import { expect, test } from "vitest";
import type { NumericSketchDefinition } from "@/contracts/sketch/schema";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { solveSketchDefinitionCore } from "./solve-sketch";

function line() {
  const fixture = makeSketchFixture();
  fixture.point("a", 1, 2);
  fixture.point("b", 4, 6);
  fixture.line("line", "a", "b");
  return literalResolvedDefinition(fixture.definition());
}

function solve(definition: NumericSketchDefinition) {
  return solveSketchDefinitionCore({
    definition,
    tolerances: {
      coincidence: 1e-3,
      angleRadians: 1e-4,
      minimumSegmentLength: 1e-3,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
}

function distance(
  point: "a" | "b",
  value: number,
): Extract<
  NumericSketchDefinition["dimensions"][number],
  { kind: "pointDatumDistance" }
> {
  return {
    dimensionId: `dimension_${point}`,
    label: point,
    kind: "pointDatumDistance",
    point: { kind: "localPoint", pointId: `sketch_point_${point}` },
    datum: { kind: "sketchDatum", datum: "origin" },
    axis: "horizontal",
    value,
  };
}

test("disagreeing axis-distance anchors keep the ordinary unconditioned solve", () => {
  const definition = line();
  const dimensions = [distance("a", 10), distance("b", 30)];
  const solved = solve({
    ...definition,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
  });
  expect(solved.solvedPoints.map((point) => point.solvedPosition)).toEqual([
    [9.999999995040753, 2],
    [30.00000001962144, 6],
  ]);
  expect(solved.status.solveState).toBe("solved");
});

test("a component without point-distance anchors keeps its original positions bitwise", () => {
  const definition = line();
  expect(
    solve(definition).solvedPoints.map((point) => point.solvedPosition),
  ).toEqual([
    [1, 2],
    [4, 6],
  ]);
});

test("the existing Fix anchor translates its component bitwise as before", () => {
  const definition = line();
  const constraint = {
    constraintId: "constraint_fix" as const,
    label: "Fix",
    kind: "fixPoint" as const,
    pointId: "sketch_point_a" as const,
    position: [20, 30] as const,
  };
  const solved = solve({
    ...definition,
    constraintIds: [constraint.constraintId],
    constraints: [constraint],
  });
  expect(solved.solvedPoints.map((point) => point.solvedPosition)).toEqual([
    [20, 30],
    [23, 34],
  ]);
});

for (const sign of [-1, 1]) {
  test(`axis-distance targets preserve the signed area of the enclosure hexagon on branch ${sign}`, () => {
    const fixture = makeSketchFixture();
    fixture.point("center", sign * 42, -27, true);
    fixture.circle("circle", "center", 1.3, true);
    for (let index = 0; index < 6; index++) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 3;
      fixture.point(
        `v${index}`,
        sign * 42 + 1.3 * Math.cos(angle),
        -27 + 1.3 * Math.sin(angle),
      );
    }
    for (let index = 0; index < 6; index++) {
      fixture.line(`side${index}`, `v${index}`, `v${(index + 1) % 6}`);
      fixture.pointOnCurve(`v${index}`, "circle");
    }
    const definition = literalResolvedDefinition(fixture.definition());
    const constraints: NumericSketchDefinition["constraints"] = [
      ...definition.constraints,
      ...Array.from({ length: 5 }, (_, index) => ({
        constraintId: `constraint_equal${index}` as const,
        label: "Equal sides",
        kind: "equalLength" as const,
        entityIds: [
          "sketch_entity_side0",
          `sketch_entity_side${index + 1}`,
        ] as const,
      })),
      {
        constraintId: "constraint_vertical",
        label: "Vertical",
        kind: "vertical",
        entityId: "sketch_entity_side1",
      },
    ];
    const dimensions: NumericSketchDefinition["dimensions"] = [
      {
        ...distance("a", 67),
        dimensionId: "dimension_centerX",
        point: { kind: "localPoint", pointId: "sketch_point_center" },
      },
      {
        ...distance("a", 27),
        dimensionId: "dimension_centerY",
        point: { kind: "localPoint", pointId: "sketch_point_center" },
        axis: "vertical",
      },
      {
        dimensionId: "dimension_radius",
        label: "Radius",
        kind: "circleRadius",
        entityId: "sketch_entity_circle",
        value: 1.3,
      },
    ];
    const solved = solve({
      ...definition,
      constraints,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      dimensions,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    });
    const positions = new Map(
      solved.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
    );
    const area = Array.from({ length: 6 }, (_, index) => {
      const a = positions.get(`sketch_point_v${index}`)!;
      const b = positions.get(`sketch_point_v${(index + 1) % 6}`)!;
      return (a[0] * b[1] - b[0] * a[1]) / 2;
    }).reduce((sum, contribution) => sum + contribution, 0);
    expect(solved.status.solveState).toBe("solved");
    expect(area).toBeCloseTo((3 * Math.sqrt(3) * 1.3 ** 2) / 2, 6);
    expect(positions.get("sketch_point_center")).toEqual([sign * 67, -27]);
  });
}
