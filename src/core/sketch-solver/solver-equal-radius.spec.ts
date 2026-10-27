import { expect, test } from "vitest";
import { makeEqualCircleDefinition } from "@/contracts/sketch/equal-radius.fixtures";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { NumericSketchDefinition } from "@/contracts/sketch/schema";

const solve = (definition: NumericSketchDefinition) =>
  solveSketchDefinitionCore({
    definition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    modelingTolerance: 1e-6,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;

for (const kind of ["diameter", "circleRadius"] as const) {
  test(`${kind} drives all three equal circles through shared solver rows`, () => {
    const definition = makeEqualCircleDefinition();
    const solved = solve({
      ...definition,
      dimensions: [
        {
          dimensionId: "dimension_size",
          label: "Driving size",
          entityId: "sketch_entity_circle0",
          kind,
          value: kind === "diameter" ? 16 : 8,
        },
      ],
    });
    expect(solved.status.solveState).toBe("solved");
    for (const entity of solved.solvedEntities) {
      expect(entity.kind).toBe("circle");
      if (entity.kind === "circle")
        expect(entity.solvedRadius).toBeCloseTo(8, 5);
    }
    expect(solved.constraintStatuses).toHaveLength(2);
    expect(
      solved.constraintStatuses.every((c) => c.status === "satisfied"),
    ).toBe(true);
  });
}

test("different driving sizes on equal circles produce authoritative conflict diagnostics", () => {
  const definition = makeEqualCircleDefinition();
  const dimensions = [
    ...definition.dimensions,
    {
      dimensionId: "dimension_conflict" as const,
      kind: "circleRadius" as const,
      label: "Conflicting radius",
      entityId: "sketch_entity_circle1" as const,
      value: 11,
    },
  ];
  const solved = solve({
    ...definition,
    dimensions,
    dimensionIds: dimensions.map((d) => d.dimensionId),
  });
  expect(solved.status.solveState).not.toBe("solved");
  expect(solved.diagnostics).toContainEqual(
    expect.objectContaining({ code: "solver-requirement-unsatisfied" }),
  );
  expect(
    solved.constraintStatuses.some((c) => c.status === "unsatisfied"),
  ).toBe(true);
});

for (const kind of ["lineSegment", "arc"] as const) {
  test(`equal circle and ${kind} operands return unsupported diagnostics without throwing`, () => {
    const fixture = makeSketchFixture();
    fixture.point("center", 0, 0);
    fixture.point("start", 2, 0);
    fixture.point("end", 0, 2);
    fixture.circle("circle", "center", 2);
    if (kind === "arc") fixture.arc("other", "center", "start", "end");
    else fixture.line("other", "start", "end");
    const constraints = [
      {
        constraintId: "constraint_equal" as const,
        kind: "equalLength" as const,
        label: "Unsupported equality",
        entityIds: ["sketch_entity_circle", "sketch_entity_other"] as const,
      },
    ];
    const solved = solve({
      ...literalResolvedDefinition(fixture.definition()),
      constraints,
      constraintIds: [constraints[0]!.constraintId],
    });
    expect(solved.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupported-equal-operands",
        severity: "error",
      }),
    );
    expect(solved.status.solveState).not.toBe("solved");
  });
}
