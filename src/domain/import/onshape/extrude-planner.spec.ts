import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import * as math from "mathjs";
import { expect, test } from "vitest";

import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import {
  hasUnresolvedExtrudeTopology,
  planExtrudeFeature,
  referencedSketchFeatureIds,
  resolvedExtrudeExtent,
  resolvedExtrudeStartExtent,
  resolvePlannedExtrudeTopology,
} from "@/domain/import/onshape/extrude-planner";
import { makeWaveTCaptureBundle } from "@/domain/import/onshape/wave-t-capture-fixtures";
import { makeWaveXSurfaceExtrudeCaptureBundle } from "@/domain/import/onshape/wave-x-capture-fixtures";

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

test("binds an ENTITY start bound over live body topology to a resolved start entity", () => {
  const input = fixtureInput("WT_UP_TO_NEXT");
  ensureParameter(input.feature, "startOffset").value = true;
  ensureParameter(input.feature, "startOffsetBound").value = "ENTITY";
  // A body edge query, not a decodable sketch-entity vertex: the only exact
  // route is a topology slot resolved against the pre-consumer prefix.
  ensureParameter(input.feature, "startOffsetEntity").queries = [{
    queryString: "query = qCompressed(1.0,\"start-edge\",id);",
    deterministicIds: ["start-edge"],
  }];

  const result = planExtrudeFeature({
    feature: input.feature,
    ...profileInput(input),
    priorBodyProducingFeatureIds: ["WT_EXTENT_BASE"],
    inferredDefaultScopeFeatureIds: ["WT_EXTENT_BASE"],
  });
  expect(result.tier).toBe("topology");
  if (result.tier !== "topology") return;
  expect(result.plannedExtrude.topologySlots).toMatchObject([
    { key: "startEntity", parameterId: "startOffsetEntity", expectedKinds: ["edge", "face"] },
  ]);
  expect(hasUnresolvedExtrudeTopology(result.plannedExtrude)).toBe(true);
  expect(() => resolvedExtrudeStartExtent(result.plannedExtrude)).toThrow(
    "unresolved topology slot",
  );

  const edgeSelector = {
    kind: "topologyOf" as const,
    expectedKind: "edge" as const,
    capturedSignature: { entityClass: "edge" as const, geometryType: "circle" },
    tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.001, ambiguityMargin: 0.01 },
    source: {
      consumerFeatureId: input.feature.featureId,
      parameterId: "startOffsetEntity",
      deterministicId: "start-edge",
    },
  };
  const binding = {
    query: {
      consumerFeatureId: input.feature.featureId,
      slotKey: "startEntity",
      parameterId: "startOffsetEntity",
      queryIndex: 0,
      deterministicId: "start-edge",
      queryString: null,
      expectedKinds: ["edge", "face"] as const,
    },
    reviewReference: {
      kind: "edge" as const,
      bodyId: "body_review" as never,
      edgeId: "edge_review" as never,
    },
    deferred: edgeSelector,
    score: 0,
    evidence: [],
    sourceEvidence: "historyPoint" as const,
  };
  const resolved = resolvePlannedExtrudeTopology(result.plannedExtrude, [binding]);
  expect(resolved).not.toBeNull();
  expect(hasUnresolvedExtrudeTopology(resolved!)).toBe(false);
  expect(resolvedExtrudeStartExtent(resolved!)).toMatchObject({
    kind: "entityOffset",
    target: { kind: "topologyOf", expectedKind: "edge" },
  });

  // A slot that resolved to something that names no plane fails the whole plan
  // instead of silently starting the prism on the profile plane.
  const bodyBinding = {
    ...binding,
    reviewReference: { kind: "body" as const, bodyId: "body_review" as never },
    deferred: { ...edgeSelector, expectedKind: "body" as const },
  };
  expect(resolvePlannedExtrudeTopology(result.plannedExtrude, [bodyBinding])).toBeNull();
});

