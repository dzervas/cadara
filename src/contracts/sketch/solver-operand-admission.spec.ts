import { expect, test } from "vitest";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "./region-extraction.fixtures";
import type { ConstraintDefinition } from "./schema";
import {
  compileSketchSolveProgram,
  solveSketchDefinitionCore,
  solveCompiledSketchProgram,
  validateSketchDefinitionCore,
} from "./solver-core";

const tolerances = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};
const kinds = ["lineSegment", "circle", "arc", "spline", "ellipse"] as const;
function definition(
  a: (typeof kinds)[number],
  b: (typeof kinds)[number],
  constraintKind:
    | "tangent"
    | "concentric"
    | "parallel"
    | "perpendicular"
    | "equalLength"
    | "horizontal"
    | "vertical",
) {
  const f = makeSketchFixture();
  for (const [name, x, y] of [
    ["center", 0, 0],
    ["start", 2, 0],
    ["end", 0, 2],
  ] as const)
    f.point(name, x, y);
  for (const [name, kind] of [
    ["a", a],
    ["b", b],
  ] as const) {
    if (kind === "lineSegment") f.line(name, "start", "end");
    else if (kind === "circle") f.circle(name, "center", 2);
    else if (kind === "arc") f.arc(name, "center", "start", "end");
    else if (kind === "spline") f.spline(name, ["start", "end"], "open");
    else f.ellipse(name, "center", "start", 1);
  }
  const constraint: ConstraintDefinition =
    constraintKind === "horizontal" || constraintKind === "vertical"
      ? {
          constraintId: "constraint_test",
          label: "Test",
          kind: constraintKind,
          entityId: "sketch_entity_a",
        }
      : {
          constraintId: "constraint_test",
          label: "Test",
          kind: constraintKind,
          entityIds: ["sketch_entity_a", "sketch_entity_b"],
          relation: "external",
        };
  return {
    ...literalResolvedDefinition(f.definition()),
    constraints: [constraint],
    constraintIds: [constraint.constraintId],
  };
}
const options = {
  tolerances,
  modelingTolerance: 1e-6,
  partialSolvePolicy: "bestEffort" as const,
};
for (const kind of [
  "tangent",
  "concentric",
  "parallel",
  "perpendicular",
  "equalLength",
  "horizontal",
  "vertical",
] as const) {
  for (const a of kinds)
    for (const b of kinds) {
      test(`${kind}: ${a}/${b} admission agrees with solver rows`, () => {
        const input = { ...options, definition: definition(a, b, kind) };
        const validation = validateSketchDefinitionCore(input);
        const program = compileSketchSolveProgram(input);
        expect(validation.isValid).toBe(
          program.system.scalarConstraints.some(
            (row) => row.id === "constraint_test",
          ),
        );
      });
    }
}
test("line/line tangent is explicitly unsupported and cannot report satisfied without rows", () => {
  const input = {
    ...options,
    definition: definition("lineSegment", "lineSegment", "tangent"),
  };
  const solved = solveSketchDefinitionCore(input).solvedSnapshot;
  expect(solved.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "unsupported-constraint-operands",
      message: expect.stringContaining("unsupported operand combination"),
      target: { kind: "constraint", constraintId: "constraint_test" },
    }),
  );
  expect(solved.constraintStatuses).toEqual([
    { constraintId: "constraint_test", status: "conflicting" },
  ]);
  expect(solved.status.solveState).not.toBe("solved");
});

for (const kind of [
  "parallelProjectedLine",
  "perpendicularProjectedLine",
] as const) {
  test(`${kind} refuses a collapsed projected direction and reports unadmitted status`, () => {
    const f = makeSketchFixture();
    f.point("start", 0, 0);
    f.point("end", 2, 1);
    f.line("a", "start", "end");
    const referenceId = f.project("direction", [
      {
        geometryId: "projected_geometry_line",
        kind: "lineSegment",
        startPosition: [0, 0],
        endPosition: [0, 0],
      },
    ]);
    const constraint: ConstraintDefinition = {
      constraintId: "constraint_test",
      label: "Direction",
      kind,
      line: { kind: "localEntity", entityId: "sketch_entity_a" },
      projectedLine: {
        kind: "projectedGeometry",
        reference: {
          referenceId,
          geometryId: "projected_geometry_line",
          kind: "projectedLineSegment",
        },
      },
    };
    const input = {
      ...options,
      definition: {
        ...literalResolvedDefinition(f.definition()),
        constraints: [constraint],
        constraintIds: [constraint.constraintId],
      },
      projectedReferences: f.build().projectedReferences,
    };
    expect(validateSketchDefinitionCore(input).isValid).toBe(false);
    expect(
      compileSketchSolveProgram(input).system.scalarConstraints,
    ).toHaveLength(0);
    const solved = solveSketchDefinitionCore(input).solvedSnapshot;
    expect(solved.constraintStatuses).toEqual([
      { constraintId: "constraint_test", status: "conflicting" },
    ]);
    expect(solved.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported-constraint-operands" }),
    );
    expect(solved.status.solveState).not.toBe("solved");
  });
}

