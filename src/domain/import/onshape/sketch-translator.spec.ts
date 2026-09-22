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
  parameters: readonly { parameterId: string; value?: string | number; expression?: string; hasExternalQuery?: boolean }[],
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

test("translates mirror, linear-pattern, and offset derivation records", () => {
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
        { parameterId: "halfSpace0", value: "RIGHT" },
      ]),
    ],
  });

  expect(result.relationshipSummary.derivations).toEqual({ carried: 3, dropped: 0 });
  expect(result.definition.derivedRelationships?.map((entry) => entry.kind)).toEqual([
    "mirror",
    "linearPattern",
    "offset",
  ]);
  const linearPattern = result.definition.derivedRelationships?.find(
    (entry) => entry.kind === "linearPattern",
  );
  expect(
    linearPattern?.kind === "linearPattern" && linearPattern.vector,
    "LINEAR_PATTERN vector should be derived from solved seed/output geometry, not hardcoded to zero.",
  ).toEqual([0, 20]);
  const offset = result.definition.derivedRelationships?.find(
    (entry) => entry.kind === "offset",
  );
  expect(
    offset?.kind === "offset" && offset.distance,
    "OFFSET distance should be normalized from translated seed/output geometry, not hardcoded to zero.",
  ).toEqual({ source: "literal", value: -2 });
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

test("a circle OFFSET carries the shrink-positive distance the offset contract expects", () => {
  // The offset contract measures to the LEFT of traversal, so a
  // counter-clockwise circle shrinks under a positive distance. Reporting the
  // raw radius delta inverts the sign and makes an authored outward offset
  // collapse the circle at solve time.
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

  const offset = result.definition.derivedRelationships?.find(
    (entry) => entry.kind === "offset",
  );
  expect(
    offset?.kind === "offset" && offset.distance,
    "Growing a circle must yield a negative offset distance under the left-of-travel contract.",
  ).toEqual({ source: "literal", value: -1.5 });
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
