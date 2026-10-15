import { describe, expect, test } from "vitest";

import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchReferenceImageRecord,
} from "@/contracts/sketch/schema";
import type {
  ConstraintId,
  DimensionId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  FIXTURE_SKETCH_ID,
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import { orderedSplinePointIds } from "@/contracts/sketch/spline-geometry";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  appendDefinition,
  createSessionCommitFactories,
} from "@/domain/editor/sketch-session/internals";
import {
  createSketchDerivedTransformContribution,
  createSketchOffsetDerivationContribution,
} from "@/domain/sketch-editing/operations";
import {
  createSketchMergePointsMutation,
  getSketchMergePointRefusal,
  MERGE_POINTS_SAME_POINT_MESSAGE,
  retargetSketchPointReferences,
} from "@/domain/sketch-editing/merge-points";

// Lane: logic (docs/testing.md). Seam: the exported merge operation and its
// exhaustive retarget helper (T13j, D25, R-4, R-5), checked against the
// contract validator, the solver and the production arrangement deriver.

const S = "sketch_point_src" as SketchPointId;
const D = "sketch_point_dst" as SketchPointId;
const X = "sketch_point_x" as SketchPointId;
const Y = "sketch_point_y" as SketchPointId;
const E = "sketch_entity_e" as SketchEntityId;
const E2 = "sketch_entity_e2" as SketchEntityId;
const DATUM = { kind: "sketchDatum", datum: "xAxis" } as const;
const PROJECTED = {
  kind: "projectedGeometry",
  reference: {
    kind: "projectedCircle",
    referenceId: "ref_r" as ReferenceId,
    geometryId: "geometry_g",
  },
} as const;
const local = (pointId: SketchPointId) =>
  ({ kind: "localPoint", pointId }) as const;
const entity = (entityId: SketchEntityId) =>
  ({ kind: "localEntity", entityId }) as const;
const base = (id: string) => ({
  entityId: `sketch_entity_${id}` as SketchEntityId,
  label: id,
  target: {
    kind: "sketchEntity" as const,
    sketchId: FIXTURE_SKETCH_ID as SketchId,
    entityId: `sketch_entity_${id}` as SketchEntityId,
  },
  isConstruction: false,
});

/** One record of every entity kind; each point-holding kind references S. */
const ENTITIES: {
  [K in SketchEntityDefinition["kind"]]: Extract<
    SketchEntityDefinition,
    { kind: K }
  >;
} = {
  lineSegment: {
    ...base("line"),
    kind: "lineSegment",
    startPointId: S,
    endPointId: X,
  },
  point: { ...base("point"), kind: "point", pointId: S },
  circle: { ...base("circle"), kind: "circle", centerPointId: S, radius: 1 },
  arc: {
    ...base("arc"),
    kind: "arc",
    centerPointId: S,
    startPointId: X,
    endPointId: S,
    sweepDirection: "clockwise",
  },
  spline: {
    ...base("spline"),
    kind: "spline",
    pointOccurrenceIds: ["o0", "o1", "o2"],
    pointOccurrences: [
      { occurrenceId: "o0", pointId: X, tangent: { kind: "automatic" } },
      { occurrenceId: "o1", pointId: S, tangent: { kind: "automatic" } },
      { occurrenceId: "o2", pointId: Y, tangent: { kind: "automatic" } },
    ],
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  },
  ellipse: {
    ...base("ellipse"),
    kind: "ellipse",
    centerPointId: X,
    majorAxisPointId: S,
    minorRadius: 1,
  },
  ellipticalArc: {
    ...base("ellipticalArc"),
    kind: "ellipticalArc",
    centerPointId: S,
    majorAxisPointId: S,
    startPointId: S,
    endPointId: S,
    minorRadius: 1,
    sweepDirection: "clockwise",
  },
  conic: {
    ...base("conic"),
    kind: "conic",
    startPointId: X,
    controlPointId: S,
    endPointId: Y,
    rho: 0.5,
  },
  bezierCurve: {
    ...base("bezier"),
    kind: "bezierCurve",
    controlPointIds: [X, S, Y, S],
    degree: 3,
  },
  derivedPiecewiseCubic: {
    ...base("shell"),
    kind: "derivedPiecewiseCubic",
    derivationId: "derivation_offset",
  },
  profileText: {
    ...base("text"),
    kind: "profileText",
    anchorPointId: S,
    text: "A",
    height: 1,
    rotationRadians: 0,
    horizontalAlign: "left",
    verticalAlign: "baseline",
  },
};

