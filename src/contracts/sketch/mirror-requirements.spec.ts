// Lane: logic. Seam: the exported functions of the dark mirror requirement
// owner (T15a): axis classification, value map, structural sync, analytic
// JVP/VJP, dependency order and correspondence. Oracles are independent:
// central finite differences, the real `reconstructSplineAggregate`, and
// today's forward evaluation (`evaluateSketchDerivations`,
// `evaluateSketchDerivationJvp`, `prepareSketchDerivationPullback`).
import { describe, expect, test } from "vitest";

import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivationJvp,
  evaluateSketchDerivations,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import {
  reconstructSplineAggregate,
  type SplineTangent,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  MIRROR_DIAGNOSTIC_CODES,
  applyMirrorOutputStructure,
  applyMirrorOutputValues,
  evaluateMirrorRelationship,
  mirrorArcVariables,
  mirrorArcVariablesJvp,
  mirrorArcVariablesVjp,
  mirrorAxisAngle,
  mirrorPoint,
  mirrorPointJvp,
  mirrorPointVjp,
  mirrorVector,
  mirrorVectorJvp,
  mirrorVectorVjp,
  orderDerivedRelationships,
  resolveMirrorAxis,
  resolveMirrorCounterpart,
  indexMirrorGeometry,
  DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED,
  type MirrorArcVariables,
  type MirrorAxis,
  type MirrorAxisReference,
  type MirrorAxisVariation,
  type MirrorOutputEvaluation,
  type MirrorRelationshipEvaluation,
  type MirrorRelationshipInput,
  correspondingMirrorDimensions,
  linkedMirrorRefs,
} from "@/contracts/sketch/mirror-requirements";
import { solveSketchDefinitionCore } from "@/core/sketch-solver";
import { literalResolvedDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";

// ------------------------------------------------------------ builders

const TAU = 1e-3;
const pid = (id: string) => id as SketchPointId;
const eid = (id: string) => id as SketchEntityId;
const SKETCH = "sketch_1" as SketchPointDefinition["target"]["sketchId"];

function makePoint(id: string, position: SketchPoint2D): SketchPointDefinition {
  return {
    pointId: pid(id),
    label: id,
    target: { kind: "sketchPoint", sketchId: SKETCH, pointId: pid(id) },
    position,
    isConstruction: false,
  };
}

function entityBase(id: string) {
  return {
    entityId: eid(id),
    label: id,
    target: {
      kind: "sketchEntity" as const,
      sketchId: SKETCH,
      entityId: eid(id),
    },
    isConstruction: false,
  };
}

const makeLine = (id: string, start: string, end: string) =>
  ({
    kind: "lineSegment",
    ...entityBase(id),
    startPointId: pid(start),
    endPointId: pid(end),
  }) satisfies SketchEntityDefinition;

const makePointEntity = (id: string, point: string) =>
  ({
    kind: "point",
    ...entityBase(id),
    pointId: pid(point),
  }) satisfies SketchEntityDefinition;

const makeCircle = (id: string, center: string, radius: number) =>
  ({
    kind: "circle",
    ...entityBase(id),
    centerPointId: pid(center),
    radius,
  }) satisfies SketchEntityDefinition;

const makeArc = (
  id: string,
  center: string,
  start: string,
  end: string,
  sweepDirection: "clockwise" | "counterClockwise",
) =>
  ({
    kind: "arc",
    ...entityBase(id),
    centerPointId: pid(center),
    startPointId: pid(start),
    endPointId: pid(end),
    sweepDirection,
  }) satisfies SketchEntityDefinition;

type Spline = Extract<SketchEntityDefinition, { kind: "spline" }>;

function makeSpline(
  id: string,
  occurrences: readonly (readonly [string, SplineTangent?])[],
  extra: Partial<Pick<Spline, "closure" | "endSpanParameterLengths">> = {},
): Spline {
  return {
    kind: "spline",
    ...entityBase(id),
    pointOccurrenceIds: occurrences.map((_, index) => `${id}-occ-${index}`),
    pointOccurrences: occurrences.map(([point, tangent], index) => ({
      occurrenceId: `${id}-occ-${index}`,
      pointId: pid(point),
      tangent: tangent ?? { kind: "automatic" },
    })),
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
    ...extra,
  };
}

function makeSketch(
  points: readonly SketchPointDefinition[],
  entities: readonly SketchEntityDefinition[],
  derivedRelationships: readonly SketchDerivationDefinition[] = [],
): SketchDefinition {
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.pointId),
    points: [...points],
    entityIds: entities.map((entity) => entity.entityId),
    entities: [...entities],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: [...derivedRelationships],
  };
}

type OutputSpec = readonly [
  seed: string,
  output: string,
  seedPoints: readonly string[],
  outputPoints: readonly string[],
];

function makeMirror(
  id: string,
  axis: string,
  outputs: readonly OutputSpec[],
): Extract<SketchDerivationDefinition, { kind: "mirror" }> {
  return {
    kind: "mirror",
    derivationId: id,
    label: id,
    seedEntityIds: [...new Set(outputs.map(([seed]) => eid(seed)))],
    mirrorReference: { kind: "lineEntity", entityId: eid(axis) },
    outputs: outputs.map(([seed, output, seedPoints, outputPoints]) => ({
      seedEntityId: eid(seed),
      outputEntityId: eid(output),
      instanceIndex: 1,
      seedPointIds: seedPoints.map(pid),
      outputPointIds: outputPoints.map(pid),
    })),
  };
}

function withDatum(
  relationship: Extract<SketchDerivationDefinition, { kind: "mirror" }>,
  reference: MirrorAxisReference,
): MirrorRelationshipInput {
  return { ...relationship, mirrorReference: reference };
}

const X_DATUM: MirrorAxisReference = {
  kind: "datumAxis",
  origin: [0, 0],
  direction: [1, 0],
};
const Y_DATUM: MirrorAxisReference = {
  kind: "datumAxis",
  origin: [0, 0],
  direction: [0, 1],
};

/** The owner on a definition: fresh lookups per call (review R-3b). */
function evaluateOn(
  input: Omit<Parameters<typeof evaluateMirrorRelationship>[0], "geometry"> & {
    readonly definition: SketchDefinition;
  },
): MirrorRelationshipEvaluation {
  const { definition, ...rest } = input;
  return evaluateMirrorRelationship({
    ...rest,
    geometry: indexMirrorGeometry(definition),
  });
}

function resolveOn(
  derivationId: string,
  reference: MirrorAxisReference,
  definition: SketchDefinition,
  tolerance: number,
) {
  return resolveMirrorAxis(
    { derivationId, label: derivationId },
    reference,
    indexMirrorGeometry(definition),
    tolerance,
  );
}

/** A resolved line axis from two endpoints (throws on a classification failure). */
function lineAxis(start: SketchPoint2D, end: SketchPoint2D): MirrorAxis {
  const resolution = resolveOn(
    "axis",
    { kind: "lineEntity", entityId: eid("axis") },
    makeSketch(
      [makePoint("axis_start", start), makePoint("axis_end", end)],
      [makeLine("axis", "axis_start", "axis_end")],
    ),
    TAU,
  );
  if (!resolution.ok) throw new Error(resolution.failure.diagnostic.message);
  return resolution.axis;
}

function datumAxis(reference: MirrorAxisReference): MirrorAxis {
  const resolution = resolveOn("datum", reference, makeSketch([], []), TAU);
  if (!resolution.ok) throw new Error(resolution.failure.diagnostic.message);
  return resolution.axis;
}

function expectOk(
  evaluation: MirrorRelationshipEvaluation,
): Extract<MirrorRelationshipEvaluation, { ok: true }> {
  if (!evaluation.ok)
    throw new Error(`unexpected failure ${evaluation.failure.diagnostic.code}`);
  return evaluation;
}

/** Deterministic PRNG (mulberry32). */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (low: number, high: number) => low + (high - low) * next(),
    vector: (scale: number): SketchPoint2D => [
      (next() * 2 - 1) * scale,
      (next() * 2 - 1) * scale,
    ],
  };
}

