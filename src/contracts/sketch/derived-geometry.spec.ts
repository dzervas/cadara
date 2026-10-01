import { test, expect } from "vitest";

import type { SketchPointId } from "@/contracts/shared/ids";
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

test("evaluateSketchDerivations mirrors geometry and reverses mirrored arc sweep direction", () => {
  const definition = makeSketchDefinition({
    points: [
      makePoint("axis_start", [0, -2]),
      makePoint("axis_end", [0, 2]),
      makePoint("arc_center", [2, 0]),
      makePoint("arc_start", [3, 0]),
      makePoint("arc_end", [2, 1]),
      makePoint("mirror_center", [0, 0]),
      makePoint("mirror_start", [0, 0]),
      makePoint("mirror_end", [0, 0]),
    ],
    entities: [
      makeLine("axis", "axis_start", "axis_end"),
      makeArc("seed_arc", "arc_center", "arc_start", "arc_end", "clockwise"),
      makeArc(
        "mirror_arc",
        "mirror_center",
        "mirror_start",
        "mirror_end",
        "clockwise",
      ),
    ],
    derivedRelationships: [
      makeRelationship({
        kind: "mirror",
        derivationId: "mirror_arc_relationship",
        label: "Mirror arc",
        seedEntityIds: ["seed_arc"],
        mirrorReference: { kind: "lineEntity", entityId: "axis" },
        outputs: [
          {
            seedEntityId: "seed_arc",
            outputEntityId: "mirror_arc",
            instanceIndex: 1,
            seedPointIds: [],
            outputPointIds: ["mirror_center", "mirror_start", "mirror_end"],
          },
        ],
      }),
    ],
  });

  const authoredSnapshot = structuredClone(definition);
  const axisStart = definition.points.find(
    (point) => point.pointId === "axis_start",
  );
  const result = evaluateSketchDerivations({
    definition: definition,
    modelingTolerance: 1e-3,
  });
  const center = pointPosition(result.definition, "mirror_center");
  const start = pointPosition(result.definition, "mirror_start");
  const end = pointPosition(result.definition, "mirror_end");
  const mirroredArc = entity(result.definition, "mirror_arc");

  assertPoint(
    center,
    [-2, 0],
    "Mirror relationships should reflect arc centers across the mirror axis.",
  );
  assertPoint(
    start,
    [-3, 0],
    "Mirror relationships should reflect arc start points across the mirror axis.",
  );
  assertPoint(
    end,
    [-2, 1],
    "Mirror relationships should reflect arc end points across the mirror axis.",
  );
  expect(
    mirroredArc.kind === "arc" &&
      mirroredArc.sweepDirection === "counterClockwise",
    "Mirrored arcs should reverse sweep direction so the mirrored geometry remains consistent.",
  ).toBeTruthy();
  expect(
    result.diagnostics.length,
    "Valid mirror relationships should not emit diagnostics.",
  ).toBe(0);
  expect(definition).toEqual(authoredSnapshot);
  expect(
    result.definition.points.find((point) => point.pointId === "axis_start"),
  ).toBe(axisStart);
});