const c = <K extends ConstraintDefinition["kind"]>(
  kind: K,
  rest: Omit<
    Extract<ConstraintDefinition, { kind: K }>,
    "kind" | "constraintId" | "label"
  >,
) =>
  ({
    constraintId: `constraint_${kind}` as ConstraintId,
    label: kind,
    kind,
    ...rest,
  }) as Extract<ConstraintDefinition, { kind: K }>;

/** One record of every constraint kind; each point-holding kind references S. */
const CONSTRAINTS: {
  [K in ConstraintDefinition["kind"]]: Extract<
    ConstraintDefinition,
    { kind: K }
  >;
} = {
  coincident: c("coincident", { pointIds: [S, X] }),
  horizontal: c("horizontal", { entityId: E }),
  vertical: c("vertical", { entityId: E }),
  coincidentProjectedPoint: c("coincidentProjectedPoint", {
    point: local(S),
    projectedPoint: DATUM,
  }),
  pointOnProjectedCurve: c("pointOnProjectedCurve", {
    point: local(S),
    projectedCurve: DATUM,
  }),
  midpoint: c("midpoint", { point: local(S), line: entity(E) }),
  midpointProjectedLine: c("midpointProjectedLine", {
    point: local(S),
    projectedLine: DATUM,
  }),
  pointOnCurve: c("pointOnCurve", { point: local(S), curve: entity(E) }),
  collinear: c("collinear", { target: local(S), line: entity(E) }),
  collinearProjectedLine: c("collinearProjectedLine", {
    target: local(S),
    projectedLine: DATUM,
  }),
  parallelProjectedLine: c("parallelProjectedLine", {
    line: entity(E),
    projectedLine: DATUM,
  }),
  perpendicularProjectedLine: c("perpendicularProjectedLine", {
    line: entity(E),
    projectedLine: DATUM,
  }),
  tangentProjectedCurve: c("tangentProjectedCurve", {
    curve: entity(E),
    projectedCurve: PROJECTED as never,
    relation: "external",
  }),
  tangent: c("tangent", { entityIds: [E, E2], relation: "external" }),
  concentric: c("concentric", { entityIds: [E, E2] }),
  concentricProjectedCurve: c("concentricProjectedCurve", {
    curve: entity(E),
    projectedCurve: PROJECTED as never,
  }),
  normal: c("normal", { line: entity(E), curve: entity(E2), point: local(S) }),
  normalProjectedCurve: c("normalProjectedCurve", {
    line: entity(E),
    projectedCurve: PROJECTED as never,
    point: local(S),
  }),
  symmetric: c("symmetric", { pointIds: [X, S], axis: entity(E) }),
  symmetricProjectedLine: c("symmetricProjectedLine", {
    pointIds: [S, X],
    projectedLine: DATUM,
  }),
  fixPoint: c("fixPoint", { pointId: S, position: [1, 2] }),
  angle: c("angle", { pointIds: [X, Y, S], valueRadians: 1 }),
  parallel: c("parallel", { entityIds: [E, E2] }),
  perpendicular: c("perpendicular", { entityIds: [E, E2] }),
  equalLength: c("equalLength", { entityIds: [E, E2] }),
  equalOffset: c("equalOffset", {
    pairs: [
      { seedEntityId: E, offsetEntityId: E2, side: "left" },
      { seedEntityId: E2, offsetEntityId: E, side: "right" },
    ],
  }),
};

const d = <K extends DimensionDefinition["kind"]>(
  kind: K,
  rest: Omit<
    Extract<DimensionDefinition, { kind: K }>,
    "kind" | "dimensionId" | "label"
  >,
) =>
  ({
    dimensionId: `dimension_${kind}` as DimensionId,
    label: kind,
    kind,
    ...rest,
  }) as Extract<DimensionDefinition, { kind: K }>;

// T17p2 (F-2): dimension values are authored wrappers.
const one = createLiteralAuthoredValue(1);
/** One record of every dimension kind; each point-holding kind references S. */
const DIMENSIONS: {
  [K in DimensionDefinition["kind"]]: Extract<DimensionDefinition, { kind: K }>;
} = {
  distance: d("distance", { axis: "aligned", pointIds: [S, X], value: one }),
  pointDatumDistance: d("pointDatumDistance", {
    axis: "horizontal",
    point: local(S),
    datum: { kind: "sketchDatum", datum: "origin" },
    value: one,
  }),
  circleRadius: d("circleRadius", { entityId: E, value: one }),
  diameter: d("diameter", { entityId: E, value: one }),
  lineLength: d("lineLength", { entityId: E, value: one }),
  lineDistance: d("lineDistance", {
    lines: [entity(E), entity(E2)],
    value: one,
  }),
  linePointDistance: d("linePointDistance", {
    line: entity(E),
    point: local(S),
    value: one,
  }),
  lineAngle: d("lineAngle", {
    lines: [entity(E), entity(E2)],
    valueRadians: one,
  }),
  horizontalDistance: d("horizontalDistance", { pointIds: [X, S], value: one }),
  verticalDistance: d("verticalDistance", { pointIds: [S, X], value: one }),
  arcStartPointCoincident: d("arcStartPointCoincident", {
    entityId: E,
    pointId: S,
  }),
  arcEndPointCoincident: d("arcEndPointCoincident", {
    entityId: E,
    pointId: S,
  }),
};

