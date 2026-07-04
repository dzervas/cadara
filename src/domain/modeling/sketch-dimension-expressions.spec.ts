import { expect, test } from "vitest";

import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  isExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { DocumentVariableRecord } from "@/contracts/modeling/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { normalizeDimensionDefinitionCore } from "@/domain/modeling/modeling-service/sketch-definition-normalization";
import { resolveSketchDimensionValues } from "@/domain/modeling/sketch-dimension-expressions";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";

test("src/domain/modeling/sketch-dimension-expressions.spec.ts", () => {
  const variables: DocumentVariableRecord[] = [
    { variableId: "variable_width", name: "width", valueText: "12" },
    { variableId: "variable_gap", name: "gap", valueText: "3" },
  ];

  const definition = createSketchDefinition({
    dimensions: [
      normalizeDimensionDefinitionCore({
        dimensionId: "dimension_width",
        kind: "distance",
        label: "Width",
        axis: "aligned",
        pointIds: ["point_a", "point_b"],
        value: 10,
      }),
      normalizeDimensionDefinitionCore({
        dimensionId: "dimension_expr",
        kind: "lineLength",
        label: "Length",
        entityId: "entity_line",
        value: createExpressionAuthoredValue("width + gap"),
      }),
    ],
  });

  const legacy = definition.dimensions[0];
  expect(
    legacy.kind === "distance" && legacy.value,
    "Legacy numeric dimension values should normalize to authored literal wrappers.",
  ).toEqual(createLiteralAuthoredValue(10));

  const expression = definition.dimensions[1];
  expect(
    expression.kind === "lineLength" && isExpressionAuthoredValue(expression.value),
    "Expression-authored dimension values should preserve raw text through normalization.",
  ).toBeTruthy();

  const resolved = resolveSketchDimensionValues({ definition, variables });
  expect(resolved.ok, "Expression-authored dimensions should resolve successfully.").toBe(
    true,
  );
  if (!resolved.ok) return;

  expect(
    resolved.definition.dimensions[0]?.kind === "distance" &&
      resolved.definition.dimensions[0].value,
  ).toBe(10);
  expect(
    resolved.definition.dimensions[1]?.kind === "lineLength" &&
      resolved.definition.dimensions[1].value,
  ).toBe(15);
});

test("src/domain/modeling/sketch-dimension-expressions.spec.ts invalid expression", () => {
  const definition = createSketchDefinition({
    dimensions: [
      normalizeDimensionDefinitionCore({
        dimensionId: "dimension_bad",
        kind: "circleRadius",
        label: "Radius",
        entityId: "entity_circle",
        value: createExpressionAuthoredValue("missing + 1"),
      }),
    ],
  });

  const resolved = resolveSketchDimensionValues({ definition, variables: [] });
  expect(resolved.ok, "Unresolved symbols should block solver-boundary resolution.").toBe(
    false,
  );
  if (resolved.ok) return;

  expect(resolved.diagnostics[0]?.code).toBe(
    "sketch-dimension-expression-unresolved-symbol",
  );
  expect(
    definition.dimensions[0]?.kind === "circleRadius" &&
      isExpressionAuthoredValue(definition.dimensions[0].value),
    "Failed resolution must leave the authored expression intact.",
  ).toBeTruthy();
});

test("src/domain/modeling/sketch-dimension-expressions.spec.ts solver boundary receives concrete numbers", () => {
  const variables: DocumentVariableRecord[] = [
    { variableId: "variable_width", name: "width", valueText: "12" },
  ];
  const definition = createSketchDefinition({
    dimensions: [
      normalizeDimensionDefinitionCore({
        dimensionId: "dimension_width",
        kind: "distance",
        label: "Width",
        axis: "aligned",
        pointIds: ["point_a", "point_b"],
        value: createExpressionAuthoredValue("width"),
      }),
    ],
  });

  // Reproduction: handing the authored expression wrapper straight to the
  // numeric solver yields a NaN residual because arithmetic runs on an object.
  const unresolvedSolve = solveSketchDefinitionCore({
    definition: definition as never,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  expect(
    unresolvedSolve.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("residual NaN"),
    ),
    "Passing an unresolved expression dimension to the solver reproduces the NaN residual.",
  ).toBe(true);

  // Fix: resolving first gives the solver concrete numeric dimension values.
  const resolved = resolveSketchDimensionValues({ definition, variables });
  expect(resolved.ok, "Expression dimension should resolve for the solver.").toBe(true);
  if (!resolved.ok) return;

  const resolvedSolve = solveSketchDefinitionCore({
    definition: resolved.definition,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  expect(
    resolvedSolve.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("residual NaN"),
    ),
    "Resolved dimensions must not produce a NaN solver residual.",
  ).toBe(false);
});

function createSketchDefinition(input: {
  dimensions: SketchDefinition["dimensions"];
}): SketchDefinition {
  return {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: ["point_a", "point_b"],
    points: [
      {
        pointId: "point_a",
        label: "A",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_1",
          pointId: "point_a",
        },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "point_b",
        label: "B",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_1",
          pointId: "point_b",
        },
        position: [1, 0],
        isConstruction: false,
      },
    ],
    entityIds: ["entity_line", "entity_circle"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "entity_line",
        label: "Line",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_1",
          entityId: "entity_line",
        },
        isConstruction: false,
        startPointId: "point_a",
        endPointId: "point_b",
      },
      {
        kind: "circle",
        entityId: "entity_circle",
        label: "Circle",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_1",
          entityId: "entity_circle",
        },
        isConstruction: false,
        centerPointId: "point_a",
        radius: 1,
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: input.dimensions.map((dimension) => dimension.dimensionId),
    dimensions: input.dimensions,
  };
}