test("evaluateSketchDerivations applies linear, circular, and transform relationships through the exported seam", () => {
  const definition = makeSketchDefinition({
    points: [
      makePoint("line_seed_start", [1, 1]),
      makePoint("line_seed_end", [2, 1]),
      makePoint("line_out_start", [0, 0]),
      makePoint("line_out_end", [0, 0]),
      makePoint("circle_center", [1, 2]),
      makePoint("circle_out_center", [0, 0]),
      makePoint("pattern_seed", [2, 0]),
      makePoint("pattern_out", [0, 0]),
      makePoint("spline_seed_a", [0, 0]),
      makePoint("spline_seed_b", [1, 0]),
      makePoint("spline_seed_c", [1, 1]),
      makePoint("spline_out_a", [0, 0]),
      makePoint("spline_out_b", [0, 0]),
      makePoint("spline_out_c", [0, 0]),
    ],
    entities: [
      makeLine("seed_line", "line_seed_start", "line_seed_end"),
      makeLine("linear_line", "line_out_start", "line_out_end"),
      makeCircle("seed_circle", "circle_center", 2),
      makeCircle("scaled_circle", "circle_out_center", 1),
      makePointEntity("pattern_seed_entity", "pattern_seed"),
      makePointEntity("pattern_out_entity", "pattern_out"),
      makeSpline("seed_spline", [
        "spline_seed_a",
        "spline_seed_b",
        "spline_seed_c",
      ]),
      makeSpline("rotated_spline", [
        "spline_out_a",
        "spline_out_b",
        "spline_out_c",
      ]),
    ],
    derivedRelationships: [
      makeRelationship({
        kind: "linearPattern",
        derivationId: "linear_line_relationship",
        label: "Linear line",
        seedEntityIds: ["seed_line"],
        vector: [3, -2],
        instanceCount: 2,
        outputs: [
          {
            seedEntityId: "seed_line",
            outputEntityId: "linear_line",
            instanceIndex: 1,
            seedPointIds: [],
            outputPointIds: ["line_out_start", "line_out_end"],
          },
        ],
      }),
      makeRelationship({
        kind: "transform",
        derivationId: "transform_circle_relationship",
        label: "Transform circle",
        seedEntityIds: ["seed_circle"],
        origin: [1, 1],
        translation: [5, -1],
        rotationRadians: Math.PI / 2,
        scale: -2,
        outputs: [
          {
            seedEntityId: "seed_circle",
            outputEntityId: "scaled_circle",
            instanceIndex: 1,
            seedPointIds: [],
            outputPointIds: ["circle_out_center"],
          },
        ],
      }),
      makeRelationship({
        kind: "circularPattern",
        derivationId: "circular_point_relationship",
        label: "Circular point",
        seedEntityIds: ["pattern_seed_entity"],
        center: [0, 0],
        angleRadians: Math.PI / 2,
        instanceCount: 2,
        outputs: [
          {
            seedEntityId: "pattern_seed_entity",
            outputEntityId: "pattern_out_entity",
            instanceIndex: 1,
            seedPointIds: [],
            outputPointIds: ["pattern_out"],
          },
        ],
      }),
      makeRelationship({
        kind: "transform",
        derivationId: "transform_spline_relationship",
        label: "Transform spline",
        seedEntityIds: ["seed_spline"],
        origin: [0, 0],
        translation: [0, 1],
        rotationRadians: Math.PI / 2,
        scale: 1,
        outputs: [
          {
            seedEntityId: "seed_spline",
            outputEntityId: "rotated_spline",
            instanceIndex: 1,
            seedPointIds: [],
            outputPointIds: ["spline_out_a", "spline_out_b", "spline_out_c"],
          },
        ],
      }),
    ],
  });

  const result = evaluateSketchDerivations({
    definition: definition,
    modelingTolerance: 1e-3,
  });
  const scaledCircle = entity(result.definition, "scaled_circle");

  assertPoint(
    pointPosition(result.definition, "line_out_start"),
    [4, -1],
    "Linear patterns should offset the first line endpoint by the pattern vector.",
  );
  assertPoint(
    pointPosition(result.definition, "line_out_end"),
    [5, -1],
    "Linear patterns should offset the second line endpoint by the pattern vector.",
  );
  assertPoint(
    pointPosition(result.definition, "circle_out_center"),
    [8, 0],
    "Transform relationships should rotate, scale, then translate circle centers.",
  );
  expect(
    scaledCircle.kind === "circle" && scaledCircle.radius === 4,
    "Transform relationships should scale circle radii by the absolute value of the transform scale.",
  ).toBeTruthy();
  assertPoint(
    pointPosition(result.definition, "pattern_out"),
    [0, 2],
    "Circular patterns should rotate points around the requested center.",
  );
  assertPoint(
    pointPosition(result.definition, "spline_out_a"),
    [0, 1],
    "Transforms should rotate and translate spline control points.",
  );
  assertPoint(
    pointPosition(result.definition, "spline_out_b"),
    [0, 2],
    "Transforms should preserve spline point order while moving each point.",
  );
  assertPoint(
    pointPosition(result.definition, "spline_out_c"),
    [-1, 2],
    "Transforms should apply consistently across every spline point in the output map.",
  );
  expect(
    result.diagnostics.length,
    "Valid derived relationships should not emit diagnostics.",
  ).toBe(0);

  const differential = evaluateSketchDerivationJvp(result, {
    points: {
      line_seed_start: [2, 3],
      circle_center: [1, -2],
      pattern_seed: [1, 0],
      spline_seed_b: [1, 0],
    },
  });
  expect(differential.points.line_out_start).toEqual([2, 3]);
  expect(differential.points.circle_out_center?.[0]).toBeCloseTo(-4, 12);
  expect(differential.points.circle_out_center?.[1]).toBeCloseTo(-2, 12);
  expect(differential.points.pattern_out?.[0]).toBeCloseTo(0, 12);
  expect(differential.points.pattern_out?.[1]).toBeCloseTo(1, 12);
  expect(differential.points.spline_out_b?.[0]).toBeCloseTo(0, 12);
  expect(differential.points.spline_out_b?.[1]).toBeCloseTo(1, 12);
});

