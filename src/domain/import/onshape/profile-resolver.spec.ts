import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { expect, test } from "vitest";

import type { OnshapeProfileEvidence } from "@/contracts/import/onshape-capture-bundle";
import type { OnshapeSolvedSketch } from "@/domain/import/onshape/bundle-reader";
import {
  IMPORT_VERIFICATION_DOCUMENT_ID,
  IMPORT_VERIFICATION_REVISION_ID,
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeOpenSketchCurveProfiles,
  resolveOnshapeSketchProfiles,
} from "@/domain/import/onshape/profile-resolver";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const profileVerifier = {
  sketchSolver: new SketchConstraintSolverAdapter({
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    documentId: IMPORT_VERIFICATION_DOCUMENT_ID,
    revisionId: IMPORT_VERIFICATION_REVISION_ID,
  }),
  modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  angularToleranceRadians: OCC_KERNEL_SETTINGS.angularToleranceRadians,
};

const frame = {
  tier: "parametric",
  planeKey: "xy" as const,
};

const profileParameter = (...sketchFeatureIds: string[]) => ({
  parameterId: "entities",
  queries: sketchFeatureIds.map((sketchFeatureId) => ({
    queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
  })),
});

function solvedCircle(featureId: string, center: [number, number, number], radius = 0.002) {
  return {
    featureId,
    entities: [{
      entityId: `${featureId}_circle`,
      entityType: "circle" as const,
      onshapeEntityType: "skCircle",
      isConstruction: false,
      center3d: center,
      radius,
    }],
  };
}

function sketchEvidence(input: {
  sketchFeatureId: string;
  queryIndex?: number;
  resultIndex?: number;
  point: [number, number, number];
  deterministicId?: string;
}): OnshapeProfileEvidence {
  return {
    consumingFeatureId: "E_PROFILE",
    parameterId: "entities",
    queryIndex: input.queryIndex ?? 0,
    resultIndex: input.resultIndex ?? 0,
    deterministicId: input.deterministicId ?? `face-${input.sketchFeatureId}`,
    evaluatedAt: "historyPoint",
    kind: "sketchRegion",
    sourceSketchFeatureId: input.sketchFeatureId,
    interiorPoint3d: input.point,
  };
}

function resolve(input: {
  parameter: ReturnType<typeof profileParameter>;
  evidence: OnshapeProfileEvidence[];
  solved: OnshapeSolvedSketch[];
}) {
  return resolveOnshapeSketchProfiles({
    profileVerifier,
    profileParameter: input.parameter,
    consumerFeatureId: "E_PROFILE",
    featureLabel: "Profile consumer",
    featureKind: "extrude",
    profileEvidence: input.evidence,
    solvedSketchesByFeatureId: new Map(input.solved.map((sketch) => [sketch.featureId, sketch])),
    referencedSketchesByFeatureId: new Map(input.solved.map((sketch) => [sketch.featureId, frame])),
  });
}

test("profile resolver expands a readable exact region set into closed sketch selectors", async () => {
  const result = await resolve({
    parameter: profileParameter("S_SET"),
    evidence: [{
      consumingFeatureId: "E_PROFILE",
      parameterId: "entities",
      queryIndex: 0,
      evaluatedAt: "historyPoint",
      kind: "sketchRegionSet",
      sourceSketchFeatureId: "S_SET",
      filterInnerLoops: true,
    }],
    solved: [solvedCircle("S_SET", [0, 0, 0])],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{
      kind: "sketchRegion",
      sketchFeatureId: "S_SET",
      boundaryIdentity: expect.stringMatching(/^import-region-boundary\/v1:/),
      interiorPoint: [0, 0],
    }],
  });
});

test("profile resolver expands true qSketchRegion roots for nested circle annuli", async () => {
  const nested = {
    featureId: "S_SET_NESTED",
    entities: [
      ...solvedCircle("S_SET_OUTER", [0, 0, 0], 0.006).entities,
      ...solvedCircle("S_SET_INNER", [0, 0, 0], 0.002).entities,
    ],
  };
  const result = await resolve({
    parameter: profileParameter("S_SET_NESTED"),
    evidence: [{
      consumingFeatureId: "E_PROFILE",
      parameterId: "entities",
      queryIndex: 0,
      evaluatedAt: "historyPoint",
      kind: "sketchRegionSet",
      sourceSketchFeatureId: "S_SET_NESTED",
      filterInnerLoops: true,
    }],
    solved: [nested],
  });

  expect(result).toMatchObject({ tier: "resolved" });
  expect(result.tier === "resolved" && result.profiles).toHaveLength(1);
  expect(result.tier === "resolved" && result.profiles[0]).toMatchObject({
    kind: "sketchRegion", sketchFeatureId: "S_SET_NESTED",
  });
});