// The BLIND start-offset sign convention is pinned by the two
// `9841e486906fa2ce62d74d8e` instances (`Extrude 10` / `Extrude 11`, derived in
// `translateStartExtent`): the start plane moves `+startOffsetDistance` along
// the extrude direction whenever `startOffsetOppositeDirection` equals
// `oppositeDirection`. The authored expression is preserved, never collapsed to
// the captured literal.
test("translates a capture-pinned BLIND start offset and refuses the undiscriminated flag combination", () => {
  for (const opposite of [false, true]) {
    const input = fixtureInput("WT_UP_TO_NEXT");
    ensureParameter(input.feature, "startOffset").value = true;
    ensureParameter(input.feature, "startOffsetBound").value = "BLIND";
    ensureParameter(input.feature, "startOffsetDistance").expression = "#tolerance*2";
    ensureParameter(input.feature, "startOffsetOppositeDirection").value = opposite;
    ensureParameter(input.feature, "oppositeDirection").value = opposite;

    const result = planExtrudeFeature({
      feature: input.feature,
      ...profileInput(input),
      priorBodyProducingFeatureIds: ["WT_EXTENT_BASE"],
      inferredDefaultScopeFeatureIds: ["WT_EXTENT_BASE"],
    });

    expect(result.tier).toBe("parametric");
    if (result.tier !== "parametric") return;
    expect(result.plannedExtrude.startExtent).toEqual({
      kind: "blindOffset",
      distance: { source: "expression", valueText: "tolerance*2" },
      direction: "positive",
    });
    expect(resolvedExtrudeStartExtent(result.plannedExtrude)).toEqual(
      result.plannedExtrude.startExtent,
    );
    expect(result.plannedExtrude.topologySlots).toEqual([]);
  }

  const mismatched = fixtureInput("WT_UP_TO_NEXT");
  ensureParameter(mismatched.feature, "startOffset").value = true;
  ensureParameter(mismatched.feature, "startOffsetBound").value = "BLIND";
  ensureParameter(mismatched.feature, "startOffsetDistance").expression = "2 mm";
  ensureParameter(mismatched.feature, "startOffsetOppositeDirection").value = true;
  ensureParameter(mismatched.feature, "oppositeDirection").value = false;

  expect(
    planExtrudeFeature({
      feature: mismatched.feature,
      ...profileInput(mismatched),
      priorBodyProducingFeatureIds: ["WT_EXTENT_BASE"],
      inferredDefaultScopeFeatureIds: ["WT_EXTENT_BASE"],
    }),
  ).toMatchObject({ tier: "baked", reason: "extrude-start-extent-unsupported" });
});

// Guards the premises of the sign derivation documented in
// `translateStartExtent`: the two capture instances it was measured from must
// still author the discriminated flag combination, and the start plane must no
// longer be what bakes them.
const BLIND_START_BUNDLE =
  "test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json";

test.skipIf(!existsSync(BLIND_START_BUNDLE))(
  "passes the capture's two BLIND start offsets through the start-extent gate",
  async () => {
    const parsed = validateOnshapeCaptureBundle(
      JSON.parse(await readFile(BLIND_START_BUNDLE, "utf8")),
    );
    if (!parsed.success) throw new Error(`${BLIND_START_BUNDLE} must validate.`);
    const studio = parsed.data.partStudios[0]!;
    const read = readPartStudio(parsed.data, studio.elementId);

    for (const [featureId, distanceExpression] of [
      ["FnqLWtKC5loyWcj_1", "2 mm"],
      ["FarVWY13vdeW4u9_1", "#tolerance*2"],
    ] as const) {
      const feature = read.features.find(
        (candidate) => candidate.featureId === featureId,
      )!;
      expect(parameter(feature, "startOffset")?.value).toBe(true);
      expect(parameter(feature, "startOffsetBound")?.value).toBe("BLIND");
      expect(parameter(feature, "startOffsetDistance")?.expression).toBe(
        distanceExpression,
      );
      // The derivation only discriminates the sign when these agree.
      expect(parameter(feature, "startOffsetOppositeDirection")?.value).toBe(
        parameter(feature, "oppositeDirection")?.value,
      );

      const result = planExtrudeFeature({
        feature,
        profileEvidence: [],
        solvedSketchesByFeatureId: new Map(),
        referencedSketchesByFeatureId: new Map(),
        priorBodyProducingFeatureIds: [],
      });
      expect(
        result.tier === "baked" && result.reason === "extrude-start-extent-unsupported",
        "A capture-pinned BLIND start offset must not bake on its start plane.",
      ).toBe(false);
    }
  },
);

// Lane: logic (per docs/testing.md — exported extrude planning seam).
// Seam: an Onshape SURFACE extrude plans as a surface extrude, or bakes with the
// specific reason its authored form cannot be represented.
function surfaceInput(elementId: "wave-x-9841" | "wave-x-d3cd9") {
  const bundle = makeWaveXSurfaceExtrudeCaptureBundle();
  const read = readPartStudio(bundle as never, elementId);
  const feature = read.features.find(
    (candidate) => candidate.featureId === "E_SURFACE_4",
  )!;
  return {
    feature,
    profileEvidence: [],
    solvedSketchesByFeatureId: read.solvedSketchesByFeatureId,
    referencedSketchesByFeatureId: new Map([
      ["S_SURFACE", { tier: "parametric", planeKey: "xy" as const }],
    ]),
    priorBodyProducingFeatureIds: [],
  };
}

