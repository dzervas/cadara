import { expect, test } from "vitest";

import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  BAKED_BODY_FEATURE_SCHEMA_VERSION,
  CONTRACT_VERSION,
} from "@/contracts/shared/versioning";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId, GeometryAssetId } from "@/contracts/shared/ids";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  type OccAuthoringFeatureRecord,
} from "@/domain/modeling/occ/authoring-state";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import {
  createMemoryGeometryAssetStore,
  hashGeometryAssetBytes,
} from "@/domain/modeling/geometry-asset-store";
import {
  createGeometryAssetRecordFromReference,
  type BakedGeometryAssetReference,
} from "@/contracts/modeling/geometry-assets";

function makeBakedMeshBytes() {
  return new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      indices: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    }),
  );
}

const PLACEHOLDER_HASH =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;

function bakedBodyDefinition(
  assetId: GeometryAssetId,
  hash: string = PLACEHOLDER_HASH,
  byteLength = 128,
): FeatureDefinition {
  return {
    kind: "bakedBody",
    featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
    parameters: {
      assetId,
      format: "baked-mesh",
      hash: hash as BakedGeometryAssetReference["hash"],
      byteLength,
      label: "Persisted baked body",
      provenance: {
        source: "onshape",
        sourceName: "Reopened studio",
        reason: "test-bake",
      },
    },
  };
}

test("OCC bakedBody materializes resolved baked-mesh assets as durable bodies and reuses the shape cache", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const assetId = "asset_occ_baked_mesh" as GeometryAssetId;
  const definition = bakedBodyDefinition(assetId);
  const feature: OccAuthoringFeatureRecord = {
    featureId: "feature_occ_baked" as FeatureId,
    definition,
    label: "Persisted baked body",
    suppressed: false,
  };
  const state = createOccAuthoringState(oc, {
    resolvedGeometryAssets: new Map([
      [assetId, { bytes: makeBakedMeshBytes(), format: "baked-mesh" }],
    ]),
  });

  const rebuilt = applyOccFeatureToAuthoringState(state, feature);
  const rebuiltAgain = applyOccFeatureToAuthoringState(state, feature);

  expect(rebuilt.bodies[0]?.bodyId).toBe("body_feature_occ_baked");
  expect(rebuilt.bodies[0]?.topology.faceIds.length).toBeGreaterThan(0);
  expect(rebuilt.features[0]?.producedTargets).toEqual([
    { kind: "body", bodyId: "body_feature_occ_baked" },
  ]);
  expect(state.bakedShapeCache.has(assetId)).toBeTruthy();
  expect(rebuiltAgain.bodies[0]?.topology.faceIds.length).toBe(
    rebuilt.bodies[0]?.topology.faceIds.length,
  );
});

test("OCC bakedBody reports a structured diagnostic when the pre-resolved asset map is missing the asset", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const assetId = "asset_occ_missing_mesh" as GeometryAssetId;
  const feature: OccAuthoringFeatureRecord = {
    featureId: "feature_occ_missing_baked" as FeatureId,
    definition: bakedBodyDefinition(assetId),
    label: "Missing baked body",
    suppressed: false,
  };

  const rebuilt = applyOccFeatureToAuthoringState(
    createOccAuthoringState(oc),
    feature,
  );

  expect(rebuilt.bodies.length).toBe(0);
  expect(rebuilt.diagnostics.some((diagnostic) =>
    diagnostic.code === "baked-body-assetMissing" &&
    diagnostic.detail?.kind === "bakedBody" &&
    diagnostic.detail.reason === "assetMissing",
  )).toBeTruthy();
});

test("OCC adapter rebuilds a reopened bakedBody document from the persisted asset store with no session state", async () => {
  const assetId = "asset_reopened_baked_mesh" as GeometryAssetId;

  // Persist bytes exactly as bakeGeometry would, then reconstruct the store
  // record purely from the definition-carried reference.
  const store = createMemoryGeometryAssetStore();
  const bytes = makeBakedMeshBytes();
  const hash = await hashGeometryAssetBytes(bytes);
  const reference: BakedGeometryAssetReference = {
    assetId,
    format: "baked-mesh",
    hash,
    byteLength: bytes.byteLength,
  };
  const putResult = await store.put({
    asset: createGeometryAssetRecordFromReference(reference),
    bytes,
  });
  expect(putResult.ok).toBeTruthy();

  const definition = bakedBodyDefinition(assetId, hash, bytes.byteLength);
  const document: AuthoredModelDocument = {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
    name: "Reopened baked document",
    revisionId: "rev_0002" as never,
    settings: OCC_KERNEL_SETTINGS,
    variables: [],
    sketches: [],
    features: [
      {
        featureId: "feature_reopened_baked" as FeatureId,
        label: "Reopened baked body",
        suppressed: false,
        definition,
      },
    ],
    featureOrder: ["feature_reopened_baked" as FeatureId],
    historyOrder: [
      { kind: "feature", featureId: "feature_reopened_baked" as FeatureId },
    ],
    cursor: { kind: "feature", featureId: "feature_reopened_baked" as FeatureId },
    bodyLabels: [],
    assets: { schemaVersion: "geometry-asset-manifest/v1alpha1", records: [] },
    embeddedBinaryAssets: [],
  };

  // A COMPLETELY FRESH adapter/resolver: it holds only the persisted store and
  // resolves strictly from the definition-carried reference — no shared registry.
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: new SketchConstraintSolverAdapter({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: document.revisionId,
    }),
    getOpenCascadeInstance: getDefaultOpenCascadeInstance,
    assetResolver: {
      async resolveGeometryAsset(requestedReference) {
        const stored = await store.get(
          createGeometryAssetRecordFromReference(requestedReference),
        );
        return stored.ok
          ? { bytes: stored.bytes.slice(), format: requestedReference.format }
          : null;
      },
    },
  });

  await adapter.restoreAuthoredModelDocument(document);
  const runtimeState = await (
    adapter as unknown as {
      getRuntimeState(): Promise<{ authoringState: { bodies: Array<{ ownerFeatureId: FeatureId | null }> } }>;
    }
  ).getRuntimeState();

  expect(runtimeState.authoringState.bodies.some((body) =>
    body.ownerFeatureId === "feature_reopened_baked",
  )).toBeTruthy();
});
