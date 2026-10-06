import { expect, test } from "vitest";

import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  isExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { DocumentVariableRecord } from "@/contracts/modeling/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { normalizeDimensionDefinitionCore } from "@/domain/modeling/modeling-service/sketch-definition-normalization";
import {
  resolveSketchDerivationDistances,
  resolveSketchDimensionValues,
} from "@/domain/modeling/sketch-dimension-expressions";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  makeReferenceDimensionCases,
  makeReferenceDimensionSketch,
  withDimensions,
} from "@/contracts/sketch/reference-dimension.fixtures";

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
    modelingTolerance: 1e-3,
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
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
  expect(
    resolvedSolve.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("residual NaN"),
    ),
    "Resolved dimensions must not produce a NaN solver residual.",
  ).toBe(false);
});

test("src/domain/modeling/sketch-dimension-expressions.spec.ts offset derivation distances", () => {
  const variables: DocumentVariableRecord[] = [
    { variableId: "variable_wall", name: "wall", valueText: "3" },
  ];
  const definition: SketchDefinition = {
    ...createSketchDefinition({ dimensions: [] }),
    derivedRelationships: [
      {
        derivationId: "sketch_derivation_1_offset",
        label: "offset 1",
        kind: "offset",
        seedEntityIds: ["entity_line" as never],
        distance: createExpressionAuthoredValue("wall / 2"),
        jointPolicy: "trimExtendArcFallback",
        piecewiseCubicOutputs: [],
        jointOutputs: [],
        outputs: [],
      },
    ],
  };

  const resolved = resolveSketchDerivationDistances({ definition, variables });
  const relationship = resolved.derivedRelationships?.[0];
  expect(
    relationship?.kind === "offset" && relationship.distance,
    "Offset derivation expression distances should resolve against document variables.",
  ).toBe(1.5);
  expect(
    definition.derivedRelationships?.[0]?.kind === "offset" &&
      isExpressionAuthoredValue(definition.derivedRelationships[0].distance),
    "Resolution should not mutate the authored definition.",
  ).toBeTruthy();

  const unresolved = resolveSketchDerivationDistances({
    definition,
    variables: [],
  });
  const unresolvedRelationship = unresolved.derivedRelationships?.[0];
  expect(
    unresolvedRelationship?.kind === "offset" &&
      isExpressionAuthoredValue(unresolvedRelationship.distance),
    "Distances that fail to resolve should stay authored so the evaluator can diagnose them.",
  ).toBeTruthy();

  const composed = resolveSketchDimensionValues({ definition, variables });
  expect(
    composed.ok &&
      composed.definition.derivedRelationships?.[0]?.kind === "offset" &&
      composed.definition.derivedRelationships[0].distance,
    "The dimension resolution path should also resolve derivation distances.",
  ).toBe(1.5);
});

// T13d (D9, R-1), logic lane: the modeling-service normalization rebuilds
// dimensions field by field; it must carry `reference` for every numeric
// kind and reject mixed shapes. Expression resolution skips references.
test("T13d R-1: normalization keeps reference dimensions of every numeric kind and rejects invalid shapes", () => {
  for (const entry of makeReferenceDimensionCases()) {
    expect(
      normalizeDimensionDefinitionCore(
        JSON.parse(JSON.stringify(entry.reference)),
      ),
      `${entry.name}: the reference round-trips exactly`,
    ).toEqual(entry.reference);
    const driving = normalizeDimensionDefinitionCore(
      JSON.parse(JSON.stringify(entry.driving)),
    );
    expect("reference" in driving, `${entry.name}: driving stays driving`).toBe(
      false,
    );
    const valueKey =
      entry.driving.kind === "lineAngle" ? "valueRadians" : "value";
    expect(
      (driving as Record<string, unknown>)[valueKey],
      `${entry.name}: the driving value is kept`,
    ).toEqual(
      createLiteralAuthoredValue(
        (entry.driving as Record<string, number>)[valueKey]!,
      ),
    );
    // D9′ (review A-2/A-3): a kept value normalizes with the marker; an
    // explicitly undefined value is no value.
    expect(
      normalizeDimensionDefinitionCore({ ...entry.reference, [valueKey]: 1 }),
      `${entry.name}: a reference keeping a value normalizes`,
    ).toMatchObject({
      reference: true,
      [valueKey]: createLiteralAuthoredValue(1),
    });
    expect(
      normalizeDimensionDefinitionCore({
        ...entry.reference,
        [valueKey]: undefined,
      }),
      `${entry.name}: { reference: true, value: undefined } normalizes`,
    ).toEqual(entry.reference);
    for (const [shape, payload] of [
      [
        "neither a value nor the marker",
        { ...entry.reference, reference: undefined },
      ],
      ["reference: false", { ...entry.reference, reference: false }],
      ["reference: false with a value", { ...entry.driving, reference: false }],
      ["reference: 'yes'", { ...entry.reference, reference: "yes" }],
    ] as const)
      expect(
        () => normalizeDimensionDefinitionCore(payload),
        `${entry.name}: ${shape} is rejected`,
      ).toThrow();
  }
  expect(() =>
    normalizeDimensionDefinitionCore({
      dimensionId: "dimension_arc_start",
      kind: "arcStartPointCoincident",
      label: "Arc start",
      entityId: "sketch_entity_arc",
      pointId: "sketch_point_g",
      reference: true,
    }),
  ).toThrow(/arc endpoint bindings cannot be reference/);
});

test("T13d R-1: expression resolution skips reference dimensions and still resolves driving ones", () => {
  const cases = makeReferenceDimensionCases();
  const references = cases.map((entry) => entry.reference);
  const width = normalizeDimensionDefinitionCore({
    dimensionId: "dimension_width_expr",
    kind: "lineLength",
    label: "Width",
    entityId: "sketch_entity_bottom",
    value: createExpressionAuthoredValue("width"),
  });
  const resolved = resolveSketchDimensionValues({
    definition: withDimensions(makeReferenceDimensionSketch(), [
      ...references,
      width,
    ]),
    variables: [
      { variableId: "variable_width", name: "width", valueText: "4" },
    ],
  });
  expect(resolved.ok, "references need no value to resolve").toBe(true);
  if (!resolved.ok) return;
  expect(resolved.definition.dimensions.slice(0, -1)).toEqual(references);
  expect(resolved.definition.dimensions.at(-1)).toMatchObject({ value: 4 });
});

function createSketchDefinition(input: {
  dimensions: SketchDefinition["dimensions"];
}): SketchDefinition {
  return {
    schemaVersion: "sketch-definition/v1alpha2",
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
