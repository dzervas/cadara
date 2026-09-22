// Usage: node scripts/occ/probe-custom-build.mjs [custom-asset-directory] [results.json]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { runNeutralCurveConformance } from "./neutral-curve-conformance.mjs";

const directory = resolve(
  process.argv[2] ?? fileURLToPath(new URL("../../public", import.meta.url)),
);
const paths = ["cadara-occ.js", "cadara-occ.wasm", "cadara-occ.d.ts"];
const assets = Object.fromEntries(
  paths.map((name) => {
    const bytes = readFileSync(resolve(directory, name));
    return [
      name,
      {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ];
  }),
);
// Emscripten's Node branch expects these CommonJS globals even in its ES-module output.
globalThis.__dirname = directory;
globalThis.require = createRequire(
  pathToFileURL(resolve(directory, "cadara-occ.js")),
);
const { default: init } = await import(
  pathToFileURL(resolve(directory, "cadara-occ.js")).href
);
const oc = await init({
  wasmBinary: readFileSync(resolve(directory, "cadara-occ.wasm")),
});
const result = {
  runtime: process.version,
  directory,
  assets,
  ...runNeutralCurveConformance(oc),
};
// The same rebuild must include the independently owned native precision correction.
const expectedX = 0.12345678901234566;
const origin = new oc.gp_Pnt_3(expectedX, 0, 0);
const box = new oc.BRepPrimAPI_MakeBox_3(origin, 1, 2, 3);
const shape = box.Shape();
try {
  const payload = JSON.parse(
    oc.CadaraBuildNativeExactBrepPayload.BuildJson(
      shape,
      "precision",
      "t_precision",
    ),
  );
  const actualX = Math.min(
    ...payload.cadaraBrep.bodies[0].topology.vertices.map(
      (vertex) => vertex.point[0],
    ),
  );
  result.nativePrecision = { expectedX, actualX, pass: actualX === expectedX };
} finally {
  shape.delete();
  box.delete();
  origin.delete();
}
if (process.argv[3])
  writeFileSync(
    resolve(process.argv[3]),
    JSON.stringify(result, null, 2) + "\n",
  );
console.log(JSON.stringify(result));
if (result.summary.error || !result.nativePrecision.pass) process.exitCode = 1;
