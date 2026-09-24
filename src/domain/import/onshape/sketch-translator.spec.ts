import { test, expect } from "vitest";

import { isExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import {
  translateSketch,
  verifySketchTranslationSolveConsistency,
} from "@/domain/import/onshape/sketch-translator";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { OnshapeSketchConstraint } from "@/domain/import/onshape/bundle-reader";

function relationship(
  constraintType: string,
  entityId: string,
  parameters: readonly {
    parameterId: string;
    value?: string | number;
    expression?: string;
    hasExternalQuery?: boolean;
    queries?: readonly { deterministicIds: readonly string[]; queryString: string }[];
  }[],
): OnshapeSketchConstraint {
  return {
    constraintType,
    entityId,
    parameters: parameters.map((parameter) => ({
      ...parameter,
      hasExternalQuery: parameter.hasExternalQuery === true,
    })),
  };
}

test("src/domain/import/onshape/sketch-translator.spec.ts", () => {
  const result = translateSketch({
    featureId: "FOoap8tw3jKAJf5_0",
    label: "Sketch 1",
    planeKey: "xy",
    entities: [
      {
        entityId: "line1",
        entityType: "lineSegment",
        start: [0, 0],
        end: [10, 0],
      },
      {
        entityId: "circle1",
        entityType: "circle",
        center: [5, 5],
        radius: 2,
        isConstruction: true,
      },
      { entityId: "spline1", entityType: "interpolatedSpline" },
    ],
  });

  expect(
    result.plane.support.kind === "construction" &&
      result.plane.key === "xy",
    "The sketch should sit on the canonical XY construction plane.",
  ).toBeTruthy();

  expect(
    result.definition.entities.map((entity) => entity.kind).sort(),
    "Supported entities (line, circle) should translate; the spline should not.",
  ).toEqual(["circle", "lineSegment"]);

  expect(
    result.definition.entities.find((entity) => entity.kind === "circle")
      ?.isConstruction,
    "Construction flags should be preserved.",
  ).toBe(true);

  const line = result.definition.points.filter((point) =>
    point.label.startsWith("line1"),
  );
  expect(
    line.some((point) => point.position[0] === 10 && point.position[1] === 0),
    "Line endpoints should be seeded from Onshape's solved positions.",
  ).toBeTruthy();

  expect(
    result.diagnostics[0]?.code,
    "The unsupported spline should produce an explicit dropped-entity diagnostic.",
  ).toBe("onshape-sketch-unsupported-entity");

  expect(
    validateSketchDefinition(result.definition).success,
    "The translated definition should validate against the sketch contract.",
  ).toBeTruthy();
});

test("carries only preclassified external point and line relationships", () => {
  const external = (deterministicId: string) => ({
    parameterId: "externalSecond",
    hasExternalQuery: true,
    queries: [{ deterministicIds: [deterministicId], queryString: "" }],
  });
  const result = translateSketch({
    featureId: "external_relations",
    label: "External relations",
    planeKey: "xy",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [0, 10] },
      { entityId: "point", entityType: "point", position: [5, 5] },
    ],
    externalReferences: new Map([
      ["BODY_EDGE", {
        geometryKind: "lineSegment" as const,
        definition: {
          referenceId: "ref_body_edge" as const,
          kind: "modelReference" as const,
          label: "Body edge",
          projectionMode: "projectAlongPlaneNormal" as const,
          source: {
            kind: "topologyOf" as const,
            expectedKind: "edge" as const,
            capturedSignature: { entityClass: "edge" as const, geometryType: "line" },
            tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 },
            source: { consumerFeatureId: "external_relations", parameterId: "externalSecond", deterministicId: "BODY_EDGE" },
          },
        },
      }],
      ["PRIOR_POINT", {
        geometryKind: "point" as const,
        definition: {
          referenceId: "ref_prior_point" as const,
          kind: "sketchReference" as const,
          label: "Prior point",
          projectionMode: "useExistingCoplanarGeometry" as const,
          source: {
            kind: "sketchPoint" as const,
            sketchId: { kind: "sketchIdOf" as const, actionIndex: 0 },
            pointId: "sketch_point_prior_point" as const,
          },
        },
      }],
    ]),
    constraints: [
      relationship("MIDPOINT", "mid", [
        { parameterId: "localEntity1", value: "line.start" },
        external("BODY_EDGE"),
      ]),
      relationship("PERPENDICULAR", "perpendicular", [
        { parameterId: "localFirst", value: "line" },
        external("BODY_EDGE"),
      ]),
      relationship("COINCIDENT", "prior", [
        { parameterId: "localFirst", value: "point" },
        external("PRIOR_POINT"),
      ]),
      relationship("COINCIDENT", "local-point-on-curve", [
        { parameterId: "localFirst", value: "point" },
        { parameterId: "localSecond", value: "line" },
      ]),
      relationship("COINCIDENT", "unsupported", [
        { parameterId: "localFirst", value: "line.end" },
        external("UNPROVENANCED"),
      ]),
    ],
  });

  expect(result.definition.references.map((reference) => reference.kind)).toEqual([
    "modelReference",
    "sketchReference",
  ]);
  expect(result.definition.constraints.map((constraint) => constraint.kind)).toEqual([
    "midpointProjectedLine",
    "perpendicularProjectedLine",
    "coincidentProjectedPoint",
    "pointOnCurve",
  ]);
  expect(result.relationshipSummary.constraints).toEqual({ carried: 4, dropped: 1 });
  expect(result.diagnostics.at(-1)?.code).toBe("onshape-sketch-external-reference-dropped");
});

