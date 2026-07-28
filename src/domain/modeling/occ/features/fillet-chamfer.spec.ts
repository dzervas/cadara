import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import { getOccDurableRefKey } from "@/domain/modeling/occ/topology";
import {
  executeChamferFeature,
  executeFilletFeature,
} from "@/domain/modeling/occ/features/fillet-chamfer";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import { classifySemanticStageTopology } from "@/domain/modeling/occ/topology-naming";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  type OccReferenceInvalidationRecord,
} from "@/domain/modeling/occ/topology";

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
  const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 2, 2, 2);
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

function bodyVolume(oc: OpenCascadeInstance, shape: object) {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(
    shape as InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
    props,
    false,
    false,
    false,
  );
  return props.Mass();
}

function chamferDefinition(
  bodyId: BodyId,
  edgeId: `edge_${string}`,
  options: NonNullable<AdvancedSolidFeatureDefinition["parameters"]["options"]>,
) {
  return {
    kind: "chamfer" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "edge" as const,
          targets: [{ kind: "edge" as const, bodyId, edgeId }],
        },
      ],
      options,
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "chamfer" };
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

test("executeFilletFeature uses native transaction history for replacement topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_fillet_history_seed" as BodyId,
    "feature_native_fillet_history_seed" as FeatureId,
  );
  const edgeId = body.topology.edgeIds[0];
  expect(
    edgeId != null,
    "Expected the tracked box to expose a fillet edge target.",
  ).toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeFilletFeature(
    context,
    "feature_native_fillet_history" as FeatureId,
    {
      radius: 0.15,
      edgeTargets: [{ kind: "edge", bodyId: body.bodyId, edgeId }],
    },
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(
    replacement != null,
    "Native fillet should replace the target body.",
  ).toBeTruthy();
  expect(
    replacement!.topology.faceIds.length > body.topology.faceIds.length,
    "Native fillet should add fillet topology.",
  ).toBeTruthy();
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Native fillet",
  );
});

test("executeChamferFeature cuts unequal two-distance chamfers through OCC Add_3", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_two_distance_chamfer_seed" as BodyId,
    "feature_two_distance_chamfer_seed" as FeatureId,
  );
  const edgeId = body.topology.edgeIds[0];
  expect(edgeId, "Expected the tracked box to expose a chamfer edge target.").toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeChamferFeature(
    context,
    "feature_two_distance_chamfer" as FeatureId,
    chamferDefinition(body.bodyId, edgeId, {
      widthForm: createLiteralAuthoredValue("twoOffsets"),
      distance1: createLiteralAuthoredValue(0.2),
      distance2: createLiteralAuthoredValue(0.5),
    }),
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(replacement, "Two-distance chamfer should replace the target body.").toBeTruthy();
  expect(
    replacement!.topology.faceIds.length,
    "Two-distance chamfer should add chamfer topology.",
  ).toBeGreaterThan(body.topology.faceIds.length);
  expect(
    replacement!.contributingFeatureIds,
    "Two-distance chamfer should preserve body provenance.",
  ).toContain("feature_two_distance_chamfer" as FeatureId);
  expect(
    bodyVolume(oc, replacement!.shape),
    "A 0.2 x 0.5 chamfer along a length-2 box edge should remove both unequal offsets, not collapse to either equal-distance form.",
  ).toBeCloseTo(7.9, 6);
});

test("executeChamferFeature cuts distance-angle chamfers through OCC AddDA", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_distance_angle_chamfer_seed" as BodyId,
    "feature_distance_angle_chamfer_seed" as FeatureId,
  );
  const edgeId = body.topology.edgeIds[0];
  expect(edgeId, "Expected the tracked box to expose a chamfer edge target.").toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeChamferFeature(
    context,
    "feature_distance_angle_chamfer" as FeatureId,
    chamferDefinition(body.bodyId, edgeId, {
      widthForm: createLiteralAuthoredValue("offsetAngle"),
      distance: createLiteralAuthoredValue(0.25),
      angle: createLiteralAuthoredValue(45),
    }),
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(replacement, "Distance-angle chamfer should replace the target body.").toBeTruthy();
  expect(bodyVolume(oc, replacement!.shape)).toBeLessThan(bodyVolume(oc, body.shape));
  expect(replacement!.contributingFeatureIds).toContain(
    "feature_distance_angle_chamfer" as FeatureId,
  );
});

