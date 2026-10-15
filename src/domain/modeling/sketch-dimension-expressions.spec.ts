import { expect, test } from "vitest";

import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  isExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { DocumentVariableRecord } from "@/contracts/modeling/schema";
import type {
  DimensionDefinition,
  SketchDefinition,
  SketchOffsetAuthoredDistance,
} from "@/contracts/sketch/schema";
import { requireSketchDefinition } from "@/contracts/sketch/runtime-schema";
import {
  evaluateAuthoredSketchDerivations,
  resolveSketchDerivationDistances,
  resolveSketchDimensionValues,
} from "@/domain/modeling/sketch-dimension-expressions";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import {
  getSketchSessionDisplayDefinition,
  rebuildSessionCommitRequest,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  beginSketchTool,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
} from "@/domain/editor/sketch-session";
import { getSketchEditOperatorResult } from "@/domain/editor/sketch-session/editing";
import { applyOffsetPublications } from "@/contracts/sketch/offset-publication";
import {
  offsetSeedSession,
  withOffset,
} from "@/domain/editor/sketch-offset.fixtures";
import { eid } from "@/domain/editor/sketch-mirror.fixtures";
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

  const definition = parsedSketchDefinition([
    {
      dimensionId: "dimension_width",
      kind: "distance",
      label: "Width",
      axis: "aligned",
      pointIds: ["sketch_point_a", "sketch_point_b"],
      value: createLiteralAuthoredValue(10),
    },
    {
      dimensionId: "dimension_expr",
      kind: "lineLength",
      label: "Length",
      entityId: "sketch_entity_line",
      value: createExpressionAuthoredValue("width + gap"),
    },
  ]);

  // T17o (E2): the hand normalizer and its bare-number → literal wrapper
  // conversion are deleted; authored literals survive the persistence
  // boundary (Typia) as they are.
  const literal = definition.dimensions[0];
  expect(
    literal.kind === "distance" && literal.value,
    "Literal dimension values survive the persistence boundary as authored literal wrappers.",
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
  const definition = parsedSketchDefinition([
    {
      dimensionId: "dimension_bad",
      kind: "circleRadius",
      label: "Radius",
      entityId: "sketch_entity_circle",
      value: createExpressionAuthoredValue("missing + 1"),
    },
  ]);

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
  const definition = parsedSketchDefinition([
    {
      dimensionId: "dimension_width",
      kind: "distance",
      label: "Width",
      axis: "aligned",
      pointIds: ["sketch_point_a", "sketch_point_b"],
      value: createExpressionAuthoredValue("width"),
    },
  ]);

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
        seedEntityIds: ["sketch_entity_line" as never],
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
  // T17p3: the resolved view holds numbers only; an unresolved distance is
  // `NaN`, which the evaluator diagnoses.
  expect(
    unresolvedRelationship?.kind === "offset" &&
      Number.isNaN(unresolvedRelationship.distance),
    "Distances that fail to resolve should be NaN so the evaluator can diagnose them.",
  ).toBe(true);

  const composed = resolveSketchDimensionValues({ definition, variables });
  expect(
    composed.ok &&
      composed.definition.derivedRelationships?.[0]?.kind === "offset" &&
      composed.definition.derivedRelationships[0].distance,
    "The dimension resolution path should also resolve derivation distances.",
  ).toBe(1.5);
});