test("profile resolver derives exact selectors for a sparse layout of thin annuli", async () => {
  const featureId = "S_SET_THIN_ANNULI";
  const centers = Array.from({ length: 6 }, (_, index) => [
    (index % 2) * 0.102,
    Math.floor(index / 2) * 0.0965,
    0,
  ] as [number, number, number]);
  const entities = centers.flatMap((center, index) => [
    ...solvedCircle(`${featureId}_OUTER_${index}`, center, 0.00375).entities,
    ...solvedCircle(`${featureId}_INNER_${index}`, center, 0.00275).entities,
  ]);
  const result = await resolve({
    parameter: profileParameter(featureId),
    evidence: [{
      consumingFeatureId: "E_PROFILE",
      parameterId: "entities",
      queryIndex: 0,
      evaluatedAt: "historyPoint",
      kind: "sketchRegionSet",
      sourceSketchFeatureId: featureId,
      filterInnerLoops: true,
    }],
    solved: [{ featureId, entities }],
  });

  expect(result).toMatchObject({ tier: "resolved" });
  expect(result.tier === "resolved" && result.profiles).toHaveLength(6);
  expect(result.tier === "resolved" && result.profiles.every((profile) => {
    if (profile.kind !== "sketchRegion") return false;
    return profile.boundaryIdentity.startsWith("import-region-boundary/v1:") && centers.some((center) =>
      Math.abs(Math.hypot(
        profile.interiorPoint[0] - center[0] * 1_000,
        profile.interiorPoint[1] - center[1] * 1_000,
      ) - 3.25) < 1e-9,
    );
  })).toBeTruthy();
  expect(
    result.tier === "resolved"
      ? new Set(result.profiles.map((profile) =>
          profile.kind === "sketchRegion" ? profile.boundaryIdentity : "planar-face"
        )).size
      : 0,
  ).toBe(6);
});

test("profile resolver fails closed for false qSketchRegion with inner loops", async () => {
  const nested = {
    featureId: "S_SET_NESTED",
    entities: [
      ...solvedCircle("S_SET_OUTER", [0, 0, 0], 0.006).entities,
      ...solvedCircle("S_SET_INNER", [0, 0, 0], 0.002).entities,
    ],
  };
  const result = await resolve({
    parameter: profileParameter("S_SET_NESTED"),
    evidence: [{
      consumingFeatureId: "E_PROFILE",
      parameterId: "entities",
      queryIndex: 0,
      evaluatedAt: "historyPoint",
      kind: "sketchRegionSet",
      sourceSketchFeatureId: "S_SET_NESTED",
      filterInnerLoops: false,
    }],
    solved: [nested],
  });

  expect(result).toMatchObject({
    tier: "unresolved",
    reason: "needs-region-resolution",
    diagnostics: [{ code: "onshape-region-set-inner-loops-unresolved" }],
  });
});

test("profile resolver selects only the captured subset, never all closed regions", async () => {
  const result = await resolve({
    parameter: profileParameter("S_LEFT"),
    evidence: [sketchEvidence({ sketchFeatureId: "S_LEFT", point: [-0.004, 0, 0] })],
    solved: [
      solvedCircle("S_LEFT", [-0.004, 0, 0]),
      solvedCircle("S_UNUSED", [0.004, 0, 0]),
    ],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{
      kind: "sketchRegion",
      sketchFeatureId: "S_LEFT",
      boundaryIdentity: expect.stringMatching(/^import-region-boundary\/v1:/),
      interiorPoint: [-4, 0],
      evidence: { queryIndex: 0, resultIndex: 0, deterministicId: "face-S_LEFT" },
    }],
  });
});

