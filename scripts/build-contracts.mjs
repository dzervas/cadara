import { build, Glob } from "bun";
import UnpluginTypia from "@typia/unplugin/bun";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { createTypiaPluginOptions } from "../typia-plugin-options.ts";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src");
const outdir = resolve(root, "dist/contracts");
const modules = [
  ...new Glob("contracts/**/*.ts").scanSync({ cwd: source }),
].filter((name) => !/\.(?:spec|fixtures|cases)\.ts$/.test(name));
const entrypoints = [
  "public-contracts.ts",
  "public-document-types.ts",
  ...modules,
].map((name) => resolve(source, name));
const result = await build({
  entrypoints,
  root: source,
  outdir,
  target: "browser",
  format: "esm",
  splitting: true,
  packages: "external",
  plugins: [UnpluginTypia({ ...createTypiaPluginOptions(root), log: false })],
});
if (!result.success)
  throw new AggregateError(result.logs, "Contracts build failed");

// TypeScript emits the declaration graph; rewrite checkout aliases to portable
// relative JS specifiers, just as the CLI distribution does.
const configFile = ts.readConfigFile(
  resolve(root, "tsconfig.app.json"),
  ts.sys.readFile,
);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const declarationDirectory = resolve(outdir, "types");
const declarationOptions = {
  ...config.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  incremental: false,
  rootDir: source,
  outDir: declarationDirectory,
};
// A git dependency is built beneath node_modules. TypeScript treats imported
// files there as external and otherwise skips their declarations on emit.
const graph = ts.createProgram(entrypoints, declarationOptions);
const program = ts.createProgram(
  graph
    .getSourceFiles()
    .filter(
      (file) =>
        file.fileName.startsWith(source + "/") && !file.isDeclarationFile,
    )
    .map((file) => file.fileName),
  declarationOptions,
);
const declarations = new Map();
const emitted = program.emit(undefined, (path, content) =>
  declarations.set(resolve(path), content),
);
if (
  emitted.emitSkipped ||
  emitted.diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)
)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
const visited = new Set();
async function emitDeclaration(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const content = declarations.get(path);
  if (content === undefined)
    throw new Error(`Missing contract declaration: ${path}`);
  const dependencies = [];
  const rewritten = content.replace(
    /(["'])(@\/[^"']+|\.\.?\/[^"']+)\1/g,
    (_match, quote, specifier) => {
      let dependency = specifier.startsWith("@/")
        ? resolve(declarationDirectory, specifier.slice(2) + ".d.ts")
        : resolve(dirname(path), specifier.replace(/\.(js|ts)$/, "") + ".d.ts");
      if (!declarations.has(dependency))
        dependency = dependency.replace(/\.d\.ts$/, "/index.d.ts");
      dependencies.push(dependency);
      const target = relative(dirname(path), dependency).replace(
        /\.d\.ts$/,
        ".js",
      );
      return quote + (target.startsWith(".") ? target : "./" + target) + quote;
    },
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rewritten);
  for (const dependency of dependencies) await emitDeclaration(dependency);
}
for (const entry of entrypoints)
  await emitDeclaration(
    resolve(
      declarationDirectory,
      relative(source, entry).replace(/\.ts$/, ".d.ts"),
    ),
  );
