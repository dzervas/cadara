import { expect, test } from "vitest";

import type { OnshapeProfileEvidence } from "@/contracts/import/onshape-capture-bundle";
import type { OnshapeSolvedSketch } from "@/domain/import/onshape/bundle-reader";
import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
} from "@/domain/import/onshape/profile-resolver";

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
    profileParameter: input.parameter,
    consumerFeatureId: "E_PROFILE",
    featureLabel: "Profile consumer",
    featureKind: "extrude",
    profileEvidence: input.evidence,
    solvedSketchesByFeatureId: new Map(input.solved.map((sketch) => [sketch.featureId, sketch])),
    referencedSketchesByFeatureId: new Map(input.solved.map((sketch) => [sketch.featureId, frame])),
  });
}

test("profile resolver expands a readable exact region set into closed sketch selectors", () => {
  const result = resolve({
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
    profiles: [{ kind: "sketchRegion", sketchFeatureId: "S_SET", interiorPoint: [0, 0] }],
  });
});

test("profile resolver expands true qSketchRegion roots for nested circle annuli", () => {
  const nested = {
    featureId: "S_SET_NESTED",
    entities: [
      ...solvedCircle("S_SET_OUTER", [0, 0, 0], 0.006).entities,
      ...solvedCircle("S_SET_INNER", [0, 0, 0], 0.002).entities,
    ],
  };
  const result = resolve({
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

test("profile resolver derives exact selectors for a sparse layout of thin annuli", () => {
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
  const result = resolve({
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
    return centers.some((center) =>
      Math.abs(Math.hypot(
        profile.interiorPoint[0] - center[0] * 1_000,
        profile.interiorPoint[1] - center[1] * 1_000,
      ) - 3.25) < 1e-9,
    );
  })).toBeTruthy();
});

test("profile resolver fails closed for false qSketchRegion with inner loops", () => {
  const nested = {
    featureId: "S_SET_NESTED",
    entities: [
      ...solvedCircle("S_SET_OUTER", [0, 0, 0], 0.006).entities,
      ...solvedCircle("S_SET_INNER", [0, 0, 0], 0.002).entities,
    ],
  };
  const result = resolve({
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

test("profile resolver selects only the captured subset, never all closed regions", () => {
  const result = resolve({
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
      interiorPoint: [-4, 0],
      evidence: { queryIndex: 0, resultIndex: 0, deterministicId: "face-S_LEFT" },
    }],
  });
});

test("profile resolver preserves ordered exact profiles from multiple source sketches", () => {
  const result = resolve({
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

test("profile resolver requires a unique projected witness region for nested profiles", () => {
  const nested = {
    featureId: "S_NESTED",
    entities: [
      ...solvedCircle("S_NESTED_OUTER", [0, 0, 0], 0.006).entities,
      ...solvedCircle("S_NESTED_INNER", [0, 0, 0], 0.002).entities,
    ],
  };
  const result = resolve({
    parameter: profileParameter("S_NESTED"),
    evidence: [sketchEvidence({ sketchFeatureId: "S_NESTED", point: [0.004, 0, 0] })],
    solved: [nested],
  });

  expect(result).toMatchObject({ tier: "resolved", profiles: [{ interiorPoint: [4, 0] }] });
});

test("profile resolver resolves a witness in the odd-depth nested cell", () => {
  const result = resolve({
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

test("profile resolver verifies a witness in a line-circle cell", () => {
  const result = resolve({
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

test("profile resolver ignores open lines that cross a standalone circle", () => {
  const result = resolve({
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

test("profile resolver projects a mirror-derived source witness through the sketch frame", () => {
  const result = resolve({
    parameter: profileParameter("S_MIRROR"),
    evidence: [sketchEvidence({ sketchFeatureId: "S_MIRROR", point: [0.004, 0, 0] })],
    solved: [solvedCircle("S_MIRROR", [0.004, 0, 0])],
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ kind: "sketchRegion", sketchFeatureId: "S_MIRROR", interiorPoint: [4, 0] }],
  });
});

test("profile resolver keeps a selected planar face as an exact deferred topology profile", () => {
  const result = resolve({
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

test("profile resolver keeps missing witnesses, ambiguous sources, and unordered evidence unresolved", () => {
  const unresolvedWitness = resolve({
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
  const unordered = resolve({
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