test("executeChamferFeature rejects invalid advanced chamfer width inputs", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_invalid_chamfer_seed" as BodyId,
    "feature_invalid_chamfer_seed" as FeatureId,
  );
  const edgeId = body.topology.edgeIds[0];
  expect(edgeId, "Expected the tracked box to expose a chamfer edge target.").toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  expect(() =>
    executeChamferFeature(
      context,
      "feature_invalid_two_distance_chamfer" as FeatureId,
      chamferDefinition(body.bodyId, edgeId, {
        widthForm: "twoOffsets",
        distance1: 0,
        distance2: 0.5,
      }),
    ),
  ).toThrow(/positive constant distance1/);

  expect(() =>
    executeChamferFeature(
      context,
      "feature_invalid_angle_chamfer" as FeatureId,
      chamferDefinition(body.bodyId, edgeId, {
        widthForm: "offsetAngle",
        distance: 0.25,
        angle: 90,
      }),
    ),
  ).toThrow(/angle greater than 0 and less than 90/);

  expect(() =>
    executeChamferFeature(
      context,
      "feature_expression_chamfer" as FeatureId,
      chamferDefinition(body.bodyId, edgeId, {
        widthForm: "equalOffsets",
        distance: createExpressionAuthoredValue("edgeChamfer"),
      }),
    ),
  ).toThrow(/positive constant distance/);
});

test("executeChamferFeature uses native transaction history for replacement topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_chamfer_history_seed" as BodyId,
    "feature_native_chamfer_history_seed" as FeatureId,
  );
  const edgeId = body.topology.edgeIds[0];
  expect(
    edgeId != null,
    "Expected the tracked box to expose a chamfer edge target.",
  ).toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeChamferFeature(
    context,
    "feature_native_chamfer_history" as FeatureId,
    {
      kind: "chamfer",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: "edge",
            targets: [{ kind: "edge", bodyId: body.bodyId, edgeId }],
          },
        ],
        options: { distance: 0.15 },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "chamfer" },
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(
    replacement != null,
    "Native chamfer should replace the target body.",
  ).toBeTruthy();
  expect(
    replacement!.topology.faceIds.length > body.topology.faceIds.length,
    "Native chamfer should add chamfer topology.",
  ).toBeTruthy();
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Native chamfer",
  );
});

// Lane: logic (per docs/testing.md — exported OCC feature-execution behavior in
// src/domain/modeling, proven through the real kernel with pure inputs).
// Seam: `executeChamferFeature`'s topology-stage lineage. `BRepFilletAPI`'s
// `IsDeleted` answers `true` for prior edges/vertices the chamfer never touched
// and that the result still contains as the IDENTICAL TopoDS shape. Taking that
// answer literally invalidated untouched topology, so a LATER chamfer selecting
// one of those edges was refused with `occ-topology-unsupported-history` (9841
// `Chamfer 2`, 5151 `Chamfer 2`/`3`). Only exact shape identity is claimed here;
// the genuinely consumed edge must still be reported unsupported.
test("executeChamferFeature keeps untouched topology in its stage lineage", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_chamfer_lineage_seed" as BodyId,
    "feature_chamfer_lineage_seed" as FeatureId,
  );
  const chamferedEdgeId = body.topology.edgeIds[0]!;
  const untouchedEdgeId = body.topology.edgeIds[6]!;
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeChamferFeature(
    context,
    "feature_chamfer_lineage" as FeatureId,
    chamferDefinition(body.bodyId, chamferedEdgeId, {
      widthForm: createLiteralAuthoredValue("equalOffsets"),
      distance: createLiteralAuthoredValue(0.15),
    }),
  );

  const output = result.topologyStage?.outputs.get(body.bodyId);
  expect(
    output,
    "A chamfer must publish stage lineage for the body it replaces.",
  ).toBeDefined();

  const claimedSourceIds = new Set(
    [...output!.sourceTargets.keys()].map((key) => key.split(":").at(-1)),
  );
  expect(
    claimedSourceIds.has(untouchedEdgeId),
    "An edge the chamfer never touched, still present as the identical shape, must keep an exact successor claim.",
  ).toBe(true);
  expect(
    result.historyInvalidations.has(
      getOccDurableRefKey({ kind: "edge", bodyId: body.bodyId, edgeId: untouchedEdgeId }),
    ),
    "An exactly preserved edge must not be reported as invalidated.",
  ).toBe(false);

  const unsupportedSourceIds = new Set(
    [...output!.unsupportedSourceKeys].map((key) => key.split(":").at(-1)),
  );
  expect(
    unsupportedSourceIds.has(chamferedEdgeId),
    "The edge the chamfer actually consumed must stay unsupported rather than claim a fabricated successor.",
  ).toBe(true);
  expect(
    claimedSourceIds.has(chamferedEdgeId),
    "The consumed edge must never receive an exact successor claim.",
  ).toBe(false);
});