test("evaluateSketchDerivations preserves complete spline aggregates and linearly transforms authored tangents", () => {
  const seed = {
    ...makeSpline("seed_spline", ["seed_a", "seed_b", "seed_a"]),
    pointOccurrenceIds: ["seed-occ-a", "seed-occ-b", "seed-occ-alias"],
    pointOccurrences: [
      {
        occurrenceId: "seed-occ-a",
        pointId: "seed_a",
        tangent: { kind: "authored" as const, vector: [1, 2] as const },
      },
      {
        occurrenceId: "seed-occ-b",
        pointId: "seed_b",
        tangent: { kind: "authored" as const, vector: [0, 0] as const },
      },
      {
        occurrenceId: "seed-occ-alias",
        pointId: "seed_a",
        tangent: { kind: "automatic" as const },
      },
    ],
    closure: "smooth" as const,
  } as Extract<SketchEntityDefinition, { kind: "spline" }>;
  const mirrored = {
    ...makeSpline("mirrored_spline", ["mirror_a", "mirror_b", "mirror_a"]),
    pointOccurrenceIds: ["mirror-occ-a", "mirror-occ-b", "mirror-occ-alias"],
    pointOccurrences: [
      {
        occurrenceId: "mirror-occ-a",
        pointId: "mirror_a",
        tangent: { kind: "automatic" as const },
      },
      {
        occurrenceId: "mirror-occ-b",
        pointId: "mirror_b",
        tangent: { kind: "automatic" as const },
      },
      {
        occurrenceId: "mirror-occ-alias",
        pointId: "mirror_a",
        tangent: { kind: "automatic" as const },
      },
    ],
  } as Extract<SketchEntityDefinition, { kind: "spline" }>;
  const transformed = {
    ...makeSpline("transformed_spline", [
      "transform_a",
      "transform_b",
      "transform_a",
    ]),
    pointOccurrenceIds: [
      "transform-occ-a",
      "transform-occ-b",
      "transform-occ-alias",
    ],
    pointOccurrences: [
      {
        occurrenceId: "transform-occ-a",
        pointId: "transform_a",
        tangent: { kind: "automatic" as const },
      },
      {
        occurrenceId: "transform-occ-b",
        pointId: "transform_b",
        tangent: { kind: "automatic" as const },
      },
      {
        occurrenceId: "transform-occ-alias",
        pointId: "transform_a",
        tangent: { kind: "automatic" as const },
      },
    ],
  } as Extract<SketchEntityDefinition, { kind: "spline" }>;
  const definition = makeSketchDefinition({
    points: [
      makePoint("axis_start", [0, -2]),
      makePoint("axis_end", [0, 2]),
      makePoint("seed_a", [1, 0]),
      makePoint("seed_b", [2, 1]),
      makePoint("mirror_a", [0, 0]),
      makePoint("mirror_b", [0, 0]),
      makePoint("transform_a", [0, 0]),
      makePoint("transform_b", [0, 0]),
    ],
    entities: [
      makeLine("axis", "axis_start", "axis_end"),
      seed,
      mirrored,
      transformed,
    ],
    derivedRelationships: [
      makeRelationship({
        kind: "mirror",
        derivationId: "mirror_spline_relationship",
        label: "Mirror spline",
        seedEntityIds: ["seed_spline"],
        mirrorReference: { kind: "lineEntity", entityId: "axis" },
        outputs: [
          {
            seedEntityId: "seed_spline",
            outputEntityId: "mirrored_spline",
            instanceIndex: 1,
            seedPointIds: ["seed_a", "seed_b", "seed_a"],
            outputPointIds: ["mirror_a", "mirror_b", "mirror_a"],
          },
        ],
      }),
      makeRelationship({
        kind: "transform",
        derivationId: "transform_spline_relationship",
        label: "Transform spline",
        seedEntityIds: ["seed_spline"],
        origin: [0, 0],
        translation: [9, 7],
        rotationRadians: Math.PI / 2,
        scale: 2,
        outputs: [
          {
            seedEntityId: "seed_spline",
            outputEntityId: "transformed_spline",
            instanceIndex: 1,
            seedPointIds: ["seed_a", "seed_b", "seed_a"],
            outputPointIds: ["transform_a", "transform_b", "transform_a"],
          },
        ],
      }),
    ],
  });

  const first = evaluateSketchDerivations({
    definition: definition,
    modelingTolerance: 1e-3,
  });
  const second = evaluateSketchDerivations({
    definition: {
      ...definition,
      points: [...definition.points],
    },
    modelingTolerance: 1e-3,
  });
  const mirrorResult = entity(first.definition, "mirrored_spline") as Extract<
    SketchEntityDefinition,
    { kind: "spline" }
  >;
  const transformResult = entity(
    first.definition,
    "transformed_spline",
  ) as Extract<SketchEntityDefinition, { kind: "spline" }>;
  const repeatedMirror = entity(
    second.definition,
    "mirrored_spline",
  ) as Extract<SketchEntityDefinition, { kind: "spline" }>;

  expect(mirrorResult.pointOccurrenceIds).toEqual([
    "mirror-occ-a",
    "mirror-occ-b",
    "mirror-occ-alias",
  ]);
  expect(repeatedMirror.pointOccurrenceIds).toEqual(
    mirrorResult.pointOccurrenceIds,
  );
  expect(
    mirrorResult.pointOccurrences.map((occurrence) => occurrence.pointId),
  ).toEqual(["mirror_a", "mirror_b", "mirror_a"]);
  expect(mirrorResult.closure).toBe("smooth");
  expect(
    mirrorResult.pointOccurrences.map((occurrence) => occurrence.tangent),
  ).toEqual([
    { kind: "authored", vector: [-1, 2] },
    { kind: "authored", vector: [0, 0] },
    { kind: "automatic" },
  ]);
  expect(
    transformResult.pointOccurrences.map((occurrence) => occurrence.tangent),
  ).toEqual([
    { kind: "authored", vector: [-4, 2.0000000000000004] },
    { kind: "authored", vector: [0, 0] },
    { kind: "automatic" },
  ]);

  const differential = evaluateSketchDerivationJvp(first, {
    splineTangents: {
      seed_spline: { "seed-occ-a": [3, -1], "seed-occ-b": [0, 0] },
    },
  });
  expect(differential.splineTangents.mirrored_spline?.["mirror-occ-a"]).toEqual(
    [-3, -1],
  );
  expect(
    differential.splineTangents.transformed_spline?.["transform-occ-a"]?.[0],
  ).toBeCloseTo(2, 12);
  expect(
    differential.splineTangents.transformed_spline?.["transform-occ-a"]?.[1],
  ).toBeCloseTo(6, 12);
  expect(
    differential.splineTangents.mirrored_spline?.["mirror-occ-b"],
    "Explicit zero authored handles retain a zero JVP instead of reverting to automatic behavior.",
  ).toEqual([0, 0]);

  const variation = {
    points: {
      axis_start: [0.2, -0.3] as const,
      axis_end: [-0.4, 0.5] as const,
    },
    splineTangents: {
      seed_spline: { "seed-occ-a": [3, -1] as const },
    },
  };
  const mirrorDifferential = evaluateSketchDerivationJvp(first, variation);
  const outputCotangent = [0.7, -1.2] as const;
  const pulled = prepareSketchDerivationPullback(first)({
    splineTangents: {
      mirrored_spline: { "mirror-occ-a": outputCotangent },
    },
  });
  const outputDifferential =
    mirrorDifferential.splineTangents.mirrored_spline?.["mirror-occ-a"];
  expect(outputDifferential).toBeDefined();
  if (!outputDifferential) {
    throw new Error("Expected a mirrored authored-handle differential.");
  }
  const inputDot =
    variation.points.axis_start[0] * (pulled.points?.axis_start?.[0] ?? 0) +
    variation.points.axis_start[1] * (pulled.points?.axis_start?.[1] ?? 0) +
    variation.points.axis_end[0] * (pulled.points?.axis_end?.[0] ?? 0) +
    variation.points.axis_end[1] * (pulled.points?.axis_end?.[1] ?? 0) +
    variation.splineTangents.seed_spline["seed-occ-a"][0] *
      (pulled.splineTangents?.seed_spline?.["seed-occ-a"]?.[0] ?? 0) +
    variation.splineTangents.seed_spline["seed-occ-a"][1] *
      (pulled.splineTangents?.seed_spline?.["seed-occ-a"]?.[1] ?? 0);
  const outputDot =
    outputCotangent[0] * outputDifferential[0] +
    outputCotangent[1] * outputDifferential[1];
  expect(inputDot).toBeCloseTo(outputDot, 12);
});

