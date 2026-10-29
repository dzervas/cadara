import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import { expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const exec = promisify(execFile);

async function contractModules(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? contractModules(path)
          : path.endsWith(".ts") && !/\.(?:spec|fixtures|cases)\.ts$/.test(path)
            ? [path]
            : [];
      }),
    )
  ).flat();
}

test("contracts exports stay within contracts and discover every production module", async () => {
  const contracts = join(root, "src/contracts");
  const configFile = ts.readConfigFile(
    join(root, "tsconfig.app.json"),
    ts.sys.readFile,
  );
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const modules = await contractModules(contracts);
  const offenders: string[] = [];
  for (const file of [join(root, "src/public-contracts.ts"), ...modules]) {
    const source = ts.preProcessFile(await readFile(file, "utf8"));
    for (const imported of source.importedFiles) {
      const target = ts.resolveModuleName(
        imported.fileName,
        file,
        config.options,
        ts.sys,
      ).resolvedModule;
      expect(
        target,
        `${relative(root, file)} -> ${imported.fileName}`,
      ).toBeDefined();
      if (
        target &&
        !target.isExternalLibraryImport &&
        !target.resolvedFileName.startsWith(contracts + "/")
      )
        offenders.push(`${relative(root, file)} -> ${imported.fileName}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("a file dependency runs precompiled validators and resolves portable document declarations", async () => {
  const consumer = await mkdtemp(join(tmpdir(), "cadara-contracts-consumer-"));
  try {
    // Bun runs prepare for trusted git dependencies, but not file dependencies.
    await exec("bun", ["run", "build:contracts"], {
      cwd: root,
      timeout: 180_000,
    });
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "contracts-consumer",
        type: "module",
        dependencies: { cadara: `file:${root}` },
        trustedDependencies: ["cadara"],
      }),
    );
    await writeFile(
      join(consumer, "bunfig.toml"),
      "[install]\nignoreScripts = false\n",
    );
    await exec("bun", ["install"], { cwd: consumer, timeout: 120_000 });
    await writeFile(
      join(consumer, "consumer.ts"),
      `
import { parseAuthoredModelDocument, type AuthoredModelDocument } from "cadara/contracts";
import type { CollaborativeDocument } from "cadara/contracts/documents";
import { CONTRACT_VERSION } from "cadara/contracts/shared/versioning";
const parsed = parseAuthoredModelDocument(await Bun.file(${JSON.stringify(join(root, "landing/examples/bracket/model.cadara"))}).json());
if (!parsed.ok) throw new Error(JSON.stringify(parsed));
const document: AuthoredModelDocument = parsed.document;
const storageFormat: CollaborativeDocument["format"] = "cadara-stable-authored-v3";
if (parseAuthoredModelDocument({ ...document, unexpected: true }).ok)
  throw new Error("Strict Typia validator accepted an extra field");
console.log(JSON.stringify({ ok: parsed.ok, version: CONTRACT_VERSION, storageFormat }));
`,
    );
    const result = await exec("bun", ["consumer.ts"], {
      cwd: consumer,
      timeout: 30_000,
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      storageFormat: "cadara-stable-authored-v3",
    });
    // Typecheck without checkout aliases or a consumer-side Typia plugin.
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2023",
          types: [],
        },
        files: ["types.ts"],
      }),
    );
    await writeFile(
      join(consumer, "types.ts"),
      `
import type { AuthoredModelDocument } from "cadara/contracts";
import type { CollaborativeDocument } from "cadara/contracts/documents";
import type { AuthoredValue } from "cadara/contracts/modeling/authored-actions";
export const format: CollaborativeDocument["format"] = "cadara-stable-authored-v3";
export type Stored = { document: AuthoredModelDocument; value: AuthoredValue };
`,
    );
    await exec(
      "bun",
      [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      { cwd: consumer, timeout: 60_000 },
    );
    const metadata = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    const wildcard = metadata.exports["./contracts/*"];
    for (const module of await contractModules(join(root, "src/contracts"))) {
      const subpath = relative(join(root, "src/contracts"), module).replace(
        /\.ts$/,
        "",
      );
      for (const target of [wildcard.import, wildcard.types])
        expect(
          (
            await stat(
              resolve(
                consumer,
                "node_modules/cadara",
                target.replace("*", subpath),
              ),
            )
          ).isFile(),
          subpath,
        ).toBe(true);
    }
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}, 360_000);

test("a trusted pinned git dependency builds validators during prepare", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-contracts-git-"));
  const snapshot = join(directory, "package");
  const consumer = join(directory, "consumer");
  try {
    await mkdir(snapshot);
    await mkdir(consumer);
    // No dist or node_modules: prepare must build from the same source files
    // a git consumer receives, not borrow the checkout's generated artifacts.
    for (const path of [
      "src",
      "scripts/build-contracts.mjs",
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "tsconfig.json",
      "tsconfig.app.json",
      "typia-plugin-options.ts",
      "typia-preload.ts",
      "README.md",
      "LICENSE.md",
    ])
      await cp(join(root, path), join(snapshot, path), { recursive: true });
    await exec("git", ["init", "-q"], { cwd: snapshot });
    await exec("git", ["add", "."], { cwd: snapshot });
    await exec(
      "git",
      [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Contracts test",
        "-c",
        "user.email=contracts@example.invalid",
        "commit",
        "-qm",
        "Consumer fixture",
      ],
      { cwd: snapshot },
    );
    const revision = (
      await exec("git", ["rev-parse", "HEAD"], { cwd: snapshot })
    ).stdout.trim();
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "git-contracts-consumer",
        type: "module",
        dependencies: { cadara: `git+file://${snapshot}#${revision}` },
        trustedDependencies: ["cadara"],
      }),
    );
    await writeFile(
      join(consumer, "bunfig.toml"),
      "[install]\nignoreScripts = false\n",
    );
    await exec("bun", ["install"], { cwd: consumer, timeout: 180_000 });
    await writeFile(
      join(consumer, "consumer.ts"),
      `
import { parseAuthoredModelDocument } from "cadara/contracts";
const result = parseAuthoredModelDocument(await Bun.file(${JSON.stringify(join(root, "landing/examples/bracket/model.cadara"))}).json());
if (!result.ok) throw new Error(JSON.stringify(result));
console.log(result.ok);
`,
    );
    expect(
      (
        await exec("bun", ["consumer.ts"], { cwd: consumer, timeout: 30_000 })
      ).stdout.trim(),
    ).toBe("true");
    const declaration = await readFile(
      join(
        consumer,
        "node_modules/cadara/dist/contracts/types/core/modeling/collaborative-document.d.ts",
      ),
      "utf8",
    );
    expect(declaration).toContain("interface CollaborativeDocument");
    expect(declaration).not.toContain("@/");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 240_000);
