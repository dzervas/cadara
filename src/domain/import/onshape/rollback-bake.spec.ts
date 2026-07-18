import { expect, test } from "vitest";

import type { ImportCapabilities } from "@/contracts/import/capabilities";
import {
  encodeRollbackSnapshotBake,
  prepareRollbackCheckpointBake,
} from "@/domain/import/onshape/rollback-bake";

const triangle = (offset: number) => ({
  faces: [
    {
      facets: [
        {
          vertices: [
            { x: offset, y: 0, z: 0 },
            { x: offset + 0.001, y: 0, z: 0 },
            { x: offset, y: 0.001, z: 0 },
          ],
        },
      ],
    },
  ],
});

const snapshot = {
  featureId: "failed-feature",
  tessellationTolerance: 0.001,
  tessellatedFaces: {
    bodies: [
      { id: "changed-body", ...triangle(0) },
      { id: "independent-body", ...triangle(0.01) },
      { id: "carried-body", ...triangle(0.02) },
    ],
  },
} as const;

let bakedBytes: Uint8Array | null = null;
const capabilities = {
  context: {
    contractVersion: "cadara-contract/v1alpha1",
    documentId: "doc_test",
    baseRevisionId: "rev_test",
  },
  modeling: {
    async bakeGeometry({ bytes }: { bytes: Uint8Array }) {
      bakedBytes = bytes;
      return {
        assetId: "asset_checkpoint",
        format: "baked-mesh",
        hash: `sha256:${"a".repeat(64)}`,
        byteLength: bytes.byteLength,
      };
    },
  },
} as ImportCapabilities;

test("encodes selected checkpoint bodies with deterministic identity in snapshot order", () => {
  const bytes = encodeRollbackSnapshotBake(snapshot, [
    "carried-body",
    "changed-body",
  ]);
  expect(bytes).not.toBeNull();
  const mesh = JSON.parse(new TextDecoder().decode(bytes!));

  expect(mesh.vertices[1]).toEqual([1, 0, 0]);
  expect(mesh.components).toEqual([
    {
      sourceComponentKey: "onshape-body:changed-body",
      indexStart: 0,
      indexCount: 1,
    },
    {
      sourceComponentKey: "onshape-body:carried-body",
      indexStart: 1,
      indexCount: 1,
    },
  ]);
  expect(mesh.vertices).toHaveLength(6);
});

test("refuses checkpoint selection when a requested deterministic body is absent", () => {
  expect(encodeRollbackSnapshotBake(snapshot, ["missing-body"])).toBeNull();
});

test("prepares the planner-supplied provenance span and replacement closure", async () => {
  bakedBytes = null;
  const result = await prepareRollbackCheckpointBake({
    snapshot,
    capabilities,
    featureLabel: "Transform checkpoint",
    studioElementId: "studio",
    studioName: "Studio",
    checkpointBodyDeterministicIds: ["changed-body", "carried-body"],
    provenanceFeatureSpan: {
      fromFeatureId: "transform-start",
      toFeatureId: "failed-feature",
    },
    replacementActionIndexes: [0, 2],
  });

  expect(result.kind).toBe("ready");
  expect(bakedBytes).not.toBeNull();
  const mesh = JSON.parse(new TextDecoder().decode(bakedBytes!));
  expect(mesh.components.map((component: { sourceComponentKey: string }) => component.sourceComponentKey)).toEqual([
    "onshape-body:changed-body",
    "onshape-body:carried-body",
  ]);

  if (result.kind === "ready") {
    expect(result.request.definition.parameters.replacement).toEqual({
      kind: "replaceBodyOutputs",
      actionIndexes: [0, 2],
    });
    expect(result.request.definition.parameters.provenance.featureSpan).toEqual({
      fromFeatureId: "transform-start",
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