test("evaluateSketchDerivations emits diagnostics for missing seed, missing output, and missing mirror axis seams", () => {
  const definition = makeSketchDefinition({
    points: [
      makePoint("seed_point", [1, 1]),
      makePoint("output_point", [0, 0]),
    ],
    entities: [
      makePointEntity("seed_entity", "seed_point"),
      makePointEntity("output_entity", "output_point"),
    ],
    derivedRelationships: [
      makeRelationship({
        kind: "linearPattern",
        derivationId: "missing_seed_relationship",
        label: "Missing seed",
        seedEntityIds: ["missing_seed"],
        vector: [1, 0],
        instanceCount: 2,
        outputs: [
          {
            seedEntityId: "missing_seed",
            outputEntityId: "output_entity",
            instanceIndex: 1,
            seedPointIds: ["seed_point"],
            outputPointIds: ["output_point"],
          },
        ],
      }),
      makeRelationship({
        kind: "linearPattern",
        derivationId: "missing_output_relationship",
        label: "Missing output",
        seedEntityIds: ["seed_entity"],
        vector: [1, 0],
        instanceCount: 2,
        outputs: [
          {
            seedEntityId: "seed_entity",
            outputEntityId: "missing_output",
            instanceIndex: 1,
            seedPointIds: ["seed_point"],
            outputPointIds: ["output_point"],
          },
        ],
      }),
      makeRelationship({
        kind: "mirror",
        derivationId: "missing_axis_relationship",
        label: "Missing axis",
        seedEntityIds: ["seed_entity"],
        mirrorReference: { kind: "lineEntity", entityId: "missing_axis" },
        outputs: [
          {
            seedEntityId: "seed_entity",
            outputEntityId: "output_entity",
            instanceIndex: 1,
            seedPointIds: ["seed_point"],
            outputPointIds: ["output_point"],
          },
        ],
      }),
    ],
  });

  const result = evaluateSketchDerivations({
    definition: definition,
    modelingTolerance: 1e-3,
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(
    codes.includes("derived-transform-missing-seed"),
    "Missing seed entities should emit a missing-seed diagnostic.",
  ).toBeTruthy();
  expect(
    codes.includes("derived-transform-missing-output"),
    "Missing output entities should emit a missing-output diagnostic.",
  ).toBeTruthy();
  expect(
    codes.includes("derived-transform-missing-mirror-axis"),
    "Missing mirror axes should emit a missing-axis diagnostic.",
  ).toBeTruthy();
});

test("evaluateSketchDerivations recomputes offset chains from seed edits with stable output identities", () => {
  function makeOffsetDefinition(input: {
    bX: number;
    distance: SketchDerivationDefinition extends { distance: infer T }
      ? T
      : never;
  }) {
    return makeSketchDefinition({
      points: [
        makePoint("a", [0, 0]),
        makePoint("b", [input.bX, 0]),
        makePoint("c", [input.bX, 4]),
        makePoint("o1s", [0, 0]),
        makePoint("o1e", [0, 0]),
        makePoint("o2e", [0, 0]),
      ],
      entities: [
        makeLine("seed_ab", "a", "b"),
        makeLine("seed_bc", "b", "c"),
        makeLine("out_ab", "o1s", "o1e"),
        // T08b-g5 (D2/[TECH] G6): a trimmed corner is one shared driven point.
        makeLine("out_bc", "o1e", "o2e"),
      ],
      derivedRelationships: [
        makeRelationship({
          kind: "offset",
          derivationId: "sketch_derivation_1_offset",
          label: "offset 1",
          seedEntityIds: [
            "seed_ab",
            "seed_bc",
          ] as unknown as SketchDerivationDefinition["seedEntityIds"],
          distance: input.distance,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: "seed_ab",
              outputEntityId: "out_ab",
              instanceIndex: 1,
              seedPointIds: ["a", "b"],
              outputPointIds: ["o1s", "o1e"],
            },
            {
              seedEntityId: "seed_bc",
              outputEntityId: "out_bc",
              instanceIndex: 1,
              seedPointIds: ["b", "c"],
              outputPointIds: ["o1e", "o2e"],
            },
          ],
        } as SketchDerivationDefinition),
      ],
    });
  }

  const initial = evaluateSketchDerivations({
    definition: makeOffsetDefinition({ bX: 4, distance: 1 }),
    modelingTolerance: 1e-3,
  });
  expect(
    initial.diagnostics.length,
    "A resolvable offset chain should not emit diagnostics.",
  ).toBe(0);
  assertPoint(
    pointPosition(initial.definition, "o1s"),
    [0, 1],
    "Offset recompute should place the chain start on the offset side.",
  );
  assertPoint(
    pointPosition(initial.definition, "o1e"),
    [3, 1],
    "Offset recompute should trim the inside corner.",
  );
  expect(
    initial.definition.entities.find((entity) => entity.entityId === "out_bc"),
    "Adjacent trimmed outputs should share the corner point.",
  ).toMatchObject({ startPointId: "o1e" });
  assertPoint(
    pointPosition(initial.definition, "o2e"),
    [3, 4],
    "Offset recompute should keep the natural direction of each seed.",
  );

  const seedEdited = evaluateSketchDerivations({
    definition: makeOffsetDefinition({ bX: 6, distance: 1 }),
    modelingTolerance: 1e-3,
  });
  expect(
    seedEdited.diagnostics.length,
    "Seed edits should recompute without diagnostics.",
  ).toBe(0);
  assertPoint(
    pointPosition(seedEdited.definition, "o1e"),
    [5, 1],
    "Seed edits should propagate into derived offset outputs.",
  );
  expect(
    seedEdited.definition.entities.map((entry) => entry.entityId),
    "Recompute should keep output entity identities stable.",
  ).toEqual(initial.definition.entities.map((entry) => entry.entityId));

  const variation = {
    points: {
      a: [0.2, -0.4] as const,
      b: [0.7, 0.3] as const,
      c: [-0.1, 0.6] as const,
    },
  };
  const differential = evaluateSketchDerivationJvp(initial, variation);
  const cotangent = {
    points: {
      o1s: [0.8, -0.2] as const,
      o1e: [-0.3, 0.9] as const,
      o2e: [-0.6, 0.1] as const,
    },
  };
  const pulled = prepareSketchDerivationPullback(initial)(cotangent);
  const dot = (left: SketchPoint2D, right: SketchPoint2D) =>
    left[0] * right[0] + left[1] * right[1];
  const forwardDot = Object.entries(cotangent.points).reduce(
    (sum, [pointId, value]) =>
      sum + dot(differential.points[pointId as SketchPointId]!, value),
    0,
  );
  const reverseDot = Object.entries(variation.points).reduce(
    (sum, [pointId, value]) =>
      sum + dot(pulled.points?.[pointId as SketchPointId] ?? [0, 0], value),
    0,
  );
  expect(
    reverseDot,
    "Offset pullback should be the transpose of the analytic owner JVP.",
  ).toBeCloseTo(forwardDot, 9);
  expect(
    pulled.points?.o1e,
    "Offset output slots must not receive authority cotangents.",
  ).toBeUndefined();

  const distanceEdited = evaluateSketchDerivations({
    definition: makeOffsetDefinition({ bX: 4, distance: 0.5 }),
    modelingTolerance: 1e-3,
  });
  assertPoint(
    pointPosition(distanceEdited.definition, "o1s"),
    [0, 0.5],
    "Distance edits should recompute the derived chain.",
  );

  const literalAuthored = evaluateSketchDerivations({
    definition: makeOffsetDefinition({
      bX: 4,
      distance: { source: "literal", value: 1 },
    }),
    modelingTolerance: 1e-3,
  });
  assertPoint(
    pointPosition(literalAuthored.definition, "o1s"),
    [0, 1],
    "Authored literal distances should evaluate like plain numbers.",
  );

  const unresolvedExpression = evaluateSketchDerivations({
    definition: makeOffsetDefinition({
      bX: 4,
      distance: { source: "expression", valueText: "wall / 2" },
    }),
    modelingTolerance: 1e-3,
  });
  expect(
    unresolvedExpression.diagnostics.some(
      (diagnostic) => diagnostic.code === "derived-offset-unresolved-distance",
    ),
    "Unresolved expression distances should emit the unresolved-distance diagnostic.",
  ).toBeTruthy();
  assertPoint(
    pointPosition(unresolvedExpression.definition, "o1s"),
    [0, 0],
    "Unresolved distances should keep outputs in their last resolvable state.",
  );
});