// T13d (D9, R-1), logic lane: the persistence boundary must carry
// `reference` for every numeric kind and reject mixed shapes. Expression
// resolution skips references. T17o (E2): ported from the deleted hand
// normalizer to the Typia persistence validator (the dimension is parsed
// inside its sketch definition); a value is kept as authored (no
// bare-number → literal wrapper conversion any more).
test("T13d R-1: normalization keeps reference dimensions of every numeric kind and rejects invalid shapes", () => {
  const parseDimension = (dimension: unknown) =>
    requireSketchDefinition(
      withDimensions(makeReferenceDimensionSketch(), [
        dimension as DimensionDefinition,
      ]),
    ).dimensions[0]!;
  for (const entry of makeReferenceDimensionCases()) {
    expect(
      parseDimension(JSON.parse(JSON.stringify(entry.reference))),
      `${entry.name}: the reference round-trips exactly`,
    ).toEqual(entry.reference);
    const driving = parseDimension(JSON.parse(JSON.stringify(entry.driving)));
    expect("reference" in driving, `${entry.name}: driving stays driving`).toBe(
      false,
    );
    const valueKey =
      entry.driving.kind === "lineAngle" ? "valueRadians" : "value";
    expect(
      (driving as Record<string, unknown>)[valueKey],
      `${entry.name}: the driving value is kept`,
    ).toEqual((entry.driving as Record<string, unknown>)[valueKey]!);
    // D9′ (review A-2/A-3): a kept value parses with the marker; an
    // explicitly undefined value is no value.
    expect(
      parseDimension({
        ...entry.reference,
        [valueKey]: createLiteralAuthoredValue(1),
      }),
      `${entry.name}: a reference keeping a value parses`,
    ).toMatchObject({
      reference: true,
      [valueKey]: createLiteralAuthoredValue(1),
    });
    expect(
      parseDimension({
        ...entry.reference,
        [valueKey]: undefined,
      }),
      `${entry.name}: { reference: true, value: undefined } parses`,
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
        () => parseDimension(payload),
        `${entry.name}: ${shape} is rejected`,
      ).toThrow();
  }
  expect(() =>
    parseDimension({
      dimensionId: "dimension_arc_start",
      kind: "arcStartPointCoincident",
      label: "Arc start",
      entityId: "sketch_entity_arc",
      pointId: "sketch_point_g",
      reference: true,
    }),
  ).toThrow(/`reference` is not defined/);
});