// Lane: logic (per docs/testing.md — exported OCC feature-execution behavior in
// src/domain/modeling, proven through the real kernel with pure inputs).
// Seam: `executeChamferFeature`'s topology-stage lineage for subtopology the
// chamfer GENERATES, reconciled across a rebuild by
// `classifySemanticStageTopology`. Exact-successor lineage can only name prior
// subtopology, so the chamfer's own surface reached rebuild with no source key
// and was invalidated as `occ-topology-unsupported-history` — which is what
// refused 9841 `Chamfer 2`, whose edges are `Chamfer 1`'s own boundary.
// `BRepFilletAPI::Generated` is the only exact answer for a generated entity,
// and it exists solely while the builder that produced the committed shape is
// alive. This exercises the two-offset width form, which builds in JS; the
// native equal-offset form carries the same attribution through the shim's own
// `generated` history records and is pinned separately below.
test("executeChamferFeature claims producer identity for generated topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();

  const chamferBox = (distance2: number) => {
    const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 2, 2, 2);
    box.Build(new oc.Message_ProgressRange_1());
    const body = trackNewSolidBody(oc, {
      bodyId: "body_generated_lineage" as BodyId,
      label: "body_generated_lineage",
      ownerFeatureId: "feature_generated_lineage_seed" as FeatureId,
      shape: box.Shape(),
    });
    const result = executeChamferFeature(
      createOccAuthoringState(oc, { bodies: [body] }),
      "feature_generated_lineage" as FeatureId,
      chamferDefinition(body.bodyId, body.topology.edgeIds[0]!, {
        widthForm: createLiteralAuthoredValue("twoOffsets"),
        distance1: createLiteralAuthoredValue(0.2),
        distance2: createLiteralAuthoredValue(distance2),
      }),
    );
    return {
      body,
      output: result.topologyStage!.outputs.get(body.bodyId)!,
      replacement: result.bodies.find(
        (candidate) => candidate.bodyId === body.bodyId,
      )!,
    };
  };

  const original = chamferBox(0.35);
  const claimedTargetIds = new Set(
    [...original.output.sourceTargets.values()]
      .flat()
      .map((target) =>
        target.kind === "face"
          ? target.faceId
          : target.kind === "edge"
            ? target.edgeId
            : target.kind === "vertex"
              ? target.vertexId
              : null,
      ),
  );
  const producerKeys = [...original.output.sourceTargets.keys()].filter((key) =>
    key.startsWith("generated-from:"),
  );

  expect(
    producerKeys.length,
    "A chamfer must claim producer identity for the topology it generated, or a downstream feature selecting it is refused on rebuild.",
  ).toBeGreaterThan(0);

  const generatedFaceIds = original.replacement.topology.faceIds.filter(
    (faceId) => !original.body.topology.faceIds.includes(faceId),
  );
  expect(
    generatedFaceIds.every((faceId) => claimedTargetIds.has(faceId)),
    "Every face the chamfer generated must carry a stage source key.",
  ).toBe(true);

  // Determinism across an upstream edit: the same feature over the same source
  // keys must reproduce the same producer keys, so a downstream reference to a
  // generated entity still resolves after the rebuild.
  const rebuilt = chamferBox(0.5);
  const rebuiltProducerKeys = [...rebuilt.output.sourceTargets.keys()].filter(
    (key) => key.startsWith("generated-from:"),
  );
  expect(
    rebuiltProducerKeys.sort(),
    "A rebuild over an edited upstream must reproduce identical producer keys; otherwise the downstream reference is lost.",
  ).toEqual(producerKeys.sort());

  const reconciliation = classifySemanticStageTopology({
    previous: original.output,
    current: rebuilt.output,
  });
  for (const faceId of generatedFaceIds) {
    expect(
      reconciliation.invalidations.has(
        `face:${original.body.bodyId}:${faceId}`,
      ),
      "A generated face proved by one producer key on both sides must survive the rebuild instead of being invalidated.",
    ).toBe(false);
  }

  // Zero/many stay honest: an unsupported producer key must invalidate, and a
  // key claiming two successors must be ambiguous, never guessed.
  const generatedFaceId = generatedFaceIds[0]!;
  const producerKeyForFace = [...original.output.sourceTargets].find(
    ([key, targets]) =>
      key.startsWith("generated-from:") &&
      targets.some(
        (target) => target.kind === "face" && target.faceId === generatedFaceId,
      ),
  )![0];

  const unsupported = classifySemanticStageTopology({
    previous: original.output,
    current: {
      ...rebuilt.output,
      unsupportedSourceKeys: new Set([producerKeyForFace]),
    },
  });
  expect(
    unsupported.invalidations.get(
      `face:${original.body.bodyId}:${generatedFaceId}`,
    )?.reason,
    "An unsupported producer key must invalidate the generated entity honestly.",
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory);

  const ambiguous = classifySemanticStageTopology({
    previous: original.output,
    current: {
      ...rebuilt.output,
      sourceTargets: new Map(rebuilt.output.sourceTargets).set(
        producerKeyForFace,
        rebuilt.replacement.topology.faceIds
          .slice(0, 2)
          .map((faceId) => ({
            kind: "face" as const,
            bodyId: rebuilt.body.bodyId,
            faceId,
          })),
      ),
    },
  });
  expect(
    ambiguous.invalidations.get(
      `face:${original.body.bodyId}:${generatedFaceId}`,
    )?.reason,
    "A producer key reaching two successors is many, and must be reported ambiguous rather than resolved.",
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous);
});

