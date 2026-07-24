import { expect, test } from "vitest";

import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import {
  hasUnresolvedExtrudeTopology,
  planExtrudeFeature,
  referencedSketchFeatureIds,
  resolvedExtrudeExtent,
  resolvePlannedExtrudeTopology,
} from "@/domain/import/onshape/extrude-planner";
import { makeWaveTCaptureBundle } from "@/domain/import/onshape/wave-t-capture-fixtures";

const ELEMENT_ID = "wave-t-extrude-extents";

function fixtureInput(featureId: string) {
  const read = readPartStudio(makeWaveTCaptureBundle() as never, ELEMENT_ID);
  const feature = read.features.find((candidate) => candidate.featureId === featureId)!;
  const sketchId = referencedSketchFeatureIds(feature)[0]!;
  return {
    read,
    feature,
    sketchId,
    solvedSketch: read.solvedSketchesByFeatureId.get(sketchId),
    referencedSketch: { tier: "parametric", planeKey: "yz" as const },
  };
}

function parameter(feature: { parameters?: unknown[] }, id: string) {
  return feature.parameters?.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === id,
  ) as Record<string, unknown> | undefined;
}

function ensureParameter(feature: { parameters?: unknown[] }, id: string) {
  const existing = parameter(feature, id);
  if (existing) return existing;
  const created: Record<string, unknown> = { parameterId: id };
  feature.parameters ??= [];
  feature.parameters.push(created);
  return created;
}

function profileInput(input: ReturnType<typeof fixtureInput>) {
  const center = input.solvedSketch?.entities.find(
    (entity) => entity.entityType === "circle",
  )?.center3d ?? [0, 0, 0] as [number, number, number];
  return {
    profileEvidence: [{
      consumingFeatureId: input.feature.featureId,
      parameterId: "entities" as const,
      queryIndex: 0,
      resultIndex: 0,
      deterministicId: `profile-${input.feature.featureId}`,
      evaluatedAt: "historyPoint" as const,
      kind: "sketchRegion" as const,
      sourceSketchFeatureId: input.sketchId,
      interiorPoint3d: center,
    }],
    solvedSketchesByFeatureId: input.read.solvedSketchesByFeatureId,
    referencedSketchesByFeatureId: new Map([[input.sketchId, input.referencedSketch]]),
  };
}

test("plans two-side extents and active draft angles", () => {
  const input = fixtureInput("WT_TWO_SIDE");
  ensureParameter(input.feature, "hasDraft").value = true;
  ensureParameter(input.feature, "draftAngle").expression = "5 deg";

  const result = planExtrudeFeature({
    feature: input.feature,
    ...profileInput(input),
    priorBodyProducingFeatureIds: ["WT_EXTENT_BASE"],
  });

  expect(result.tier).toBe("parametric");
  if (result.tier !== "parametric") return;
  expect(result.plannedExtrude.extent).toMatchObject({
    mode: "twoSide",
    firstEnd: {
      kind: "blind",
      direction: "positive",
      distance: { source: "literal", value: 20 },
      draftAngle: { source: "literal", value: 5 * (Math.PI / 180) },
    },
    secondEnd: {
      kind: "blind",
      direction: "negative",
      distance: { source: "literal", value: 10 },
    },
  });
});

test("plans UP_TO_NEXT with rollback-inferred default scope and compressed profile queries", () => {
  const input = fixtureInput("WT_UP_TO_NEXT");
  const entities = parameter(input.feature, "entities")!;
  entities.queries = [{
    queryString: `query=qCompressed(1.0,"operationId$IdA1S11.6$${input.sketchId}wireOp",id);`,
    deterministicIds: ["profile-face"],
  }];

  const result = planExtrudeFeature({
    feature: input.feature,
    ...profileInput(input),
    priorBodyProducingFeatureIds: ["WT_EXTENT_BASE", "WT_TWO_SIDE"],
    inferredDefaultScopeFeatureIds: ["WT_EXTENT_BASE"],
  });

  expect(result.tier).toBe("parametric");
  if (result.tier !== "parametric") return;
  expect(result.plannedExtrude.extent).toEqual({
    mode: "oneSide",
    end: {
      kind: "upToNext",
      direction: "positive",
      offset: undefined,
      draftAngle: undefined,
    },
  });
  expect(result.plannedExtrude.boolean).toEqual({
    kind: "deferredBody",
    sourceFeatureId: "WT_EXTENT_BASE",
  });
});