test("T13d R-1: expression resolution skips reference dimensions and still resolves driving ones", () => {
  const cases = makeReferenceDimensionCases();
  const references = cases.map((entry) => entry.reference);
  const width: DimensionDefinition = {
    dimensionId: "dimension_width_expr" as DimensionDefinition["dimensionId"],
    kind: "lineLength",
    label: "Width",
    entityId: "sketch_entity_bottom" as never,
    value: createExpressionAuthoredValue("width"),
  };
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

// T17p3, logic lane, domain seam: the resolve boundary of offset distances
// (`resolveSketchDerivationDistances`, `evaluateAuthoredSketchDerivations`)
// and the editor's solve boundary (`rebuildSessionForDefinition`). An offset
// distance is stored only as an authored wrapper; an expression one resolves
// against the document variables and drives the offset exactly as the same
// literal does, while the authored expression is kept.
test("T17p3: an expression offset distance still drives its offset, through derivation and the live solve", () => {
  const variables: DocumentVariableRecord[] = [
    { variableId: "variable_wall", name: "wall", valueText: "3" },
  ];
  const { session, relationship } = withOffset(
    offsetSeedSession(),
    [eid("free")],
    1,
  );
  expect(
    relationship.distance,
    "premise: the Offset tool authored a literal wrapper",
  ).toEqual(createLiteralAuthoredValue(0.5));
  const withDistance = (distance: SketchOffsetAuthoredDistance) =>
    requireSketchDefinition(
      JSON.parse(
        JSON.stringify({
          ...session.definition,
          derivedRelationships: session.definition.derivedRelationships!.map(
            (entry) =>
              entry.derivationId === relationship.derivationId
                ? { ...entry, distance }
                : entry,
          ),
        }),
      ),
    );
  const expression = withDistance(createExpressionAuthoredValue("wall / 2"));
  const literal = withDistance(createLiteralAuthoredValue(1.5));
  const outputPointIds = relationship.outputs[0]!.outputPointIds;
  const positions = (definition: SketchDefinition) =>
    outputPointIds.map(
      (pointId) =>
        definition.points.find((point) => point.pointId === pointId)!.position,
    );
  const evaluate = (
    definition: SketchDefinition,
    documentVariables: readonly DocumentVariableRecord[],
  ) =>
    evaluateAuthoredSketchDerivations({
      definition,
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      documentVariables,
    });

  const fromLiteral = evaluate(literal, []);
  const fromExpression = evaluate(expression, variables);
  expect(fromExpression.offsetFailures, "the expression resolves").toEqual([]);
  expect(
    positions(fromExpression.definition),
    "wall / 2 drives the offset exactly as the literal 1.5",
  ).toEqual(positions(fromLiteral.definition));
  expect(
    positions(fromExpression.definition),
    "non-vacuous: the outputs moved off the 0.5 offset",
  ).not.toEqual(positions(session.definition));
  expect(
    fromExpression.definition.derivedRelationships,
    "the evaluated definition keeps the authored expression",
  ).toEqual(expression.derivedRelationships);

  const unresolved = evaluate(expression, []);
  expect(
    unresolved.offsetFailures.map((failure) => failure.diagnostic.code),
    "without its variable the distance is unresolved",
  ).toEqual(["derived-offset-unresolved-distance"]);
  expect(
    positions(unresolved.definition),
    "an unresolved offset keeps its outputs",
  ).toEqual(positions(expression));

  // The live solve gets the resolved number and solves the outputs there.
  const solved = rebuildSessionForDefinition(
    { ...session, documentVariables: variables },
    { definition: expression },
  );
  const solvedPositions = outputPointIds.map(
    (pointId) =>
      solved.liveSolve?.solvedSnapshot.solvedPoints.find(
        (point) => point.pointId === pointId,
      )?.solvedPosition,
  );
  expect(
    solved.liveSolve?.solvedSnapshot.status.solveState,
    "the live solve of the expression offset is solved",
  ).toBe("solved");
  expect(
    solvedPositions,
    "the live solve places the outputs at wall / 2",
  ).toEqual(positions(fromLiteral.definition));
});

/**
 * T17p3 review R-1 / A-1 shared setup: one production-built offset of the
 * free line, whose stored distance is replaced by `distance` (parsed by the
 * persistence validator), in a session with `variables`.
 */
function expressionOffsetSession(
  distance: SketchOffsetAuthoredDistance,
  variables: readonly DocumentVariableRecord[],
) {
  const { session, relationship } = withOffset(
    offsetSeedSession(),
    [eid("free")],
    1,
  );
  const definition = requireSketchDefinition(
    JSON.parse(
      JSON.stringify({
        ...session.definition,
        derivedRelationships: session.definition.derivedRelationships!.map(
          (entry) =>
            entry.derivationId === relationship.derivationId
              ? { ...entry, distance }
              : entry,
        ),
      }),
    ),
  );
  const outputPointIds = relationship.outputs[0]!.outputPointIds;
  return {
    session: rebuildSessionForDefinition(
      { ...session, documentVariables: [...variables] },
      { definition },
    ),
    relationship,
    positions: (current: SketchDefinition) =>
      outputPointIds.map(
        (pointId) =>
          current.points.find((point) => point.pointId === pointId)!.position,
      ),
  };
}

const WALL: DocumentVariableRecord[] = [
  { variableId: "variable_wall", name: "wall", valueText: "3" },
];

// T17p3 review R-1, logic lane, domain seam: the editor's display
// (`getSketchSessionDisplayDefinition`) and commit request
// (`rebuildSessionCommitRequest`). Both evaluate the authored definition
// with the variables carried by `getSketchSessionDerivationSettings`: an
// expression offset's outputs sit where the same literal puts them, and the
// expression stays stored. Red when the settings drop the variables (the
// outputs stay held and the commit persists stale geometry).
test("T17p3 R-1: the display and the commit request place an expression offset's outputs at its evaluated distance and keep the expression stored", () => {
  const expression = createExpressionAuthoredValue("wall / 2");
  const expressionCase = expressionOffsetSession(expression, WALL);
  const literalCase = expressionOffsetSession(
    createLiteralAuthoredValue(1.5),
    [],
  );
  const { session, relationship, positions } = expressionCase;
  const expected = literalCase.positions(
    getSketchSessionDisplayDefinition(literalCase.session),
  );
  expect(
    expected,
    "premise: the literal 1.5 moves the outputs off the authored 0.5 ones",
  ).not.toEqual(positions(session.definition));

  const display = getSketchSessionDisplayDefinition(session);
  expect(positions(display), "display: outputs at wall / 2").toEqual(expected);

  const committed = rebuildSessionCommitRequest(
    session,
    session.definition,
  )!.definition;
  expect(
    positions(committed),
    "commit request: outputs at wall / 2 (never the held positions)",
  ).toEqual(expected);
  expect(
    committed.derivedRelationships?.find(
      (entry) => entry.derivationId === relationship.derivationId,
    ),
    "commit request: the expression stays stored",
  ).toMatchObject({ kind: "offset", distance: expression });
  expect(
    requireSketchDefinition(JSON.parse(JSON.stringify(committed)))
      .derivedRelationships,
    "the committed definition passes the persistence validator unchanged",
  ).toEqual(committed.derivedRelationships);
});

// T17p3 review A-1, logic lane, domain seam: the derived-transform tool
// preview (`getSketchEditOperatorResult`, Linear Pattern). A copy of an
// expression offset's output is previewed from the output evaluated with
// the session's variables, exactly as from the same literal. Red when the
// editor passes no variables to the tool builders (the copy follows the
// held output). The publication round is applied as certified (as the live
// derive effect does once it certifies) so the output may be a tool input.
test("T17p3 A-1: a tool preview copies an expression offset's output from its position at the evaluated distance", () => {
  const preview = (
    distance: SketchOffsetAuthoredDistance,
    variables: readonly DocumentVariableRecord[],
  ) => {
    const { session, relationship } = expressionOffsetSession(
      distance,
      variables,
    );
    const live = session.liveSolve!;
    expect(
      live.solvedSnapshot.status.solveState,
      "premise: the live solve is solved",
    ).toBe("solved");
    const certified = {
      ...session,
      liveSolve: {
        ...live,
        solvedSnapshot: applyOffsetPublications(
          live.definition,
          live.solvedSnapshot,
          [{ derivationId: relationship.derivationId, status: "certified" }],
        ),
      },
    };
    const output = relationship.outputs[0]!.outputEntityId;
    let tool = beginSketchTool(certified, "sketchLinearPattern");
    tool = selectSketchEditToolTarget(tool, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: output,
    } as never);
    tool = patchSketchEditToolValue(tool, { value: 20 });
    const result = getSketchEditOperatorResult(tool, tool.activeEditTool!);
    expect(result.valid, result.message ?? "premise: a valid preview").toBe(
      true,
    );
    return result.contribution!.points.map((point) => point.position);
  };
  const fromLiteral = preview(createLiteralAuthoredValue(1.5), []);
  expect(
    preview(createExpressionAuthoredValue("wall / 2"), WALL),
    "the copy of the expression offset's output is the copy at wall / 2",
  ).toEqual(fromLiteral);
  expect(
    fromLiteral,
    "non-vacuous: the copy differs from the copy of the 0.5 output",
  ).not.toEqual(preview(createLiteralAuthoredValue(0.5), []));
});

/** T17o (E2): the definition as the persistence boundary (Typia) parses it. */
function parsedSketchDefinition(dimensions: readonly unknown[]) {
  return requireSketchDefinition(
    createSketchDefinition({
      dimensions: dimensions as SketchDefinition["dimensions"],
    }),
  );
}

function createSketchDefinition(input: {
  dimensions: SketchDefinition["dimensions"];
}): SketchDefinition {
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b"],
    points: [
      {
        pointId: "sketch_point_a",
        label: "A",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_1",
          pointId: "sketch_point_a",
        },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_b",
        label: "B",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_1",
          pointId: "sketch_point_b",
        },
        position: [1, 0],
        isConstruction: false,
      },
    ],
    entityIds: ["sketch_entity_line", "sketch_entity_circle"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_line",
        label: "Line",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_1",
          entityId: "sketch_entity_line",
        },
        isConstruction: false,
        startPointId: "sketch_point_a",
        endPointId: "sketch_point_b",
      },
      {
        kind: "circle",
        entityId: "sketch_entity_circle",
        label: "Circle",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_1",
          entityId: "sketch_entity_circle",
        },
        isConstruction: false,
        centerPointId: "sketch_point_a",
        radius: 1,
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: input.dimensions.map((dimension) => dimension.dimensionId),
    dimensions: input.dimensions,
  };
}