// Cover the remaining constraint families with local operand kinds and every
// projected primitive kind. The binary entity families above cover both orders.
for (const a of kinds)
  for (const b of kinds) {
    const base = definition(a, b, "tangent");
    const point = {
      kind: "localPoint",
      pointId: "sketch_point_start",
    } as const;
    const line = { kind: "localEntity", entityId: "sketch_entity_a" } as const;
    const curve = { kind: "localEntity", entityId: "sketch_entity_b" } as const;
    const pointIds = ["sketch_point_start", "sketch_point_end"] as const;
    const common = { constraintId: "constraint_test", label: "Test" } as const;
    const constraints: ConstraintDefinition[] = [
      { ...common, kind: "coincident", pointIds },
      { ...common, kind: "fixPoint", pointId: point.pointId, position: [2, 0] },
      {
        ...common,
        kind: "angle",
        pointIds: [...pointIds, "sketch_point_center"],
        valueRadians: 1,
      },
      { ...common, kind: "midpoint", point, line },
      { ...common, kind: "pointOnCurve", point, curve },
      { ...common, kind: "collinear", target: curve, line },
      { ...common, kind: "normal", point, line, curve },
      { ...common, kind: "symmetric", pointIds, axis: line },
      {
        ...common,
        kind: "equalOffset",
        pairs: [
          {
            seedEntityId: line.entityId,
            offsetEntityId: curve.entityId,
            side: "left",
          },
          {
            seedEntityId: curve.entityId,
            offsetEntityId: line.entityId,
            side: "right",
          },
        ],
      },
    ];
    for (const constraint of constraints)
      test(`${constraint.kind}: ${a}/${b} admission agrees with rows`, () => {
        const input = {
          ...options,
          definition: { ...base, constraints: [constraint] },
        };
        expect(validateSketchDefinitionCore(input).isValid).toBe(
          compileSketchSolveProgram(input).system.scalarConstraints.some(
            (r) => r.id === constraint.constraintId,
          ),
        );
      });
    for (const projectedKind of [
      "point",
      "lineSegment",
      "circle",
      "arc",
    ] as const) {
      const f = makeSketchFixture();
      const geometry =
        projectedKind === "point"
          ? { kind: projectedKind, position: [0, 0] as const }
          : projectedKind === "lineSegment"
            ? {
                kind: projectedKind,
                startPosition: [0, 0] as const,
                endPosition: [5, 0] as const,
              }
            : projectedKind === "circle"
              ? {
                  kind: projectedKind,
                  centerPosition: [0, 0] as const,
                  radius: 2,
                }
              : {
                  kind: projectedKind,
                  centerPosition: [0, 0] as const,
                  startPosition: [2, 0] as const,
                  endPosition: [0, 2] as const,
                  sweepDirection: "counterClockwise" as const,
                };
      const referenceId = f.project("target", [
        { ...geometry, geometryId: "projected_geometry_target" },
      ]);
      const projected = {
        kind: "projectedGeometry",
        reference: {
          referenceId,
          geometryId: "projected_geometry_target",
          kind: (
            {
              point: "projectedPoint",
              lineSegment: "projectedLineSegment",
              circle: "projectedCircle",
              arc: "projectedArc",
            } as const
          )[projectedKind],
        },
      } as const;
      const projectedConstraints: ConstraintDefinition[] = [
        {
          ...common,
          kind: "coincidentProjectedPoint",
          point,
          projectedPoint: projected,
        },
        {
          ...common,
          kind: "pointOnProjectedCurve",
          point,
          projectedCurve: projected,
        },
        {
          ...common,
          kind: "midpointProjectedLine",
          point,
          projectedLine: projected,
        },
        {
          ...common,
          kind: "collinearProjectedLine",
          target: line,
          projectedLine: projected,
        },
        {
          ...common,
          kind: "parallelProjectedLine",
          line,
          projectedLine: projected,
        },
        {
          ...common,
          kind: "perpendicularProjectedLine",
          line,
          projectedLine: projected,
        },
        {
          ...common,
          kind: "tangentProjectedCurve",
          curve,
          projectedCurve: projected,
          relation: "external",
        },
        {
          ...common,
          kind: "concentricProjectedCurve",
          curve,
          projectedCurve: projected,
        },
        {
          ...common,
          kind: "normalProjectedCurve",
          point,
          line,
          projectedCurve: projected,
        },
        {
          ...common,
          kind: "symmetricProjectedLine",
          pointIds,
          projectedLine: projected,
        },
      ];
      for (const constraint of projectedConstraints)
        test(`${constraint.kind}: ${a}/${b}/${projectedKind} admission agrees with rows`, () => {
          const input = {
            ...options,
            definition: {
              ...base,
              references: f.definition().references,
              referenceIds: [referenceId],
              constraints: [constraint],
            },
            projectedReferences: f.build().projectedReferences,
          };
          expect(validateSketchDefinitionCore(input).isValid).toBe(
            compileSketchSolveProgram(input).system.scalarConstraints.some(
              (r) => r.id === constraint.constraintId,
            ),
          );
        });
    }
  }

// Simulate future validator/builder drift through the public compiled-program
// seam: even a validation-clean program must not turn absent rows into success.
test("an unadmitted constraint in a validation-clean program is unsupported", () => {
  const program = compileSketchSolveProgram({
    ...options,
    definition: definition("lineSegment", "lineSegment", "tangent"),
  });
  program.validation = { isValid: true, diagnostics: [] };
  program.diagnostics = [];
  const solved = solveCompiledSketchProgram(program).solvedSnapshot;
  expect(solved.constraintStatuses).toEqual([
    { constraintId: "constraint_test", status: "conflicting" },
  ]);
  expect(solved.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "unsupported-constraint-operands",
      message: expect.stringContaining("no solver rows were admitted"),
    }),
  );
  expect(solved.status.solveState).not.toBe("solved");
});