test("offset derivatives compose through transform relationships in both directions", () => {
  const definition = makeSketchDefinition({
    points: [
      makePoint("a", [0, 0]),
      makePoint("b", [2, 0]),
      makePoint("offset_a", [0, 0]),
      makePoint("offset_b", [0, 0]),
      makePoint("offset_transform_a", [0, 0]),
      makePoint("offset_transform_b", [0, 0]),
      makePoint("c", [0, 3]),
      makePoint("d", [2, 3]),
      makePoint("transform_a", [0, 0]),
      makePoint("transform_b", [0, 0]),
      makePoint("transform_offset_a", [0, 0]),
      makePoint("transform_offset_b", [0, 0]),
    ],
    entities: [
      makeLine("seed_ab", "a", "b"),
      makeLine("offset_ab", "offset_a", "offset_b"),
      makeLine(
        "offset_transform_ab",
        "offset_transform_a",
        "offset_transform_b",
      ),
      makeLine("seed_cd", "c", "d"),
      makeLine("transform_cd", "transform_a", "transform_b"),
      makeLine(
        "transform_offset_cd",
        "transform_offset_a",
        "transform_offset_b",
      ),
    ],
    derivedRelationships: [
      makeRelationship({
        kind: "offset",
        derivationId: "sketch_derivation_compose_offset_first",
        label: "offset first",
        seedEntityIds: ["seed_ab"],
        distance: 0.5,
        jointPolicy: "trimExtendArcFallback",
        piecewiseCubicOutputs: [],
        jointOutputs: [],
        outputs: [
          {
            seedEntityId: "seed_ab",
            outputEntityId: "offset_ab",
            instanceIndex: 1,
            seedPointIds: ["a", "b"],
            outputPointIds: ["offset_a", "offset_b"],
          },
        ],
      } as SketchDerivationDefinition),
      makeRelationship({
        kind: "transform",
        derivationId: "sketch_derivation_compose_transform_second",
        label: "transform second",
        seedEntityIds: ["offset_ab"],
        translation: [2, 0],
        rotationRadians: 0,
        scale: 1,
        origin: [0, 0],
        outputs: [
          {
            seedEntityId: "offset_ab",
            outputEntityId: "offset_transform_ab",
            instanceIndex: 1,
            seedPointIds: ["offset_a", "offset_b"],
            outputPointIds: ["offset_transform_a", "offset_transform_b"],
          },
        ],
      } as SketchDerivationDefinition),
      makeRelationship({
        kind: "transform",
        derivationId: "sketch_derivation_compose_transform_first",
        label: "transform first",
        seedEntityIds: ["seed_cd"],
        translation: [1, 0],
        rotationRadians: 0,
        scale: 1,
        origin: [0, 0],
        outputs: [
          {
            seedEntityId: "seed_cd",
            outputEntityId: "transform_cd",
            instanceIndex: 1,
            seedPointIds: ["c", "d"],
            outputPointIds: ["transform_a", "transform_b"],
          },
        ],
      } as SketchDerivationDefinition),
      makeRelationship({
        kind: "offset",
        derivationId: "sketch_derivation_compose_offset_second",
        label: "offset second",
        seedEntityIds: ["transform_cd"],
        distance: -0.25,
        jointPolicy: "trimExtendArcFallback",
        piecewiseCubicOutputs: [],
        jointOutputs: [],
        outputs: [
          {
            seedEntityId: "transform_cd",
            outputEntityId: "transform_offset_cd",
            instanceIndex: 1,
            seedPointIds: ["transform_a", "transform_b"],
            outputPointIds: ["transform_offset_a", "transform_offset_b"],
          },
        ],
      } as SketchDerivationDefinition),
    ],
  });
  const evaluation = evaluateSketchDerivations({
    definition: definition,
    modelingTolerance: 1e-3,
  });
  const variation = {
    points: {
      a: [0.2, -0.1] as const,
      b: [0.4, 0.3] as const,
      c: [-0.3, 0.5] as const,
      d: [0.6, -0.2] as const,
    },
  };
  const jvp = evaluateSketchDerivationJvp(evaluation, variation);
  const cotangent = {
    points: {
      offset_transform_a: [0.7, -0.4] as const,
      offset_transform_b: [-0.2, 0.8] as const,
      transform_offset_a: [0.3, 0.6] as const,
      transform_offset_b: [-0.9, 0.1] as const,
    },
  };
  const pulled = prepareSketchDerivationPullback(evaluation)(cotangent);
  const dot = (left: SketchPoint2D, right: SketchPoint2D) =>
    left[0] * right[0] + left[1] * right[1];
  const forward = Object.entries(cotangent.points).reduce(
    (sum, [pointId, value]) =>
      sum + dot(jvp.points[pointId as SketchPointId]!, value),
    0,
  );
  const reverse = Object.entries(variation.points).reduce(
    (sum, [pointId, value]) =>
      sum + dot(pulled.points?.[pointId as SketchPointId] ?? [0, 0], value),
    0,
  );
  expect(reverse).toBeCloseTo(forward, 9);
  for (const pointId of Object.keys(cotangent.points)) {
    expect(
      pulled.points?.[pointId as SketchPointId],
      `${pointId} must remain a driven output rather than pullback authority.`,
    ).toBeUndefined();
  }
});