const output = (index: number) => ({
  seedEntityId: E,
  outputEntityId: `sketch_entity_out${index}` as SketchEntityId,
  instanceIndex: 1,
  seedPointIds: [S, X],
  outputPointIds: [`sketch_point_out${index}` as SketchPointId, S],
});
const relationshipBase = (kind: string) => ({
  derivationId: `derivation_${kind}`,
  label: kind,
  seedEntityIds: [E],
  outputs: [output(0)],
});

/** One record of every derived relationship kind, each referencing S. */
const RELATIONSHIPS: {
  [K in SketchDerivationDefinition["kind"]]: Extract<
    SketchDerivationDefinition,
    { kind: K }
  >;
} = {
  mirror: {
    ...relationshipBase("mirror"),
    kind: "mirror",
    mirrorReference: { kind: "lineEntity", entityId: E2 },
  },
  linearPattern: {
    ...relationshipBase("linearPattern"),
    kind: "linearPattern",
    vector: [1, 0],
    instanceCount: 2,
  },
  circularPattern: {
    ...relationshipBase("circularPattern"),
    kind: "circularPattern",
    center: [0, 0],
    angleRadians: 1,
    instanceCount: 2,
  },
  transform: {
    ...relationshipBase("transform"),
    kind: "transform",
    origin: [0, 0],
    translation: [1, 0],
    rotationRadians: 0,
    scale: 1,
  },
  offset: {
    ...relationshipBase("offset"),
    kind: "offset",
    distance: 1,
    jointPolicy: "trimExtendArcFallback",
    jointOutputs: [
      {
        firstSeedEntityId: E,
        secondSeedEntityId: E2,
        outputEntityId: "sketch_entity_joint" as SketchEntityId,
        centerPointId: S,
        startPointId: S,
        endPointId: X,
      },
    ],
    piecewiseCubicOutputs: [
      {
        seedEntityId: E,
        outputEntityId: "sketch_entity_shell" as SketchEntityId,
        startPointId: X,
        endPointId: S,
        spans: [],
      },
    ],
  },
};

const REFERENCE_IMAGE: SketchReferenceImageRecord = {
  operationId:
    "sketch_operation_image" as SketchReferenceImageRecord["operationId"],
  label: "Image",
  kind: "referenceImage",
  ownedPointIds: [S],
  ownedEntityIds: [],
  ownedState: {
    kind: "referenceImage",
    image: {
      mediaType: "image/png",
      pixelWidth: 1,
      pixelHeight: 1,
      base64Data: "AA==",
    },
    placement: { center: [0, 0], width: 1, height: 1, rotationRadians: 0 },
    calibration: {
      scaleMode: "lockedAspect",
      showExportedAnchorsInSketch: true,
      anchors: [
        { anchorId: "a0", label: "A0", uv: [0, 0], pointId: S },
        { anchorId: "a1", label: "A1", uv: [1, 1], pointId: X },
      ],
    },
  },
};

/**
 * Review R-4.1: the retarget table puts the source in EVERY point slot of
 * every record (each other point id of the tables above becomes S), so a
 * slot the helper forgets keeps S and fails its row.
 */
const everySlotIsSource = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value)
      .replaceAll(`"${X}"`, `"${S}"`)
      .replaceAll(`"${Y}"`, `"${S}"`)
      .replace(/"sketch_point_out\d+"/g, `"${S}"`),
  ) as T;
const EVERY_KIND: SketchDefinition = everySlotIsSource({
  schemaVersion: "sketch-definition/v1alpha2",
  referenceIds: [],
  references: [],
  pointIds: [],
  points: [],
  entityIds: Object.values(ENTITIES).map((record) => record.entityId),
  entities: Object.values(ENTITIES),
  constraintIds: Object.values(CONSTRAINTS).map(
    (record) => record.constraintId,
  ),
  constraints: Object.values(CONSTRAINTS),
  dimensionIds: Object.values(DIMENSIONS).map((record) => record.dimensionId),
  dimensions: Object.values(DIMENSIONS),
  derivedRelationships: Object.values(RELATIONSHIPS),
  referenceImages: [REFERENCE_IMAGE],
});
const RETARGETED = retargetSketchPointReferences(EVERY_KIND, S, D);
const json = (value: unknown) => JSON.stringify(value);
const POINT_FREE = new Set<string>([
  "derivedPiecewiseCubic",
  "horizontal",
  "vertical",
  "parallelProjectedLine",
  "perpendicularProjectedLine",
  "tangentProjectedCurve",
  "tangent",
  "concentric",
  "concentricProjectedCurve",
  "parallel",
  "perpendicular",
  "equalLength",
  "equalOffset",
  "circleRadius",
  "diameter",
  "lineLength",
  "lineDistance",
  "lineAngle",
]);

