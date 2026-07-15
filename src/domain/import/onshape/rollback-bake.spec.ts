import { expect, test } from "vitest";

import type { ImportCapabilities } from "@/contracts/import/capabilities";
import {
  encodeRollbackSnapshotBake,
  prepareRollbackCheckpointBake,
} from "@/domain/import/onshape/rollback-bake";

const snapshot = {
  featureId: "failed-feature",
  tessellationTolerance: 0.001,
  tessellatedFaces: {
    bodies: [
      {
        faces: [
          {
            facets: [
              {
                vertices: [
                  { x: 0, y: 0, z: 0 },
                  { x: 0.001, y: 0, z: 0 },
                  { x: 0, y: 0.001, z: 0 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
} as const;

const capabilities = {
  context: {
    contractVersion: "cadara-contract/v1alpha1",
    documentId: "doc_test",
    baseRevisionId: "rev_test",
  },
  modeling: {
    async bakeGeometry({ bytes }: { bytes: Uint8Array }) {
      return {
        assetId: "asset_checkpoint",
        format: "baked-mesh",
        hash: `sha256:${"a".repeat(64)}`,
        byteLength: bytes.byteLength,
      };
    },
  },
} as ImportCapabilities;

test("encodes a v2 post-feature snapshot and prepares an in-position replacement", async () => {
  const bytes = encodeRollbackSnapshotBake(snapshot);
  expect(bytes).not.toBeNull();
  const mesh = JSON.parse(new TextDecoder().decode(bytes!));
  expect(mesh.vertices[1]).toEqual([1, 0, 0]);

  const result = await prepareRollbackCheckpointBake({
    snapshot,
    capabilities,
    featureLabel: "Failed chamfer checkpoint",
    studioElementId: "studio",
    studioName: "Studio",
    replacementActionIndexes: [0, 2],
  });
  expect(result.kind).toBe("ready");
  if (result.kind === "ready") {
    expect(result.request.definition.parameters.replacement).toEqual({
      kind: "replaceBodyOutputs",
      actionIndexes: [0, 2],
    });
    expect(result.request.definition.parameters.provenance.featureSpan).toEqual({
      fromFeatureId: "failed-feature",
      toFeatureId: "failed-feature",
    });
  }
});

test("reports the explicit legacy/no-snapshot degradation", async () => {
  expect(
    await prepareRollbackCheckpointBake({
      snapshot: null,
      capabilities,
      featureLabel: "Missing",
      studioElementId: "studio",
      studioName: "Studio",
      replacementActionIndexes: [],
    }),
  ).toEqual({ kind: "missing", reason: "topology-bake-snapshot-missing" });
});