test("evaluateSketchDerivations maintains offset joint arcs and reports structured offset diagnostics", () => {
  function makeJointDefinition(distance: number) {
    return makeSketchDefinition({
      points: [
        makePoint("a", [0, 0]),
        makePoint("b", [4, 0]),
        makePoint("c", [4, 4]),
        makePoint("o1s", [9, 9]),
        makePoint("o1e", [9, 9]),
        makePoint("o2s", [9, 9]),
        makePoint("o2e", [9, 9]),
        makePoint("joint_center", [9, 9]),
      ],
      entities: [
        makeLine("seed_ab", "a", "b"),
        makeLine("seed_bc", "b", "c"),
        makeLine("out_ab", "o1s", "o1e"),
        makeLine("out_bc", "o2s", "o2e"),
        makeArc("joint_arc", "joint_center", "o1e", "o2s", "counterClockwise"),
      ],
      derivedRelationships: [
        makeRelationship({
          kind: "offset",
          derivationId: "sketch_derivation_2_offset",
          label: "offset 2",
          seedEntityIds: [
            "seed_ab",
            "seed_bc",
          ] as unknown as SketchDerivationDefinition["seedEntityIds"],
          distance,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [
            {
              firstSeedEntityId: "seed_ab",
              secondSeedEntityId: "seed_bc",
              outputEntityId: "joint_arc",
              centerPointId: "joint_center",
              startPointId: "o1e",
              endPointId: "o2s",
            },
          ] as unknown as Extract<
            SketchDerivationDefinition,
            { kind: "offset" }
          >["jointOutputs"],
          outputs: [
            {
              seedEntityId: "seed_ab",
              outputEntityId: "out_ab",
              instanceIndex: 1,
              seedPointIds: ["a", "b"],
              outputPointIds: ["o1s", "o1e"],
            },
            {
              seedEntityId: "seed_bc",
              outputEntityId: "out_bc",
              instanceIndex: 1,
              seedPointIds: ["b", "c"],
              outputPointIds: ["o2s", "o2e"],
            },
          ],
        } as SketchDerivationDefinition),
      ],
    });
  }

  const arcJoined = evaluateSketchDerivations({
    definition: makeJointDefinition(-1),
    modelingTolerance: 1e-3,
  });
  expect(
    arcJoined.diagnostics.length,
    "A satisfiable arc-joined offset should not emit diagnostics.",
  ).toBe(0);
  assertPoint(
    pointPosition(arcJoined.definition, "joint_center"),
    [4, 0],
    "Joint arcs should track the shared seed vertex.",
  );
  assertPoint(
    pointPosition(arcJoined.definition, "o1e"),
    [4, -1],
    "The joint arc start should sit at the first segment's offset end.",
  );
  assertPoint(
    pointPosition(arcJoined.definition, "o2s"),
    [5, 0],
    "The joint arc end should sit at the second segment's offset start.",
  );
  const jointDifferential = evaluateSketchDerivationJvp(arcJoined, {
    points: { b: [0.4, -0.3] },
  });
  assertPoint(
    jointDifferential.points.joint_center!,
    [0.4, -0.3],
    "Committed joint centers should carry the shared seed vertex differential.",
  );

  const topologyFlip = evaluateSketchDerivations({
    definition: makeJointDefinition(1),
    modelingTolerance: 1e-3,
  });
  expect(
    topologyFlip.diagnostics.some(
      // T08b-g5 ([TECH] G6): arc presence is authored intent; a corner that
      // can no longer hold its authored arc is `topologyChanged`.
      (diagnostic) => diagnostic.code === "derived-offset-topology-changed",
    ),
    "A joint topology change should emit the topology-changed diagnostic.",
  ).toBeTruthy();
  assertPoint(
    pointPosition(topologyFlip.definition, "o1e"),
    [9, 9],
    "Joint topology changes should keep outputs in their last resolvable state.",
  );

  const collapsed = evaluateSketchDerivations({
    definition: makeSketchDefinition({
      points: [
        makePoint("arc_center", [0, 0]),
        makePoint("arc_start", [2, 0]),
        makePoint("arc_end", [0, 2]),
        makePoint("out_center", [9, 9]),
        makePoint("out_start", [9, 9]),
        makePoint("out_end", [9, 9]),
      ],
      entities: [
        makeArc(
          "seed_arc",
          "arc_center",
          "arc_start",
          "arc_end",
          "counterClockwise",
        ),
        makeArc(
          "out_arc",
          "out_center",
          "out_start",
          "out_end",
          "counterClockwise",
        ),
      ],
      derivedRelationships: [
        makeRelationship({
          kind: "offset",
          derivationId: "sketch_derivation_3_offset",
          label: "offset 3",
          seedEntityIds: [
            "seed_arc",
          ] as unknown as SketchDerivationDefinition["seedEntityIds"],
          distance: 3,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: "seed_arc",
              outputEntityId: "out_arc",
              instanceIndex: 1,
              seedPointIds: ["arc_center", "arc_start", "arc_end"],
              outputPointIds: ["out_center", "out_start", "out_end"],
            },
          ],
        } as SketchDerivationDefinition),
      ],
    }),
    modelingTolerance: 1e-3,
  });
  expect(
    collapsed.diagnostics.some(
      (diagnostic) => diagnostic.code === "derived-offset-arc-collapse",
    ),
    "Arc collapse should emit the structured arc-collapse diagnostic.",
  ).toBeTruthy();
  assertPoint(
    pointPosition(collapsed.definition, "out_start"),
    [9, 9],
    "Arc collapse should keep outputs in their last resolvable state instead of detaching.",
  );
});