test("profile resolver preserves ordered exact profiles from multiple source sketches", async () => {
  const result = await resolve({
    parameter: profileParameter("S_ONE", "S_TWO"),
    evidence: [
      sketchEvidence({ sketchFeatureId: "S_ONE", queryIndex: 0, point: [-0.003, 0, 0] }),
      sketchEvidence({ sketchFeatureId: "S_TWO", queryIndex: 1, point: [0.003, 0, 0] }),
    ],
    solved: [solvedCircle("S_ONE", [-0.003, 0, 0]), solvedCircle("S_TWO", [0.003, 0, 0])],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [
      { kind: "sketchRegion", sketchFeatureId: "S_ONE", interiorPoint: [-3, 0] },
      { kind: "sketchRegion", sketchFeatureId: "S_TWO", interiorPoint: [3, 0] },
    ],
  });
});

test("profile resolver requires a unique projected witness region for nested profiles", async () => {
  const nested = {
    featureId: "S_NESTED",
    entities: [
      ...solvedCircle("S_NESTED_OUTER", [0, 0, 0], 0.006).entities,
      ...solvedCircle("S_NESTED_INNER", [0, 0, 0], 0.002).entities,
    ],
  };
  const result = await resolve({
    parameter: profileParameter("S_NESTED"),
    evidence: [sketchEvidence({ sketchFeatureId: "S_NESTED", point: [0.004, 0, 0] })],
    solved: [nested],
  });

  expect(result).toMatchObject({ tier: "resolved", profiles: [{ interiorPoint: [4, 0] }] });
});

test("profile resolver resolves a witness in the odd-depth nested cell", async () => {
  const result = await resolve({
    parameter: profileParameter("S_THREE_NESTED"),
    evidence: [sketchEvidence({
      sketchFeatureId: "S_THREE_NESTED",
      point: [0.003, 0, 0],
    })],
    solved: [{
      featureId: "S_THREE_NESTED",
      entities: [
        ...solvedCircle("S_THREE_OUTER", [0, 0, 0], 0.006).entities,
        ...solvedCircle("S_THREE_MIDDLE", [0, 0, 0], 0.004).entities,
        ...solvedCircle("S_THREE_INNER", [0, 0, 0], 0.002).entities,
      ],
    }],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ interiorPoint: [3, 0] }],
  });
});

test("profile resolver verifies a witness in a line-circle cell", async () => {
  const result = await resolve({
    parameter: profileParameter("S_LINE_CIRCLE"),
    evidence: [sketchEvidence({
      sketchFeatureId: "S_LINE_CIRCLE",
      point: [0, 0.001, 0],
    })],
    solved: [{
      featureId: "S_LINE_CIRCLE",
      entities: [
        ...solvedCircle("S_LINE_CIRCLE", [0, 0, 0], 0.002).entities,
        {
          entityId: "S_LINE_CIRCLE_chord",
          entityType: "lineSegment",
          onshapeEntityType: "skLineSegment",
          isConstruction: false,
          start3d: [-0.002, 0, 0],
          end3d: [0.002, 0, 0],
        },
      ],
    }],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ interiorPoint: [0, 1] }],
  });
});

