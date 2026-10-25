import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import { OCC_ASSET_VERSION } from "../../src/domain/modeling/occ/assets";
import { OCC_WASM_BYTE_LENGTH } from "../../src/domain/modeling/occ/asset-version";

function sha256Artifact(name: "cadara-occ.js" | "cadara-occ.wasm") {
  return createHash("sha256")
    .update(readFileSync(join(process.cwd(), "public", name)))
    .digest("hex");
}

test("test/static/occ-asset-version.spec.ts", () => {
  const expectedVersion = `${sha256Artifact("cadara-occ.js")}-${sha256Artifact("cadara-occ.wasm")}`;

  expect(
    OCC_ASSET_VERSION,
    "The checked-in OCC asset version must change whenever either generated JS or WASM artifact changes.",
  ).toBe(expectedVersion);
  expect(
    OCC_WASM_BYTE_LENGTH,
    "Engine download progress counts decoded bytes against the shipped wasm size.",
  ).toBe(statSync(join(process.cwd(), "public", "cadara-occ.wasm")).size);

  const workerSource = readFileSync(
    join(process.cwd(), "src/domain/modeling/occ/worker.ts"),
    "utf8",
  );
  expect(
    workerSource.includes("getVersionedOpenCascadeRuntimeAssetUrls"),
    "The OCC worker must initialize its wasm URL through the same versioned runtime asset resolver.",
  ).toBeTruthy();
});