function assertPoint(
  actual: SketchPoint2D,
  expected: SketchPoint2D,
  message: string,
) {
  const close =
    Math.abs(actual[0] - expected[0]) < 1e-9 &&
    Math.abs(actual[1] - expected[1]) < 1e-9;
  expect(
    close,
    `${message} Expected [${expected.join(", ")}], received [${actual.join(", ")}].`,
  ).toBeTruthy();
}

function pointPosition(definition: SketchDefinition, pointId: string) {
  const point = definition.points.find(
    (candidate) => candidate.pointId === pointId,
  );
  expect(
    point,
    `Expected point ${pointId} to exist in the evaluated sketch definition.`,
  ).toBeTruthy();
  return point.position;
}

function entity(
  definition: SketchDefinition,
  entityId: string,
): SketchEntityDefinition {
  const candidate = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );
  expect(
    candidate,
    `Expected entity ${entityId} to exist in the evaluated sketch definition.`,
  ).toBeTruthy();
  return candidate;
}

test("circle scalar derivatives compose transitively and pull back only to source authority", () => {
  const evaluation = evaluateSketchDerivations({
    definition: makeSketchDefinition({
      points: [
        makePoint("circle_seed_center", [0, 0]),
        makePoint("circle_offset_center", [0, 0]),
        makePoint("circle_transform_center", [0, 0]),
      ],
      entities: [
        makeCircle("circle_seed", "circle_seed_center", 2),
        makeCircle("circle_offset", "circle_offset_center", 1),
        makeCircle("circle_transform", "circle_transform_center", 2),
      ],
      derivedRelationships: [
        makeRelationship({
          kind: "offset",
          derivationId: "circle_scalar_offset",
          label: "Circle scalar offset",
          seedEntityIds: ["circle_seed"],
          distance: 1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: "circle_seed",
              outputEntityId: "circle_offset",
              instanceIndex: 1,
              seedPointIds: ["circle_seed_center"],
              outputPointIds: ["circle_offset_center"],
            },
          ],
        } as SketchDerivationDefinition),
        makeRelationship({
          kind: "transform",
          derivationId: "circle_scalar_transform",
          label: "Circle scalar transform",
          seedEntityIds: ["circle_offset"],
          translation: [0, 0],
          rotationRadians: 0,
          scale: 2,
          origin: [0, 0],
          outputs: [
            {
              seedEntityId: "circle_offset",
              outputEntityId: "circle_transform",
              instanceIndex: 1,
              seedPointIds: ["circle_offset_center"],
              outputPointIds: ["circle_transform_center"],
            },
          ],
        } as SketchDerivationDefinition),
      ],
    }),
    modelingTolerance: 1e-3,
  });
  const variation = {
    entities: {
      circle_seed: { kind: "circle" as const, radius: 0.3 },
    },
  };
  const jvp = evaluateSketchDerivationJvp(evaluation, variation);
  expect(jvp.entities.circle_offset).toEqual({ kind: "circle", radius: 0.3 });
  expect(jvp.entities.circle_transform).toEqual({
    kind: "circle",
    radius: 0.6,
  });

  const cotangent = {
    entities: {
      circle_transform: { kind: "circle" as const, radius: 1.5 },
    },
  };
  const pulled = prepareSketchDerivationPullback(evaluation)(cotangent);
  const forward = 1.5 * (jvp.entities.circle_transform?.radius ?? 0);
  const reverse =
    variation.entities.circle_seed.radius *
    (pulled.entities?.circle_seed?.radius ?? 0);
  expect(reverse).toBeCloseTo(forward, 10);
  expect(pulled.entities?.circle_offset).toBeUndefined();
  expect(pulled.entities?.circle_transform).toBeUndefined();
});