test("keeps ambiguous default-scope multi-body extrudes honest", () => {
  const input = fixtureInput("WT_UP_TO_NEXT");
  const result = planExtrudeFeature({
    feature: input.feature,
    ...profileInput(input),
    priorBodyProducingFeatureIds: ["WT_EXTENT_BASE", "WT_TWO_SIDE"],
  });
  expect(result).toMatchObject({
    tier: "baked",
    reason: "extrude-default-scope-ambiguous",
  });
});

test("declares and resolves exact-prefix slots for up-to-face and explicit body scope", () => {
  const input = fixtureInput("WT_UP_TO_NEXT");
  parameter(input.feature, "endBound")!.value = "UP_TO_FACE";
  ensureParameter(input.feature, "endBoundEntityFace").queries = [{
    queryString: "query = qCompressed(...);",
    deterministicIds: ["face-target"],
  }];
  parameter(input.feature, "defaultScope")!.value = false;
  ensureParameter(input.feature, "booleanScope").queries = [{
    queryString: "query = qCreatedBy(id + \"WT_EXTENT_BASE\", EntityType.BODY);",
    deterministicIds: ["body-target"],
  }];

  const result = planExtrudeFeature({
    feature: input.feature,
    ...profileInput(input),
    priorBodyProducingFeatureIds: ["WT_EXTENT_BASE", "WT_TWO_SIDE"],
  });
  expect(result.tier).toBe("topology");
  if (result.tier !== "topology") return;
  expect(result.plannedExtrude.topologySlots).toMatchObject([
    { key: "firstEndFace", parameterId: "endBoundEntityFace", expectedKinds: ["face"] },
    { key: "booleanScope", parameterId: "booleanScope", expectedKinds: ["body"] },
  ]);
  expect(hasUnresolvedExtrudeTopology(result.plannedExtrude)).toBe(true);

  const faceSelector = {
    kind: "topologyOf" as const,
    expectedKind: "face" as const,
    capturedSignature: { entityClass: "face" as const, geometryType: "plane" },
    tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.001, ambiguityMargin: 0.01 },
    source: { consumerFeatureId: input.feature.featureId, parameterId: "endBoundEntityFace", deterministicId: "face-target" },
  };
  const bodySelector = {
    kind: "topologyOf" as const,
    expectedKind: "body" as const,
    capturedSignature: { entityClass: "body" as const, geometryType: "unknown" },
    tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.001, ambiguityMargin: 0.01 },
    source: { consumerFeatureId: input.feature.featureId, parameterId: "booleanScope", deterministicId: "body-target" },
  };
  const resolved = resolvePlannedExtrudeTopology(result.plannedExtrude, [
    {
      query: { consumerFeatureId: input.feature.featureId, slotKey: "firstEndFace", parameterId: "endBoundEntityFace", queryIndex: 0, deterministicId: "face-target", queryString: null, expectedKinds: ["face"] },
      reviewReference: { kind: "face", bodyId: "body_review" as never, faceId: "face_review" as never },
      deferred: faceSelector,
      score: 0,
      evidence: [],
      sourceEvidence: "historyPoint",
    },
    {
      query: { consumerFeatureId: input.feature.featureId, slotKey: "booleanScope", parameterId: "booleanScope", queryIndex: 0, deterministicId: "body-target", queryString: null, expectedKinds: ["body"] },
      reviewReference: { kind: "body", bodyId: "body_review" as never },
      deferred: bodySelector,
      score: 0,
      evidence: [],
      sourceEvidence: "historyPoint",
    },
  ]);

  expect(resolved?.extent).toMatchObject({
    mode: "oneSide",
    end: { kind: "upToFace", target: { kind: "topologyOf", expectedKind: "face" } },
  });
  expect(resolved?.boolean).toMatchObject({
    kind: "topologyTargets",
    targets: [{ kind: "topologyOf", expectedKind: "body" }],
  });

  expect(() => resolvedExtrudeExtent(result.plannedExtrude)).toThrow(
    "unresolved topologySlot",
  );
  expect(resolved).not.toBeNull();
  expect(resolved!.topologySlots).toHaveLength(2);
  expect(hasUnresolvedExtrudeTopology(resolved!)).toBe(false);
  expect(resolvedExtrudeExtent(resolved!)).toMatchObject({
    mode: "oneSide",
    end: {
      kind: "upToFace",
      target: { kind: "topologyOf", expectedKind: "face" },
    },
  });
});
