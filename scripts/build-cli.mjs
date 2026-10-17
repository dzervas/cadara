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
  entrypoints: [resolve(root, "src/cli/main.ts")],
  outdir,
  target: "bun",
  format: "esm",
  splitting: false,
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
      files: [
        "main.js",
        "occ",
        "README.md",
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
  ["src/cli/COVERAGE.md", "COVERAGE.md"],
  ["LICENSE.md", "LICENSE.md"],
])
  await copyFile(resolve(root, from), resolve(outdir, to));
await cp(resolve(root, "src/cli/examples"), resolve(outdir, "examples"), {
  recursive: true,
});
await chmod(resolve(outdir, "main.js"), 0o755);