test("plans a SURFACE extrude with open sketch-curve profiles and no boolean state", () => {
  const result = planExtrudeFeature(surfaceInput("wave-x-9841"));

  expect(result.tier).toBe("parametric");
  if (result.tier !== "parametric") return;
  expect(result.plannedExtrude.resultBodyType).toBe("surface");
  expect(result.plannedExtrude).not.toHaveProperty("operation");
  expect(result.plannedExtrude).not.toHaveProperty("boolean");
  expect(result.plannedExtrude.profiles).toMatchObject([
    { kind: "sketchCurve" },
    { kind: "sketchCurve" },
  ]);
  expect(result.plannedExtrude.extent).toEqual({
    mode: "oneSide",
    end: {
      kind: "blind",
      direction: "positive",
      distance: { source: "literal", value: 10 },
      draftAngle: undefined,
    },
  });
});

test("halves the authored depth of a symmetric extrude", () => {
  const literal = planExtrudeFeature(surfaceInput("wave-x-d3cd9"));
  expect(literal.tier).toBe("parametric");
  if (literal.tier !== "parametric") return;
  // Pinned by the d3cd capture: a 50 mm symmetric depth spans ±25 mm, and cadara's
  // symmetric extent applies its end distance in both directions.
  expect(literal.plannedExtrude.extent).toEqual({
    mode: "symmetric",
    end: {
      kind: "blind",
      direction: "positive",
      distance: { source: "literal", value: 5 },
      draftAngle: undefined,
    },
  });

  const expression = surfaceInput("wave-x-d3cd9");
  const depth = parameter(expression.feature, "depth")!;
  depth.expression = "#walls";
  const result = planExtrudeFeature(expression);
  expect(result.tier === "parametric" && result.plannedExtrude.extent).toMatchObject({
    mode: "symmetric",
    end: { distance: { source: "expression", valueText: "((walls) / 2)" } },
  });
});

test("plans a grouped blind depth without an unresolved unit symbol", () => {
  const input = surfaceInput("wave-x-9841");
  parameter(input.feature, "depth")!.expression = "(25/2) mm";

  const result = planExtrudeFeature(input);
  expect(result.tier).toBe("parametric");
  if (result.tier !== "parametric") return;
  expect(result.plannedExtrude.extent).toMatchObject({
    mode: "oneSide",
    end: {
      kind: "blind",
      distance: { source: "expression", valueText: "(25/2) * 1" },
    },
  });

  const extent = result.plannedExtrude.extent;
  if (
    extent.mode !== "oneSide" ||
    extent.end.kind !== "blind" ||
    extent.end.distance.source !== "expression"
  ) return;
  expect(extent.end.distance.valueText).not.toMatch(/\bmm\b/);
  expect(math.evaluate(extent.end.distance.valueText)).toBe(12.5);
});

test("keeps an UP_TO_SURFACE surface extrude on the topology-slot path", () => {
  const input = surfaceInput("wave-x-9841");
  const endBound = parameter(input.feature, "endBound")!;
  endBound.value = "UP_TO_SURFACE";
  ensureParameter(input.feature, "endBoundEntityFace").queries = [{
    queryString: 'query = qCreatedBy(id + "E_BASE", EntityType.FACE);',
    deterministicIds: ["JQm"],
  }];

  const result = planExtrudeFeature(input);

  expect(result.tier).toBe("topology");
  if (result.tier !== "topology") return;
  expect(result.plannedExtrude.resultBodyType).toBe("surface");
  expect(result.plannedExtrude.topologySlots).toMatchObject([
    { key: "firstEndFace", parameterId: "endBoundEntityFace", role: "face" },
  ]);
  expect(hasUnresolvedExtrudeTopology(result.plannedExtrude)).toBe(true);
});

test("bakes surface extrudes whose boolean operation or draft angle is unrepresentable", () => {
  const booleanInput = surfaceInput("wave-x-9841");
  parameter(booleanInput.feature, "surfaceOperationType")!.value = "ADD";

  const draftInput = surfaceInput("wave-x-9841");
  ensureParameter(draftInput.feature, "hasDraft").value = true;
  ensureParameter(draftInput.feature, "draftAngle").expression = "3 deg";

  const profileInput = surfaceInput("wave-x-9841");
  parameter(profileInput.feature, "surfaceEntities")!.queries = [{
    queryString: "query = qEverything(EntityType.EDGE);",
  }];

  expect([booleanInput, draftInput, profileInput].map((input) => {
    const result = planExtrudeFeature(input);
    return result.tier === "baked" ? result.reason : result.tier;
  })).toEqual([
    "extrude-surface-operation-unsupported",
    "extrude-surface-draft-unsupported",
    "extrude-surface-profile-unresolved",
  ]);
});
