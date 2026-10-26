import { build } from "bun";
import UnpluginTypia from "@typia/unplugin/bun";
import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  chmod,
  cp,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createTypiaPluginOptions } from "../typia-plugin-options.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = resolve(root, process.argv[2] ?? "dist-cli");
const result = await build({
  entrypoints: [resolve(root, "src/cli/main.ts"), resolve(root, "src/sdk.ts")],
  outdir,
  target: "bun",
  format: "esm",
  splitting: true,
  naming: { entry: "[name].[ext]", chunk: "chunk-[hash].[ext]" },
  define: { CADARA_CLI_PACKAGED: "true" },
  plugins: [UnpluginTypia({ ...createTypiaPluginOptions(root), log: false })],
});
if (!result.success) throw new AggregateError(result.logs, "CLI build failed");
await mkdir(resolve(outdir, "occ"), { recursive: true });
for (const name of ["cadara-occ.js", "cadara-occ.wasm"]) {
  await copyFile(resolve(root, "public", name), resolve(outdir, "occ", name));
}
const metadata = JSON.parse(
  await readFile(resolve(root, "src/cli/package.json"), "utf8"),
);
await writeFile(
  resolve(outdir, "package.json"),
  JSON.stringify(
    {
      ...metadata,
      bin: { cadara: "./main.js" },
      engines: { bun: ">=1.3.13" },
      exports: { "./sdk": { types: "./types/sdk.d.ts", import: "./sdk.js" } },
      types: "./types/sdk.d.ts",
      files: [
        "*.js",
        "types",
        "SDK.md",
        "occ",
        "README.md",
        "SKETCH-OPERATIONS.md",
        "PART-OPERATIONS.md",
        "COVERAGE.md",
        "examples",
        "LICENSE.md",
      ],
    },
    null,
    2,
  ) + "\n",
);
for (const [from, to] of [
  ["src/cli/README.md", "README.md"],
  ["src/cli/SKETCH-OPERATIONS.md", "SKETCH-OPERATIONS.md"],
  ["src/cli/PART-OPERATIONS.md", "PART-OPERATIONS.md"],
  ["src/cli/COVERAGE.md", "COVERAGE.md"],
  ["src/cli/SDK.md", "SDK.md"],
  ["LICENSE.md", "LICENSE.md"],
])
  await copyFile(resolve(root, from), resolve(outdir, to));
await cp(resolve(root, "src/cli/examples"), resolve(outdir, "examples"), {
  recursive: true,
});
await chmod(resolve(outdir, "main.js"), 0o755);

// Emit the public declaration closure, not the concrete headless implementation graph.
// Consumers resolve ordinary package-relative modules without checkout @/ aliases.
const ts = (await import("typescript")).default;
const configFile = ts.readConfigFile(resolve(root, "tsconfig.app.json"), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const declarationDirectory = resolve(outdir, "types");
const program = ts.createProgram([resolve(root, "src/application/semantic/sdk.ts")], {
  ...config.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  incremental: false,
  rootDir: resolve(root, "src"),
  outDir: declarationDirectory,
});
const declarations = new Map();
const emitted = program.emit(undefined, (path, content) => declarations.set(resolve(path), content));
if (emitted.emitSkipped || emitted.diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error))
  throw new Error(ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
const publicEntry = ts.transpileDeclaration(await readFile(resolve(root, "src/sdk.ts"), "utf8"), { fileName: "sdk.ts", compilerOptions: config.options, reportDiagnostics: true });
if (publicEntry.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(publicEntry.diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
declarations.set(resolve(declarationDirectory, "sdk.d.ts"), publicEntry.outputText);
const { dirname, relative } = await import("node:path");
const visited = new Set();
async function emitDeclaration(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const content = declarations.get(path);
  if (content === undefined) throw new Error(`Missing SDK declaration: ${path}`);
  const dependencies = [];
  const rewritten = content.replace(/(["'])(@\/[^"']+|\.\.?\/[^"']+)\1/g, (_match, quote, specifier) => {
    const dependency = specifier.startsWith("@/")
      ? resolve(declarationDirectory, specifier.slice(2) + ".d.ts")
      : resolve(dirname(path), specifier.replace(/\.(js|ts)$/, "") + ".d.ts");
    dependencies.push(dependency);
    const target = relative(dirname(path), dependency).replace(/\.d\.ts$/, ".js");
    return quote + (target.startsWith(".") ? target : "./" + target) + quote;
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rewritten);
  for (const dependency of dependencies) await emitDeclaration(dependency);
}
await emitDeclaration(resolve(declarationDirectory, "sdk.d.ts"));