// Lane: logic (per docs/testing.md — exported OCC feature-execution behavior in
// src/domain/modeling, proven through the real kernel with pure inputs).
// Seam: `executeChamferFeature`'s topology-stage lineage on the NATIVE
// equal-offset transaction path, whose `BRepFilletAPI` the shim destroys. Its
// producer identity can therefore only arrive through the shim's own
// `reason: "generated"` history records, parsed by `collectNativeGeneratedClaims`
// and keyed identically to the JS builder path. This pins the whole native
// round trip end to end: the equal-offset form 9841 `Chamfer 1` and 5151
// `Chamfer 1` actually use must claim the face it generates and keep that face
// live across an upstream edit.
test("executeChamferFeature claims producer identity through native generated history", async () => {
  const oc = await loadCustomOpenCascadeForTest();

  const chamferBox = (distance: number) => {
    const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 2, 2, 2);
    box.Build(new oc.Message_ProgressRange_1());
    const body = trackNewSolidBody(oc, {
      bodyId: "body_native_generated_lineage" as BodyId,
      label: "body_native_generated_lineage",
      ownerFeatureId: "feature_native_generated_lineage_seed" as FeatureId,
      shape: box.Shape(),
    });
    const result = executeChamferFeature(
      createOccAuthoringState(oc, { bodies: [body] }),
      "feature_native_generated_lineage" as FeatureId,
      chamferDefinition(body.bodyId, body.topology.edgeIds[0]!, {
        widthForm: createLiteralAuthoredValue("equalOffsets"),
        distance: createLiteralAuthoredValue(distance),
      }),
    );
    return {
      body,
      output: result.topologyStage!.outputs.get(body.bodyId)!,
      replacement: result.bodies.find(
        (candidate) => candidate.bodyId === body.bodyId,
      )!,
      invalidations: result.historyInvalidations,
    };
  };

  const original = chamferBox(0.3);
  assertNativeHistoryDidNotFallBack(
    original.invalidations,
    "The equal-offset chamfer",
  );

  const generatedFaceIds = original.replacement.topology.faceIds.filter(
    (faceId) => !original.body.topology.faceIds.includes(faceId),
  );
  expect(
    generatedFaceIds.length,
    "A single-edge chamfer must generate exactly one face for this pin to mean anything.",
  ).toBe(1);
  const generatedFaceId = generatedFaceIds[0]!;

  const producerEntries = [...original.output.sourceTargets].filter(([key]) =>
    key.startsWith("generated-from:"),
  );
  expect(
    producerEntries.map(([key]) => key),
    "The native transaction's `generated` history records must reach the topology stage as producer keys; an empty set means the Wasm shim emitted none.",
  ).toEqual([
    `generated-from:feature_native_generated_lineage:body_native_generated_lineage:edge:${original.body.topology.edgeIds[0]}:generated-face`,
  ]);
  expect(
    producerEntries[0]![1],
    "The producer key must claim exactly the face the chamfer generated.",
  ).toEqual([
    {
      kind: "face",
      bodyId: original.body.bodyId,
      faceId: generatedFaceId,
    },
  ]);

  // An upstream edit must reproduce the same key, or the downstream reference to
  // the generated face is lost on rebuild.
  const rebuilt = chamferBox(0.45);
  expect(
    [...rebuilt.output.sourceTargets.keys()].filter((key) =>
      key.startsWith("generated-from:"),
    ),
    "A rebuild over an edited upstream must reproduce identical native producer keys.",
  ).toEqual(producerEntries.map(([key]) => key));

  const reconciliation = classifySemanticStageTopology({
    previous: original.output,
    current: rebuilt.output,
  });
  expect(
    reconciliation.invalidations.has(
      `face:${original.body.bodyId}:${generatedFaceId}`,
    ),
    "The natively generated chamfer face must survive the rebuild instead of being invalidated as unsupported history.",
  ).toBe(false);
});