function makeSketchDefinition(overrides: {
  points: SketchPointDefinition[];
  entities: SketchEntityDefinition[];
  derivedRelationships?: SketchDerivationDefinition[];
}) {
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: overrides.points.map((point) => point.pointId),
    points: overrides.points,
    entityIds: overrides.entities.map((shape) => shape.entityId),
    entities: overrides.entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: overrides.derivedRelationships,
  } satisfies SketchDefinition;
}

function makePoint(
  pointId: string,
  position: SketchPoint2D,
): SketchPointDefinition {
  return {
    pointId: pointId as SketchPointDefinition["pointId"],
    label: pointId,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_1" as SketchPointDefinition["target"]["sketchId"],
      pointId: pointId as SketchPointDefinition["pointId"],
    },
    position,
    isConstruction: false,
  };
}

function makeLine(
  entityId: string,
  startPointId: string,
  endPointId: string,
): SketchEntityDefinition {
  return {
    kind: "lineSegment",
    entityId: entityId as SketchEntityDefinition["entityId"],
    label: entityId,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_1" as SketchEntityDefinition["target"]["sketchId"],
      entityId: entityId as SketchEntityDefinition["entityId"],
    },
    isConstruction: false,
    startPointId: startPointId as SketchPointDefinition["pointId"],
    endPointId: endPointId as SketchPointDefinition["pointId"],
  };
}

function makePointEntity(
  entityId: string,
  pointId: string,
): SketchEntityDefinition {
  return {
    kind: "point",
    entityId: entityId as SketchEntityDefinition["entityId"],
    label: entityId,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_1" as SketchEntityDefinition["target"]["sketchId"],
      entityId: entityId as SketchEntityDefinition["entityId"],
    },
    isConstruction: false,
    pointId: pointId as SketchPointDefinition["pointId"],
  };
}

function makeCircle(
  entityId: string,
  centerPointId: string,
  radius: number,
): SketchEntityDefinition {
  return {
    kind: "circle",
    entityId: entityId as SketchEntityDefinition["entityId"],
    label: entityId,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_1" as SketchEntityDefinition["target"]["sketchId"],
      entityId: entityId as SketchEntityDefinition["entityId"],
    },
    isConstruction: false,
    centerPointId: centerPointId as SketchPointDefinition["pointId"],
    radius,
  };
}

function makeArc(
  entityId: string,
  centerPointId: string,
  startPointId: string,
  endPointId: string,
  sweepDirection: "clockwise" | "counterClockwise",
): SketchEntityDefinition {
  return {
    kind: "arc",
    entityId: entityId as SketchEntityDefinition["entityId"],
    label: entityId,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_1" as SketchEntityDefinition["target"]["sketchId"],
      entityId: entityId as SketchEntityDefinition["entityId"],
    },
    isConstruction: false,
    centerPointId: centerPointId as SketchPointDefinition["pointId"],
    startPointId: startPointId as SketchPointDefinition["pointId"],
    endPointId: endPointId as SketchPointDefinition["pointId"],
    sweepDirection,
  };
}

function makeSpline(
  entityId: string,
  fitPointIds: string[],
): SketchEntityDefinition {
  return {
    kind: "spline",
    entityId: entityId as SketchEntityDefinition["entityId"],
    label: entityId,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_1" as SketchEntityDefinition["target"]["sketchId"],
      entityId: entityId as SketchEntityDefinition["entityId"],
    },
    isConstruction: false,
    pointOccurrenceIds: fitPointIds.map((_, index) => `occ-${index}`),
    pointOccurrences: fitPointIds.map((pointId, index) => ({
      occurrenceId: `occ-${index}`,
      pointId: pointId as SketchPointDefinition["pointId"],
      tangent: { kind: "automatic" },
    })),
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  };
}

function makeRelationship(
  definition: SketchDerivationDefinition,
): SketchDerivationDefinition {
  return definition;
}
