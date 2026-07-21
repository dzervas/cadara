import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type {
  BodyId,
  FeatureId,
  SketchEntityId,
  SketchId,
} from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import { executeShellFeature } from "@/domain/modeling/occ/features/shell";
import { getShapeVertexPoints } from "@/domain/modeling/occ/features/extrude";
import {
  executeMirrorFeature,
  executeTransformFeature,
} from "@/domain/modeling/occ/features/mirror-transform";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  getOccDurableRefKey,
  trackNewSolidBody,
  type OccReferenceInvalidationRecord,
} from "@/domain/modeling/occ/topology";
import {
  SKETCH_SCHEMA_VERSION,
  SOLVED_SKETCH_SCHEMA_VERSION,
  type SketchRecord,
} from "@/contracts/sketch/schema";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  createStandardPlaneDefinition,
} from "@/domain/modeling/opencascade-kernel-seed";

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadCustomOpenCascadeForTest() {
  const module = (await import("../../../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(
      new URL("../../../../../public/cadara-occ.wasm", import.meta.url),
    ),
  );

  return new module.default({ wasmBinary });
}

function makeTrackedBox(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  ownerFeatureId: FeatureId,
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 4, 4, 4);
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

function getShapeBounds(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const points = getShapeVertexPoints(oc, shape);
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
    minZ: Math.min(...points.map(([, , z]) => z)),
    maxZ: Math.max(...points.map(([, , z]) => z)),
  };
}

function makeSketchLineAxis(
  sketchId: SketchId,
  entityId: SketchEntityId,
): SketchSnapshotRecord {
  const plane = createStandardPlaneDefinition("xy");
  const sketch: SketchRecord = {
    ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
    ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: "Rotation axis",
    planeSupport: plane.support,
    definition: {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    },
    solvedSnapshot: {
      schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
      status: { solveState: "solved", constraintState: "wellConstrained" },
      solvedEntities: [
        {
          kind: "lineSegment",
          entityId,
          startPosition: [0, 0],
          endPosition: [0, 4],
        },
      ],
      solvedPoints: [],
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    },
    regions: [],
  };

  return {
    ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
    ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: "Rotation axis",
    plane,
    planeTarget: plane.support,
    planeKey: plane.key,
    sketch,
  };
}

function assertNativeHistoryDidNotFallBack(
  invalidations: ReadonlyMap<string, OccReferenceInvalidationRecord>,
  label: string,
) {
  for (const invalidation of invalidations.values()) {
    expect(
      invalidation.reason,
      `${label} should use native history instead of unsupported-history invalidations.`,
    ).not.toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory);
    expect(
      invalidation.reason,
      `${label} should use native successor classifications instead of JS-side modified-history invalidations.`,
    ).not.toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyModified);
  }
}