// Lane: logic (docs/testing.md). Seam: the resolver's exported boundary, with
// a recording wrapper around the real verifier solver port. Import verification
// solves the translated sketch, so a declared point-on-curve closing corner is
// honoured exactly as the committed sketch's solve honours it (review B1).
test("profile resolver closes a rectangle whose closing corner is a point-on-curve T-junction", async () => {
  const regionResponses: Awaited<
    ReturnType<typeof profileVerifier.sketchSolver.deriveSketchRegions>
  >[] = [];
  const recordingVerifier = {
    ...profileVerifier,
    sketchSolver: {
      solveSketch: (
        request: Parameters<typeof profileVerifier.sketchSolver.solveSketch>[0],
      ) => profileVerifier.sketchSolver.solveSketch(request),
      deriveSketchRegions: async (
        request: Parameters<
          typeof profileVerifier.sketchSolver.deriveSketchRegions
        >[0],
      ) => {
        const response =
          await profileVerifier.sketchSolver.deriveSketchRegions(request);
        regionResponses.push(response);
        return response;
      },
    },
  };
  const line = (
    name: string,
    start: [number, number, number],
    end: [number, number, number],
  ) => ({
    entityId: name,
    entityType: "lineSegment" as const,
    onshapeEntityType: "skLineSegment",
    isConstruction: false,
    start3d: start,
    end3d: end,
  });
  const coincident = (id: string, first: string, second: string) => ({
    constraintType: "COINCIDENT",
    entityId: id,
    parameters: [
      { parameterId: "localFirst", value: first, hasExternalQuery: false },
      { parameterId: "localSecond", value: second, hasExternalQuery: false },
    ],
  });
  // The bottom side overshoots the closing corner; the left side's end is
  // declared on the bottom side's body (a T-junction), not a shared point. Its
  // captured position carries a 2e-7 mm residual off the host, as captured
  // Onshape geometry does, so only the declaration can close the corner.
  const solved: OnshapeSolvedSketch = {
    featureId: "S_T_CORNER",
    entities: [
      line("bottom", [-0.003, 0, 0], [0.01, 0, 0]),
      line("right", [0.01, 0, 0], [0.01, 0.006, 0]),
      line("top", [0.01, 0.006, 0], [0, 0.006, 0]),
      line("left", [0, 0.006, 0], [0, 2e-10, 0]),
    ],
    constraints: [
      coincident("c_br", "bottom.end", "right.start"),
      coincident("c_rt", "right.end", "top.start"),
      coincident("c_tl", "top.end", "left.start"),
      coincident("c_lb", "left.end", "bottom"),
    ],
  };
  const result = await resolveOnshapeSketchProfiles({
    profileVerifier: recordingVerifier,
    profileParameter: profileParameter("S_T_CORNER"),
    consumerFeatureId: "E_PROFILE",
    featureLabel: "Profile consumer",
    featureKind: "extrude",
    profileEvidence: [
      {
        consumingFeatureId: "E_PROFILE",
        parameterId: "entities",
        queryIndex: 0,
        evaluatedAt: "historyPoint",
        kind: "sketchRegionSet",
        sourceSketchFeatureId: "S_T_CORNER",
        filterInnerLoops: true,
      },
    ],
    solvedSketchesByFeatureId: new Map([[solved.featureId, solved]]),
    referencedSketchesByFeatureId: new Map([[solved.featureId, frame]]),
  });

  expect(
    regionResponses.map((response) => ({
      regions: response.regions.filter((region) => region.isClosed).length,
      diagnostics: response.diagnostics.map((diagnostic) => diagnostic.code),
    })),
    "Verification derives the one rectangle region through the declared closing corner.",
  ).toEqual([{ regions: 1, diagnostics: [] }]);
  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ kind: "sketchRegion", sketchFeatureId: "S_T_CORNER" }],
  });
  expect(result.tier === "resolved" && result.profiles).toHaveLength(1);
});

test("profile resolver ignores open lines that cross a standalone circle", async () => {
  const result = await resolve({
    parameter: profileParameter("S_OPEN_LINES"),
    evidence: [sketchEvidence({
      sketchFeatureId: "S_OPEN_LINES",
      point: [0, 0, 0],
    })],
    solved: [{
      featureId: "S_OPEN_LINES",
      entities: [
        ...solvedCircle("S_OPEN_LINES", [0, 0, 0], 0.005).entities,
        {
          entityId: "S_OPEN_LINES_seed",
          entityType: "lineSegment",
          onshapeEntityType: "skLineSegment",
          isConstruction: false,
          start3d: [0, 0, 0],
          end3d: [0.01, 0, 0],
        },
        {
          entityId: "S_OPEN_LINES_offset",
          entityType: "lineSegment",
          onshapeEntityType: "skLineSegment",
          isConstruction: false,
          start3d: [0, 0.002, 0],
          end3d: [0.01, 0.002, 0],
        },
      ],
    }],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ interiorPoint: [0, 0] }],
  });
});

test("profile resolver projects a mirror-derived source witness through the sketch frame", async () => {
  const result = await resolve({
    parameter: profileParameter("S_MIRROR"),
    evidence: [sketchEvidence({ sketchFeatureId: "S_MIRROR", point: [0.004, 0, 0] })],
    solved: [solvedCircle("S_MIRROR", [0.004, 0, 0])],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ kind: "sketchRegion", sketchFeatureId: "S_MIRROR", interiorPoint: [4, 0] }],
  });
});

test("profile resolver keeps a selected planar face as an exact deferred topology profile", async () => {
  const result = await resolve({
    parameter: profileParameter("S_PROFILE", "S_CAP"),
    evidence: [
      sketchEvidence({ sketchFeatureId: "S_PROFILE", queryIndex: 0, point: [0, 0, 0] }),
      {
        consumingFeatureId: "E_PROFILE",
        parameterId: "entities",
        queryIndex: 1,
        resultIndex: 0,
        deterministicId: "cap-face",
        evaluatedAt: "historyPoint",
        kind: "planarFace",
        signature: {
          entityClass: "face",
          geometryType: "plane",
          definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
        },
      },
    ],
    solved: [solvedCircle("S_PROFILE", [0, 0, 0]), solvedCircle("S_CAP", [0.01, 0, 0])],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [
      { kind: "sketchRegion", sketchFeatureId: "S_PROFILE" },
      {
        kind: "planarFace",
        selector: { kind: "topologyOf", expectedKind: "face", source: { deterministicId: "cap-face" } },
      },
    ],
  });
});

