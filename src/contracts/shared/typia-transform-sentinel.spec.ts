import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import UnpluginTypia from "@typia/unplugin/vite";
import { test, expect } from "vitest";
import typia, { type tags } from "typia";

import { createTypiaPluginOptions } from "../../../typia-plugin-options";

interface TypiaTransformSentinel {
  kind: "typia-transform-sentinel";
  value: number & tags.ExclusiveMinimum<0>;
}

const validateSentinel = typia.createValidateEquals<TypiaTransformSentinel>();

test("Typia generated validators execute in Bun tests", () => {
  const valid = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 1,
  });
  expect(
    valid.success,
    "Typia should validate a matching tagged payload.",
  ).toBeTruthy();

  const extraField = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 1,
    extra: true,
  });
  expect(
    extraField.success,
    "Typia strict validation should reject extra persisted fields.",
  ).toBeFalsy();

  const invalidConstraint = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 0,
  });
  expect(
    invalidConstraint.success,
    "Typia should enforce generated primitive constraints.",
  ).toBeFalsy();
});

async function transformWithProductionOptions(
  rootDir: string,
  id: string,
  source: string,
) {
  const plugin = UnpluginTypia(createTypiaPluginOptions(rootDir));
  const hook = plugin.transform;
  if (typeof hook !== "function") {
    throw new Error("Expected Typia's Vite transform hook to be a function.");
  }
  if (plugin.transformInclude?.(id) === false) {
    throw new Error(
      `Production Typia options excluded regression fixture ${id}.`,
    );
  }

  const result = await hook.call({ warn() {} }, source, id);
  if (result == null) return source;
  return typeof result === "string" ? result : result.code;
}

function runBun(scriptPath: string, cwd: string, cacheDir: string) {
  const result = spawnSync("bun", [scriptPath], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CACHE_DIR: cacheDir },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout.trim();
}

test("production Typia options invalidate validators when an imported type changes", async () => {
  const projectRoot = process.cwd();
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "cadara-typia-cache-"));
  const fixtureDir = path.join(rootDir, "src", "contracts", "shared");
  const entryPath = path.join(fixtureDir, "typia-transform-sentinel.spec.ts");
  const payloadPath = path.join(fixtureDir, "payload.ts");
  const source = [
    'import typia from "typia";',
    'import type { Payload } from "./payload";',
    "export const validate = typia.createValidateEquals<Payload>();",
    "",
  ].join("\n");
  const payload = (kind: "alpha" | "beta") =>
    `export interface Payload { kind: "${kind}"; value: number; }\n`;
  const originalCacheDir = process.env.CACHE_DIR;

  try {
    await writeFile(
      path.join(rootDir, "tsconfig.app.json"),
      JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          target: "ES2022",
        },
        include: ["src"],
      }),
    );
    await symlink(
      path.join(projectRoot, "node_modules"),
      path.join(rootDir, "node_modules"),
    );
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(payloadPath, payload("alpha"));

    process.env.CACHE_DIR = path.join(rootDir, "main-cache");
    const alphaCode = await transformWithProductionOptions(
      rootDir,
      entryPath,
      source,
    );
    await writeFile(path.join(rootDir, "generated-alpha.ts"), alphaCode);

    await writeFile(payloadPath, payload("beta"));
    const betaCode = await transformWithProductionOptions(
      rootDir,
      entryPath,
      source,
    );
    await writeFile(path.join(rootDir, "generated-beta.ts"), betaCode);

    const optionsUrl = pathToFileURL(
      path.join(projectRoot, "typia-plugin-options.ts"),
    ).href;
    await writeFile(
      path.join(rootDir, "cold-transform.ts"),
      [
        'import { writeFile } from "node:fs/promises";',
        'import path from "node:path";',
        'import UnpluginTypia from "@typia/unplugin/vite";',
        `import { createTypiaPluginOptions } from ${JSON.stringify(optionsUrl)};`,
        `const rootDir = ${JSON.stringify(rootDir)};`,
        `const id = ${JSON.stringify(entryPath)};`,
        `const source = ${JSON.stringify(source)};`,
        "const plugin = UnpluginTypia(createTypiaPluginOptions(rootDir));",
        "const hook = plugin.transform;",
        'if (typeof hook !== "function") throw new Error("Missing transform hook.");',
        "const result = await hook.call({ warn() {} }, source, id);",
        'const code = result == null ? source : typeof result === "string" ? result : result.code;',
        'await writeFile(path.join(rootDir, "generated-cold-beta.ts"), code);',
        "",
      ].join("\n"),
    );
    runBun(
      path.join(rootDir, "cold-transform.ts"),
      rootDir,
      path.join(rootDir, "cold-cache"),
    );

    await writeFile(
      path.join(rootDir, "assert-validators.ts"),
      [
        'import { validate as alpha } from "./generated-alpha.ts";',
        'import { validate as beta } from "./generated-beta.ts";',
        'import { validate as coldBeta } from "./generated-cold-beta.ts";',
        "const semantics = (validate: (input: unknown) => { success: boolean }) => ({",
        '  alpha: validate({ kind: "alpha", value: 1 }).success,',
        '  beta: validate({ kind: "beta", value: 1 }).success,',
        "});",
        "console.log(JSON.stringify({",
        "  alpha: semantics(alpha),",
        "  beta: semantics(beta),",
        "  coldBeta: semantics(coldBeta),",
        "}));",
        "",
      ].join("\n"),
    );
    const semantics = JSON.parse(
      runBun(
        path.join(rootDir, "assert-validators.ts"),
        rootDir,
        path.join(rootDir, "runtime-cache"),
      ),
    );

    expect(semantics.alpha).toEqual({ alpha: true, beta: false });
    expect(
      semantics.beta,
      "The unchanged primary source must not reuse an alpha validator after its imported type becomes beta.",
    ).toEqual({ alpha: false, beta: true });
    expect(
      semantics.coldBeta,
      "A cold process confirms the current imported type independently of module-global state.",
    ).toEqual({ alpha: false, beta: true });
  } finally {
    if (originalCacheDir == null) delete process.env.CACHE_DIR;
    else process.env.CACHE_DIR = originalCacheDir;
    await rm(rootDir, { recursive: true, force: true });
  }
});