test("executeTransformFeature uses native transaction history for replacement topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_transform_history_seed" as BodyId,
    "feature_native_transform_history_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeTransformFeature(
    context,
    "feature_native_transform_history" as FeatureId,
    {
      kind: "transform",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
          {
            role: "transformReference",
            targets: [
              { kind: "construction", constructionId: "construction_plane-xy" },
            ],
          },
        ],
        options: { distance: 1 },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" },
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(
    replacement != null,
    "Native transform should replace the selected body.",
  ).toBeTruthy();
  expect(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Native transform should preserve previous face ids with unique successors.",
  ).toBeTruthy();
  const output = result.topologyStage?.outputs.get(body.bodyId);
  expect(output, "Native transform should publish a topology stage.").toBeTruthy();
  const sourceKeyPrefix = `rigid-transform:feature_native_transform_history:${body.bodyId}:`;
  const expectedSourceCount =
    body.topology.faceIds.length +
    body.topology.edgeIds.length +
    body.topology.vertexIds.length;
  expect(output!.sourceTargets.size).toBe(expectedSourceCount);
  expect(output!.unsupportedSourceKeys.size).toBe(0);
  expect(
    [...output!.sourceTargets.keys()].every((key) =>
      key.startsWith(sourceKeyPrefix),
    ),
    "Rigid transform source keys should be stable semantic keys, not traversal positions.",
  ).toBeTruthy();
  const targetKeys = [...output!.sourceTargets.values()].flatMap((targets) =>
    targets.map((target) => getOccDurableRefKey(target)),
  );
  expect(new Set(targetKeys).size).toBe(expectedSourceCount);
  expect(
    targetKeys.every((key) =>
      [
        ...replacement!.topology.faceIds.map((faceId) =>
          getOccDurableRefKey({ kind: "face", bodyId: body.bodyId, faceId }),
        ),
        ...replacement!.topology.edgeIds.map((edgeId) =>
          getOccDurableRefKey({ kind: "edge", bodyId: body.bodyId, edgeId }),
        ),
        ...replacement!.topology.vertexIds.map((vertexId) =>
          getOccDurableRefKey({ kind: "vertex", bodyId: body.bodyId, vertexId }),
        ),
      ].includes(key),
    ),
    "Every rigid transform source should map to one current same-body successor.",
  ).toBeTruthy();
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Native transform",
  );
});

test("executeTransformFeature fallback publishes honest unsupported topology stage", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeTransactions = nativeHost.CadaraExecuteNativeFeatureTransaction;
  const nativeTransform =
    nativeTransactions?.BuildTransformCommittedShapeTransactionWithHistory;
  if (nativeTransactions) {
    delete nativeTransactions.BuildTransformCommittedShapeTransactionWithHistory;
  }
  try {
    const body = makeTrackedBox(
      oc,
      "body_transform_fallback_seed" as BodyId,
      "feature_transform_fallback_seed" as FeatureId,
    );
    const context = createOccAuthoringState(oc, { bodies: [body] });
    const result = executeTransformFeature(
      context,
      "feature_transform_fallback" as FeatureId,
      {
        kind: "transform",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
            {
              role: "transformReference",
              targets: [
                { kind: "construction", constructionId: "construction_plane-xy" },
              ],
            },
          ],
          options: { distance: 1 },
        },
      } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" },
    );
    const output = result.topologyStage?.outputs.get(body.bodyId);
    expect(output?.sourceTargets.size).toBe(0);
    expect(output?.unsupportedSourceKeys.size).toBe(0);
  } finally {
    if (nativeTransactions && nativeTransform) {
      nativeTransactions.BuildTransformCommittedShapeTransactionWithHistory =
        nativeTransform;
    }
  }
});

test("executeTransformFeature rotates a body about a construction-plane axis while retaining identity", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_rotation_seed" as BodyId,
    "feature_rotation_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeTransformFeature(
    context,
    "feature_rotation" as FeatureId,
    {
      kind: "transform",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
          {
            role: "axis",
            targets: [
              { kind: "construction", constructionId: "construction_plane-xy" },
            ],
          },
        ],
        options: { transformType: "rotation", angle: 90 },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" },
  );

  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );
  expect(
    replacement != null,
    "Rotation should replace the selected body in place, retaining its bodyId.",
  ).toBeTruthy();
  expect(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Rotation should preserve previous face ids as unique successors.",
  ).toBeTruthy();
  assertNativeHistoryDidNotFallBack(result.historyInvalidations, "Rotation");

  // The seed box spans [0,4]^3. A +90° rotation about the +Z axis through the
  // origin maps (x, y, z) -> (-y, x, z), so the rotated body spans
  // x in [-4, 0], y in [0, 4], z in [0, 4].
  const points = getShapeVertexPoints(oc, replacement!.shape);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const zs = points.map((point) => point[2]);
  expect(Math.min(...xs)).toBeCloseTo(-4, 5);
  expect(Math.max(...xs)).toBeCloseTo(0, 5);
  expect(Math.min(...ys)).toBeCloseTo(0, 5);
  expect(Math.max(...ys)).toBeCloseTo(4, 5);
  expect(Math.min(...zs)).toBeCloseTo(0, 5);
  expect(Math.max(...zs)).toBeCloseTo(4, 5);
});