const bits = new Float64Array(1);
const bitsInt = new BigInt64Array(bits.buffer);
/** The adjacent binary64 of a positive number. */
function adjacent(value: number, step: 1 | -1) {
  bits[0] = value;
  bitsInt[0] += BigInt(step);
  return bits[0];
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const norm = (a: readonly number[]) => Math.sqrt(dot(a, a));
const distance = (a: SketchPoint2D, b: SketchPoint2D) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
/** An angle difference reduced to (−π, π]. */
const angleGap = (a: number, b: number) => {
  const turn = 2 * Math.PI;
  const gap = (((a - b) % turn) + turn) % turn;
  return gap > Math.PI ? gap - turn : gap;
};

/** Collects every leaf where two values differ bitwise (Object.is on numbers). */
function bitwiseDifferences(
  actual: unknown,
  expected: unknown,
  path = "",
): string[] {
  if (typeof actual === "number" || typeof expected === "number")
    return Object.is(actual, expected)
      ? []
      : [`${path}: ${String(actual)} ≠ ${String(expected)}`];
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  )
    return actual === expected
      ? []
      : [`${path}: ${String(actual)} ≠ ${String(expected)}`];
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  return [...keys].flatMap((key) =>
    bitwiseDifferences(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${path}.${key}`,
    ),
  );
}

/** The output definition the owner produces: structure, then values. */
function applyOwner(
  definition: SketchDefinition,
  evaluation: Extract<MirrorRelationshipEvaluation, { ok: true }>,
) {
  const positions = new Map(
    definition.points.map((point) => [point.pointId, point.position]),
  );
  const entities = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  for (const output of evaluation.outputs) {
    for (const point of output.points)
      positions.set(point.outputPointId, point.position);
    entities.set(
      output.outputEntityId,
      applyMirrorOutputValues(
        applyMirrorOutputStructure(
          entities.get(output.outputEntityId)!,
          output,
        ),
        output,
      ),
    );
  }
  return { positions, entities };
}

// ---------------------------------------------------- axis classification

describe("axis classification (AX)", () => {
  const seedDefinition = (
    axisEntities: SketchEntityDefinition[],
    axisPoints: SketchPointDefinition[],
  ) =>
    makeSketch(
      [
        makePoint("p", [1, 1]),
        makePoint("q", [0, 0]),
        makePoint("c", [3, 3]),
        ...axisPoints,
      ],
      [
        makePointEntity("seed", "p"),
        makePointEntity("copy", "q"),
        makeCircle("not_a_line", "c", 1),
        ...axisEntities,
      ],
    );
  const relationship = (axis: string) =>
    makeMirror("m", axis, [["seed", "copy", ["p"], ["q"]]]);

  test("AX1: a missing axis, a non-line axis and an axis with a missing endpoint are derived-mirror-axis-missing, one failure each", () => {
    const cases = [
      { axis: "absent", definition: seedDefinition([], []), target: null },
      {
        axis: "not_a_line",
        definition: seedDefinition([], []),
        target: { kind: "entity", entityId: "not_a_line" },
      },
      {
        axis: "axis",
        definition: seedDefinition(
          [makeLine("axis", "s", "gone")],
          [makePoint("s", [0, -1])],
        ),
        target: { kind: "entity", entityId: "axis" },
      },
    ];
    for (const { axis, definition, target } of cases) {
      const evaluation = evaluateOn({
        relationship: relationship(axis),
        definition,
        modelingTolerance: TAU,
      });
      expect(evaluation.ok, axis).toBe(false);
      if (evaluation.ok) continue;
      expect(evaluation.failure.derivationId).toBe("m");
      expect(evaluation.failure.diagnostic.code).toBe(
        MIRROR_DIAGNOSTIC_CODES.axisMissing,
      );
      expect(evaluation.failure.diagnostic.severity).toBe("error");
      expect(evaluation.failure.diagnostic.target).toEqual(target);
    }
  });

  test("AX2: at the τ boundary an axis of length τ or the next binary64 above verifies; the one below and zero fail as derived-mirror-axis-degenerate", () => {
    const lengths = [
      { length: adjacent(TAU, 1), ok: true },
      { length: TAU, ok: true },
      { length: adjacent(TAU, -1), ok: false },
      { length: 0, ok: false },
    ];
    for (const { length, ok } of lengths)
      for (const end of [
        [length, 0],
        [0, -length],
      ] as SketchPoint2D[]) {
        const definition = seedDefinition(
          [makeLine("axis", "s", "e")],
          [makePoint("s", [0, 0]), makePoint("e", end)],
        );
        const evaluation = evaluateOn({
          relationship: relationship("axis"),
          definition,
          modelingTolerance: TAU,
        });
        expect(evaluation.ok, `length ${length}`).toBe(ok);
        if (!evaluation.ok) {
          expect(evaluation.failure.diagnostic.code).toBe(
            MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
          );
          expect(evaluation.failure.diagnostic.target).toEqual({
            kind: "entity",
            entityId: "axis",
          });
        } else {
          // Just above τ the reflection is a real reflection: finite, moved.
          const [point] = evaluation.outputs[0]!.points;
          expect(point!.position.every(Number.isFinite)).toBe(true);
          expect(distance(point!.position, [1, 1])).toBeGreaterThan(1);
        }
      }
  });

  test("AX3: the degenerate predicate is production's degenerate-line-segment predicate length(start − end) < τ on diagonal axes around τ (no unchanged point, no NaN)", () => {
    const rng = random(3);
    let degenerate = 0;
    let accepted = 0;
    for (let index = 0; index < 400; index += 1) {
      const start = rng.vector(50);
      const angle = rng.range(-Math.PI, Math.PI);
      const length = TAU * (1 + Math.round(rng.range(-4, 4)) * 2 ** -50);
      const end: SketchPoint2D = [
        start[0] + length * Math.cos(angle),
        start[1] + length * Math.sin(angle),
      ];
      const production = Math.hypot(start[0] - end[0], start[1] - end[1]) < TAU;
      const resolution = resolveOn(
        "m",
        { kind: "lineEntity", entityId: eid("axis") },
        makeSketch(
          [makePoint("s", start), makePoint("e", end)],
          [makeLine("axis", "s", "e")],
        ),
        TAU,
      );
      expect(resolution.ok, `${start} → ${end}`).toBe(!production);
      if (resolution.ok) {
        accepted += 1;
        const image = mirrorPoint(resolution.axis, [
          start[0] + 1,
          start[1] + 2,
        ]);
        expect(image.every(Number.isFinite)).toBe(true);
      } else degenerate += 1;
    }
    // Both sides of the boundary are exercised.
    expect(degenerate).toBeGreaterThan(20);
    expect(accepted).toBeGreaterThan(20);
    // A NaN axis length is degenerate too (never a NaN reflection).
    expect(
      resolveOn(
        "m",
        { kind: "lineEntity", entityId: eid("axis") },
        makeSketch(
          [makePoint("s", [0, 0]), makePoint("e", [Number.NaN, 1])],
          [makeLine("axis", "s", "e")],
        ),
        TAU,
      ).ok,
    ).toBe(false);
    // Review A-1: the predicate is hypot(d) ≥ τ, not d·d ≥ τ². On these
    // axes the two disagree (found under the test engine, V8: Math.hypot is
    // not correctly rounded, so other engines may place the ulp elsewhere —
    // production's predicate runs on the same engine as the owner).
    for (const { end, accepted } of [
      {
        end: [-0.000013360208778839883, 0.0009999107484277713],
        accepted: true,
      },
      { end: [-0.0007534864391682195, 0.0006574634484057624], accepted: true },
      {
        end: [-0.0009999901307465484, -0.000004442792984240016],
        accepted: false,
      },
      { end: [0.0009498796982427238, 0.0003126156727777928], accepted: false },
    ] as { end: SketchPoint2D; accepted: boolean }[]) {
      expect(end[0] * end[0] + end[1] * end[1] >= TAU * TAU).toBe(!accepted);
      expect(Math.hypot(end[0], end[1]) >= TAU).toBe(accepted);
      expect(
        resolveOn(
          "m",
          { kind: "lineEntity", entityId: eid("axis") },
          makeSketch(
            [makePoint("s", [0, 0]), makePoint("e", end)],
            [makeLine("axis", "s", "e")],
          ),
          TAU,
        ).ok,
      ).toBe(accepted);
    }
  });

  test("AX4: a datum axis direction must be a unit axis vector; anything else is a programming error and throws", () => {
    for (const direction of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as SketchPoint2D[])
      expect(
        resolveOn(
          "m",
          { kind: "datumAxis", origin: [2, -3], direction },
          makeSketch([], []),
          TAU,
        ).ok,
      ).toBe(true);
    for (const direction of [
      [0, 0],
      [3, 4],
      [1e-4, 0],
      [Math.cos(0.3), Math.sin(0.3)],
      [Number.NaN, 0],
    ] as SketchPoint2D[])
      expect(() =>
        resolveOn(
          "m",
          { kind: "datumAxis", origin: [0, 0], direction },
          makeSketch([], []),
          TAU,
        ),
      ).toThrow(/unit axis vector/);
  });
});

// -------------------------------------------------------------- values

describe("value map (V)", () => {
  test("V1: points reflect to known images about vertical, diagonal and datum axes", () => {
    expect(mirrorPoint(lineAxis([0, -2], [0, 2]), [3, 1])).toEqual([-3, 1]);
    expect(mirrorPoint(lineAxis([0, 0], [1, 1]), [2, 0])).toEqual([0, 2]);
    expect(mirrorPoint(lineAxis([0, 1], [5, 1]), [2, 4])).toEqual([2, -2]);
    expect(mirrorPoint(datumAxis(X_DATUM), [2.5, -1.25])).toEqual([2.5, 1.25]);
    expect(mirrorPoint(datumAxis(Y_DATUM), [2.5, -1.25])).toEqual([
      -2.5, -1.25,
    ]);
    expect(mirrorVector(lineAxis([0, 0], [1, 1]), [3, -1])).toEqual([-1, 3]);
    expect(mirrorAxisAngle(lineAxis([0, 0], [0, 4]))).toBe(Math.PI / 2);
  });

  test("V2: reflection is an isometry and an involution (R∘R = id to rounding; bitwise on datum axes)", () => {
    const rng = random(7);
    for (let index = 0; index < 300; index += 1) {
      const start = rng.vector(20);
      const end: SketchPoint2D = [
        start[0] + rng.range(-30, 30),
        start[1] + rng.range(-30, 30),
      ];
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1) continue;
      const axis = lineAxis(start, end);
      const p = rng.vector(20);
      const q = rng.vector(20);
      const v = rng.vector(5);
      const scale = 100;
      expect(distance(mirrorPoint(axis, mirrorPoint(axis, p)), p)).toBeLessThan(
        1e-13 * scale,
      );
      expect(
        Math.abs(
          distance(mirrorPoint(axis, p), mirrorPoint(axis, q)) - distance(p, q),
        ),
      ).toBeLessThan(1e-13 * scale);
      expect(
        distance(mirrorVector(axis, mirrorVector(axis, v)), v),
      ).toBeLessThan(1e-14 * scale);
      // Fixed points: the projection of p onto the axis is its own image.
      expect(
        distance(
          mirrorPoint(axis, [
            (p[0] + mirrorPoint(axis, p)[0]) / 2,
            (p[1] + mirrorPoint(axis, p)[1]) / 2,
          ]),
          [
            (p[0] + mirrorPoint(axis, p)[0]) / 2,
            (p[1] + mirrorPoint(axis, p)[1]) / 2,
          ],
        ),
      ).toBeLessThan(1e-13 * scale);
      for (const reference of [X_DATUM, Y_DATUM]) {
        const datum = datumAxis(reference);
        expect(
          bitwiseDifferences(mirrorPoint(datum, mirrorPoint(datum, p)), p),
        ).toEqual([]);
        expect(
          bitwiseDifferences(mirrorVector(datum, mirrorVector(datum, v)), v),
        ).toEqual([]);
      }
    }
  });

  test("V3: an exact-zero vector stays the same exact zero bitwise where the reflection arithmetic alone would flip a sign", () => {
    const axis = lineAxis([1, 0], [-2, 0.5]);
    const [dx, dy] = axis.direction;
    // Control: the bare arithmetic turns +0 into −0 on this axis.
    const bare = 2 * ((0 * dx + 0 * dy) / axis.lengthSquared) * dx - 0;
    expect(Object.is(bare, -0)).toBe(true);
    for (const zero of [
      [0, 0],
      [-0, 0],
      [0, -0],
      [-0, -0],
    ] as SplineVector[])
      expect(bitwiseDifferences(mirrorVector(axis, zero), zero)).toEqual([]);
  });

  test("V4: property — accepted axes (just above τ, near vertical, long, datum) never produce NaN or an unchanged off-axis point", () => {
    const rng = random(11);
    const axes: MirrorAxis[] = [datumAxis(X_DATUM), datumAxis(Y_DATUM)];
    for (let index = 0; index < 60; index += 1) {
      const start = rng.vector(100);
      const angle = rng.range(-Math.PI, Math.PI);
      const length = [TAU * 1.0000001, TAU * 3, 1, 1e4][index % 4]!;
      axes.push(
        lineAxis(start, [
          start[0] + length * Math.cos(angle),
          start[1] + length * Math.sin(angle),
        ]),
      );
      axes.push(lineAxis(start, [start[0] + 1e-12, start[1] + length]));
    }
    for (const axis of axes)
      for (let sample = 0; sample < 20; sample += 1) {
        const point = rng.vector(200);
        const image = mirrorPoint(axis, point);
        const vector = mirrorVector(axis, rng.vector(3));
        const arc = mirrorArcVariables(axis, {
          radius: rng.range(0.1, 5),
          startAngle: rng.range(-Math.PI, Math.PI),
          endAngle: rng.range(-Math.PI, Math.PI),
        });
        expect(
          [...image, ...vector, arc.radius, arc.startAngle, arc.endAngle].every(
            Number.isFinite,
          ),
        ).toBe(true);
        // The signed distance to the axis flips; off the axis the image moves.
        const [dx, dy] = axis.direction;
        const side = (p: SketchPoint2D) =>
          ((p[0] - axis.start[0]) * dy - (p[1] - axis.start[1]) * dx) /
          Math.sqrt(axis.lengthSquared);
        if (Math.abs(side(point)) > 1e-6) {
          expect(Math.sign(side(image))).toBe(-Math.sign(side(point)));
          expect(Math.abs(side(image) + side(point))).toBeLessThan(
            1e-9 * Math.max(1, Math.abs(side(point))),
          );
        }
      }
  });

  test("V5: a relationship's values are R(seed) in map order, the seed radius, and the reflected authored tangents with zeros kept", () => {
    const axisStart: SketchPoint2D = [0.5, -3];
    const axisEnd: SketchPoint2D = [2, 4];
    const axis = lineAxis(axisStart, axisEnd);
    const definition = makeSketch(
      [
        makePoint("as", axisStart),
        makePoint("ae", axisEnd),
        makePoint("cc", [4, 1]),
        makePoint("oc", [9, 9]),
        makePoint("s0", [3, 0]),
        makePoint("s1", [5, 1]),
        makePoint("s2", [6, -1]),
        makePoint("s3", [7, 1]),
        makePoint("o0", [0, 0]),
        makePoint("o1", [0, 0]),
        makePoint("o2", [0, 0]),
        makePoint("o3", [0, 0]),
      ],
      [
        makeLine("axis", "as", "ae"),
        makeCircle("circle", "cc", 2.25),
        makeCircle("circle_copy", "oc", 7),
        makeSpline("spline", [
          ["s0", { kind: "authored", vector: [1, 0.5] }],
          ["s1", { kind: "authored", vector: [-0, 0] }],
          ["s2"],
          // Axis-aligned, not zero (review R-1).
          ["s3", { kind: "authored", vector: [0, 1] }],
        ]),
        makeSpline("spline_copy", [["o0"], ["o1"], ["o2"], ["o3"]]),
      ],
    );
    const evaluation = expectOk(
      evaluateOn({
        relationship: makeMirror("m", "axis", [
          ["circle", "circle_copy", ["cc"], ["oc"]],
          [
            "spline",
            "spline_copy",
            ["s0", "s1", "s2", "s3"],
            ["o0", "o1", "o2", "o3"],
          ],
        ]),
        definition,
        modelingTolerance: TAU,
      }),
    );
    const [circle, spline] = evaluation.outputs;
    expect(circle!.circleRadius).toBe(2.25);
    expect(circle!.points).toEqual([
      {
        seedPointId: "cc",
        outputPointId: "oc",
        position: mirrorPoint(axis, [4, 1]),
      },
    ]);
    expect(spline!.points.map((point) => point.outputPointId)).toEqual([
      "o0",
      "o1",
      "o2",
      "o3",
    ]);
    expect(spline!.tangents).toEqual([
      {
        seedOccurrenceId: "spline-occ-0",
        outputOccurrenceId: "spline_copy-occ-0",
        vector: mirrorVector(axis, [1, 0.5]),
      },
      {
        seedOccurrenceId: "spline-occ-1",
        outputOccurrenceId: "spline_copy-occ-1",
        vector: [-0, 0],
      },
      {
        seedOccurrenceId: "spline-occ-3",
        outputOccurrenceId: "spline_copy-occ-3",
        vector: mirrorVector(axis, [0, 1]),
      },
    ]);
    // [0, 1] is reflected, not kept: about this axis its image is not [0, 1].
    expect(distance(spline!.tangents[2]!.vector, [0, 1])).toBeGreaterThan(0.1);
    expect(Object.is(spline!.tangents[1]!.vector[0], -0)).toBe(true);
    expect(spline!.structure).toEqual({
      kind: "spline",
      closure: "open",
      interpolationPolicy: "centripetal-mean-arm-v1",
      endSpanParameterLengths: null,
      occurrenceIds: [
        "spline_copy-occ-0",
        "spline_copy-occ-1",
        "spline_copy-occ-2",
        "spline_copy-occ-3",
      ],
      tangentKinds: ["authored", "zero", "automatic", "authored"],
    });
  });

  test("V6: axis-aligned vectors (one zero component) are reflected, not treated as exact zero (review R-1)", () => {
    const diagonal = lineAxis([0, 0], [1, 1]);
    expect(mirrorVector(diagonal, [0, 1])).toEqual([1, 0]);
    expect(mirrorVector(diagonal, [-2, 0])).toEqual([0, -2]);
    expect(mirrorVector(datumAxis(Y_DATUM), [3, 0])).toEqual([-3, 0]);
    expect(mirrorVector(datumAxis(X_DATUM), [0, 3])).toEqual([0, -3]);
  });

  test("V7: the owner reads the caller's lookups at every call, so an in-place point change is seen (review R-3b)", () => {
    const definition = makeSketch(
      [
        makePoint("as", [0, -1]),
        makePoint("ae", [0, 1]),
        makePoint("p", [1, 0]),
        makePoint("q", [0, 0]),
      ],
      [
        makeLine("axis", "as", "ae"),
        makePointEntity("seed", "p"),
        makePointEntity("copy", "q"),
      ],
    );
    const geometry = indexMirrorGeometry(definition);
    const pointById = geometry.pointById as Map<
      SketchPointId,
      SketchPointDefinition
    >;
    const relationship = makeMirror("m", "axis", [
      ["seed", "copy", ["p"], ["q"]],
    ]);
    const image = () =>
      expectOk(
        evaluateMirrorRelationship({
          relationship,
          geometry,
          modelingTolerance: TAU,
        }),
      ).outputs[0]!.points[0]!.position;
    expect(image()).toEqual([-1, 0]);
    // The caller updates its map in place (a chain step wrote the seed).
    pointById.set(pid("p"), makePoint("p", [5, 0]));
    expect(image()).toEqual([-5, 0]);
    // An in-place definition change is seen through fresh lookups.
    definition.points[2] = makePoint("p", [7, 0]);
    expect(
      expectOk(evaluateOn({ relationship, definition, modelingTolerance: TAU }))
        .outputs[0]!.points[0]!.position,
    ).toEqual([-7, 0]);
  });
});

// ----------------------------------------------------------------- arcs

/** The angle at the middle of the swept arc. */
function midAngle(
  arc: MirrorArcVariables,
  sweep: "clockwise" | "counterClockwise",
) {
  const turn = 2 * Math.PI;
  const wrap = (angle: number) => ((angle % turn) + turn) % turn;
  return sweep === "counterClockwise"
    ? arc.startAngle + wrap(arc.endAngle - arc.startAngle) / 2
    : arc.startAngle - wrap(arc.startAngle - arc.endAngle) / 2;
}

const onCircle = (
  center: SketchPoint2D,
  radius: number,
  angle: number,
): SketchPoint2D => [
  center[0] + radius * Math.cos(angle),
  center[1] + radius * Math.sin(angle),
];

describe("arc orientation from variables (ARC)", () => {
  const cases: {
    name: string;
    center: SketchPoint2D;
    arc: MirrorArcVariables;
    sweep: "clockwise" | "counterClockwise";
    axis: readonly [SketchPoint2D, SketchPoint2D];
  }[] = [
    {
      name: "ccw arc straddling ±π",
      center: [2, 1],
      arc: { radius: 1.5, startAngle: 2.9, endAngle: -2.9 },
      sweep: "counterClockwise",
      axis: [
        [0, -2],
        [0.3, 2],
      ],
    },
    {
      name: "cw arc straddling ±π",
      center: [-1, 4],
      arc: { radius: 0.75, startAngle: -3, endAngle: 3 },
      sweep: "clockwise",
      axis: [
        [1, 1],
        [3, 2],
      ],
    },
    {
      name: "axis angle just below π (2φ wraps)",
      center: [1, 2],
      arc: { radius: 2, startAngle: 0.2, endAngle: 2.4 },
      sweep: "counterClockwise",
      axis: [
        [0, 0],
        [-1, 1e-12],
      ],
    },
    {
      name: "axis angle just above −π (2φ wraps)",
      center: [1, 2],
      arc: { radius: 2, startAngle: -2.4, endAngle: 0.7 },
      sweep: "clockwise",
      axis: [
        [0, 0],
        [-1, -1e-12],
      ],
    },
    {
      name: "major ccw arc, oblique axis",
      center: [0.4, -0.7],
      arc: { radius: 3, startAngle: -0.3, endAngle: -1.1 },
      sweep: "counterClockwise",
      axis: [
        [-2, 5],
        [4, -1],
      ],
    },
  ];

  test.each(cases)(
    "ARC1: $name — centre′ = R(centre), r′ = r, start/end/midpoint of the output arc = R(seed's), sweep flipped",
    ({ center, arc, sweep, axis: [start, end] }) => {
      const definition = makeSketch(
        [
          makePoint("as", start),
          makePoint("ae", end),
          makePoint("c", center),
          makePoint("s", onCircle(center, arc.radius, arc.startAngle)),
          makePoint("e", onCircle(center, arc.radius, arc.endAngle)),
          makePoint("oc", [0, 0]),
          makePoint("os", [0, 0]),
          makePoint("oe", [0, 0]),
        ],
        [
          makeLine("axis", "as", "ae"),
          makeArc("arc", "c", "s", "e", sweep),
          makeArc("copy", "oc", "os", "oe", sweep),
        ],
      );
      const evaluation = expectOk(
        evaluateOn({
          relationship: makeMirror("m", "axis", [
            ["arc", "copy", ["c", "s", "e"], ["oc", "os", "oe"]],
          ]),
          definition,
          modelingTolerance: TAU,
          arcVariables: new Map([[eid("arc"), arc]]),
        }),
      );
      const output = evaluation.outputs[0]!;
      const mirrored = output.arc!;
      const flipped = sweep === "clockwise" ? "counterClockwise" : "clockwise";
      expect(output.structure).toEqual({
        kind: "arc",
        sweepDirection: flipped,
      });
      expect(mirrored.radius).toBe(arc.radius);
      const outputCenter = output.points[0]!.position;
      expect(outputCenter).toEqual(mirrorPoint(evaluation.axis, center));
      const tolerance = 1e-13 * 10;
      for (const angle of ["startAngle", "endAngle"] as const)
        expect(
          distance(
            onCircle(outputCenter, mirrored.radius, mirrored[angle]),
            mirrorPoint(
              evaluation.axis,
              onCircle(center, arc.radius, arc[angle]),
            ),
          ),
          angle,
        ).toBeLessThan(tolerance);
      // The output arc's start/end agree with the mirrored point map too.
      expect(
        distance(
          onCircle(outputCenter, mirrored.radius, mirrored.startAngle),
          output.points[1]!.position,
        ),
      ).toBeLessThan(tolerance);
      expect(
        distance(
          onCircle(outputCenter, mirrored.radius, midAngle(mirrored, flipped)),
          mirrorPoint(
            evaluation.axis,
            onCircle(center, arc.radius, midAngle(arc, sweep)),
          ),
        ),
        "sampled midpoint",
      ).toBeLessThan(tolerance);
      // θ′ = 2φ − θ modulo 2π.
      const phi = mirrorAxisAngle(evaluation.axis);
      expect(
        Math.abs(angleGap(mirrored.startAngle, 2 * phi - arc.startAngle)),
      ).toBeLessThan(1e-15 * 16);
      // Involution on the variables (modulo 2π, to rounding).
      const back = mirrorArcVariables(evaluation.axis, mirrored);
      expect(Math.abs(angleGap(back.startAngle, arc.startAngle))).toBeLessThan(
        1e-14,
      );
      expect(Math.abs(angleGap(back.endAngle, arc.endAngle))).toBeLessThan(
        1e-14,
      );
    },
  );

  test("ARC2: without solver arc variables (definition level) an arc output is its mirrored points plus the flipped sweep", () => {
    const evaluation = expectOk(
      evaluateOn({
        relationship: makeMirror("m", "axis", [
          ["arc", "copy", ["c", "s", "e"], ["oc", "os", "oe"]],
        ]),
        definition: makeSketch(
          [
            makePoint("as", [0, -2]),
            makePoint("ae", [0, 2]),
            makePoint("c", [2, 0]),
            makePoint("s", [3, 0]),
            makePoint("e", [2, 1]),
            makePoint("oc", [0, 0]),
            makePoint("os", [0, 0]),
            makePoint("oe", [0, 0]),
          ],
          [
            makeLine("axis", "as", "ae"),
            makeArc("arc", "c", "s", "e", "clockwise"),
            makeArc("copy", "oc", "os", "oe", "clockwise"),
          ],
        ),
        modelingTolerance: TAU,
      }),
    );
    expect(evaluation.outputs[0]!.arc).toBeNull();
    expect(
      evaluation.outputs[0]!.points.map((point) => point.position),
    ).toEqual([
      [-2, 0],
      [-3, 0],
      [-2, 1],
    ]);
  });
});

// --------------------------------------------------- spline equivariance

/**
 * Equivariance tolerance (A-8, test oracle only): coordinates ≤ ~12, a pole
 * is a short sum of O(1)-conditioned terms (centripetal √|Δp| intervals and
 * mean-arm blends), and the reflection adds ≤ 4 roundings, so each pole
 * coordinate differs by a few ulps of 16 (≈ 3.6e-15 each). 1e-13 is ~30 ulps
 * of the largest coordinate; the measured worst case is recorded in T15a.md.
 */
const SPLINE_TOLERANCE = 1e-13;

describe("spline equivariance through reconstructSplineAggregate (SPL)", () => {
  const seedPoints: Record<string, SketchPoint2D> = {
    a: [0.2, 0.1],
    b: [1.7, 2.3],
    c: [3.9, 1.4],
    d: [5.2, -0.6],
    e: [6.1, 1.9],
  };
  const authored = (x: number, y: number): SplineTangent => ({
    kind: "authored",
    vector: [x, y],
  });
  const zero: SplineTangent = { kind: "authored", vector: [0, 0] };
  const seeds: { name: string; seed: Spline }[] = [
    {
      name: "automatic open",
      seed: makeSpline("seed", [["a"], ["b"], ["c"], ["d"]]),
    },
    {
      name: "authored and automatic",
      seed: makeSpline("seed", [
        ["a", authored(1.2, 0.4)],
        ["b", authored(0, 1)],
        ["c", authored(-0.3, -1.1)],
        ["d"],
        ["e", authored(0.8, 2)],
      ]),
    },
    {
      name: "exact zero",
      seed: makeSpline("seed", [["a"], ["b", zero], ["c"], ["d", zero]]),
    },
    {
      name: "smooth closed",
      seed: makeSpline(
        "seed",
        [["a", authored(0.5, -1)], ["b"], ["c", zero], ["d"]],
        { closure: "smooth" },
      ),
    },
    {
      name: "positional closed",
      seed: makeSpline("seed", [["a"], ["b", authored(1, 1)], ["c"], ["a"]], {
        closure: "positional",
      }),
    },
    {
      name: "endSpanParameterLengths",
      seed: makeSpline(
        "seed",
        [["a", authored(0.3, 0.5)], ["b"], ["c"], ["d", authored(0.4, -0.2)]],
        { endSpanParameterLengths: { start: 0.8, end: 1.1 } },
      ),
    },
  ];
  const axes: { name: string; reference: MirrorAxisReference }[] = [
    {
      name: "oblique line",
      reference: { kind: "lineEntity", entityId: eid("axis") },
    },
    { name: "x datum", reference: X_DATUM },
    {
      name: "offset −y datum",
      reference: {
        kind: "datumAxis",
        origin: [1, -2],
        direction: [0, -1],
      },
    },
  ];
  const rows = seeds.flatMap((seed) =>
    axes.map((axis) => ({
      ...seed,
      axisName: axis.name,
      reference: axis.reference,
    })),
  );

  test.each(rows)(
    "SPL1: $name about the $axisName — reconstruct(output) = R(reconstruct(seed)) span by span",
    ({ seed, reference }) => {
      const pointIds = seed.pointOccurrences.map(
        (occurrence) => occurrence.pointId,
      );
      const outputIds = pointIds.map((id) => `o_${id}`);
      // A stale output: wrong tangents, closure and end-span lengths.
      const staleOutput = makeSpline(
        "copy",
        outputIds.map((id, index) => [
          id,
          index === 1 ? authored(9, 9) : undefined,
        ]),
        { endSpanParameterLengths: { start: 99 } },
      );
      const definition = makeSketch(
        [
          makePoint("as", [-1, -3]),
          makePoint("ae", [2.5, 4]),
          ...Object.entries(seedPoints).map(([id, position]) =>
            makePoint(id, position),
          ),
          ...[...new Set(outputIds)].map((id) => makePoint(id, [0, 0])),
        ],
        [makeLine("axis", "as", "ae"), seed, staleOutput],
      );
      const evaluation = expectOk(
        evaluateOn({
          relationship: withDatum(
            makeMirror("m", "axis", [["seed", "copy", pointIds, outputIds]]),
            reference,
          ),
          definition,
          modelingTolerance: TAU,
        }),
      );
      const { positions, entities } = applyOwner(definition, evaluation);
      const output = entities.get(eid("copy")) as Spline;
      expect(output.closure).toBe(seed.closure);
      expect(output.endSpanParameterLengths).toEqual(
        seed.endSpanParameterLengths,
      );
      seed.pointOccurrences.forEach((occurrence, index) => {
        const copied = output.pointOccurrences[index]!.tangent;
        expect(copied.kind).toBe(occurrence.tangent.kind);
        if (
          occurrence.tangent.kind === "authored" &&
          copied.kind === "authored"
        )
          expect(
            bitwiseDifferences(
              copied.vector,
              mirrorVector(evaluation.axis, occurrence.tangent.vector),
            ),
          ).toEqual([]);
      });
      const record = Object.fromEntries(positions) as Record<
        string,
        SplineVector
      >;
      const seedGeometry = reconstructSplineAggregate(seed, record);
      const outputGeometry = reconstructSplineAggregate(output, record);
      if (
        seedGeometry.validity !== "valid" ||
        outputGeometry.validity !== "valid"
      )
        throw new Error("reconstruction failed");
      expect(outputGeometry.spans.length).toBe(seedGeometry.spans.length);
      outputGeometry.spans.forEach((span, spanIndex) => {
        const seedSpan = seedGeometry.spans[spanIndex]!;
        expect(span.source.startOccurrenceId).toBe(
          `copy-occ-${seedSpan.source.startOccurrenceId.slice("seed-occ-".length)}`,
        );
        for (let pole = 0; pole < 4; pole += 1)
          expect(
            distance(
              span.poles[pole]!,
              mirrorPoint(evaluation.axis, seedSpan.poles[pole]!),
            ),
            `span ${spanIndex} pole ${pole}`,
          ).toBeLessThan(SPLINE_TOLERANCE);
        expect(
          Math.abs(
            span.interval[1] -
              span.interval[0] -
              (seedSpan.interval[1] - seedSpan.interval[0]),
          ),
        ).toBeLessThan(SPLINE_TOLERANCE);
      });
    },
  );
});

// --------------------------------------------------- structural sync R-1

describe("structural sync touches no values (ST)", () => {
  const definition = makeSketch(
    [
      makePoint("as", [0, -2]),
      makePoint("ae", [0, 2]),
      makePoint("c", [2, 0]),
      makePoint("s", [3, 0]),
      makePoint("e", [2, 1]),
      makePoint("oc", [5, 5]),
      makePoint("os", [6, 6]),
      makePoint("oe", [7, 7]),
      makePoint("cc", [1, 3]),
      makePoint("occ", [8, 8]),
      makePoint("p0", [1, 0]),
      makePoint("p1", [2, 1]),
      makePoint("p2", [3, 0]),
      makePoint("p3", [4, 1]),
      makePoint("q0", [0, 0]),
      makePoint("q1", [0, 0]),
      makePoint("q2", [0, 0]),
      makePoint("q3", [0, 0]),
    ],
    [
      makeLine("axis", "as", "ae"),
      makeArc("arc", "c", "s", "e", "clockwise"),
      makeArc("arc_copy", "oc", "os", "oe", "clockwise"),
      makeCircle("circle", "cc", 2),
      makeCircle("circle_copy", "occ", 7),
      makeSpline("spline", [
        ["p0", { kind: "authored", vector: [1, 2] }],
        ["p1"],
        ["p2", { kind: "authored", vector: [0, 0] }],
        ["p3", { kind: "authored", vector: [-1, 0.5] }],
      ]),
      makeSpline(
        "spline_copy",
        [
          ["q0", { kind: "authored", vector: [5, 5] }],
          ["q1", { kind: "authored", vector: [4, 4] }],
          ["q2", { kind: "authored", vector: [3, 3] }],
          ["q3"],
        ],
        { closure: "positional", endSpanParameterLengths: { end: 2 } },
      ),
    ],
  );
  // Evaluated inside each row, so a failing owner fails rows, not collection.
  const evaluate = () =>
    expectOk(
      evaluateOn({
        relationship: makeMirror("m", "axis", [
          ["arc", "arc_copy", ["c", "s", "e"], ["oc", "os", "oe"]],
          ["circle", "circle_copy", ["cc"], ["occ"]],
          [
            "spline",
            "spline_copy",
            ["p0", "p1", "p2", "p3"],
            ["q0", "q1", "q2", "q3"],
          ],
        ]),
        definition,
        modelingTolerance: TAU,
      }),
    );
  const outputOf = (id: string) =>
    definition.entities.find((entity) => entity.entityId === id)!;
  const evaluationOf = (id: string): MirrorOutputEvaluation =>
    evaluate().outputs.find((output) => output.outputEntityId === id)!;

  test("ST1: structure flips the sweep, keeps the circle radius, and keeps an existing authored-nonzero output vector bitwise", () => {
    const arc = applyMirrorOutputStructure(
      outputOf("arc_copy"),
      evaluationOf("arc_copy"),
    );
    expect(arc).toEqual({
      ...outputOf("arc_copy"),
      sweepDirection: "counterClockwise",
    });
    const circle = applyMirrorOutputStructure(
      outputOf("circle_copy"),
      evaluationOf("circle_copy"),
    );
    expect(circle).toBe(outputOf("circle_copy"));
    const spline = applyMirrorOutputStructure(
      outputOf("spline_copy"),
      evaluationOf("spline_copy"),
    ) as Spline;
    const original = outputOf("spline_copy") as Spline;
    // q0: seed authored nonzero, output authored nonzero → the output's own value.
    expect(spline.pointOccurrences[0]!.tangent).toBe(
      original.pointOccurrences[0]!.tangent,
    );
    // q1: seed automatic → automatic.
    expect(spline.pointOccurrences[1]!.tangent).toEqual({ kind: "automatic" });
    // q2: seed exact zero → exact zero.
    expect(spline.pointOccurrences[2]!.tangent).toEqual({
      kind: "authored",
      vector: [0, 0],
    });
    // q3: kind change automatic → authored nonzero: the value map's vector.
    expect(spline.pointOccurrences[3]!.tangent).toEqual({
      kind: "authored",
      vector: mirrorVector(evaluate().axis, [-1, 0.5]),
    });
    expect(spline.closure).toBe("open");
    expect("endSpanParameterLengths" in spline).toBe(false);
  });

  test("ST2: values then write R(seed) vectors and the seed radius", () => {
    const circle = applyMirrorOutputValues(
      applyMirrorOutputStructure(
        outputOf("circle_copy"),
        evaluationOf("circle_copy"),
      ),
      evaluationOf("circle_copy"),
    );
    expect(circle).toEqual({ ...outputOf("circle_copy"), radius: 2 });
    const spline = applyMirrorOutputValues(
      applyMirrorOutputStructure(
        outputOf("spline_copy"),
        evaluationOf("spline_copy"),
      ),
      evaluationOf("spline_copy"),
    ) as Spline;
    expect(
      spline.pointOccurrences.map((occurrence) => occurrence.tangent),
    ).toEqual([
      { kind: "authored", vector: [-1, 2] },
      { kind: "automatic" },
      { kind: "authored", vector: [0, 0] },
      { kind: "authored", vector: [1, 0.5] },
    ]);
  });

  test("ST3: structure refuses an entity that is not the evaluated output", () => {
    expect(() =>
      applyMirrorOutputStructure(
        outputOf("circle_copy"),
        evaluationOf("arc_copy"),
      ),
    ).toThrow();
    // Review A-5: a spline whose occurrences differ from the evaluated
    // output's throws instead of writing an undefined vector.
    const spline = outputOf("spline_copy") as Spline;
    expect(() =>
      applyMirrorOutputStructure(
        {
          ...spline,
          pointOccurrenceIds: [...spline.pointOccurrenceIds, "extra"],
          pointOccurrences: [
            ...spline.pointOccurrences,
            {
              occurrenceId: "extra",
              pointId: pid("q0"),
              tangent: { kind: "automatic" },
            },
          ],
        },
        evaluationOf("spline_copy"),
      ),
    ).toThrow(/occurrences/);
    expect(() =>
      applyMirrorOutputStructure(
        {
          ...spline,
          pointOccurrenceIds: ["x0", "x1", "x2", "x3"],
          pointOccurrences: spline.pointOccurrences.map(
            (occurrence, index) => ({
              ...occurrence,
              occurrenceId: `x${index}`,
            }),
          ),
        },
        evaluationOf("spline_copy"),
      ),
    ).toThrow(/occurrences/);
  });
});

// ------------------------------------------------------- derivatives

type Vector = number[];

/** Central difference of f along `direction` at step h. */
function centralDifference(
  f: (t: number) => Vector,
  h: number,
  angleOutputs: readonly boolean[] = [],
): Vector {
  const plus = f(h);
  const minus = f(-h);
  return plus.map((value, index) =>
    angleOutputs[index]
      ? angleGap(value, minus[index]!) / (2 * h)
      : (value - minus[index]!) / (2 * h),
  );
}

function expectClose(
  actual: Vector,
  expected: Vector,
  relative: number,
  label: string,
) {
  const scale = Math.max(1, norm(expected));
  const error = norm(actual.map((value, index) => value - expected[index]!));
  expect(error, `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
    relative * scale,
  );
}

interface AxisCase {
  name: string;
  start: SketchPoint2D;
  end: SketchPoint2D;
}

function derivativeAxes(): AxisCase[] {
  const rng = random(19);
  const cases: AxisCase[] = [];
  for (let index = 0; index < 8; index += 1) {
    const start = rng.vector(5);
    cases.push({
      name: `random ${index}`,
      start,
      end: [start[0] + rng.range(-6, 6), start[1] + rng.range(-6, 6)],
    });
  }
  cases.push(
    { name: "near vertical", start: [0.3, -1], end: [0.3 + 1e-9, 2] },
    { name: "near vertical, reversed", start: [0.3, 2], end: [0.3 - 1e-9, -1] },
    { name: "long", start: [-3, 1], end: [-3 + 6e3, 1 + 8e3] },
    {
      // 0.1 % above τ, so the FD step (1e-4·L) never takes it below τ.
      name: "short, just above τ",
      start: [0.7, 0.2],
      end: [0.7 + TAU * 0.6 * 1.001, 0.2 + TAU * 0.8 * 1.001],
    },
    {
      name: "axis direction near −x (φ ≈ ±π)",
      start: [1, 0.5],
      end: [-2, 0.5 + 1e-13],
    },
  );
  return cases;
}

describe("analytic derivatives (D)", () => {
  const rng = random(23);
  const axisCases = derivativeAxes();
  const lengthOf = ({ start, end }: AxisCase) =>
    Math.hypot(end[0] - start[0], end[1] - start[1]);
  /**
   * FD step: 1e-6, or 1e-4·L on short axes (the second derivative scales
   * like |r|/L², so the truncation error stays ~1e-8 of the derivative).
   */
  const stepFor = (axisCase: AxisCase) =>
    Math.min(1e-6, 1e-4 * lengthOf(axisCase));

  test.each(axisCases)(
    "D1: point, vector and arc-variable JVPs match central differences w.r.t. seed and both axis endpoints ($name)",
    (axisCase) => {
      const h = stepFor(axisCase);
      const axisAt = (t: number, dStart: SketchPoint2D, dEnd: SketchPoint2D) =>
        lineAxis(
          [
            axisCase.start[0] + t * dStart[0],
            axisCase.start[1] + t * dStart[1],
          ],
          [axisCase.end[0] + t * dEnd[0], axisCase.end[1] + t * dEnd[1]],
        );
      for (let sample = 0; sample < 6; sample += 1) {
        const point: SketchPoint2D = [
          axisCase.start[0] + rng.range(-4, 4),
          axisCase.start[1] + rng.range(-4, 4),
        ];
        const vector = rng.vector(2);
        const arc: MirrorArcVariables = {
          radius: rng.range(0.5, 3),
          startAngle: rng.range(-Math.PI, Math.PI),
          endAngle: rng.range(-Math.PI, Math.PI),
        };
        // Each input direction alone, then all together.
        const directions = [
          { dp: rng.vector(1), dS: [0, 0], dE: [0, 0] },
          { dp: [0, 0], dS: rng.vector(1), dE: [0, 0] },
          { dp: [0, 0], dS: [0, 0], dE: rng.vector(1) },
          { dp: rng.vector(1), dS: rng.vector(1), dE: rng.vector(1) },
        ] as { dp: SketchPoint2D; dS: SketchPoint2D; dE: SketchPoint2D }[];
        for (const [index, { dp, dS, dE }] of directions.entries()) {
          const axis = axisAt(0, dS, dE);
          const variation: MirrorAxisVariation = { start: dS, end: dE };
          const label = `${axisCase.name} #${sample}.${index}`;
          expectClose(
            [...mirrorPointJvp(axis, point, dp, variation)],
            centralDifference(
              (t) => [
                ...mirrorPoint(axisAt(t, dS, dE), [
                  point[0] + t * dp[0],
                  point[1] + t * dp[1],
                ]),
              ],
              h,
            ),
            1e-6,
            `point ${label}`,
          );
          expectClose(
            [...mirrorVectorJvp(axis, vector, dp, variation)],
            centralDifference(
              (t) => [
                ...mirrorVector(axisAt(t, dS, dE), [
                  vector[0] + t * dp[0],
                  vector[1] + t * dp[1],
                ]),
              ],
              h,
            ),
            1e-6,
            `vector ${label}`,
          );
          const dArc: MirrorArcVariables = {
            radius: dp[0],
            startAngle: dp[1],
            endAngle: dp[0] - dp[1],
          };
          const arcJvp = mirrorArcVariablesJvp(axis, dArc, variation);
          expectClose(
            [arcJvp.radius, arcJvp.startAngle, arcJvp.endAngle],
            centralDifference(
              (t) => {
                const value = mirrorArcVariables(axisAt(t, dS, dE), {
                  radius: arc.radius + t * dArc.radius,
                  startAngle: arc.startAngle + t * dArc.startAngle,
                  endAngle: arc.endAngle + t * dArc.endAngle,
                });
                return [value.radius, value.startAngle, value.endAngle];
              },
              h,
              [false, true, true],
            ),
            1e-6,
            `arc ${label}`,
          );
        }
      }
    },
  );

  test.each([
    { name: "x datum", reference: X_DATUM },
    { name: "y datum", reference: Y_DATUM },
    {
      name: "offset −x datum",
      reference: {
        kind: "datumAxis",
        origin: [1, 2],
        direction: [-1, 0],
      } as MirrorAxisReference,
    },
  ])(
    "D2: datum axis ($name) — JVPs match central differences w.r.t. the seed only; the axis has no variables",
    ({ reference }) => {
      const axis = datumAxis(reference);
      for (let sample = 0; sample < 10; sample += 1) {
        const point = rng.vector(5);
        const dp = rng.vector(1);
        expectClose(
          [...mirrorPointJvp(axis, point, dp)],
          centralDifference(
            (t) => [
              ...mirrorPoint(axis, [
                point[0] + t * dp[0],
                point[1] + t * dp[1],
              ]),
            ],
            1e-6,
          ),
          1e-8,
          "datum point",
        );
        const arcJvp = mirrorArcVariablesJvp(axis, {
          radius: dp[0],
          startAngle: dp[1],
          endAngle: -dp[0],
        });
        expect(arcJvp).toEqual({
          radius: dp[0],
          startAngle: 0 - dp[1],
          endAngle: 0 - -dp[0],
        });
        const variation = { start: [1, 0], end: [0, 0] } as MirrorAxisVariation;
        expect(() => mirrorPointJvp(axis, point, dp, variation)).toThrow();
        // Review A-6: an all-zero axis variation is no variation.
        const still = { start: [0, -0], end: [0, 0] } as MirrorAxisVariation;
        expect(mirrorPointJvp(axis, point, dp, still)).toEqual(
          mirrorPointJvp(axis, point, dp),
        );
        expect(mirrorPointVjp(axis, point, dp).axis).toBeNull();
        expect(mirrorVectorVjp(axis, point, dp).axis).toBeNull();
        expect(
          mirrorArcVariablesVjp(axis, { radius: 1, startAngle: 1, endAngle: 1 })
            .axis,
        ).toBeNull();
      }
    },
  );

  test.each(axisCases)(
    "D3: VJP is the transpose of the JVP — w·(J v) = (Jᵀw)·v for points, vectors and arc variables ($name)",
    (axisCase) => {
      const axis = lineAxis(axisCase.start, axisCase.end);
      for (let sample = 0; sample < 10; sample += 1) {
        const point: SketchPoint2D = [
          axisCase.start[0] + rng.range(-4, 4),
          axisCase.start[1] + rng.range(-4, 4),
        ];
        const dp = rng.vector(1);
        const dS = rng.vector(1);
        const dE = rng.vector(1);
        const w = rng.vector(1);
        const variation = { start: dS, end: dE };
        const check = (
          forward: number,
          reverse: number,
          scale: number,
          label: string,
        ) =>
          expect(Math.abs(forward - reverse), label).toBeLessThanOrEqual(
            1e-12 * Math.max(1, scale),
          );

        const pointJvp = mirrorPointJvp(axis, point, dp, variation);
        const pointVjp = mirrorPointVjp(axis, point, w);
        check(
          dot(w, pointJvp),
          dot(pointVjp.point, dp) +
            dot(pointVjp.axis!.start, dS) +
            dot(pointVjp.axis!.end, dE),
          norm(w) * (norm(pointJvp) + norm(pointVjp.axis!.end) * 3),
          `point ${axisCase.name}`,
        );

        const vector = rng.vector(2);
        const vectorJvp = mirrorVectorJvp(axis, vector, dp, variation);
        const vectorVjp = mirrorVectorVjp(axis, vector, w);
        check(
          dot(w, vectorJvp),
          dot(vectorVjp.vector, dp) +
            dot(vectorVjp.axis!.start, dS) +
            dot(vectorVjp.axis!.end, dE),
          norm(w) * (norm(vectorJvp) + norm(vectorVjp.axis!.end) * 3),
          `vector ${axisCase.name}`,
        );

        const dArc = { radius: dp[0], startAngle: dp[1], endAngle: dS[0] };
        const wArc = { radius: w[0], startAngle: w[1], endAngle: dE[1] };
        const arcJvp = mirrorArcVariablesJvp(axis, dArc, variation);
        const arcVjp = mirrorArcVariablesVjp(axis, wArc);
        check(
          wArc.radius * arcJvp.radius +
            wArc.startAngle * arcJvp.startAngle +
            wArc.endAngle * arcJvp.endAngle,
          arcVjp.arc.radius * dArc.radius +
            arcVjp.arc.startAngle * dArc.startAngle +
            arcVjp.arc.endAngle * dArc.endAngle +
            dot(arcVjp.axis!.start, dS) +
            dot(arcVjp.axis!.end, dE),
          norm([arcJvp.radius, arcJvp.startAngle, arcJvp.endAngle]) +
            norm(arcVjp.axis!.end) * 3,
          `arc ${axisCase.name}`,
        );
      }
    },
  );
});

// ------------------------------------- agreement with today's evaluation

/** Today's mirror fixtures (`derived-geometry.spec.ts`, `display.spec.ts`), mirror parts copied. */
function agreementFixtures(): { name: string; definition: SketchDefinition }[] {
  const authoredOccurrences = (
    id: string,
    points: readonly string[],
    tangents: readonly SplineTangent[],
  ) => ({
    pointOccurrenceIds: points.map((_, index) => `${id}-occ-${index}`),
    pointOccurrences: points.map((point, index) => ({
      occurrenceId: `${id}-occ-${index}`,
      pointId: pid(point),
      tangent: tangents[index] ?? { kind: "automatic" as const },
    })),
  });
  return [
    {
      // derived-geometry.spec.ts "mirrors geometry and reverses mirrored arc sweep direction"
      name: "derived-geometry arc",
      definition: makeSketch(
        [
          makePoint("axis_start", [0, -2]),
          makePoint("axis_end", [0, 2]),
          makePoint("arc_center", [2, 0]),
          makePoint("arc_start", [3, 0]),
          makePoint("arc_end", [2, 1]),
          makePoint("mirror_center", [0, 0]),
          makePoint("mirror_start", [0, 0]),
          makePoint("mirror_end", [0, 0]),
        ],
        [
          makeLine("axis", "axis_start", "axis_end"),
          makeArc(
            "seed_arc",
            "arc_center",
            "arc_start",
            "arc_end",
            "clockwise",
          ),
          makeArc(
            "mirror_arc",
            "mirror_center",
            "mirror_start",
            "mirror_end",
            "clockwise",
          ),
        ],
        [
          makeMirror("mirror_arc_relationship", "axis", [
            [
              "seed_arc",
              "mirror_arc",
              ["arc_center", "arc_start", "arc_end"],
              ["mirror_center", "mirror_start", "mirror_end"],
            ],
          ]),
        ],
      ),
    },
    {
      // derived-geometry.spec.ts "preserves complete spline aggregates…" (mirror part)
      name: "derived-geometry smooth spline with alias, authored, zero",
      definition: makeSketch(
        [
          makePoint("axis_start", [0, -2]),
          makePoint("axis_end", [0, 2]),
          makePoint("seed_a", [1, 0]),
          makePoint("seed_b", [2, 1]),
          makePoint("mirror_a", [0, 0]),
          makePoint("mirror_b", [0, 0]),
        ],
        [
          makeLine("axis", "axis_start", "axis_end"),
          {
            ...makeSpline("seed_spline", []),
            ...authoredOccurrences(
              "seed",
              ["seed_a", "seed_b", "seed_a"],
              [
                { kind: "authored", vector: [1, 2] },
                { kind: "authored", vector: [0, 0] },
              ],
            ),
            closure: "smooth",
          },
          {
            ...makeSpline("mirrored_spline", []),
            ...authoredOccurrences(
              "mirror",
              ["mirror_a", "mirror_b", "mirror_a"],
              [],
            ),
          },
        ],
        [
          makeMirror("mirror_spline_relationship", "axis", [
            [
              "seed_spline",
              "mirrored_spline",
              ["seed_a", "seed_b", "seed_a"],
              ["mirror_a", "mirror_b", "mirror_a"],
            ],
          ]),
        ],
      ),
    },
    {
      // derived-geometry.spec.ts "spline copies carry endSpanParameterLengths" (mirror case)
      name: "derived-geometry endSpanParameterLengths spline",
      definition: makeSketch(
        [
          makePoint("axis_start", [0, -2]),
          makePoint("axis_end", [0, 2]),
          makePoint("seed_a", [0, 0]),
          makePoint("seed_b", [1, 2]),
          makePoint("seed_c", [3, 2.5]),
          makePoint("seed_d", [4.2, 0.3]),
          ...["a", "b", "c", "d"].map((id) =>
            makePoint(`mirror_seed_${id}`, [0, 0]),
          ),
        ],
        [
          makeLine("axis", "axis_start", "axis_end"),
          {
            ...makeSpline("seed_spline", []),
            ...authoredOccurrences(
              "occ",
              ["seed_a", "seed_b", "seed_c", "seed_d"],
              [
                { kind: "authored", vector: [0.3, 0.5] },
                { kind: "automatic" },
                { kind: "automatic" },
                { kind: "authored", vector: [0.4, -0.2] },
              ],
            ),
            endSpanParameterLengths: { start: 0.8, end: 1.1 },
          },
          {
            ...makeSpline("mirror_spline", []),
            ...authoredOccurrences(
              "out",
              ["a", "b", "c", "d"].map((id) => `mirror_seed_${id}`),
              [],
            ),
            endSpanParameterLengths: { start: 99 },
          },
        ],
        [
          makeMirror("mirror_relationship", "axis", [
            [
              "seed_spline",
              "mirror_spline",
              ["seed_a", "seed_b", "seed_c", "seed_d"],
              ["a", "b", "c", "d"].map((id) => `mirror_seed_${id}`),
            ],
          ]),
        ],
      ),
    },
    {
      // display.spec.ts markerSession: a line mirrored about the construction axis x = −1
      name: "display line about a construction axis",
      definition: makeSketch(
        [
          makePoint("la", [0.1, 0.2]),
          makePoint("lb", [3.3, 1.7]),
          makePoint("xa", [-1, -5]),
          makePoint("xb", [-1, 5]),
          makePoint("ma", [0, 0]),
          makePoint("mb", [0, 0]),
        ],
        [
          makeLine("line", "la", "lb"),
          { ...makeLine("axis", "xa", "xb"), isConstruction: true },
          makeLine("mirrored", "ma", "mb"),
        ],
        [
          makeMirror("mirror_line", "axis", [
            ["line", "mirrored", ["la", "lb"], ["ma", "mb"]],
          ]),
        ],
      ),
    },
    {
      // A circle and an oblique axis: radius and centre (not in the two spec files).
      name: "circle about an oblique axis",
      definition: makeSketch(
        [
          makePoint("as", [0.3, -1.7]),
          makePoint("ae", [2.9, 3.1]),
          makePoint("cc", [4.4, 0.6]),
          makePoint("oc", [0, 0]),
        ],
        [
          makeLine("axis", "as", "ae"),
          makeCircle("circle", "cc", 1.375),
          makeCircle("copy", "oc", 1),
        ],
        [
          makeMirror("mirror_circle", "axis", [
            ["circle", "copy", ["cc"], ["oc"]],
          ]),
        ],
      ),
    },
  ];
}

describe("agreement with today's forward evaluation (AG)", () => {
  const fixtures = agreementFixtures();

  test.each(fixtures)(
    "AG1: $name — points, radius, sweep and tangents equal evaluateSketchDerivations bitwise",
    ({ definition }) => {
      const today = evaluateSketchDerivations({
        definition: literalResolvedDefinition(definition),
        modelingTolerance: TAU,
      });
      expect(today.diagnostics).toEqual([]);
      const relationship = definition
        .derivedRelationships![0] as MirrorRelationshipInput;
      const evaluation = expectOk(
        evaluateOn({
          relationship,
          definition,
          modelingTolerance: TAU,
        }),
      );
      const { positions, entities } = applyOwner(definition, evaluation);
      for (const output of evaluation.outputs) {
        for (const { outputPointId } of output.points)
          expect(
            bitwiseDifferences(
              positions.get(outputPointId),
              today.definition.points.find(
                (point) => point.pointId === outputPointId,
              )!.position,
            ),
            outputPointId,
          ).toEqual([]);
        expect(
          bitwiseDifferences(
            entities.get(output.outputEntityId),
            today.definition.entities.find(
              (entity) => entity.entityId === output.outputEntityId,
            ),
          ),
          output.outputEntityId,
        ).toEqual([]);
      }
    },
  );

  test.each(fixtures)(
    "AG2: $name — point and tangent JVPs equal evaluateSketchDerivationJvp bitwise; VJPs equal prepareSketchDerivationPullback to rounding",
    ({ definition }) => {
      const rng = random(31);
      const today = evaluateSketchDerivations({
        definition: literalResolvedDefinition(definition),
        modelingTolerance: TAU,
      });
      const relationship = definition.derivedRelationships![0] as Extract<
        SketchDerivationDefinition,
        { kind: "mirror" }
      >;
      const evaluation = expectOk(
        evaluateOn({
          relationship,
          definition,
          modelingTolerance: TAU,
        }),
      );
      const axis = evaluation.axis;
      if (axis.kind !== "line") throw new Error("line axis expected");
      const position = (id: SketchPointId) =>
        today.definition.points.find((point) => point.pointId === id)!.position;
      const pointVariation: Record<string, SketchPoint2D> = {
        [axis.startPointId]: rng.vector(1),
        [axis.endPointId]: rng.vector(1),
      };
      const tangentVariation: Record<
        string,
        Record<string, SketchPoint2D>
      > = {};
      for (const output of evaluation.outputs) {
        for (const { seedPointId } of output.points)
          pointVariation[seedPointId] ??= rng.vector(1);
        for (const tangent of output.tangents)
          (tangentVariation[output.seedEntityId] ??= {})[
            tangent.seedOccurrenceId
          ] = rng.vector(1);
      }
      const axisVariation = {
        start: pointVariation[axis.startPointId]!,
        end: pointVariation[axis.endPointId]!,
      };
      const todayJvp = evaluateSketchDerivationJvp(today, {
        points: pointVariation as Record<SketchPointId, SketchPoint2D>,
        splineTangents: tangentVariation as Record<
          SketchEntityId,
          Record<string, SketchPoint2D>
        >,
      });
      const pullback = prepareSketchDerivationPullback(today);
      const definitionEntity = (id: SketchEntityId) =>
        definition.entities.find((entity) => entity.entityId === id)!;
      for (const output of evaluation.outputs) {
        for (const { seedPointId, outputPointId } of output.points) {
          expect(
            bitwiseDifferences(
              mirrorPointJvp(
                axis,
                position(seedPointId),
                pointVariation[seedPointId]!,
                axisVariation,
              ),
              todayJvp.points[outputPointId],
            ),
            `JVP ${outputPointId}`,
          ).toEqual([]);
          const w = rng.vector(1);
          const owner = mirrorPointVjp(axis, position(seedPointId), w);
          const pulled = pullback({ points: { [outputPointId]: w } });
          const expected = [
            ...(pulled.points?.[seedPointId] ?? [0, 0]),
            ...(pulled.points?.[axis.startPointId] ?? [0, 0]),
            ...(pulled.points?.[axis.endPointId] ?? [0, 0]),
          ];
          expectClose(
            [...owner.point, ...owner.axis!.start, ...owner.axis!.end],
            expected,
            1e-14,
            `VJP ${outputPointId}`,
          );
        }
        const seed = definitionEntity(output.seedEntityId);
        if (seed.kind !== "spline") continue;
        for (const tangent of output.tangents) {
          const seedVector = (
            seed.pointOccurrences.find(
              (occurrence) =>
                occurrence.occurrenceId === tangent.seedOccurrenceId,
            )!.tangent as Extract<SplineTangent, { kind: "authored" }>
          ).vector;
          expect(
            bitwiseDifferences(
              mirrorVectorJvp(
                axis,
                seedVector,
                tangentVariation[output.seedEntityId]![
                  tangent.seedOccurrenceId
                ]!,
                axisVariation,
              ),
              todayJvp.splineTangents[output.outputEntityId]?.[
                tangent.outputOccurrenceId
              ],
            ),
            `tangent JVP ${tangent.outputOccurrenceId}`,
          ).toEqual([]);
          const w = rng.vector(1);
          const owner = mirrorVectorVjp(axis, seedVector, w);
          const pulled = pullback({
            splineTangents: {
              [output.outputEntityId]: { [tangent.outputOccurrenceId]: w },
            },
          });
          expectClose(
            [...owner.vector, ...owner.axis!.start, ...owner.axis!.end],
            [
              ...(pulled.splineTangents?.[output.seedEntityId]?.[
                tangent.seedOccurrenceId
              ] ?? [0, 0]),
              ...(pulled.points?.[axis.startPointId] ?? [0, 0]),
              ...(pulled.points?.[axis.endPointId] ?? [0, 0]),
            ],
            1e-14,
            `tangent VJP ${tangent.outputOccurrenceId}`,
          );
        }
      }
    },
  );

  test("AG3: listed difference — an arc's derivative comes from the seed arc variables (owner) vs from the output points (today); they agree when the point motion is the arc-variable motion", () => {
    const rng = random(37);
    for (let sample = 0; sample < 20; sample += 1) {
      const axisStart = rng.vector(3);
      const axisEnd: SketchPoint2D = [
        axisStart[0] + rng.range(1, 4),
        axisStart[1] + rng.range(-4, 4),
      ];
      const center = rng.vector(5);
      const arc: MirrorArcVariables = {
        radius: rng.range(0.5, 2),
        startAngle: rng.range(-Math.PI, Math.PI),
        endAngle: rng.range(-Math.PI, Math.PI),
      };
      const definition = makeSketch(
        [
          makePoint("as", axisStart),
          makePoint("ae", axisEnd),
          makePoint("c", center),
          makePoint("s", onCircle(center, arc.radius, arc.startAngle)),
          makePoint("e", onCircle(center, arc.radius, arc.endAngle)),
          makePoint("oc", [0, 0]),
          makePoint("os", [0, 0]),
          makePoint("oe", [0, 0]),
        ],
        [
          makeLine("axis", "as", "ae"),
          makeArc("arc", "c", "s", "e", "counterClockwise"),
          makeArc("copy", "oc", "os", "oe", "counterClockwise"),
        ],
        [
          makeMirror("m", "axis", [
            ["arc", "copy", ["c", "s", "e"], ["oc", "os", "oe"]],
          ]),
        ],
      );
      const dc = rng.vector(1);
      const dArc: MirrorArcVariables = {
        radius: rng.range(-1, 1),
        startAngle: rng.range(-1, 1),
        endAngle: rng.range(-1, 1),
      };
      const pointMotion = (angle: number, dAngle: number): SketchPoint2D => [
        dc[0] +
          dArc.radius * Math.cos(angle) -
          arc.radius * Math.sin(angle) * dAngle,
        dc[1] +
          dArc.radius * Math.sin(angle) +
          arc.radius * Math.cos(angle) * dAngle,
      ];
      const dS = rng.vector(1);
      const dE = rng.vector(1);
      const today = evaluateSketchDerivationJvp(
        evaluateSketchDerivations({
          definition: literalResolvedDefinition(definition),
          modelingTolerance: TAU,
        }),
        {
          points: {
            [pid("c")]: dc,
            [pid("s")]: pointMotion(arc.startAngle, dArc.startAngle),
            [pid("e")]: pointMotion(arc.endAngle, dArc.endAngle),
            [pid("as")]: dS,
            [pid("ae")]: dE,
          },
        },
      ).entities[eid("copy")];
      const owner = mirrorArcVariablesJvp(lineAxis(axisStart, axisEnd), dArc, {
        start: dS,
        end: dE,
      });
      if (today?.kind !== "arc") throw new Error("arc JVP expected");
      expectClose(
        [owner.radius, owner.startAngle, owner.endAngle],
        [today.radius, today.startAngle, today.endAngle],
        1e-12,
        `arc JVP sample ${sample}`,
      );
    }
  });

  test("AG4: a missing axis is derived-mirror-axis-missing in the owner and, since T15b, in evaluateSketchDerivations (one derived failure per relationship, not a sketch diagnostic; was derived-transform-missing-mirror-axis)", () => {
    const definition = makeSketch(
      [makePoint("seed_point", [1, 1]), makePoint("output_point", [0, 0])],
      [
        makePointEntity("seed_entity", "seed_point"),
        makePointEntity("output_entity", "output_point"),
      ],
      [
        makeMirror("missing_axis_relationship", "missing_axis", [
          ["seed_entity", "output_entity", ["seed_point"], ["output_point"]],
        ]),
      ],
    );
    const today = evaluateSketchDerivations({
      definition: literalResolvedDefinition(definition),
      modelingTolerance: TAU,
    });
    expect(today.diagnostics).toEqual([]);
    expect(
      today.derivedFailures.map((failure) => [
        failure.derivationId,
        failure.diagnostic.code,
        failure.diagnostic.severity,
      ]),
    ).toEqual([
      [
        "missing_axis_relationship",
        MIRROR_DIAGNOSTIC_CODES.axisMissing,
        "error",
      ],
    ]);
    const owner = evaluateOn({
      relationship: definition
        .derivedRelationships![0] as MirrorRelationshipInput,
      definition,
      modelingTolerance: TAU,
    });
    expect(owner.ok ? null : owner.failure.diagnostic.code).toBe(
      MIRROR_DIAGNOSTIC_CODES.axisMissing,
    );
  });
});

// ----------------------------------------------------------- stale maps

describe("stale point maps (SM)", () => {
  /** A seed line and a seed spline mirrored about x = 0 (both valid). */
  function base() {
    const points = [
      makePoint("as", [0, -5]),
      makePoint("ae", [0, 5]),
      makePoint("a", [1, 0]),
      makePoint("b", [3, 1]),
      makePoint("oa", [-1, 0]),
      makePoint("ob", [-3, 1]),
      makePoint("s0", [1, 2]),
      makePoint("s1", [2, 3]),
      makePoint("s2", [4, 2]),
      makePoint("t0", [0, 0]),
      makePoint("t1", [0, 0]),
      makePoint("t2", [0, 0]),
      makePoint("new", [2, 0.5]),
    ];
    const entities: SketchEntityDefinition[] = [
      makeLine("axis", "as", "ae"),
      makeLine("line", "a", "b"),
      makeLine("line_copy", "oa", "ob"),
      makeSpline("spline", [["s0"], ["s1"], ["s2"]]),
      makeSpline("spline_copy", [["t0"], ["t1"], ["t2"]]),
    ];
    const relationship = makeMirror("m", "axis", [
      ["line", "line_copy", ["a", "b"], ["oa", "ob"]],
      ["spline", "spline_copy", ["s0", "s1", "s2"], ["t0", "t1", "t2"]],
    ]);
    return { points, entities, relationship };
  }
  const evaluate = (
    points: SketchPointDefinition[],
    entities: SketchEntityDefinition[],
    relationship: MirrorRelationshipInput,
  ) =>
    evaluateOn({
      relationship,
      definition: makeSketch(points, entities),
      modelingTolerance: TAU,
    });
  const replace = (
    entities: SketchEntityDefinition[],
    entity: SketchEntityDefinition,
  ) =>
    entities.map((current) =>
      current.entityId === entity.entityId ? entity : current,
    );

  test("SM0: control — the unchanged relationship evaluates", () => {
    const { points, entities, relationship } = base();
    expect(evaluate(points, entities, relationship).ok).toBe(true);
  });

  const cases: {
    name: string;
    mutate: (input: ReturnType<typeof base>) => ReturnType<typeof base>;
  }[] = [
    {
      name: "seed kind changed (line → circle)",
      mutate: (input) => ({
        ...input,
        entities: replace(input.entities, makeCircle("line", "a", 1)),
      }),
    },
    {
      name: "seed endpoint id replaced (Trim/Split/Fillet on the original)",
      mutate: (input) => ({
        ...input,
        entities: replace(input.entities, makeLine("line", "a", "new")),
      }),
    },
    {
      name: "output endpoint id replaced (Trim/Fillet on the copy)",
      mutate: (input) => ({
        ...input,
        entities: replace(input.entities, makeLine("line_copy", "new", "ob")),
      }),
    },
    {
      name: "seed spline gained an occurrence (occurrence counts differ)",
      mutate: (input) => ({
        ...input,
        entities: replace(
          input.entities,
          makeSpline("spline", [["s0"], ["s1"], ["new"], ["s2"]]),
        ),
      }),
    },
    {
      name: "seed spline gained an occurrence and the seed map follows, the output does not",
      mutate: (input) => ({
        entities: replace(
          input.entities,
          makeSpline("spline", [["s0"], ["s1"], ["new"], ["s2"]]),
        ),
        points: input.points,
        relationship: makeMirror("m", "axis", [
          ["line", "line_copy", ["a", "b"], ["oa", "ob"]],
          [
            "spline",
            "spline_copy",
            ["s0", "s1", "new", "s2"],
            ["t0", "t1", "t2"],
          ],
        ]),
      }),
    },
    {
      name: "seed entity missing",
      mutate: (input) => ({
        ...input,
        entities: input.entities.filter(
          (entity) => entity.entityId !== eid("line"),
        ),
      }),
    },
    {
      name: "output entity missing",
      mutate: (input) => ({
        ...input,
        entities: input.entities.filter(
          (entity) => entity.entityId !== eid("line_copy"),
        ),
      }),
    },
    {
      name: "an output point record missing",
      mutate: (input) => ({
        ...input,
        points: input.points.filter((point) => point.pointId !== pid("ob")),
      }),
    },
    {
      // Review R-2: ids intact, only the kinds differ.
      name: "kind changed with ids intact (2-occurrence spline seed, line output)",
      mutate: (input) => ({
        ...input,
        entities: replace(input.entities, makeSpline("line", [["a"], ["b"]])),
      }),
    },
    {
      name: "kind changed with ids intact (point seed, circle output)",
      mutate: (input) => ({
        points: input.points,
        entities: [
          ...input.entities,
          makePointEntity("dot", "a"),
          makeCircle("dot_copy", "oa", 1),
        ],
        relationship: makeMirror("m", "axis", [
          ["dot", "dot_copy", ["a"], ["oa"]],
        ]),
      }),
    },
    {
      // Review R-2: only the occurrence-count (map length) check catches it.
      name: "output spline gained an occurrence and outputPointIds follow",
      mutate: (input) => ({
        points: input.points,
        entities: replace(
          input.entities,
          makeSpline("spline_copy", [["t0"], ["t1"], ["new"], ["t2"]]),
        ),
        relationship: makeMirror("m", "axis", [
          ["line", "line_copy", ["a", "b"], ["oa", "ob"]],
          [
            "spline",
            "spline_copy",
            ["s0", "s1", "s2"],
            ["t0", "t1", "new", "t2"],
          ],
        ]),
      }),
    },
    {
      name: "both outputs stale (still one failure)",
      mutate: (input) => ({
        ...input,
        entities: replace(
          replace(input.entities, makeLine("line", "a", "new")),
          makeSpline("spline", [["s0"], ["s1"]]),
        ),
      }),
    },
  ];

  test.each(cases)(
    "SM1: $name → one derived-mirror-map-stale failure",
    ({ mutate }) => {
      const { points, entities, relationship } = mutate(base());
      const evaluation = evaluate(points, entities, relationship);
      expect(evaluation.ok).toBe(false);
      if (evaluation.ok) return;
      expect(evaluation.failure).toMatchObject({
        derivationId: "m",
        diagnostic: {
          code: MIRROR_DIAGNOSTIC_CODES.mapStale,
          severity: "error",
        },
      });
    },
  );

  test("SM2: an offset shell seed is not mirrorable (map stale; U-G2 keeps its own check upstream)", () => {
    const { points, entities } = base();
    const shell: SketchEntityDefinition = {
      kind: "derivedPiecewiseCubic",
      ...entityBase("shell"),
      derivationId: "offset",
    };
    const evaluation = evaluate(
      points,
      [...entities, shell],
      makeMirror("m", "axis", [["shell", "line_copy", [], ["oa", "ob"]]]),
    );
    expect(evaluation.ok ? null : evaluation.failure.diagnostic.code).toBe(
      MIRROR_DIAGNOSTIC_CODES.mapStale,
    );
  });
});

// ------------------------------------------------------- dependency order

describe("dependency order (SO)", () => {
  /**
   * A chain: m1 mirrors `line` about `axis1`; m2 mirrors m1's copy about
   * `axis2`; a pattern copies m2's copy (pattern of mirror); an offset of
   * `base` feeds m3 (mirror of offset output); `bridge` (a user line between
   * m1 output points) is mirrored by m4 (a dependency through seed points
   * only); m5 mirrors `free` about m2's copy (a dependency through the axis
   * only).
   */
  function chain() {
    const points = [
      "a",
      "b",
      "a1",
      "b1",
      "a2",
      "b2",
      "a3",
      "b3",
      "x1",
      "y1",
      "x2",
      "y2",
      "c",
      "d",
      "c1",
      "d1",
      "c2",
      "d2",
      "e1",
      "f1",
      "f",
      "g",
      "f2",
      "g2",
    ].map((id, index) => makePoint(id, [index, index % 3]));
    const entities: SketchEntityDefinition[] = [
      makeLine("line", "a", "b"),
      makeLine("axis1", "x1", "y1"),
      makeLine("axis2", "x2", "y2"),
      makeLine("copy1", "a1", "b1"),
      makeLine("copy2", "a2", "b2"),
      makeLine("copy3", "a3", "b3"),
      makeLine("base", "c", "d"),
      makeLine("offset_out", "c1", "d1"),
      makeLine("offset_mirror", "c2", "d2"),
      makeLine("bridge", "a1", "b1"),
      makeLine("bridge_copy", "e1", "f1"),
      makeLine("free", "f", "g"),
      makeLine("free_copy", "f2", "g2"),
    ];
    const relationships: SketchDerivationDefinition[] = [
      makeMirror("m1", "axis1", [["line", "copy1", ["a", "b"], ["a1", "b1"]]]),
      makeMirror("m2", "axis2", [
        ["copy1", "copy2", ["a1", "b1"], ["a2", "b2"]],
      ]),
      {
        kind: "linearPattern",
        derivationId: "pattern",
        label: "pattern",
        seedEntityIds: [eid("copy2")],
        vector: [1, 0],
        instanceCount: 2,
        outputs: [
          {
            seedEntityId: eid("copy2"),
            outputEntityId: eid("copy3"),
            instanceIndex: 1,
            seedPointIds: [pid("a2"), pid("b2")],
            outputPointIds: [pid("a3"), pid("b3")],
          },
        ],
      },
      {
        kind: "offset",
        derivationId: "offset",
        label: "offset",
        seedEntityIds: [eid("base")],
        distance: literal(0.5),
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
        piecewiseCubicOutputs: [],
        outputs: [
          {
            seedEntityId: eid("base"),
            outputEntityId: eid("offset_out"),
            instanceIndex: 1,
            seedPointIds: [pid("c"), pid("d")],
            outputPointIds: [pid("c1"), pid("d1")],
          },
        ],
      } as SketchDerivationDefinition,
      makeMirror("m3", "axis1", [
        ["offset_out", "offset_mirror", ["c1", "d1"], ["c2", "d2"]],
      ]),
      // Reads a1/b1 only through its seed's defining points (no recorded map).
      makeMirror("m4", "axis2", [
        ["bridge", "bridge_copy", ["a1", "b1"], ["e1", "f1"]],
      ]),
      // Reads m2's output only through its axis.
      makeMirror("m5", "copy2", [
        ["free", "free_copy", ["f", "g"], ["f2", "g2"]],
      ]),
    ];
    const edges: [string, string][] = [
      ["m1", "m2"],
      ["m2", "pattern"],
      ["offset", "m3"],
      ["m1", "m4"],
      ["m2", "m5"],
    ];
    return { points, entities, relationships, edges };
  }

  const permutations: { name: string; order: (count: number) => number[] }[] = [
    { name: "in order", order: (count) => [...Array(count).keys()] },
    { name: "reversed", order: (count) => [...Array(count).keys()].reverse() },
    { name: "shuffled", order: () => [5, 2, 6, 0, 4, 1, 3] },
    { name: "shuffled again", order: () => [6, 4, 2, 5, 3, 0, 1] },
  ];

  test.each(permutations)(
    "SO1: $name — every relationship comes after the ones whose outputs its seeds, seed points or axis read",
    ({ order }) => {
      const { points, entities, relationships, edges } = chain();
      const shuffled = order(relationships.length).map(
        (index) => relationships[index]!,
      );
      const result = orderDerivedRelationships(
        makeSketch(points, entities, shuffled),
      );
      expect(result.unresolved).toEqual([]);
      const ids = result.order.map((relationship) => relationship.derivationId);
      expect([...ids].sort()).toEqual(
        relationships.map((relationship) => relationship.derivationId).sort(),
      );
      for (const [before, after] of edges)
        expect(
          ids.indexOf(before),
          `${before} before ${after} in ${ids}`,
        ).toBeLessThan(ids.indexOf(after));
      if (order(relationships.length)[0] === 0)
        // Already sorted input keeps its order.
        expect(ids).toEqual(
          relationships.map((relationship) => relationship.derivationId),
        );
    },
  );

  test("SO2: a 2-cycle fails explicitly (with its dependents), terminates, and leaves independent relationships sorted", () => {
    const points = [
      "a",
      "b",
      "a1",
      "b1",
      "c",
      "d",
      "c1",
      "d1",
      "e",
      "f",
      "e1",
      "f1",
      "e2",
      "f2",
      "x",
      "y",
    ].map((id, index) => makePoint(id, [index, 1]));
    const entities = [
      makeLine("l1", "a", "b"),
      makeLine("l1_copy", "a1", "b1"),
      makeLine("l2", "c", "d"),
      makeLine("l2_copy", "c1", "d1"),
      makeLine("l3_copy", "e1", "f1"),
      makeLine("free", "e", "f"),
      makeLine("free_copy", "e2", "f2"),
      makeLine("axis", "x", "y"),
    ];
    const relationships = [
      // m1 mirrors l1 about l2's copy; m2 mirrors l2 about l1's copy.
      makeMirror("m1", "l2_copy", [
        ["l1", "l1_copy", ["a", "b"], ["a1", "b1"]],
      ]),
      makeMirror("m2", "l1_copy", [
        ["l2", "l2_copy", ["c", "d"], ["c1", "d1"]],
      ]),
      makeMirror("downstream", "axis", [
        ["l1_copy", "l3_copy", ["a1", "b1"], ["e1", "f1"]],
      ]),
      makeMirror("independent", "axis", [
        ["free", "free_copy", ["e", "f"], ["e2", "f2"]],
      ]),
    ];
    for (const shuffled of [relationships, [...relationships].reverse()]) {
      const result = orderDerivedRelationships(
        makeSketch(points, entities, shuffled),
      );
      expect(
        result.order.map((relationship) => relationship.derivationId),
      ).toEqual(["independent"]);
      expect(
        result.unresolved.map((failure) => failure.derivationId).sort(),
      ).toEqual(["downstream", "m1", "m2"]);
      for (const failure of result.unresolved)
        expect(failure.diagnostic).toMatchObject({
          code: DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED,
          severity: "error",
        });
    }
  });

  test("SO3: a mirror whose axis is its own output is a self-reference; an unrelated relationship still sorts", () => {
    const points = [
      "a",
      "b",
      "a1",
      "b1",
      "c",
      "d",
      "c1",
      "d1",
      "x",
      "y",
      "p",
      "q",
    ].map((id, index) => makePoint(id, [index, 2]));
    const entities = [
      makeLine("axis2", "p", "q"),
      makeLine("seed", "a", "b"),
      makeLine("copy", "a1", "b1"),
      makeLine("other", "c", "d"),
      makeLine("other_copy", "c1", "d1"),
      makeLine("axis", "x", "y"),
    ];
    const result = orderDerivedRelationships(
      makeSketch(points, entities, [
        makeMirror("self", "copy", [
          ["seed", "copy", ["a", "b"], ["a1", "b1"]],
        ]),
        makeMirror("other", "axis", [
          ["other", "other_copy", ["c", "d"], ["c1", "d1"]],
        ]),
        // The axis line runs between this relationship's own output points.
        makeMirror("self_by_points", "axis2", [
          ["seed", "copy", ["a", "b"], ["p", "q"]],
        ]),
      ]),
    );
    expect(
      result.order.map((relationship) => relationship.derivationId),
    ).toEqual(["other"]);
    expect(result.unresolved.map((failure) => failure.derivationId)).toEqual([
      "self",
      "self_by_points",
    ]);
  });
});

describe("dependency order through offset joints and shells (SO4)", () => {
  /**
   * Review R-3a: an offset of a mirror output (offset-of-mirror) whose joint
   * arc is mirrored (`mj`) and whose shell's terminal point starts a user
   * line that is mirrored (`ms`). Every consumer is listed before its source.
   */
  test("SO4: joint arcs and shell endpoints are dependency sources; offset-of-mirror orders after its mirror", () => {
    const points = [
      "a",
      "b",
      "c",
      "a1",
      "b1",
      "c1",
      "jc",
      "o1",
      "o2",
      "sh0",
      "sh1",
      "u",
      "x",
      "y",
      "j1",
      "j2",
      "j3",
      "l1",
      "l2",
    ].map((id, index) => makePoint(id, [index, (index * 7) % 5]));
    const shell: SketchEntityDefinition = {
      kind: "derivedPiecewiseCubic",
      ...entityBase("shell"),
      derivationId: "offset",
    };
    const entities: SketchEntityDefinition[] = [
      makeLine("axis", "x", "y"),
      makeLine("ab", "a", "b"),
      makeLine("bc", "b", "c"),
      makeLine("ab_copy", "a1", "b1"),
      makeLine("bc_copy", "b1", "c1"),
      makeLine("offset_ab", "a1", "o1"),
      makeLine("offset_bc", "o2", "c1"),
      makeArc("joint", "jc", "o1", "o2", "counterClockwise"),
      shell,
      makeLine("attached", "sh0", "u"),
      makeArc("joint_copy", "j1", "j2", "j3", "clockwise"),
      makeLine("attached_copy", "l1", "l2"),
    ];
    const offset = {
      kind: "offset",
      derivationId: "offset",
      label: "offset",
      // Seeds are the mirror's outputs: offset-of-mirror.
      seedEntityIds: [eid("ab_copy"), eid("bc_copy")],
      distance: literal(0.5),
      jointPolicy: "trimExtendArcFallback",
      outputs: [],
      jointOutputs: [
        {
          firstSeedEntityId: eid("ab_copy"),
          secondSeedEntityId: eid("bc_copy"),
          outputEntityId: eid("joint"),
          centerPointId: pid("jc"),
          startPointId: pid("o1"),
          endPointId: pid("o2"),
        },
      ],
      piecewiseCubicOutputs: [
        {
          seedEntityId: eid("ab_copy"),
          outputEntityId: eid("shell"),
          startPointId: pid("sh0"),
          endPointId: pid("sh1"),
          spans: [],
        },
      ],
    } as SketchDerivationDefinition;
    const relationships: SketchDerivationDefinition[] = [
      // Reads the joint arc (entity and its centre/end points).
      makeMirror("mj", "axis", [
        ["joint", "joint_copy", ["jc", "o1", "o2"], ["j1", "j2", "j3"]],
      ]),
      // Reads only the shell's terminal point, through `attached`.
      makeMirror("ms", "axis", [
        ["attached", "attached_copy", ["sh0", "u"], ["l1", "l2"]],
      ]),
      offset,
      makeMirror("m", "axis", [
        ["ab", "ab_copy", ["a", "b"], ["a1", "b1"]],
        ["bc", "bc_copy", ["b", "c"], ["b1", "c1"]],
      ]),
    ];
    for (const listed of [relationships, [...relationships].reverse()]) {
      const result = orderDerivedRelationships(
        makeSketch(points, entities, listed),
      );
      expect(result.unresolved).toEqual([]);
      const ids = result.order.map((relationship) => relationship.derivationId);
      for (const [before, after] of [
        ["m", "offset"],
        ["offset", "mj"],
        ["offset", "ms"],
      ] as const)
        expect(
          ids.indexOf(before),
          `${before} before ${after} in ${ids}`,
        ).toBeLessThan(ids.indexOf(after));
    }
  });
});

// --------------------------------------------------------- correspondence

describe("correspondence resolver (CO)", () => {
  const definition = makeSketch(
    [
      "a",
      "b",
      "a1",
      "b1",
      "a2",
      "b2",
      "x",
      "y",
      "u",
      "v",
      "s0",
      "s1",
      "t0",
      "t1",
      "z0",
      "z1",
    ].map((id, index) => makePoint(id, [index, 0])),
    [
      makeLine("line", "a", "b"),
      makeLine("copy1", "a1", "b1"),
      makeLine("copy2", "a2", "b2"),
      makeLine("axis1", "x", "y"),
      makeLine("axis2", "u", "v"),
      makeSpline("spline", [["s0"], ["s1"]]),
      makeSpline("spline_copy", [["t0"], ["t1"]]),
      makeSpline("spline_copy2", [["z0"], ["z1"]]),
    ],
    [
      makeMirror("m1", "axis1", [
        ["line", "copy1", ["a", "b"], ["a1", "b1"]],
        ["spline", "spline_copy", ["s0", "s1"], ["t0", "t1"]],
      ]),
      makeMirror("m2", "axis2", [
        ["copy1", "copy2", ["a1", "b1"], ["a2", "b2"]],
        ["spline_copy", "spline_copy2", ["t0", "t1"], ["z0", "z1"]],
      ]),
    ],
  );

  test("CO1: points, entities and spline occurrences resolve on either side through the recorded maps", () => {
    expect(
      resolveMirrorCounterpart(definition, {
        kind: "point",
        pointId: pid("b"),
      }),
    ).toEqual([
      {
        relationshipId: "m1",
        side: "seed",
        counterpart: { kind: "point", pointId: "b1" },
        chain: [],
      },
    ]);
    expect(
      resolveMirrorCounterpart(definition, {
        kind: "entity",
        entityId: eid("copy1"),
      }),
    ).toEqual([
      {
        relationshipId: "m1",
        side: "output",
        counterpart: { kind: "entity", entityId: "line" },
        chain: [],
      },
      {
        relationshipId: "m2",
        side: "seed",
        counterpart: { kind: "entity", entityId: "copy2" },
        chain: [],
      },
    ]);
    expect(
      resolveMirrorCounterpart(definition, {
        kind: "splineOccurrence",
        entityId: eid("spline_copy"),
        occurrenceId: "spline_copy-occ-1",
      }),
    ).toEqual([
      {
        relationshipId: "m1",
        side: "output",
        counterpart: {
          kind: "splineOccurrence",
          entityId: "spline",
          occurrenceId: "spline-occ-1",
        },
        chain: [],
      },
      {
        relationshipId: "m2",
        side: "seed",
        counterpart: {
          kind: "splineOccurrence",
          entityId: "spline_copy2",
          occurrenceId: "spline_copy2-occ-1",
        },
        chain: [],
      },
    ]);
    expect(
      resolveMirrorCounterpart(definition, {
        kind: "point",
        pointId: pid("x"),
      }),
    ).toEqual([]);
  });

  test("CO2: a mirror of a mirror resolves upstream to the root seed with chain steps", () => {
    expect(
      resolveMirrorCounterpart(definition, {
        kind: "point",
        pointId: pid("a2"),
      }),
    ).toEqual([
      {
        relationshipId: "m2",
        side: "output",
        counterpart: { kind: "point", pointId: "a1" },
        chain: [
          {
            relationshipId: "m1",
            side: "output",
            counterpart: { kind: "point", pointId: "a" },
          },
        ],
      },
    ]);
    expect(
      resolveMirrorCounterpart(definition, {
        kind: "splineOccurrence",
        entityId: eid("spline_copy2"),
        occurrenceId: "spline_copy2-occ-0",
      })[0]!.chain,
    ).toEqual([
      {
        relationshipId: "m1",
        side: "output",
        counterpart: {
          kind: "splineOccurrence",
          entityId: "spline",
          occurrenceId: "spline-occ-0",
        },
      },
    ]);
  });

  test("CO4: a relationship whose map is stale yields a null counterpart and ends the chain (review A-7)", () => {
    // The seed line's end point was replaced (a Trim on the original): m1's
    // map is stale, m2 (copy1 → copy2) is still current.
    const stale = {
      ...definition,
      points: [...definition.points, makePoint("b9", [9, 9])],
      entities: definition.entities.map((entity) =>
        entity.entityId === eid("line") ? makeLine("line", "a", "b9") : entity,
      ),
    };
    expect(
      resolveMirrorCounterpart(stale, { kind: "point", pointId: pid("b") }),
    ).toEqual([
      { relationshipId: "m1", side: "seed", counterpart: null, chain: [] },
    ]);
    expect(
      resolveMirrorCounterpart(stale, {
        kind: "splineOccurrence",
        entityId: eid("spline"),
        occurrenceId: "spline-occ-0",
      }),
    ).toEqual([
      { relationshipId: "m1", side: "seed", counterpart: null, chain: [] },
    ]);
    // m2 is current, so a2 resolves to a1; the chain stops at stale m1.
    expect(
      resolveMirrorCounterpart(stale, { kind: "point", pointId: pid("a2") }),
    ).toEqual([
      {
        relationshipId: "m2",
        side: "output",
        counterpart: { kind: "point", pointId: "a1" },
        chain: [{ relationshipId: "m1", side: "output", counterpart: null }],
      },
    ]);
  });

  test("CO3: a malformed cycle of mirrors terminates with each relationship visited once", () => {
    const cyclic = makeSketch(
      ["a", "b", "c", "d", "x", "y"].map((id, index) =>
        makePoint(id, [index, 1]),
      ),
      [
        makeLine("l1", "a", "b"),
        makeLine("l2", "c", "d"),
        makeLine("axis", "x", "y"),
      ],
      [
        makeMirror("m1", "axis", [["l1", "l2", ["a", "b"], ["c", "d"]]]),
        makeMirror("m2", "axis", [["l2", "l1", ["c", "d"], ["a", "b"]]]),
      ],
    );
    const result = resolveMirrorCounterpart(cyclic, {
      kind: "point",
      pointId: pid("a"),
    });
    expect(result.map((step) => [step.relationshipId, step.side])).toEqual([
      ["m1", "seed"],
      ["m2", "output"],
    ]);
    expect(result[1]!.chain.map((step) => step.relationshipId)).toEqual(["m1"]);
  });
});

// ------------------------------------------ shared driving dimensions (T16f)
// Lane: logic. Seam: the owner exports `correspondingMirrorDimensions` and
// `linkedMirrorRefs` ([TECH] T16-11/T16-14 with review R-7) on records-only
// definitions, and (SDE) the core solve, which pins each routed size family
// operationally: a dimension on the copy solves exactly as its image on the
// seed.

type DimensionInput = SketchDefinition["dimensions"][number];
const local = (id: string) => ({
  kind: "localEntity" as const,
  entityId: eid(id),
});
const localPoint = (id: string) => ({
  kind: "localPoint" as const,
  pointId: pid(id),
});
const datum = (which: "xAxis" | "yAxis" | "origin") => ({
  kind: "sketchDatum" as const,
  datum: which,
});
const literal = (value: number) => ({ source: "literal" as const, value });
function dim(id: string, fields: Record<string, unknown>): DimensionInput {
  return {
    dimensionId: id,
    label: id,
    ...(fields.kind === "lineAngle"
      ? { valueRadians: literal(1) }
      : { value: literal(1) }),
    ...fields,
  } as unknown as DimensionInput;
}
const radiusOf = (id: string, entity: string) =>
  dim(id, { kind: "circleRadius", entityId: eid(entity) });
const diameterOf = (id: string, entity: string) =>
  dim(id, { kind: "diameter", entityId: eid(entity) });
const lengthOf = (id: string, entity: string) =>
  dim(id, { kind: "lineLength", entityId: eid(entity) });
const distanceOf = (
  id: string,
  first: string,
  second: string,
  axis: "aligned" | "horizontal" | "vertical" = "aligned",
) => dim(id, { kind: "distance", axis, pointIds: [pid(first), pid(second)] });

/**
 * Records only (positions are irrelevant to correspondence). m1 mirrors
 * lines ab, ef (parallel to ab), gh, circle c, point entity pd and line xk
 * (which starts at the axis end x0: R-7a) about line ax (x0–x1); m2
 * mirrors c about the y datum (c2: orbit copy ↔ seed ↔ copy); m3 mirrors
 * m1's copy c1 about line ay (chain); mx mirrors ab about the x datum.
 * u is unrelated.
 */
function sharedDimensionSketch(): SketchDefinition {
  const pointIds = [
    ...["a", "b", "e", "f", "g", "h", "c", "d", "x0", "x1", "k", "u"],
    ...["a1", "b1", "e1", "f1", "g1", "h1", "c1", "d1", "x0c", "k1"],
    ...["c2", "c11", "y0", "y1", "ax_a", "ax_b"],
  ];
  const mirrorX = makeMirror("mx", "ax", [
    ["ab", "abx", ["a", "b"], ["ax_a", "ax_b"]],
  ]);
  const mirrorY = makeMirror("m2", "ax", [["c", "c2", ["c"], ["c2"]]]);
  return makeSketch(
    pointIds.map((id, index) => makePoint(id, [index, index % 3])),
    [
      makeLine("ab", "a", "b"),
      makeLine("ef", "e", "f"),
      makeLine("gh", "g", "h"),
      makeCircle("c", "c", 1),
      makePointEntity("pd", "d"),
      makeLine("ax", "x0", "x1"),
      makeLine("xk", "x0", "k"),
      makePointEntity("u", "u"),
      makeLine("ab1", "a1", "b1"),
      makeLine("ef1", "e1", "f1"),
      makeLine("gh1", "g1", "h1"),
      makeCircle("c1", "c1", 1),
      makePointEntity("pd1", "d1"),
      makeLine("xk1", "x0c", "k1"),
      makeCircle("c2", "c2", 1),
      makeCircle("c11", "c11", 1),
      makeLine("ay", "y0", "y1"),
      makeLine("abx", "ax_a", "ax_b"),
    ],
    [
      makeMirror("m1", "ax", [
        ["ab", "ab1", ["a", "b"], ["a1", "b1"]],
        ["ef", "ef1", ["e", "f"], ["e1", "f1"]],
        ["gh", "gh1", ["g", "h"], ["g1", "h1"]],
        ["c", "c1", ["c"], ["c1"]],
        ["pd", "pd1", ["d"], ["d1"]],
        ["xk", "xk1", ["x0", "k"], ["x0c", "k1"]],
      ]),
      { ...mirrorY, mirrorReference: { kind: "sketchDatum", datum: "yAxis" } },
      makeMirror("m3", "ay", [["c1", "c11", ["c1"], ["c11"]]]),
      { ...mirrorX, mirrorReference: { kind: "sketchDatum", datum: "xAxis" } },
    ],
  );
}

function correspondence(
  dimensions: readonly DimensionInput[],
  candidate: DimensionInput,
  failed: readonly string[] = [],
  definition: SketchDefinition = sharedDimensionSketch(),
) {
  return correspondingMirrorDimensions(
    {
      ...definition,
      dimensions: [...dimensions],
    },
    candidate,
    new Set(failed),
  ).map((entry) => [
    entry.dimension.dimensionId,
    entry.mirrors.map((mirror) => mirror.derivationId),
  ]);
}

describe("shared driving dimensions: correspondence matrix (SD, T16f)", () => {
  const corresponding: readonly [
    string,
    DimensionInput,
    DimensionInput,
    string[],
  ][] = [
    [
      "radius on the copy ↔ radius on the seed",
      radiusOf("D", "c1"),
      radiusOf("E", "c"),
      ["m1"],
    ],
    [
      "diameter on the copy ↔ radius on the seed (one family)",
      diameterOf("D", "c1"),
      radiusOf("E", "c"),
      ["m1"],
    ],
    [
      "radius on the seed ↔ diameter on the copy (either side)",
      radiusOf("D", "c"),
      diameterOf("E", "c1"),
      ["m1"],
    ],
    ["line length", lengthOf("D", "ab1"), lengthOf("E", "ab"), ["m1"]],
    [
      "aligned distance, order-insensitive",
      distanceOf("D", "b1", "a1"),
      distanceOf("E", "a", "b"),
      ["m1"],
    ],
    [
      "aligned distance across sides {a, b′} ↔ {a′, b}",
      distanceOf("D", "a", "b1"),
      distanceOf("E", "b", "a1"),
      ["m1"],
    ],
    [
      "aligned distance to an axis end (fixed)",
      distanceOf("D", "a1", "x0"),
      distanceOf("E", "x0", "a"),
      ["m1"],
    ],
    [
      "line distance, order-insensitive",
      dim("D", { kind: "lineDistance", lines: [local("ef1"), local("ab1")] }),
      dim("E", { kind: "lineDistance", lines: [local("ab"), local("ef")] }),
      ["m1"],
    ],
    [
      "point-line distance to the axis line (the axis maps to itself)",
      dim("D", {
        kind: "linePointDistance",
        line: local("ax"),
        point: localPoint("d1"),
      }),
      dim("E", {
        kind: "linePointDistance",
        line: local("ax"),
        point: localPoint("d"),
      }),
      ["m1"],
    ],
    [
      "line angle, order-insensitive",
      dim("D", { kind: "lineAngle", lines: [local("ab1"), local("gh1")] }),
      dim("E", { kind: "lineAngle", lines: [local("gh"), local("ab")] }),
      ["m1"],
    ],
    [
      "a datum operand maps to itself when it is the mirror's axis",
      dim("D", { kind: "lineDistance", lines: [datum("xAxis"), local("abx")] }),
      dim("E", { kind: "lineDistance", lines: [local("ab"), datum("xAxis")] }),
      ["mx"],
    ],
    [
      "R-7a: an axis end that is a seed point keeps itself as an image",
      distanceOf("D", "x0", "k1"),
      distanceOf("E", "x0", "k"),
      ["m1"],
    ],
    [
      "R-7a: … and its copy point maps back to it",
      distanceOf("D", "x0c", "k1"),
      distanceOf("E", "k", "x0"),
      ["m1"],
    ],
    [
      "orbit copy → seed → other copy (two mirrors of one seed)",
      radiusOf("D", "c1"),
      radiusOf("E", "c2"),
      ["m1", "m2"],
    ],
    [
      "orbit the other way",
      radiusOf("D", "c2"),
      radiusOf("E", "c1"),
      ["m2", "m1"],
    ],
    [
      "chain: a copy of a copy ↔ the root seed",
      radiusOf("D", "c11"),
      radiusOf("E", "c"),
      ["m3", "m1"],
    ],
  ];
  test.each(corresponding)("SD1 %s", (_, candidate, driver, mirrors) => {
    expect(correspondence([driver], candidate)).toEqual([["E", mirrors]]);
  });

  const distinct: readonly [string, DimensionInput, DimensionInput][] = [
    [
      "self-image: a seed↔copy distance is its own image",
      distanceOf("D", "a", "a1"),
      distanceOf("E", "a1", "a"),
    ],
    [
      "self-image: the angle between a seed line and its copy",
      dim("D", { kind: "lineAngle", lines: [local("ab"), local("ab1")] }),
      dim("E", { kind: "lineAngle", lines: [local("ab1"), local("ab")] }),
    ],
    [
      "copy ↔ unrelated geometry",
      distanceOf("D", "a1", "u"),
      distanceOf("E", "a", "u"),
    ],
    [
      "horizontal distance (signed, axis-dependent)",
      dim("D", {
        kind: "horizontalDistance",
        pointIds: [pid("a1"), pid("b1")],
      }),
      dim("E", { kind: "horizontalDistance", pointIds: [pid("a"), pid("b")] }),
    ],
    [
      "vertical distance",
      dim("D", { kind: "verticalDistance", pointIds: [pid("a1"), pid("b1")] }),
      dim("E", { kind: "verticalDistance", pointIds: [pid("a"), pid("b")] }),
    ],
    [
      "h/v-axis `distance`",
      distanceOf("D", "a1", "b1", "horizontal"),
      distanceOf("E", "a", "b", "horizontal"),
    ],
    [
      "pointDatumDistance",
      dim("D", {
        kind: "pointDatumDistance",
        axis: "aligned",
        point: localPoint("d1"),
        datum: datum("origin"),
      }),
      dim("E", {
        kind: "pointDatumDistance",
        axis: "aligned",
        point: localPoint("d"),
        datum: datum("origin"),
      }),
    ],
    [
      "a datum that is not the mirror's axis",
      dim("D", {
        kind: "linePointDistance",
        line: datum("xAxis"),
        point: localPoint("c2"),
      }),
      dim("E", {
        kind: "linePointDistance",
        line: datum("xAxis"),
        point: localPoint("c"),
      }),
    ],
    [
      "different families (line length vs aligned distance of its ends)",
      lengthOf("D", "ab1"),
      distanceOf("E", "a", "b"),
    ],
    [
      "a reference is never E",
      radiusOf("D", "c1"),
      { ...radiusOf("E", "c"), reference: true } as DimensionInput,
    ],
  ];
  test.each(distinct)("SD2 %s stays distinct", (_, candidate, driver) => {
    expect(correspondence([driver], candidate)).toEqual([]);
  });

  test("SD3: a failed mirror (live solve's failedDerivationIds) is not a step; others still route", () => {
    expect(
      correspondence([radiusOf("E", "c")], radiusOf("D", "c1"), ["m1"]),
    ).toEqual([]);
    // c2 ↔ c1 runs through m1 too: broken.
    expect(
      correspondence([radiusOf("E", "c1")], radiusOf("D", "c2"), ["m1"]),
    ).toEqual([]);
    expect(
      correspondence([radiusOf("E", "c")], radiusOf("D", "c2"), ["m1"]),
    ).toEqual([["E", ["m2"]]]);
    // Control: healthy.
    expect(
      correspondence([radiusOf("E", "c")], radiusOf("D", "c1"), []),
    ).toEqual([["E", ["m1"]]]);
  });

  test("SD4: a stale map gives no correspondence even when the caller passes no failure", () => {
    const definition = sharedDimensionSketch();
    const stale = {
      ...definition,
      entityIds: definition.entityIds.filter((id) => id !== eid("gh1")),
      entities: definition.entities.filter(
        (entity) => entity.entityId !== eid("gh1"),
      ),
    };
    expect(
      correspondence([radiusOf("E", "c")], radiusOf("D", "c1"), [], stale),
    ).toEqual([]);
  });

  test("SD5: several corresponding drivers come in definition order (tie-break), not search order", () => {
    // E2 (two mirrors away) precedes E1 (one mirror away) in the definition.
    expect(
      correspondence(
        [radiusOf("E2", "c2"), lengthOf("L", "ab"), diameterOf("E1", "c")],
        radiusOf("D", "c1"),
      ),
    ).toEqual([
      ["E2", ["m1", "m2"]],
      ["E1", ["m1"]],
    ]);
  });

  test("SD6: a persisted dimension is never its own correspondent; its duplicate is", () => {
    const seed = radiusOf("seed", "c");
    const copy = radiusOf("copy", "c1");
    expect(correspondence([seed, copy], seed)).toEqual([["copy", ["m1"]]]);
    expect(correspondence([seed, copy], copy)).toEqual([["seed", ["m1"]]]);
    // An exact duplicate on the same targets is not a mirror correspondence.
    expect(correspondence([seed, radiusOf("same", "c")], seed)).toEqual([]);
  });

  test("SD8 (review R-1): 24 mirrors about one line stay fast (visited target sets bound the search, not per-path mirror sets)", () => {
    const count = 24;
    const ids = Array.from({ length: count }, (_, index) => index);
    const definition = makeSketch(
      [
        makePoint("x0", [-2, 0]),
        makePoint("x1", [20, 0]),
        ...ids.flatMap((index) => [
          makePoint(`s${index}a`, [index, 1]),
          makePoint(`s${index}b`, [index, 2]),
          makePoint(`c${index}a`, [index, -1]),
          makePoint(`c${index}b`, [index, -2]),
        ]),
      ],
      [
        makeLine("ax", "x0", "x1"),
        ...ids.flatMap((index) => [
          makeLine(`s${index}`, `s${index}a`, `s${index}b`),
          makeLine(`c${index}`, `c${index}a`, `c${index}b`),
        ]),
      ],
      ids.map((index) =>
        makeMirror(`m${index}`, "ax", [
          [
            `s${index}`,
            `c${index}`,
            [`s${index}a`, `s${index}b`],
            [`c${index}a`, `c${index}b`],
          ],
        ]),
      ),
    );
    const started = performance.now();
    // The axis maps to itself under all 24 mirrors (the case that was 2^k).
    expect(
      correspondence(
        [lengthOf("E", "ax")],
        lengthOf("D", "ax"),
        [],
        definition,
      ),
    ).toEqual([]);
    expect(
      correspondence(
        [distanceOf("E", "x1", "x0")],
        distanceOf("D", "x0", "x1"),
        [],
        definition,
      ),
    ).toEqual([]);
    expect(
      correspondence(
        [lengthOf("E", "s23")],
        lengthOf("D", "c23"),
        [],
        definition,
      ),
    ).toEqual([["E", ["m23"]]]);
    expect(
      performance.now() - started,
      "milliseconds, generous bound",
    ).toBeLessThan(1000);
  });

  test("SD7: linkedMirrorRefs gives the healthy orbit of entities and points, never the ref itself", () => {
    const definition = {
      ...sharedDimensionSketch(),
      dimensionIds: [],
      dimensions: [],
    };
    const linked = (
      refs: Parameters<typeof linkedMirrorRefs>[1],
      failed: string[] = [],
    ) => linkedMirrorRefs(definition, refs, new Set(failed));
    expect(linked([{ kind: "entity", entityId: eid("c1") }])).toEqual([
      { kind: "entity", entityId: eid("c") },
      { kind: "entity", entityId: eid("c11") },
      { kind: "entity", entityId: eid("c2") },
    ]);
    expect(linked([{ kind: "point", pointId: pid("x0") }])).toEqual([
      { kind: "point", pointId: pid("x0c") },
    ]);
    // The axis line maps only to itself.
    expect(linked([{ kind: "entity", entityId: eid("ax") }])).toEqual([]);
    expect(linked([{ kind: "entity", entityId: eid("c1") }], ["m1"])).toEqual([
      { kind: "entity", entityId: eid("c11") },
    ]);
  });
});

// SDE: each routed family is reflection-invariant in the solve: a dimension
// on the copy and its image on the seed give the same solved geometry and
// statuses, about a line axis, a construction-line axis and a datum axis.
// The seed dimension is D's exact image (same operand order: an
// underconstrained solve may end elsewhere on the same requirement when a
// two-line kind lists its lines the other way). The core solve takes
// resolved numeric values.
describe("shared driving dimensions: equivalence in the solve (SDE, T16f)", () => {
  const tolerances = createDocumentSolverTolerances({
    modelingTolerance: TAU,
    angularToleranceRadians: 1e-6,
  });
  type AxisKind = "line" | "constructionLine" | "slopedLine" | "datum";
  function mirrored(axis: AxisKind, dimension: DimensionInput) {
    const points = [
      makePoint("a", [1, 1]),
      makePoint("b", [3, 2]),
      makePoint("e", [1, 3]),
      makePoint("f", [3, 4]),
      makePoint("g", [5, 1]),
      makePoint("h", [6, 3]),
      makePoint("c", [9, 3]),
      makePoint("d", [4, 5]),
      makePoint("x0", [-2, 0]),
      // Review A-1: a sloped axis too, where axis-dependent kinds would differ.
      makePoint("x1", axis === "slopedLine" ? [20, 11] : [20, 0]),
      ...["a1", "b1", "e1", "f1", "g1", "h1", "c1", "d1"].map((id) =>
        makePoint(id, [0, 0]),
      ),
    ];
    const axisLine = {
      ...makeLine("ax", "x0", "x1"),
      isConstruction: axis === "constructionLine",
    };
    const relationship = makeMirror("m1", "ax", [
      ["ab", "ab1", ["a", "b"], ["a1", "b1"]],
      ["ef", "ef1", ["e", "f"], ["e1", "f1"]],
      ["gh", "gh1", ["g", "h"], ["g1", "h1"]],
      ["c", "c1", ["c"], ["c1"]],
      ["pd", "pd1", ["d"], ["d1"]],
    ]);
    const definition = makeSketch(
      points,
      [
        makeLine("ab", "a", "b"),
        makeLine("ef", "e", "f"),
        makeLine("gh", "g", "h"),
        makeCircle("c", "c", 1),
        makePointEntity("pd", "d"),
        axisLine,
        makeLine("ab1", "a1", "b1"),
        makeLine("ef1", "e1", "f1"),
        makeLine("gh1", "g1", "h1"),
        makeCircle("c1", "c1", 1),
        makePointEntity("pd1", "d1"),
      ],
      [
        axis === "datum"
          ? {
              ...relationship,
              mirrorReference: { kind: "sketchDatum", datum: "xAxis" },
            }
          : relationship,
      ],
    );
    const authored = {
      ...definition,
      dimensionIds: [dimension.dimensionId],
      dimensions: [dimension],
    };
    // T17p3: derivation evaluates the resolved view; the authored
    // definition takes its evaluated points and entities.
    const evaluated = evaluateSketchDerivations({
      definition: literalResolvedDefinition(authored),
      modelingTolerance: TAU,
    }).definition;
    return {
      ...authored,
      points: evaluated.points,
      entities: evaluated.entities,
    };
  }
  const axisLineOperand = (axis: AxisKind) =>
    axis === "datum" ? datum("xAxis") : local("ax");
  const families: readonly [
    string,
    (axis: AxisKind) => [DimensionInput, DimensionInput],
  ][] = [
    [
      "radius / diameter",
      () => [
        { ...diameterOf("D", "c1"), value: literal(4) } as DimensionInput,
        { ...radiusOf("D", "c"), value: literal(2) } as DimensionInput,
      ],
    ],
    [
      "line length",
      () => [
        { ...lengthOf("D", "ab1"), value: literal(3) } as DimensionInput,
        { ...lengthOf("D", "ab"), value: literal(3) } as DimensionInput,
      ],
    ],
    [
      "aligned distance",
      () => [
        { ...distanceOf("D", "a1", "h1"), value: literal(6) } as DimensionInput,
        { ...distanceOf("D", "a", "h"), value: literal(6) } as DimensionInput,
      ],
    ],
    [
      "line distance",
      () => [
        dim("D", {
          kind: "lineDistance",
          lines: [local("ab1"), local("ef1")],
          value: literal(2.5),
        }),
        dim("D", {
          kind: "lineDistance",
          lines: [local("ab"), local("ef")],
          value: literal(2.5),
        }),
      ],
    ],
    [
      "point-line distance (to the axis)",
      (axis) => [
        dim("D", {
          kind: "linePointDistance",
          line: axisLineOperand(axis),
          point: localPoint("d1"),
          value: literal(7),
        }),
        dim("D", {
          kind: "linePointDistance",
          line: axisLineOperand(axis),
          point: localPoint("d"),
          value: literal(7),
        }),
      ],
    ],
    [
      "line angle",
      () => [
        dim("D", {
          kind: "lineAngle",
          lines: [local("ab1"), local("gh1")],
          valueRadians: literal(Math.PI / 3),
        }),
        dim("D", {
          kind: "lineAngle",
          lines: [local("ab"), local("gh")],
          valueRadians: literal(Math.PI / 3),
        }),
      ],
    ],
  ];
  const axes: readonly AxisKind[] = [
    "line",
    "constructionLine",
    "slopedLine",
    "datum",
  ];
  test.each(
    families.flatMap(([family, make]) =>
      axes.map((axis) => [family, axis, make] as const),
    ),
  )("SDE %s about a %s axis", (_, axis, make) => {
    const [onCopy, onSeed] = make(axis);
    const definitionOnCopy = mirrored(axis, onCopy);
    const definitionOnSeed = mirrored(axis, onSeed);
    // The owner calls them corresponding (the family is routed) …
    expect(
      correspondingMirrorDimensions(
        {
          ...definitionOnCopy,
          dimensions: [{ ...onSeed, dimensionId: "dimension_seed" }],
        },
        onCopy,
        new Set(),
      ).map((entry) => entry.dimension.dimensionId),
    ).toEqual(["dimension_seed"]);
    // … and the solve treats them as one requirement.
    const solveOf = (definition: SketchDefinition) =>
      solveSketchDefinitionCore({
        // T17p2 (F-2): the solver consumes the resolved definition.
        definition: literalResolvedDefinition(definition),
        tolerances,
        modelingTolerance: TAU,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot;
    const copySolve = solveOf(definitionOnCopy);
    const seedSolve = solveOf(definitionOnSeed);
    expect(copySolve.status).toEqual(seedSolve.status);
    expect(copySolve.status.solveState).toBe("solved");
    expect(copySolve.dimensionStatuses.map((entry) => entry.status)).toEqual(
      seedSolve.dimensionStatuses.map((entry) => entry.status),
    );
    expect(copySolve.dimensionStatuses[0]!.status).toBe("driving");
    const seedPosition = new Map(
      seedSolve.solvedPoints.map((entry) => [
        entry.pointId,
        entry.solvedPosition,
      ]),
    );
    expect(copySolve.solvedPoints.length).toBe(seedSolve.solvedPoints.length);
    for (const entry of copySolve.solvedPoints) {
      const other = seedPosition.get(entry.pointId)!;
      expect(entry.solvedPosition[0]).toBeCloseTo(other[0], 6);
      expect(entry.solvedPosition[1]).toBeCloseTo(other[1], 6);
    }
    const radiusOfEntity = (snapshot: typeof seedSolve, id: string) =>
      (
        snapshot.solvedEntities.find((entry) => entry.entityId === id) as
          | { solvedRadius?: number }
          | undefined
      )?.solvedRadius;
    for (const id of [eid("c"), eid("c1")])
      expect(radiusOfEntity(copySolve, id)).toBeCloseTo(
        radiusOfEntity(seedSolve, id)!,
        6,
      );
    // The requirement moved the geometry (the row is not vacuous).
    const authored = new Map(
      definitionOnSeed.points.map((entry) => [entry.pointId, entry.position]),
    );
    expect(
      radiusOfEntity(seedSolve, eid("c"))! > 1.5 ||
        seedSolve.solvedPoints.some((entry) => {
          const before = authored.get(entry.pointId)!;
          return (
            Math.hypot(
              entry.solvedPosition[0] - before[0],
              entry.solvedPosition[1] - before[1],
            ) > 1e-3
          );
        }),
    ).toBe(true);
  });
});