describe("retargetSketchPointReferences (T13j: one row per reference kind)", () => {
  const rows = [
    ...EVERY_KIND.entities.map((record, index) => ({
      family: "entity",
      kind: record.kind,
      before: record as unknown,
      after: RETARGETED.entities[index] as unknown,
    })),
    ...EVERY_KIND.constraints.map((record, index) => ({
      family: "constraint",
      kind: record.kind as string,
      before: record as unknown,
      after: RETARGETED.constraints[index] as unknown,
    })),
    ...EVERY_KIND.dimensions.map((record, index) => ({
      family: "dimension",
      kind: record.kind as string,
      before: record as unknown,
      after: RETARGETED.dimensions[index] as unknown,
    })),
    ...EVERY_KIND.derivedRelationships!.map((record, index) => ({
      family: "derived relationship",
      kind: record.kind as string,
      before: record as unknown,
      after: RETARGETED.derivedRelationships![index] as unknown,
    })),
    {
      family: "reference image",
      kind: "ownership and calibration anchors",
      before: EVERY_KIND.referenceImages![0] as unknown,
      after: RETARGETED.referenceImages![0] as unknown,
    },
  ];

  test("the table covers every kind of each reference family", () => {
    // The tables are typed as complete mapped records over each kind union,
    // so a new kind fails to compile here as in the helper's `never` switch.
    expect(rows).toHaveLength(11 + 26 + 12 + 5 + 1);
  });

  test.each(rows)("$family $kind", ({ kind, before, after }) => {
    if (POINT_FREE.has(kind)) {
      expect(json(before), "premise: this kind holds no point").not.toContain(
        S,
      );
      expect(after, "a point-free record is unchanged").toEqual(before);
      return;
    }
    expect(json(before), "premise: the record references the source").toContain(
      S,
    );
    expect(
      json(before),
      "premise: the source fills every point slot of the record",
    ).not.toMatch(/"sketch_point_(?!src")/);
    expect(
      json(after),
      "every source reference, and nothing else, becomes the destination",
    ).toBe(json(before).replaceAll(S, D));
  });
});

const TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};
const solve = (definition: SketchDefinition) =>
  solveSketchDefinitionCore({
    definition: literalResolvedDefinition(definition),
    tolerances: TOLERANCES,
    modelingTolerance: FIXTURE_TOLERANCE,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
const deriver = createSketchArrangementDeriver(
  createCertifiedNeutralCurveQueryCapabilityForTest(),
);
async function regionCount(definition: SketchDefinition) {
  return (
    await deriver.derive({
      documentId: "doc_merge",
      revisionId: "rev_merge",
      sketchId: FIXTURE_SKETCH_ID,
      definition,
      solvedSnapshot: solve(definition),
      projectedReferences: [],
      modelingTolerance: FIXTURE_TOLERANCE,
    })
  ).regions.length;
}
const pid = (name: string) => `sketch_point_${name}` as SketchPointId;
const merge = (
  definition: SketchDefinition,
  source: string,
  destination: string,
) =>
  createSketchMergePointsMutation({
    definition,
    sourcePointId: pid(source),
    destinationPointId: pid(destination),
  });
function valid(result: ReturnType<typeof merge>) {
  if (!result.valid)
    throw new Error(`Expected a valid merge: ${result.message}`);
  return result;
}

/** A triangle a→b→c→(gap)→a2: the last side ends 0.01 from the first start. */
function gappedTriangle() {
  const f = makeSketchFixture();
  f.point("a", 0, 0);
  f.point("b", 4, 0);
  f.point("c", 2, 3);
  f.point("a2", 0.01, 0.005);
  f.line("ab", "a", "b");
  f.line("bc", "b", "c");
  f.line("ca", "c", "a2");
  return f;
}

describe("createSketchMergePointsMutation (T13j, D25)", () => {
  test("destination id and authored position survive; the source record is deleted; the gap closes a region", async () => {
    const before = gappedTriangle().definition();
    expect(
      await regionCount(before),
      "premise: the near gap bounds nothing",
    ).toBe(0);
    const result = valid(merge(before, "a2", "a"));
    const destination = result.definition.points.find(
      (point) => point.pointId === pid("a"),
    );
    expect(
      destination?.position,
      "the destination keeps its authored position",
    ).toEqual([0, 0]);
    expect(result.definition.pointIds).not.toContain(pid("a2"));
    expect(result.definition.points.map((point) => point.pointId)).toEqual(
      result.definition.pointIds,
    );
    const side = result.definition.entities.find(
      (record) => record.entityId === "sketch_entity_ca",
    );
    expect(side?.kind === "lineSegment" && side.endPointId).toBe(pid("a"));
    expect(
      result.definition.entities,
      "no connecting segment is added",
    ).toHaveLength(3);
    expect(result.definition.constraints, "no coincident substitute").toEqual(
      [],
    );
    expect(result.absorbedConstraintIds).toEqual([]);
    expect(validateSketchDefinition(result.definition).success).toBe(true);
    expect(
      await regionCount(result.definition),
      "the declared join bounds the triangle",
    ).toBe(1);
  });

  test("only coincidents between exactly the pair are absorbed and reported; duplicates and others are retained", () => {
    const f = gappedTriangle();
    f.point("q", 7, 7);
    f.coincident("a2", "a");
    f.coincident("a", "a2");
    const other = f.coincident("a2", "q");
    const kept = f.coincident("a", "q");
    const result = valid(merge(f.definition(), "a2", "a"));
    expect(result.absorbedConstraintIds).toEqual([
      "constraint_0",
      "constraint_1",
    ]);
    expect(result.definition.constraintIds).toEqual([other, kept]);
    const retargeted = result.definition.constraints.find(
      (entry) => entry.constraintId === other,
    );
    expect(retargeted?.kind === "coincident" && retargeted.pointIds).toEqual([
      pid("a"),
      pid("q"),
    ]);
    expect(
      result.retargetedRequirementIds,
      "the retained retargeted requirement",
    ).toEqual([other]);
  });

  test("a distance between the merged pair is retained and becomes an unsatisfied, explained conflict", () => {
    const definition = gappedTriangle().definition();
    const withDistance: SketchDefinition = {
      ...definition,
      dimensionIds: ["dimension_gap" as DimensionId],
      dimensions: [
        {
          dimensionId: "dimension_gap" as DimensionId,
          kind: "distance",
          label: "Gap",
          axis: "aligned",
          pointIds: [pid("a2"), pid("a")],
          value: createLiteralAuthoredValue(0.5),
        },
      ],
    };
    const result = valid(merge(withDistance, "a2", "a"));
    expect(result.definition.dimensions).toEqual([
      { ...withDistance.dimensions[0], pointIds: [pid("a"), pid("a")] },
    ]);
    expect(result.retargetedRequirementIds).toEqual(["dimension_gap"]);
    expect(
      solve(result.definition).dimensionStatuses.find(
        (entry) => entry.dimensionId === "dimension_gap",
      )?.status,
    ).toBe("unsatisfied");
  });

  test("R-5: merging an open spline's own ends (4 fit points, the minimum) closes it positionally and forms a region", async () => {
    const f = makeSketchFixture();
    f.point("s0", 0, 0);
    f.point("s1", 4, 0);
    f.point("s2", 2, 3);
    f.point("s3", 0.02, 0.01);
    f.spline("loop", ["s0", "s1", "s2", "s3"], "open");
    const before = f.definition();
    expect(await regionCount(before)).toBe(0);
    const result = valid(merge(before, "s3", "s0"));
    const spline = result.definition.entities[0]!;
    expect(spline.kind === "spline" && spline.closure).toBe("positional");
    expect(spline.kind === "spline" && orderedSplinePointIds(spline)).toEqual([
      pid("s0"),
      pid("s1"),
      pid("s2"),
      pid("s0"),
    ]);
    expect(
      spline.kind === "spline" && spline.pointOccurrences.map((o) => o.tangent),
    ).toEqual(
      before.entities[0]!.kind === "spline"
        ? before.entities[0]!.pointOccurrences.map((o) => o.tangent)
        : [],
    );
    expect(result.closedSplineEntityId).toBe("sketch_entity_loop");
    expect(validateSketchDefinition(result.definition).success).toBe(true);
    expect(await regionCount(result.definition)).toBe(1);
  });
});

describe("refusals (T13j)", () => {
  function shapes() {
    const f = gappedTriangle();
    f.point("o", 10, 0);
    f.point("r", 11, 0);
    f.circle("ring", "o", 1);
    f.point("ac", 20, 0);
    f.point("as", 21, 0);
    f.point("ae", 20, 1);
    f.arc("bow", "ac", "as", "ae");
    f.point("t0", 30, 0);
    f.point("t1", 31, 1);
    f.point("t2", 32, 0);
    f.spline("wave", ["t0", "t1", "t2"], "open");
    f.point("u0", 40, 0);
    f.point("u1", 41, 1);
    f.spline("short", ["u0", "u1"], "open");
    f.point("ec", 50, 0);
    f.point("em", 52, 0);
    f.ellipse("oval", "ec", "em", 1);
    f.point("lone", 60, 0);
    f.point("v0", 70, 0);
    f.point("v1", 71, 1);
    f.point("v2", 72, 0);
    f.spline("arch", ["v0", "v1", "v2"], "open");
    for (const [name, x] of [
      ["k", 80],
      ["m", 90],
      ["n", 100],
      ["z", 130],
    ] as const) {
      f.point(`${name}0`, x, 0);
      f.point(`${name}1`, x + 1, 1);
      f.point(`${name}2`, x + 2, 0);
      f.point(`${name}3`, x + 3, 1);
    }
    f.spline("ring4", ["k0", "k1", "k2", "k0"], "positional");
    f.spline("smooth4", ["m0", "m1", "m2", "m3"], "smooth");
    f.point("w0", 110, 0);
    f.point("w1", 111, 1);
    f.point("w2", 112, 0);
    f.point("w3", 113, 1);
    f.point("wc", 111, 0);
    f.point("wm", 113, 0);
    f.point("txt", 120, 0);
    const definition = f.definition();
    const extra: SketchEntityDefinition[] = [
      {
        ...base("ellArc"),
        label: "ellArc",
        kind: "ellipticalArc",
        centerPointId: pid("wc"),
        majorAxisPointId: pid("wm"),
        startPointId: pid("w0"),
        endPointId: pid("w2"),
        minorRadius: 0.5,
        sweepDirection: "clockwise",
      },
      {
        ...base("con"),
        label: "con",
        kind: "conic",
        startPointId: pid("n0"),
        controlPointId: pid("n1"),
        endPointId: pid("n2"),
        rho: 0.5,
      },
      {
        ...base("quad"),
        label: "quad",
        kind: "bezierCurve",
        controlPointIds: [pid("w1"), pid("w3"), pid("n3")],
        degree: 2,
      },
      {
        ...base("cubic"),
        label: "cubic",
        kind: "bezierCurve",
        controlPointIds: [pid("z0"), pid("z1"), pid("z2"), pid("z3")],
        degree: 3,
      },
      { ...ENTITIES.profileText, label: "label", anchorPointId: pid("txt") },
    ];
    return {
      ...definition,
      entityIds: [...definition.entityIds, ...extra.map((e) => e.entityId)],
      entities: [...definition.entities, ...extra],
    };
  }

  test.each([
    [
      "a centre",
      "o",
      "a",
      "o is the centre of ring; centres are not merged. Use Concentric or Coincident instead.",
    ],
    [
      "an arc centre",
      "a",
      "ac",
      "ac is the centre of bow; centres are not merged. Use Concentric or Coincident instead.",
    ],
    [
      "an interior fit point",
      "t1",
      "a",
      "t1 is an interior fit point of wave; only the ends of an open spline can be merged.",
    ],
    [
      "an ellipse axis point",
      "em",
      "a",
      "em is a control point of oval; only curve ends and points can be merged.",
    ],
    [
      "a point record with no curve",
      "lone",
      "a",
      "lone is not a curve end or a point; it cannot be merged.",
    ],
    ["the same point twice", "a", "a", MERGE_POINTS_SAME_POINT_MESSAGE],
    [
      "the two ends of one line",
      "a",
      "b",
      "Both points are ends of ab; merging them would collapse it.",
    ],
    [
      "the two ends of one arc",
      "as",
      "ae",
      "Both points are ends of bow; merging them would collapse it.",
    ],
    [
      "a 2-point spline's own ends",
      "u1",
      "u0",
      "short needs at least 4 fit points to close by merging its ends.",
    ],
    // Review R-4.3: a 3-point closure is an out-and-back curve; refused.
    [
      "a 3-point spline's own ends",
      "v2",
      "v0",
      "arch needs at least 4 fit points to close by merging its ends.",
    ],
    // Review R-1: every other curve's own ends.
    [
      "the two ends of one elliptical arc",
      "w2",
      "w0",
      "Both points are ends of ellArc; merging them would collapse it.",
    ],
    [
      "the two ends of one conic",
      "n2",
      "n0",
      "Both points are ends of con; merging them would collapse it.",
    ],
    [
      "the two ends of one quadratic Bézier",
      "n3",
      "w1",
      "Both points are ends of quad; merging them would collapse it.",
    ],
    [
      "the two ends of one cubic Bézier",
      "z3",
      "z0",
      "Both points are ends of cubic; merging them would collapse it.",
    ],
    // Review R-4.2: the remaining non-end roles.
    [
      "a Bézier interior control point",
      "w3",
      "a",
      "w3 is a control point of quad; only curve ends and points can be merged.",
    ],
    [
      "a conic control point",
      "n1",
      "a",
      "n1 is a control point of con; only curve ends and points can be merged.",
    ],
    [
      "a text anchor",
      "txt",
      "a",
      "txt is the anchor of label; only curve ends and points can be merged.",
    ],
    [
      "a positionally closed spline's end",
      "k0",
      "a",
      "k0 is an interior fit point of ring4; only the ends of an open spline can be merged.",
    ],
    [
      "a smoothly closed spline's first point",
      "a",
      "m0",
      "m0 is an interior fit point of smooth4; only the ends of an open spline can be merged.",
    ],
  ])("%s", (_, source, destination, message) => {
    const definition = shapes();
    expect(merge(definition, source, destination)).toEqual({
      valid: false,
      message,
    });
  });

  test("a reference-image-owned point", () => {
    const definition = gappedTriangle().definition();
    const owned: SketchDefinition = {
      ...definition,
      referenceImages: [{ ...REFERENCE_IMAGE, ownedPointIds: [pid("a2")] }],
    };
    expect(merge(owned, "a2", "a")).toEqual({
      valid: false,
      message: "a2 belongs to reference image Image; it cannot be merged.",
    });
  });

  test.each([
    [
      "an output point",
      {
        outputs: [
          { ...output(0), seedPointIds: [X], outputPointIds: [pid("a2")] },
        ],
      },
    ],
    [
      "a joint centre",
      {
        jointOutputs: [
          {
            ...RELATIONSHIPS.offset.jointOutputs[0]!,
            centerPointId: pid("a2"),
            startPointId: X,
            endPointId: Y,
          },
        ],
      },
    ],
    [
      "a shell terminal",
      {
        piecewiseCubicOutputs: [
          {
            ...RELATIONSHIPS.offset.piecewiseCubicOutputs[0]!,
            startPointId: X,
            endPointId: pid("a2"),
          },
        ],
      },
    ],
  ])("G18: a driven point (%s)", (_, patch) => {
    const definition = gappedTriangle().definition();
    const driven: SketchDefinition = {
      ...definition,
      derivedRelationships: [
        {
          ...RELATIONSHIPS.offset,
          outputs: [],
          jointOutputs: [],
          piecewiseCubicOutputs: [],
          ...patch,
        },
      ],
    };
    for (const [source, destination] of [
      ["a2", "a"],
      ["a", "a2"],
    ] as const)
      expect(merge(driven, source, destination)).toEqual({
        valid: false,
        message:
          "a2 is driven by offset offset; it cannot be merged (merge its seed points instead).",
      });
  });

  test("getSketchMergePointRefusal accepts curve ends and Point-tool points", () => {
    const f = gappedTriangle();
    const definition = {
      ...f.definition(),
      entities: [
        ...f.definition().entities,
        { ...ENTITIES.point, pointId: pid("c") },
      ],
    };
    for (const name of ["a", "b", "c", "a2"])
      expect(getSketchMergePointRefusal(definition, pid(name))).toBeNull();
  });
});

describe("R-4: derived relationships (real contributions)", () => {
  const factories = createSessionCommitFactories(
    50,
    FIXTURE_SKETCH_ID as SketchId,
  );
  /** An L chain p→q→r, a separate line s→t, and an axis line far away. */
  function chain() {
    const f = makeSketchFixture();
    f.point("p", 0, 0);
    f.point("q", 4, 0);
    f.point("r", 4, 3);
    f.point("s", 6, 0.01);
    f.point("t", 9, 0);
    f.point("x0", -5, -5);
    f.point("x1", -5, 5);
    f.line("pq", "p", "q");
    f.line("qr", "q", "r");
    f.line("st", "s", "t");
    f.line("axis", "x0", "x1");
    return f.definition();
  }
  const seeds = ["sketch_entity_pq", "sketch_entity_qr"] as SketchEntityId[];
  const relationships = {
    offset: (definition: SketchDefinition) =>
      createSketchOffsetDerivationContribution({
        definition,
        entityIds: seeds,
        distance: 0.5,
        side: "left",
        sequence: 50,
        factories,
        modelingTolerance: FIXTURE_TOLERANCE,
      }),
    mirror: (definition: SketchDefinition) =>
      createSketchDerivedTransformContribution({
        definition,
        operatorKind: "mirror",
        entityIds: [...seeds, "sketch_entity_axis" as SketchEntityId],
        value: null,
        sequence: 50,
        factories,
        modelingTolerance: FIXTURE_TOLERANCE,
      }),
    linearPattern: (definition: SketchDefinition) =>
      createSketchDerivedTransformContribution({
        definition,
        operatorKind: "linearPattern",
        entityIds: seeds,
        value: 20,
        sequence: 50,
        factories,
        modelingTolerance: FIXTURE_TOLERANCE,
      }),
    circularPattern: (definition: SketchDefinition) =>
      createSketchDerivedTransformContribution({
        definition,
        operatorKind: "circularPattern",
        entityIds: seeds,
        value: 1,
        sequence: 50,
        factories,
        modelingTolerance: FIXTURE_TOLERANCE,
      }),
    transform: (definition: SketchDefinition) =>
      createSketchDerivedTransformContribution({
        definition,
        operatorKind: "transform",
        entityIds: seeds,
        value: 20,
        sequence: 50,
        factories,
        modelingTolerance: FIXTURE_TOLERANCE,
      }),
  };

  test.each(Object.entries(relationships))("%s", (kind, create) => {
    const definition = chain();
    const contribution = create(definition);
    expect(
      contribution.valid,
      `premise: the ${kind} is authored (${contribution.message})`,
    ).toBe(true);
    const withRelationship = appendDefinition(
      definition,
      contribution.contribution!,
    );
    expect(
      validateSketchDefinition(withRelationship).success,
      "premise: valid",
    ).toBe(true);
    const relationship = withRelationship.derivedRelationships![0]!;

    // Both points referenced by the same relationship: refused, naming it.
    const refused = merge(withRelationship, "r", "p");
    expect(refused.valid).toBe(false);
    expect(!refused.valid && refused.message).toContain(relationship.label);
    expect(!refused.valid && refused.message).toMatch(
      /^Both points are used by /,
    );

    // Its driven outputs stay unmergeable.
    const drivenPoint = relationship.outputs[0]?.outputPointIds[0];
    if (drivenPoint)
      expect(getSketchMergePointRefusal(withRelationship, drivenPoint)).toMatch(
        / is driven by /,
      );

    // T15d ([TECH] T-11): a mirror seed point is refused on either side of
    // the pair (after the R-4 pair rule above), naming the mirror.
    if (kind === "mirror") {
      for (const [source, destination] of [
        ["s", "q"],
        ["q", "s"],
      ] as const)
        expect(merge(withRelationship, source, destination)).toEqual({
          valid: false,
          // T16a ([TECH] T16-3): Merge's wording, naming the seed point q.
          message: `q is part of mirror ‘${relationship.label}’. To merge it, press Esc, select it, then Mirror → Remove mirror.`,
        });
      return;
    }

    // One side referenced: retargeted, and the merged definition validates
    // (runtime schema incl. G18 offset ownership).
    const merged = valid(merge(withRelationship, "s", "q"));
    expect(merged.definition.pointIds).not.toContain(pid("s"));
    expect(json(merged.definition)).not.toContain(`"${pid("s")}"`);
    expect(validateSketchDefinition(merged.definition).success).toBe(true);
    const seedSide = valid(merge(withRelationship, "q", "s"));
    expect(json(seedSide.definition)).not.toContain(`"${pid("q")}"`);
    expect(
      seedSide.definition.derivedRelationships![0]!.outputs.flatMap(
        (o) => o.seedPointIds,
      ),
    ).toEqual(
      relationship.outputs
        .flatMap((o) => o.seedPointIds)
        .map((id) => (id === pid("q") ? pid("s") : id)),
    );
    expect(validateSketchDefinition(seedSide.definition).success).toBe(true);
  });

  // Review R-4.2: a mirror reads its axis line too, so a seed end merged
  // onto the axis (its copy would be a distinct coincident point) is
  // refused; the same pair merges when the relationship is not a mirror.
  test("mirror: a seed end merged onto the mirror axis is refused", () => {
    const definition = chain();
    const mirrored = appendDefinition(
      definition,
      relationships.mirror(definition).contribution!,
    );
    const refused = merge(mirrored, "x0", "p");
    expect(refused).toEqual({
      valid: false,
      message: `Both points are used by mirror ${mirrored.derivedRelationships![0]!.label}; merging them would leave its copies looking joined but not joined. Delete the mirror first, or merge other points.`,
    });
    const patterned = appendDefinition(
      definition,
      relationships.linearPattern(definition).contribution!,
    );
    expect(merge(patterned, "x0", "p").valid).toBe(true);
  });
});