test("executeTransformFeature rotates about a committed sketch line while retaining identity and provenance", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_sketch_rotation_seed" as BodyId,
    "feature_sketch_rotation_seed" as FeatureId,
  );
  const sketchId = "sketch_transform_rotation_axis" as SketchId;
  const entityId = "sketch_entity_transform_rotation_axis" as SketchEntityId;
  const axisSketch = makeSketchLineAxis(sketchId, entityId);
  const context = createOccAuthoringState(oc, {
    bodies: [body],
    sketches: [axisSketch],
  });

  const result = executeTransformFeature(
    context,
    "feature_sketch_rotation" as FeatureId,
    {
      kind: "transform",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
          {
            role: "axis",
            targets: [{ kind: "sketchEntity", sketchId, entityId }],
          },
        ],
        options: { transformType: "rotation", angle: 90 },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" },
  );

  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );
  expect(
    replacement,
    "Sketch-line rotation should retain the bodyId.",
  ).toBeDefined();
  expect(
    body.contributingFeatureIds.every((featureId) =>
      replacement?.contributingFeatureIds.includes(featureId),
    ),
    "Sketch-line rotation should retain the body's existing feature provenance.",
  ).toBeTruthy();
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Sketch-line rotation",
  );

  // The +Y sketch line rotates (x, y, z) -> (z, y, -x).
  const points = getShapeVertexPoints(oc, replacement!.shape);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const zs = points.map((point) => point[2]);
  expect(Math.min(...xs)).toBeCloseTo(0, 5);
  expect(Math.max(...xs)).toBeCloseTo(4, 5);
  expect(Math.min(...ys)).toBeCloseTo(0, 5);
  expect(Math.max(...ys)).toBeCloseTo(4, 5);
  expect(Math.min(...zs)).toBeCloseTo(-4, 5);
  expect(Math.max(...zs)).toBeCloseTo(0, 5);
});

test("executeShellFeature uses native shell transaction before replacement boolean composition", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_shell_history_seed" as BodyId,
    "feature_native_shell_history_seed" as FeatureId,
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildShellCommittedShapeTransactionWithHistory;
  let nativeCallCount = 0;
  expect(
    typeof nativeBuilder,
    "Expected custom OCC runtime to expose native shell transactions.",
  ).toBe("function");
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildShellCommittedShapeTransactionWithHistory =
    (...args) => {
      nativeCallCount += 1;
      return nativeBuilder(...args);
    };
  const faceId = body.topology.faceIds[0];
  expect(
    faceId != null,
    "Expected the tracked box to expose a shell removable face target.",
  ).toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeShellFeature(
    context,
    "feature_native_shell_history" as FeatureId,
    {
      bodyTarget: { kind: "body", bodyId: body.bodyId },
      faceTargets: [{ kind: "face", bodyId: body.bodyId, faceId }],
      thickness: 0.2,
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId: body.bodyId },
    },
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(
    replacement != null,
    "Native shell composition should replace the selected body.",
  ).toBeTruthy();
  expect(
    nativeCallCount,
    "Shell feature execution should use the native shell transaction when available.",
  ).toBe(1);
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Native shell composition",
  );
});