test("profile resolver keeps missing witnesses, ambiguous sources, and unordered evidence unresolved", async () => {
  const unresolvedWitness = await resolve({
    parameter: profileParameter("S1"),
    evidence: [{
      consumingFeatureId: "E_PROFILE",
      parameterId: "entities",
      queryIndex: 0,
      resultIndex: 0,
      deterministicId: "face-S1",
      evaluatedAt: "historyPoint",
      kind: "sketchRegion",
      sourceSketchFeatureId: "S1",
      unresolved: { reason: "evFaceTessellation response schema is unavailable" },
    }],
    solved: [solvedCircle("S1", [0, 0, 0])],
  });
  const unordered = await resolve({
    parameter: profileParameter("S1"),
    evidence: [sketchEvidence({ sketchFeatureId: "S1", resultIndex: 1, point: [0, 0, 0] })],
    solved: [solvedCircle("S1", [0, 0, 0])],
  });

  expect(unresolvedWitness).toMatchObject({ tier: "unresolved", reason: "needs-region-resolution" });
  expect(unordered).toMatchObject({ tier: "unresolved", reason: "needs-region-resolution" });
});

test("profile source parser never decodes compressed query text", () => {
  expect(
    referencedSketchFeatureIdsFromProfileParameter({
      queries: [
        { queryString: 'query = qSketchRegion(id + "S1", true);' },
        { queryString: 'query=qCompressed(1.0,"S2wireOp",id);' },
      ],
    }),
  ).toEqual(["S1"]);
});

// Lane: logic (per docs/testing.md — exported import profile-resolution seam).
// Seam: Onshape surface-extrude `surfaceEntities` queries resolve to durable open
// sketch-curve profile refs of the translated solved sketch, or stay unresolved.
function solvedOpenChain(featureId: string, entityCount: 1 | 2 | 3) {
  const positions: [number, number, number][] = [
    [0, 0, 0],
    [0.01, 0, 0],
    [0.01, 0.01, 0],
    [0, 0.01, 0],
  ];
  return {
    featureId,
    entities: Array.from({ length: entityCount }, (_, index) => ({
      entityId: `${featureId}_seg${index}`,
      entityType: "lineSegment" as const,
      onshapeEntityType: "skLineSegment",
      isConstruction: false,
      start3d: positions[index]!,
      end3d: positions[index + 1]!,
    })),
  };
}

function compressedEdgeQuery(sketchFeatureId: string, sketchEntityId: string) {
  return {
    queryString:
      `query=qCompressed(1.0,"%B5$QueryM5Sa$entityTypeBa$EntityTypeS4$EDGESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S${sketchFeatureId.length.toString(16)}.6$${sketchFeatureId}wireOpS9$queryTypeSd$SKETCH_ENTITYSe$sketchEntityIdS${sketchEntityId.length.toString(16)}$${sketchEntityId}",id);`,
  };
}

function wireQuery(sketchFeatureId: string) {
  return {
    queryString: `query = qConstructionFilter(qBodyType(qCreatedBy(id + "${sketchFeatureId}", EntityType.EDGE), BodyType.WIRE), ConstructionObject.NO);`,
  };
}

function resolveOpenCurves(input: {
  queries: { queryString: string }[];
  solved: OnshapeSolvedSketch[];
  tier?: string;
}) {
  return resolveOnshapeOpenSketchCurveProfiles({
    profileVerifier,
    profileParameter: { parameterId: "surfaceEntities", queries: input.queries },
    featureKind: "surface extrude",
    featureLabel: "Extrude 4",
    solvedSketchesByFeatureId: new Map(input.solved.map((sketch) => [sketch.featureId, sketch])),
    referencedSketchesByFeatureId: new Map(
      input.solved.map((sketch) => [
        sketch.featureId,
        { ...frame, tier: input.tier ?? frame.tier },
      ]),
    ),
  });
}

