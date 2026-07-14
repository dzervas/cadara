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
