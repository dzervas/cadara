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