test("profile resolver reads compressed sketch-entity edge queries into durable open-curve profiles", async () => {
  const result = await resolveOpenCurves({
    queries: [
      compressedEdgeQuery("S_OPEN", "S_OPEN_seg0"),
      compressedEdgeQuery("S_OPEN", "S_OPEN_seg1"),
    ],
    solved: [solvedOpenChain("S_OPEN", 2)],
  });

  expect(result).toEqual({
    tier: "resolved",
    diagnostics: [],
    profiles: [
      { kind: "sketchCurve", sketchFeatureId: "S_OPEN", entityId: "sketch_entity_S_OPEN_S_OPEN_seg0" },
      { kind: "sketchCurve", sketchFeatureId: "S_OPEN", entityId: "sketch_entity_S_OPEN_S_OPEN_seg1" },
    ],
  });
});

test("profile resolver expands a whole-sketch wire query over a region-free sketch", async () => {
  const result = await resolveOpenCurves({
    queries: [wireQuery("S_OPEN")],
    solved: [solvedOpenChain("S_OPEN", 3)],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [
      { entityId: "sketch_entity_S_OPEN_S_OPEN_seg0" },
      { entityId: "sketch_entity_S_OPEN_S_OPEN_seg1" },
      { entityId: "sketch_entity_S_OPEN_S_OPEN_seg2" },
    ],
  });
});

test("profile resolver rejects a whole-sketch wire query whose sketch derives closed regions", async () => {
  const result = await resolveOpenCurves({
    queries: [wireQuery("S_CLOSED")],
    solved: [solvedCircle("S_CLOSED", [0, 0, 0])],
  });

  expect(result.tier).toBe("unresolved");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "onshape-surface-profile-wire-filter-ambiguous",
  ]);
});

test("profile resolver rejects unreadable, cross-sketch, unmatched, and disconnected surface profiles", async () => {
  const unreadable = await resolveOpenCurves({
    queries: [{ queryString: 'query = qCreatedBy(id + "S_OPEN", EntityType.EDGE);' }],
    solved: [solvedOpenChain("S_OPEN", 2)],
  });
  const crossSketch = await resolveOpenCurves({
    queries: [
      compressedEdgeQuery("S_OPEN", "S_OPEN_seg0"),
      compressedEdgeQuery("S_OTHER", "S_OTHER_seg0"),
    ],
    solved: [solvedOpenChain("S_OPEN", 2), solvedOpenChain("S_OTHER", 2)],
  });
  const unmatched = await resolveOpenCurves({
    queries: [compressedEdgeQuery("S_OPEN", "S_OPEN_missing")],
    solved: [solvedOpenChain("S_OPEN", 2)],
  });
  const bakedSketch = await resolveOpenCurves({
    queries: [compressedEdgeQuery("S_OPEN", "S_OPEN_seg0")],
    solved: [solvedOpenChain("S_OPEN", 2)],
    tier: "baked",
  });
  // Two segments that share no endpoint cannot be grouped into one wire.
  const disconnected = await resolveOpenCurves({
    queries: [
      compressedEdgeQuery("S_SPLIT", "S_SPLIT_seg0"),
      compressedEdgeQuery("S_SPLIT", "S_SPLIT_seg1"),
    ],
    solved: [{
      featureId: "S_SPLIT",
      entities: [
        {
          entityId: "S_SPLIT_seg0",
          entityType: "lineSegment" as const,
          onshapeEntityType: "skLineSegment",
          isConstruction: false,
          start3d: [0, 0, 0] as [number, number, number],
          end3d: [0.01, 0, 0] as [number, number, number],
        },
        {
          entityId: "S_SPLIT_seg1",
          entityType: "lineSegment" as const,
          onshapeEntityType: "skLineSegment",
          isConstruction: false,
          start3d: [0, 0.05, 0] as [number, number, number],
          end3d: [0.01, 0.05, 0] as [number, number, number],
        },
      ],
    }],
  });

  expect([unreadable, crossSketch, unmatched, bakedSketch, disconnected].map(
    (result) => [result.tier, result.diagnostics.at(-1)?.code],
  )).toEqual([
    ["unresolved", "onshape-surface-profile-query-unreadable"],
    ["unresolved", "onshape-surface-profile-multi-sketch"],
    ["unresolved", "onshape-surface-profile-entity-unmatched"],
    ["unresolved", "onshape-surface-profile-source-sketch-unavailable"],
    ["unresolved", "onshape-surface-profile-chain-disconnected"],
  ]);
});