// Lane: logic (per docs/testing.md — exported OCC feature execution is a
// deterministic domain seam around the OpenCascade runtime, not UI behavior).
// Seam: executeShellFeature offsetAllFaces branch uses OCC PerformByJoin,
// replaces the targeted body identity in place, and publishes honest topology.
test("executeShellFeature offsets all shell faces as an in-place body replacement", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_offset_all_faces_seed" as BodyId,
    "feature_offset_all_faces_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const inward = executeShellFeature(
    context,
    "feature_offset_all_faces_inward" as FeatureId,
    {
      mode: "offsetAllFaces",
      bodyTarget: { kind: "body", bodyId: body.bodyId },
      faceTargets: [],
      thickness: 0.2,
      direction: "inside",
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId: body.bodyId },
    },
  );
  const inwardBody = inward.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );
  expect(inward.bodies.length).toBe(1);
  expect(inwardBody, "Offset-all shell should retain the source body id.").toBeTruthy();
  expect(inward.producedTargets).toEqual([{ kind: "body", bodyId: body.bodyId }]);
  expect(inward.topologyStage?.outputs.get(body.bodyId)?.sourceTargets.size).toBe(0);

  const inwardBounds = getShapeBounds(oc, inwardBody!.shape);
  expect(inwardBounds.minX).toBeCloseTo(0.2, 5);
  expect(inwardBounds.maxX).toBeCloseTo(3.8, 5);
  expect(inwardBounds.minY).toBeCloseTo(0.2, 5);
  expect(inwardBounds.maxY).toBeCloseTo(3.8, 5);
  expect(inwardBounds.minZ).toBeCloseTo(0.2, 5);
  expect(inwardBounds.maxZ).toBeCloseTo(3.8, 5);

  const outward = executeShellFeature(
    context,
    "feature_offset_all_faces_outward" as FeatureId,
    {
      mode: "offsetAllFaces",
      bodyTarget: { kind: "body", bodyId: body.bodyId },
      faceTargets: [],
      thickness: 0.2,
      direction: "outside",
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId: body.bodyId },
    },
  );
  const outwardBody = outward.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );
  const outwardBounds = getShapeBounds(oc, outwardBody!.shape);
  expect(outwardBounds.minX).toBeCloseTo(-0.2, 5);
  expect(outwardBounds.maxX).toBeCloseTo(4.2, 5);
  expect(outwardBounds.minY).toBeCloseTo(-0.2, 5);
  expect(outwardBounds.maxY).toBeCloseTo(4.2, 5);
  expect(outwardBounds.minZ).toBeCloseTo(-0.2, 5);
  expect(outwardBounds.maxZ).toBeCloseTo(4.2, 5);

  expect(() =>
    executeShellFeature(
      context,
      "feature_offset_all_faces_excessive" as FeatureId,
      {
        mode: "offsetAllFaces",
        bodyTarget: { kind: "body", bodyId: body.bodyId },
        faceTargets: [],
        thickness: 3,
        direction: "inside",
        operation: "join",
        booleanScope: { kind: "targetBody", bodyId: body.bodyId },
      },
    ),
  ).toThrow();
});

test("executeMirrorFeature uses native transform transaction for copied topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_mirror_seed" as BodyId,
    "feature_native_mirror_seed" as FeatureId,
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildTransformCommittedShapeTransactionWithHistory;
  let nativeCallCount = 0;
  expect(
    typeof nativeBuilder,
    "Expected custom OCC runtime to expose native transform transactions.",
  ).toBe("function");
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildTransformCommittedShapeTransactionWithHistory =
    (...args) => {
      nativeCallCount += 1;
      return nativeBuilder(...args);
    };
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeMirrorFeature(
    context,
    "feature_native_mirror" as FeatureId,
    {
      kind: "mirror",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
          {
            role: "plane",
            targets: [
              { kind: "construction", constructionId: "construction_plane-yz" },
            ],
          },
        ],
        options: { copy: true },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "mirror" },
  );
  const mirroredBody = result.bodies.find(
    (candidate) => candidate.bodyId !== body.bodyId,
  );

  expect(
    mirroredBody != null,
    "Native mirror should append a copied body.",
  ).toBeTruthy();
  expect(
    nativeCallCount,
    "Mirror feature execution should use the native transform transaction when available.",
  ).toBe(1);
  expect(
    result.historyInvalidations.size,
    "Mirror copy should keep source topology live and create fresh copied topology.",
  ).toBe(0);
});