test("translates local Onshape constraints and expression-backed dimensions", () => {
  const result = translateSketch({
    featureId: "sketch_constraints",
    label: "Constrained sketch",
    planeKey: "xy",
    entities: [
      { entityId: "left", entityType: "lineSegment", start: [0, 0], end: [0, 10] },
      { entityId: "right", entityType: "lineSegment", start: [10, 0], end: [10, 10] },
      { entityId: "mid", entityType: "point", position: [5, 5] },
      { entityId: "circle", entityType: "circle", center: [5, 5], radius: 2 },
    ],
    constraints: [
      relationship("COINCIDENT", "coincident1", [
        { parameterId: "localFirst", value: "left.start" },
        { parameterId: "localSecond", value: "right.start" },
      ]),
      relationship("MIDPOINT", "midpoint1", [
        { parameterId: "localEntity1", value: "mid" },
        { parameterId: "localEntity2", value: "right" },
      ]),
      relationship("PARALLEL", "parallel1", [
        { parameterId: "localFirst", value: "left" },
        { parameterId: "localSecond", value: "right" },
      ]),
      relationship("LENGTH", "length1", [
        { parameterId: "localFirst", value: "left" },
        { parameterId: "direction", value: "MINIMUM" },
        { parameterId: "length", expression: "#height * 2" },
      ]),
      relationship("DIAMETER", "diameter1", [
        { parameterId: "localFirst", value: "circle" },
        { parameterId: "length", expression: "4 mm" },
      ]),
    ],
  });

  expect(
    result.relationshipSummary,
    "Supported relationships should be counted as carried.",
  ).toEqual({
    constraints: { carried: 3, dropped: 0 },
    dimensions: { carried: 2, dropped: 0 },
    derivations: { carried: 0, dropped: 0 },
  });
  expect(result.definition.constraints.map((constraint) => constraint.kind)).toEqual([
    "coincident",
    "midpoint",
    "parallel",
  ]);
  const left = result.definition.entities.find(
    (entity) => entity.entityId.endsWith("_left"),
  );
  const right = result.definition.entities.find(
    (entity) => entity.entityId.endsWith("_right"),
  );
  expect(
    left?.kind === "lineSegment" &&
      right?.kind === "lineSegment" &&
      left.startPointId === right.startPointId,
    "Coincident imported endpoints should share topology so variable rebuilds cannot open the loop while solving.",
  ).toBe(true);
  const coincident = result.definition.constraints.find(
    (constraint) => constraint.kind === "coincident",
  );
  expect(
    coincident?.kind === "coincident" &&
      coincident.pointIds[0] === coincident.pointIds[1],
    "The translated coincidence record should remain present after topology normalization.",
  ).toBe(true);
  const length = result.definition.dimensions.find(
    (dimension) => dimension.kind === "lineLength",
  );
  expect(
    length?.kind === "lineLength" && isExpressionAuthoredValue(length.value),
    "Dimension values should preserve Onshape expressions as authored values.",
  ).toBe(true);
  if (length?.kind === "lineLength" && isExpressionAuthoredValue(length.value)) {
    expect(length.value.valueText).toBe("height * 2");
  }
  expect(validateSketchDefinition(result.definition).success).toBe(true);
});

test("drops unsupported, missing, and external relationship records individually", () => {
  const result = translateSketch({
    featureId: "sketch_drops",
    label: "Dropped relationships",
    planeKey: "xy",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
    ],
    constraints: [
      relationship("PARALLEL", "missing-local", [
        { parameterId: "localFirst", value: "line" },
        { parameterId: "localSecond", value: "missing" },
      ]),
      relationship("PROJECTED", "external-project", [
        { parameterId: "localFirst", value: "line.start" },
        { parameterId: "externalSecond", hasExternalQuery: true },
      ]),
      relationship("SPLINE_HANDLE", "unsupported", [
        { parameterId: "localFirst", value: "line" },
      ]),
    ],
  });

  expect(result.relationshipSummary.constraints).toEqual({ carried: 0, dropped: 3 });
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "onshape-sketch-relationship-dropped",
    "onshape-sketch-external-reference-dropped",
    "onshape-sketch-relationship-dropped",
  ]);
  expect(
    result.definition.entities.length,
    "Dropping bad relationship records should not drop the translated sketch geometry.",
  ).toBe(1);
});

