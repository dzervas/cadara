import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";

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

  const result = evaluateSketchDerivations(definition);
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
  expectTrue(
    mirroredArc.kind === "arc" &&
      mirroredArc.sweepDirection === "counterClockwise",
    "Mirrored arcs should reverse sweep direction so the mirrored geometry remains consistent.",
  );
  expectTrue(
    result.diagnostics.length === 0,
    "Valid mirror relationships should not emit diagnostics.",
  );
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

  const result = evaluateSketchDerivations(definition);
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
  expectTrue(
    scaledCircle.kind === "circle" && scaledCircle.radius === 4,
    "Transform relationships should scale circle radii by the absolute value of the transform scale.",
  );
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
  expectTrue(
    result.diagnostics.length === 0,
    "Valid derived relationships should not emit diagnostics.",
  );
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

  const result = evaluateSketchDerivations(definition);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expectTrue(
    codes.includes("derived-transform-missing-seed"),
    "Missing seed entities should emit a missing-seed diagnostic.",
  );
  expectTrue(
    codes.includes("derived-transform-missing-output"),
    "Missing output entities should emit a missing-output diagnostic.",
  );
  expectTrue(
    codes.includes("derived-transform-missing-mirror-axis"),
    "Missing mirror axes should emit a missing-axis diagnostic.",
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
  expectTrue(
    close,
    `${message} Expected [${expected.join(", ")}], received [${actual.join(", ")}].`,
  );
}

function pointPosition(definition: SketchDefinition, pointId: string) {
  const point = definition.points.find(
    (candidate) => candidate.pointId === pointId,
  );
  expectTrue(
    point,
    `Expected point ${pointId} to exist in the evaluated sketch definition.`,
  );
  return point.position;
}

function entity(
  definition: SketchDefinition,
  entityId: string,
): SketchEntityDefinition {
  const candidate = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );
  expectTrue(
    candidate,
    `Expected entity ${entityId} to exist in the evaluated sketch definition.`,
  );
  return candidate;
}

function makeSketchDefinition(overrides: {
  points: SketchPointDefinition[];
  entities: SketchEntityDefinition[];
  derivedRelationships?: SketchDerivationDefinition[];
}) {
  return {
    schemaVersion: "sketch-definition/v1alpha1",
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
    fitPointIds: fitPointIds as SketchEntityDefinition extends {
      kind: "spline";
      fitPointIds: infer T;
    }
      ? T
      : never,
    degree: 3,
  };
}

function makeRelationship(
  definition: SketchDerivationDefinition,
): SketchDerivationDefinition {
  return definition;
}
