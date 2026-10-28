import { expect, it } from "vitest";
import { serializeAuthoredDocumentJson } from "./authored-document-serialization";
import {
  encodeGeometryAssetData,
  type BakedMeshGeometryAssetData,
} from "./geometry-assets";
import { createDeterministicCadaraBrepData } from "@/core/modeling/geometry-asset-test-helpers";

it("preserves the content-addressed bytes of retained geometry data in native JSON", () => {
  const mesh: BakedMeshGeometryAssetData = {
    kind: "bakedMeshGeometry",
    schemaVersion: "baked-mesh-geometry/v1alpha1",
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    indices: [[0, 1, 2]],
    components: [
      { sourceComponentKey: "triangle", indexStart: 0, indexCount: 1 },
    ],
  };
  for (const data of [mesh, createDeterministicCadaraBrepData()]) {
    const expected = encodeGeometryAssetData(data);
    const serialized = serializeAuthoredDocumentJson({
      assets: { records: [{ data }] },
    });
    const restored = JSON.parse(serialized).assets.records[0].data;
    expect(encodeGeometryAssetData(restored)).toEqual(expected);
  }
});