test("translates mirror and linear-pattern derivations plus relational equal offsets", () => {
  const result = translateSketch({
    featureId: "sketch_derivations",
    label: "Derived sketch",
    planeKey: "xy",
    entities: [
      { entityId: "seed", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      { entityId: "mirror", entityType: "lineSegment", start: [0, 5], end: [10, 5], isConstruction: true },
      { entityId: "mirrored", entityType: "lineSegment", start: [0, 10], end: [10, 10] },
      { entityId: "pattern.1", entityType: "lineSegment", start: [0, 20], end: [10, 20] },
      { entityId: "offset.1", entityType: "lineSegment", start: [0, -2], end: [10, -2] },
      { entityId: "seed.2", entityType: "lineSegment", start: [10, 10], end: [0, 10] },
      { entityId: "offset.2", entityType: "lineSegment", start: [10, 12], end: [0, 12] },
    ],
    constraints: [
      relationship("MIRROR", "mirror-rel", [
        { parameterId: "localFirst", value: "seed" },
        { parameterId: "localSecond", value: "mirrored" },
        { parameterId: "localMirror", value: "mirror" },
      ]),
      relationship("LINEAR_PATTERN", "pattern-rel", [
        { parameterId: "localInstance0,0,0", value: "seed" },
        { parameterId: "localInstance0,0,1", value: "pattern.1" },
      ]),
      relationship("OFFSET", "offset-rel", [
        { parameterId: "localMaster", value: "seed" },
        { parameterId: "localOffset", value: "offset.1" },
        { parameterId: "localSecond", value: "seed.2" },
        { parameterId: "localSecondOffset", value: "offset.2" },
      ]),
    ],
  });

  expect(result.relationshipSummary.constraints).toEqual({ carried: 1, dropped: 0 });
  expect(result.relationshipSummary.derivations).toEqual({ carried: 2, dropped: 0 });
  expect(result.definition.derivedRelationships?.map((entry) => entry.kind)).toEqual([
    "mirror",
    "linearPattern",
  ]);
  const linearPattern = result.definition.derivedRelationships?.find(
    (entry) => entry.kind === "linearPattern",
  );
  expect(
    linearPattern?.kind === "linearPattern" && linearPattern.vector,
    "LINEAR_PATTERN vector should be derived from solved seed/output geometry, not hardcoded to zero.",
  ).toEqual([0, 20]);
  expect(result.definition.constraints).toContainEqual({
    constraintId: "constraint_sketch_derivations_offset_rel",
    kind: "equalOffset",
    label: "offset-rel",
    pairs: [
      {
        seedEntityId: "sketch_entity_sketch_derivations_seed",
        offsetEntityId: "sketch_entity_sketch_derivations_offset_1",
        side: "right",
      },
      {
        seedEntityId: "sketch_entity_sketch_derivations_seed_2",
        offsetEntityId: "sketch_entity_sketch_derivations_offset_2",
        side: "right",
      },
    ],
  });
  expect(validateSketchDefinition(result.definition).success).toBe(true);
});


test("groups Onshape linear-pattern local instances by entity slot and derives a nonzero vector", () => {
  const result = translateSketch({
    featureId: "sketch_linear_pattern_slots",
    label: "Linear pattern slots",
    planeKey: "xy",
    entities: [
      { entityId: "seedA", entityType: "lineSegment", start: [0, 0], end: [5, 0] },
      { entityId: "seedB", entityType: "point", position: [1, 1] },
      { entityId: "outA", entityType: "lineSegment", start: [4, 7], end: [9, 7] },
      { entityId: "outB", entityType: "point", position: [5, 8] },
    ],
    constraints: [
      relationship("LINEAR_PATTERN", "pattern-slots", [
        { parameterId: "localInstance10,0,1", value: "outB" },
        { parameterId: "localInstance2,0,0", value: "seedA" },
        { parameterId: "localInstance10,0,0", value: "seedB" },
        { parameterId: "localInstance2,0,1", value: "outA" },
      ]),
    ],
  });

  expect(result.relationshipSummary.derivations).toEqual({ carried: 1, dropped: 0 });
  const pattern = result.definition.derivedRelationships?.[0];
  expect(pattern?.kind).toBe("linearPattern");
  expect(pattern?.kind === "linearPattern" && pattern.vector).toEqual([4, 7]);
  expect(pattern?.outputs.map((output) => output.instanceIndex)).toEqual([1, 1]);
  expect(pattern?.outputs.map((output) => output.seedEntityId)).toEqual([
    "sketch_entity_sketch_linear_pattern_slots_seedB",
    "sketch_entity_sketch_linear_pattern_slots_seedA",
  ]);
});

test("remaps captured pattern helper axes into the probed face frame without dropping authored requirements", async () => {
  const translation = translateSketch({
    featureId: "FcPi2PXMdBYVGkq_1",
    label: "Sketch 2",
    plane: {
      support: { kind: "construction", constructionId: "construction_pattern_face" },
      frame: {
        origin: [52.5, 110.5, 191.392],
        xAxis: [0, -0.5, -0.866025],
        yAxis: [0.9999993006250001, 0, 0],
        normal: [0, -0.866025, 0.5],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
      key: null,
    },
    sourceFrame: {
      origin: [0, -6.009258394948636e-15, 3.4694469519536173e-15],
      xAxis: [1, 0, 0],
      yAxis: [0, 0.5000000000000004, 0.8660254037844385],
      normal: [0, -0.8660254037844385, 0.5000000000000004],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
    entities: [
      { entityId: "JpThTKh4sHM0.0", entityType: "circle", center: [201.00026379375163, -89.99993705625], radius: 3 },
      { entityId: "Lwf1pdanXeGN", entityType: "circle", center: [201.00026379375163, -89.99993705625], radius: 1.5 },
      { entityId: "HaWWOCY0Klnz.0.0.1", entityType: "circle", center: [170.00027463406664, -89.99993705625], radius: 3 },
      { entityId: "HaWWOCY0Klnz.1.0.1", entityType: "circle", center: [170.00027463406664, -89.99993705625], radius: 1.5 },
      { entityId: "HaWWOCY0Klnz.direction1", entityType: "lineSegment", start: [201.00026379375163, -89.99993705625], end: [201.00026379375163, -14.999989509375009], isConstruction: true },
      { entityId: "HaWWOCY0Klnz.direction2", entityType: "lineSegment", start: [201.00026379375163, -89.99993705625], end: [170.00027463406664, -89.99993705625], isConstruction: true },
    ],
    constraints: [
      relationship("COINCIDENT", "HaWWOCY0Klnz.originJoin", [
        { parameterId: "localFirst", value: "HaWWOCY0Klnz.direction1.start" },
        { parameterId: "localSecond", value: "HaWWOCY0Klnz.direction2.start" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
      relationship("HORIZONTAL", "HaWWOCY0Klnz.hv1", [
        { parameterId: "localFirst", value: "HaWWOCY0Klnz.direction1" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
      relationship("VERTICAL", "HaWWOCY0Klnz.hv2", [
        { parameterId: "localFirst", value: "HaWWOCY0Klnz.direction2" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
      relationship("COINCIDENT", "HaWWOCY0Klnz.len1.c1", [
        { parameterId: "localFirst", value: "HaWWOCY0Klnz.direction1.start" },
        { parameterId: "localSecond", value: "JpThTKh4sHM0.0.center" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
      relationship("COINCIDENT", "HaWWOCY0Klnz.len2.c1", [
        { parameterId: "localFirst", value: "HaWWOCY0Klnz.direction2.start" },
        { parameterId: "localSecond", value: "JpThTKh4sHM0.0.center" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
      relationship("COINCIDENT", "HaWWOCY0Klnz.len2.c2", [
        { parameterId: "localFirst", value: "HaWWOCY0Klnz.direction2.end" },
        { parameterId: "localSecond", value: "HaWWOCY0Klnz.0.0.1.center" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
      relationship("LINEAR_PATTERN", "HaWWOCY0Klnz.pattern", [
        { parameterId: "patternc1", expression: "1" },
        { parameterId: "patternc2", expression: "2" },
        { parameterId: "localInstance0,0,0", value: "JpThTKh4sHM0.0" },
        { parameterId: "localInstance2,0,0", value: "Lwf1pdanXeGN" },
        { parameterId: "localInstance0,0,1", value: "HaWWOCY0Klnz.0.0.1" },
        { parameterId: "localInstance2,0,1", value: "HaWWOCY0Klnz.1.0.1" },
        { parameterId: "localDirection1", value: "HaWWOCY0Klnz.direction1" },
        { parameterId: "localDirection2", value: "HaWWOCY0Klnz.direction2" },
        { parameterId: "sketchToolType", value: "PATTERN" },
      ]),
    ],
  });

  expect(translation.definition.constraints.map((constraint) => [constraint.label, constraint.kind])).toContainEqual([
    "HaWWOCY0Klnz.hv1",
    "vertical",
  ]);
  expect(translation.definition.constraints.map((constraint) => [constraint.label, constraint.kind])).toContainEqual([
    "HaWWOCY0Klnz.hv2",
    "horizontal",
  ]);
  const pattern = translation.definition.derivedRelationships?.find(
    (relationship) => relationship.kind === "linearPattern",
  );
  expect(pattern?.kind === "linearPattern" && {
    vector: pattern.vector,
    instanceCount: pattern.instanceCount,
    outputs: pattern.outputs.map((output) => output.outputEntityId),
  }).toEqual({
    vector: [-30.999989159684986, 0],
    instanceCount: 2,
    outputs: [
      "sketch_entity_FcPi2PXMdBYVGkq_1_HaWWOCY0Klnz_0_0_1",
      "sketch_entity_FcPi2PXMdBYVGkq_1_HaWWOCY0Klnz_1_0_1",
    ],
  });

  const delegate = new SketchConstraintSolverAdapter({
    documentId: "doc_pattern_frame",
    revisionId: "rev_pattern_frame",
  });
  const solveStates: string[] = [];
  let solvedPoints = new Map<string, readonly [number, number]>();
  const verified = await verifySketchTranslationSolveConsistency({
    solver: {
      solveSketch: async (request) => {
        const response = await delegate.solveSketch(request);
        solveStates.push(response.status.solveState);
        solvedPoints = new Map(
          response.solvedSnapshot.solvedPoints.map((point) => [
            point.pointId,
            point.solvedPosition,
          ]),
        );
        return response;
      },
    },
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_pattern_frame",
    revisionId: "rev_pattern_frame",
    sketchId: translation.definition.points[0]!.target.sketchId,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
  });

  expect(solveStates).toEqual(["solved"]);
  expect(verified.diagnostics).toEqual([]);
  expect(verified.definition.constraints).toHaveLength(6);
  expect(
    verified.definition.points
      .filter((point) => point.label.startsWith("HaWWOCY0Klnz.") && point.label.endsWith(".center"))
      .map((point) => point.position),
    "Both captured generated circle centers must remain at their captured target-frame positions.",
  ).toEqual([
    [170.00027463406664, -89.99993705625],
    [170.00027463406664, -89.99993705625],
  ]);
  for (const output of pattern?.kind === "linearPattern" ? pattern.outputs : []) {
    for (const pointId of output.outputPointIds) {
      expect(solvedPoints.get(pointId)?.[0]).toBeCloseTo(170.00027463406664, 8);
      expect(solvedPoints.get(pointId)?.[1]).toBeCloseTo(-89.99993705625, 8);
    }
  }
});

test("drops linear-pattern records when the translated vector is zero", () => {
  const result = translateSketch({
    featureId: "sketch_linear_pattern_zero",
    label: "Zero vector linear pattern",
    planeKey: "xy",
    entities: [
      { entityId: "seed", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      { entityId: "duplicate", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
    ],
    constraints: [
      relationship("LINEAR_PATTERN", "zero-pattern", [
        { parameterId: "localInstance0,0,0", value: "seed" },
        { parameterId: "localInstance0,0,1", value: "duplicate" },
      ]),
    ],
  });

  expect(result.relationshipSummary.derivations).toEqual({ carried: 0, dropped: 1 });
  expect(result.definition.derivedRelationships).toEqual([]);
  expect(result.diagnostics.at(-1)?.reason).toBe("linear pattern vector could not be derived from translated nonzero geometry");
});


test("binds external operands when projection geometry was imported", () => {
  const result = translateSketch({
    featureId: "sketch_external_projection",
    label: "External projection binding",
    planeKey: "xy",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      { entityId: "projected", entityType: "point", position: [0, 0], isConstruction: true },
    ],
    constraints: [
      relationship("COINCIDENT", "coincident-projection", [
        { parameterId: "localFirst", value: "line.start" },
        { parameterId: "externalSecond", value: "projected", hasExternalQuery: true },
      ]),
    ],
  });

  expect(result.relationshipSummary.constraints).toEqual({ carried: 1, dropped: 0 });
  expect(result.diagnostics).toEqual([]);
  expect(result.definition.constraints[0]?.kind).toBe("coincident");
});

test("retains both OFFSET pairs independently of partial, reversed, unrelated, or disagreeing dimensions", () => {
  const translate = (dimension: OnshapeSketchConstraint) => translateSketch({
    featureId: "sketch_offset_driver_roles",
    label: "Offset driver roles",
    planeKey: "xy",
    entities: [
      { entityId: "seed-a", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      { entityId: "offset-a", entityType: "lineSegment", start: [0, 3], end: [10, 3] },
      { entityId: "seed-b", entityType: "lineSegment", start: [10, 10], end: [0, 10] },
      { entityId: "offset-b", entityType: "lineSegment", start: [10, 13], end: [0, 13] },
    ],
    constraints: [
      dimension,
      relationship("OFFSET", "offset-relation", [
        { parameterId: "localMaster", value: "seed-a" },
        { parameterId: "localOffset", value: "offset-a" },
        { parameterId: "localSecond", value: "seed-b" },
        { parameterId: "localSecondOffset", value: "offset-b" },
      ]),
    ],
  });
  const dimensionRecord = (
    first: string,
    second: string,
    value: number,
    expression?: string,
  ) => relationship("DISTANCE", "candidate-driver", [
    { parameterId: "localFirst", value: first },
    { parameterId: "localSecond", value: second },
    { parameterId: "length", value, expression },
  ]);
  const assertPreserved = (result: ReturnType<typeof translate>) => {
    expect(result.definition.dimensions).toHaveLength(1);
    expect(result.relationshipSummary.constraints).toEqual({ carried: 1, dropped: 0 });
    expect(result.relationshipSummary.derivations).toEqual({ carried: 0, dropped: 0 });
    expect(result.definition.derivedRelationships).toEqual([]);
    expect(result.definition.constraints).toContainEqual({
      constraintId: "constraint_sketch_offset_driver_roles_offset_relation",
      kind: "equalOffset",
      label: "offset-relation",
      pairs: [
        {
          seedEntityId: "sketch_entity_sketch_offset_driver_roles_seed_a",
          offsetEntityId: "sketch_entity_sketch_offset_driver_roles_offset_a",
          side: "left",
        },
        {
          seedEntityId: "sketch_entity_sketch_offset_driver_roles_seed_b",
          offsetEntityId: "sketch_entity_sketch_offset_driver_roles_offset_b",
          side: "right",
        },
      ],
    });
  };

  for (const dimension of [
    dimensionRecord("seed-a", "offset-a", 0, "gap"),
    dimensionRecord("offset-a", "seed-a", 3),
    dimensionRecord("offset-a", "offset-b", 10),
    dimensionRecord("seed-a", "offset-a", 7),
  ]) {
    assertPreserved(translate(dimension));
  }
});

test("uses exact authored parameter direction before canonicalizing OFFSET seed endpoints", () => {
  const reversedSolvedStart = [0, 10] as const;
  const reversedSolvedEnd = [0, 0] as const;
  const rawSignedDistance = -3;
  const rawNormalizedDistance = rawSignedDistance * -1; // raw down seed classified right

  const result = translateSketch({
    featureId: "offset_endpoint_provenance",
    label: "Offset endpoint provenance",
    planeKey: "xy",
    entities: [
      { entityId: "bottom", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      {
        entityId: "top",
        entityType: "lineSegment",
        start: [0, 10],
        end: [10, 10],
        authoredParameterDirection: [10, 0],
      },
      {
        entityId: "left",
        entityType: "lineSegment",
        start: reversedSolvedStart,
        end: reversedSolvedEnd,
        authoredParameterDirection: [0, 10],
      },
      { entityId: "top-offset", entityType: "lineSegment", start: [0, 13], end: [10, 13] },
      { entityId: "left-offset", entityType: "lineSegment", start: [-3, 0], end: [-3, 10] },
    ],
    constraints: [
      relationship("COINCIDENT", "left-bottom", [
        { parameterId: "localFirst", value: "bottom.start" },
        { parameterId: "localSecond", value: "left.start" },
      ]),
      relationship("COINCIDENT", "left-top", [
        { parameterId: "localFirst", value: "top.start" },
        { parameterId: "localSecond", value: "left.end" },
      ]),
      relationship("OFFSET", "offset", [
        { parameterId: "localMaster", value: "top" },
        { parameterId: "localOffset", value: "top-offset" },
        { parameterId: "localSecond", value: "left" },
        { parameterId: "localSecondOffset", value: "left-offset" },
      ]),
    ],
  });

  expect([reversedSolvedStart, reversedSolvedEnd], "The solved payload is demonstrably opposite authored start→end.")
    .toEqual([[0, 10], [0, 0]]);
  const top = result.definition.entities.find((entity) => entity.label === "top");
  expect(top, "A solved line already in authored parameter order must remain unchanged.").toMatchObject({
    kind: "lineSegment",
    startPointId: "sketch_point_offset_endpoint_provenance_top_start",
    endPointId: "sketch_point_offset_endpoint_provenance_top_end",
  });
  const left = result.definition.entities.find((entity) => entity.label === "left");
  expect(left).toMatchObject({
    kind: "lineSegment",
    startPointId: "sketch_point_offset_endpoint_provenance_bottom_start",
    endPointId: "sketch_point_offset_endpoint_provenance_top_start",
  });
  const points = new Map<string, readonly [number, number]>(
    result.definition.points.map((point) => [point.pointId, point.position]),
  );
  expect(points.get("sketch_point_offset_endpoint_provenance_bottom_start")).toEqual([0, 0]);
  expect(points.get("sketch_point_offset_endpoint_provenance_top_start")).toEqual([0, 10]);
  const equalOffset = result.definition.constraints.find((constraint) => constraint.kind === "equalOffset");
  expect(equalOffset).toMatchObject({
    pairs: [
      { side: "left" },
      {
        seedEntityId: "sketch_entity_offset_endpoint_provenance_left",
        offsetEntityId: "sketch_entity_offset_endpoint_provenance_left_offset",
        side: "left",
      },
    ],
  });
  const canonicalSignedDistance = 3;
  expect(
    canonicalSignedDistance,
    "Flipping right→left with the proven endpoint reversal must preserve the physical west half-plane.",
  ).toBe(rawNormalizedDistance);
});

test("solve-consistency verifies complete mixed local/projected semantics", async () => {
  const translation = translateSketch({
    featureId: "sketch_projected_verification",
    label: "Projected verification",
    planeKey: "xy",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [0, 10] },
      { entityId: "point", entityType: "point", position: [5, 0] },
    ],
    externalReferences: new Map([["EDGE", {
      geometryKind: "lineSegment" as const,
      definition: {
        referenceId: "ref_projected_verification" as const,
        kind: "modelReference" as const,
        label: "Projected edge",
        projectionMode: "projectAlongPlaneNormal" as const,
        source: {
          kind: "topologyOf" as const,
          expectedKind: "edge" as const,
          capturedSignature: { entityClass: "edge" as const, geometryType: "line" },
          tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 },
          source: { consumerFeatureId: "sketch_projected_verification", parameterId: "externalSecond", deterministicId: "EDGE" },
        },
      },
      verificationGeometry: {
        kind: "lineSegment" as const,
        start3d: [0, 0, 0] as const,
        end3d: [0.01, 0, 0] as const,
      },
    }]]),
    constraints: [
      relationship("VERTICAL", "local-vertical", [
        { parameterId: "localFirst", value: "line" },
      ]),
      relationship("MIDPOINT", "projected-midpoint", [
        { parameterId: "localEntity1", value: "point" },
        {
          parameterId: "externalSecond",
          hasExternalQuery: true,
          queries: [{ deterministicIds: ["EDGE"], queryString: "" }],
        },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]!.target.sketchId;
  const seenProjectedReferenceCounts: number[] = [];
  const delegate = new SketchConstraintSolverAdapter({
    documentId: "doc_projected_verification",
    revisionId: "rev_projected_verification",
  });

  const verified = await verifySketchTranslationSolveConsistency({
    solver: {
      ...delegate,
      solveSketch: async (request) => {
        seenProjectedReferenceCounts.push(request.projectedReferences.length);
        return delegate.solveSketch(request);
      },
    },
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_projected_verification",
    revisionId: "rev_projected_verification",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    projectedReferences: translation.projectedReferences,
    relationshipSummary: translation.relationshipSummary,
  });

  expect(seenProjectedReferenceCounts.length).toBeGreaterThan(0);
  expect(seenProjectedReferenceCounts.every((count) => count === 1)).toBe(true);
  expect(verified.diagnostics).toEqual([]);
  expect(verified.definition.constraints.map((constraint) => constraint.kind)).toEqual([
    "vertical",
    "midpointProjectedLine",
  ]);

  await expect(verifySketchTranslationSolveConsistency({
    solver: delegate,
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_projected_verification",
    revisionId: "rev_projected_verification",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    projectedReferences: [],
    relationshipSummary: translation.relationshipSummary,
  })).rejects.toThrow("missing projected geometry for ref_projected_verification");
});

test("solve-consistency verification isolates and drops a bad translated relationship", async () => {
  const translation = translateSketch({
    featureId: "sketch_solve_consistency",
    label: "Solve consistency",
    planeKey: "xy",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
    ],
    constraints: [
      relationship("VERTICAL", "bad-vertical", [
        { parameterId: "localFirst", value: "line" },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]?.target.sketchId;
  expect(sketchId, "Translated points should carry the pending sketch id used by the pre-commit solver check.").toBeTruthy();

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_solve_consistency",
      revisionId: "rev_solve_consistency",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_solve_consistency",
    revisionId: "rev_solve_consistency",
    sketchId: sketchId!,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
  });

  expect(verified.definition.constraints).toEqual([]);
  expect(verified.relationshipSummary.constraints).toEqual({ carried: 0, dropped: 1 });
  expect(verified.diagnostics[0]?.code).toBe("onshape-sketch-solve-consistency-failed");
});


test("solve-consistency verifies equal-offset constraints with every other source relationship", async () => {
  const translation = translateSketch({
    featureId: "sketch_equal_offset_verification",
    label: "Invalid captured equal offset",
    planeKey: "xy",
    sourceSolveStatus: "WELL_DEFINED",
    entities: [
      { entityId: "seed-a", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      { entityId: "offset-a", entityType: "lineSegment", start: [0, 2], end: [10, 2] },
      { entityId: "seed-b", entityType: "lineSegment", start: [0, 10], end: [10, 10] },
      { entityId: "offset-b", entityType: "lineSegment", start: [0, 13], end: [10, 13] },
    ],
    constraints: [
      relationship("OFFSET", "unequal-offset", [
        { parameterId: "localMaster", value: "seed-a" },
        { parameterId: "localOffset", value: "offset-a" },
        { parameterId: "localSecond", value: "seed-b" },
        { parameterId: "localSecondOffset", value: "offset-b" },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]!.target.sketchId;

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_equal_offset_verification",
      revisionId: "rev_equal_offset_verification",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_equal_offset_verification",
    revisionId: "rev_equal_offset_verification",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
    sourceSolveStatus: translation.sourceSolveStatus,
  });

  expect(verified.definition.constraints.some((constraint) => constraint.kind === "equalOffset")).toBe(false);
  expect(verified.diagnostics).toContainEqual(expect.objectContaining({
    code: "onshape-sketch-solve-consistency-failed",
    relationshipKind: "equalOffset",
    operands: ["constraint_sketch_equal_offset_verification_unequal_offset"],
  }));
});

test("grounds disconnected rigid components independently", async () => {
  const translation = translateSketch({
    featureId: "sketch_disconnected_rigid_grounding",
    label: "Disconnected rigid lines",
    planeKey: "xy",
    sourceSolveStatus: "WELL_DEFINED",
    entities: [
      { entityId: "a", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
      { entityId: "b", entityType: "lineSegment", start: [100, 0], end: [110, 0] },
    ],
    constraints: [
      relationship("HORIZONTAL", "a-horizontal", [{ parameterId: "localFirst", value: "a" }]),
      relationship("LENGTH", "a-length", [
        { parameterId: "localFirst", value: "a" },
        { parameterId: "length", value: 10 },
      ]),
      relationship("HORIZONTAL", "b-horizontal", [{ parameterId: "localFirst", value: "b" }]),
      relationship("LENGTH", "b-length", [
        { parameterId: "localFirst", value: "b" },
        { parameterId: "length", value: 10 },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]!.target.sketchId;

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_disconnected_rigid_grounding",
      revisionId: "rev_disconnected_rigid_grounding",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_disconnected_rigid_grounding",
    revisionId: "rev_disconnected_rigid_grounding",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
    sourceSolveStatus: translation.sourceSolveStatus,
  });

  expect(
    verified.definition.constraints.filter((constraint) => constraint.kind === "fixPoint"),
    "Each disconnected rigid line has its own translation gauge.",
  ).toHaveLength(2);
  expect(verified.diagnostics).toEqual([
    expect.objectContaining({ code: "onshape-sketch-residual-mobility-grounded" }),
  ]);
});

test("grounds a free rigid component without anchoring projected-authority geometry", async () => {
  const translation = translateSketch({
    featureId: "sketch_mixed_authority_grounding",
    label: "Projected point and free line",
    planeKey: "xy",
    sourceSolveStatus: "WELL_DEFINED",
    entities: [
      { entityId: "datum-point", entityType: "point", position: [0, 0] },
      { entityId: "line", entityType: "lineSegment", start: [100, 0], end: [110, 0] },
    ],
    externalReferences: new Map([["PROJECTED_POINT", {
      geometryKind: "point" as const,
      definition: {
        referenceId: "ref_mixed_authority_point" as const,
        kind: "sketchReference" as const,
        label: "Projected authority",
        projectionMode: "useExistingCoplanarGeometry" as const,
        source: {
          kind: "sketchPoint" as const,
          sketchId: { kind: "sketchIdOf" as const, actionIndex: 0 },
          pointId: "sketch_point_authority" as const,
        },
      },
      verificationGeometry: {
        kind: "point" as const,
        position3d: [0, 0, 0] as const,
      },
    }]]),
    constraints: [
      relationship("COINCIDENT", "projected-anchor", [
        { parameterId: "localFirst", value: "datum-point" },
        {
          parameterId: "externalSecond",
          hasExternalQuery: true,
          queries: [{ deterministicIds: ["PROJECTED_POINT"], queryString: "" }],
        },
      ]),
      relationship("HORIZONTAL", "line-horizontal", [{ parameterId: "localFirst", value: "line" }]),
      relationship("LENGTH", "line-length", [
        { parameterId: "localFirst", value: "line" },
        { parameterId: "length", value: 10 },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]!.target.sketchId;

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_mixed_authority_grounding",
      revisionId: "rev_mixed_authority_grounding",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_mixed_authority_grounding",
    revisionId: "rev_mixed_authority_grounding",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    projectedReferences: translation.projectedReferences,
    relationshipSummary: translation.relationshipSummary,
    sourceSolveStatus: translation.sourceSolveStatus,
  });

  const anchors = verified.definition.constraints.filter(
    (constraint) => constraint.kind === "fixPoint",
  );
  expect(anchors).toHaveLength(1);
  expect(anchors[0]).toMatchObject({
    pointId: "sketch_point_sketch_mixed_authority_grounding_line_start",
  });
  expect(verified.diagnostics).toEqual([
    expect.objectContaining({ code: "onshape-sketch-residual-mobility-grounded" }),
  ]);
});

test("treats an unconstrained line as one deformable component without fixing both endpoints", async () => {
  const translation = translateSketch({
    featureId: "sketch_unconstrained_line_grounding",
    label: "Unconstrained line",
    planeKey: "xy",
    sourceSolveStatus: "WELL_DEFINED",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [10, 4] },
    ],
  });
  const sketchId = translation.definition.points[0]!.target.sketchId;

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_unconstrained_line_grounding",
      revisionId: "rev_unconstrained_line_grounding",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_unconstrained_line_grounding",
    revisionId: "rev_unconstrained_line_grounding",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
    sourceSolveStatus: translation.sourceSolveStatus,
  });

  expect(
    verified.definition.constraints.filter((constraint) => constraint.kind === "fixPoint"),
    "Entity incidence must keep free endpoints in one shape component.",
  ).toHaveLength(1);
  expect(verified.diagnostics).toEqual([
    expect.objectContaining({
      code: "onshape-sketch-residual-mobility",
      reason: "residual-rigid-rotation-after-grounding",
    }),
  ]);
});

test("grounds only rigid translation and leaves variable-driven shape freedom unlocked", async () => {
  const translation = translateSketch({
    featureId: "sketch_variable_shape_grounding",
    label: "Variable-length grounded line",
    planeKey: "xy",
    sourceSolveStatus: "WELL_DEFINED",
    entities: [
      { entityId: "line", entityType: "lineSegment", start: [0, 0], end: [10, 0] },
    ],
    constraints: [
      relationship("HORIZONTAL", "horizontal", [
        { parameterId: "localFirst", value: "line" },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]!.target.sketchId;

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_variable_shape_grounding",
      revisionId: "rev_variable_shape_grounding",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_variable_shape_grounding",
    revisionId: "rev_variable_shape_grounding",
    sketchId,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
    sourceSolveStatus: translation.sourceSolveStatus,
  });

  expect(
    verified.definition.constraints.filter((constraint) => constraint.kind === "fixPoint"),
    "The free line length is a shape degree of freedom, so grounding must not capture its second endpoint.",
  ).toHaveLength(1);
  expect(verified.definition.constraints).toHaveLength(2);
});

test("grounds residual rigid motion from dropped external anchors on a WELL_DEFINED source sketch", async () => {
  const translation = translateSketch({
    featureId: "sketch_well_defined_external_anchor",
    label: "Well-defined imported line",
    planeKey: "xy",
    sourceSolveStatus: "WELL_DEFINED",
    entities: [
      {
        entityId: "line",
        entityType: "lineSegment",
        start: [0, 0],
        end: [10, 0],
      },
    ],
    constraints: [
      relationship("HORIZONTAL", "horizontal", [
        { parameterId: "localFirst", value: "line" },
      ]),
      relationship("LENGTH", "length", [
        { parameterId: "localFirst", value: "line" },
        { parameterId: "length", value: 10 },
      ]),
      relationship("COINCIDENT", "external-anchor", [
        { parameterId: "externalFirst", hasExternalQuery: true },
        { parameterId: "localSecond", value: "line.start" },
      ]),
    ],
  });
  const sketchId = translation.definition.points[0]?.target.sketchId;
  expect(sketchId).toBeTruthy();

  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_well_defined_anchor",
      revisionId: "rev_well_defined_anchor",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_well_defined_anchor",
    revisionId: "rev_well_defined_anchor",
    sketchId: sketchId!,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
    sourceSolveStatus: translation.sourceSolveStatus,
  });

  expect(
    verified.definition.constraints.filter(
      (constraint) => constraint.kind === "fixPoint",
    ),
    "A single suitable point should ground this connected rigid sketch without blanket-fixing every point.",
  ).toHaveLength(1);
  expect(verified.diagnostics).toEqual([
    expect.objectContaining({
      code: "onshape-sketch-residual-mobility-grounded",
      reason: "source-well-defined-residual-mobility-grounded",
    }),
  ]);
  expect(validateSketchDefinition(verified.definition).success).toBe(true);
});

test("does not forge a generative derivation for an OFFSET outside the equal-line-pair contract", () => {
  const result = translateSketch({
    featureId: "sketch_circle_offset",
    label: "Circle offset",
    planeKey: "xy",
    entities: [
      { entityId: "seed_circle", entityType: "circle", center: [0, 0], radius: 0.9 },
      { entityId: "offset_circle", entityType: "circle", center: [0, 0], radius: 2.4 },
    ],
    constraints: [
      relationship("OFFSET", "circle-offset-rel", [
        { parameterId: "localMaster", value: "seed_circle" },
        { parameterId: "localOffset", value: "offset_circle" },
      ]),
    ],
  });

  expect(result.definition.derivedRelationships).toEqual([]);
  expect(result.definition.constraints).toEqual([]);
  expect(result.relationshipSummary.constraints).toEqual({ carried: 0, dropped: 1 });
  expect(result.diagnostics.at(-1)).toMatchObject({
    relationshipKind: "OFFSET",
    reason: "equal offset requires two resolved non-coincident local line pairs",
  });
});

test("Onshape DISTANCE against a circle is dropped instead of forging a line dimension", () => {
  // `lineDistance`/`linePointDistance` accept only line segments; the solver
  // rejects anything else and fails the entire sketch. Onshape's radial-gap
  // DISTANCE has no Cadara equivalent, so it must degrade honestly.
  const result = translateSketch({
    featureId: "sketch_circle_distance",
    label: "Circle distance",
    planeKey: "xy",
    entities: [
      { entityId: "inner", entityType: "circle", center: [0, 0], radius: 1 },
      { entityId: "outer", entityType: "circle", center: [0, 0], radius: 3 },
      { entityId: "edge", entityType: "lineSegment", start: [0, 10], end: [10, 10] },
    ],
    constraints: [
      relationship("DISTANCE", "circle-to-circle", [
        { parameterId: "localFirst", value: "inner" },
        { parameterId: "localSecond", value: "outer" },
        { parameterId: "length", value: 2 },
      ]),
      relationship("DISTANCE", "point-to-circle", [
        { parameterId: "localFirst", value: "edge.end" },
        { parameterId: "localSecond", value: "outer" },
        { parameterId: "length", value: 2 },
      ]),
    ],
  });

  expect(result.definition.dimensions ?? []).toEqual([]);
  expect(result.relationshipSummary.dimensions.dropped).toBe(2);
  expect(
    result.definition.entities.length,
    "Dropping unsupported dimensions must not drop the translated geometry.",
  ).toBe(3);
  expect(validateSketchDefinition(result.definition).success).toBe(true);
});
