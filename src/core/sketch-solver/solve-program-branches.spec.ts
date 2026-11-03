import { expect, test } from "vitest";
import type {
  ConstraintId,
  DimensionId,
  SketchId,
} from "@/contracts/shared/ids";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createSketchFilletMutation } from "@/core/sketch-editing/operations";
import { createSessionCommitFactories } from "@/core/editor/sketch-session/tool-authoring";
import { compileSketchSolveProgram } from "./compile-program";
import { deriveDragBranchInvariants } from "./constrained-drag-stage";
import { solveProgramValues } from "./solve-program";
import { isAcceptableSolvedValues } from "./start-session";

// Logic lane: batch dimension edits on a native filleted, circle-constrained
// hexagon. Equal sides plus a fixed circumradius cannot grow past the convex
// regular polygon: a conflict must not be solved by reflecting both fillets.
function filletedHexagon(equalSides: boolean) {
  const fixture = makeSketchFixture();
  fixture.point("center", 0, 0);
  const circle = fixture.circle("circle", "center", 1, true);
  const lines = Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    fixture.point(`p${index}`, Math.cos(angle), Math.sin(angle));
    return `l${index}`;
  }).map((name, index) =>
    fixture.line(name, `p${index}`, `p${(index + 1) % 6}`),
  );
  for (let index = 0; index < 6; index++)
    fixture.pointOnCurve(`p${index}`, "circle");
  let definition = fixture.definition();
  definition = {
    ...definition,
    constraints: [
      ...definition.constraints,
      ...(equalSides
        ? lines.slice(1).map((line, index) => ({
            constraintId: `equal_${index}` as ConstraintId,
            kind: "equalLength" as const,
            label: "Equal sides",
            entityIds: [lines[0]!, line] as const,
          }))
        : []),
    ],
    constraintIds: [
      ...definition.constraintIds,
      ...(equalSides
        ? lines.slice(1).map((_, index) => `equal_${index}` as ConstraintId)
        : []),
    ],
    dimensionIds: ["circle_radius" as DimensionId],
    dimensions: [
      {
        dimensionId: "circle_radius" as DimensionId,
        kind: "circleRadius",
        label: "Circle radius",
        entityId: circle,
        value: createLiteralAuthoredValue(1),
      },
    ],
  };
  for (const [index, pair] of [
    [lines[2]!, lines[3]!],
    [lines[5]!, lines[0]!],
  ].entries()) {
    const mutation = createSketchFilletMutation({
      definition,
      entityIds: pair,
      radius: 0.15,
      sequence: index + 1,
      factories: createSessionCommitFactories(
        index + 1,
        "branch_hexagon" as SketchId,
      ),
    });
    if (!mutation.valid || !mutation.definition)
      throw new Error(mutation.message ?? "Fillet failed");
    definition = mutation.definition;
  }
  const line = definition.entities.find(
    (entity) => entity.entityId === lines[2],
  );
  if (line?.kind !== "lineSegment")
    throw new Error("Missing fillet-adjacent line");
  const points = [line.startPointId, line.endPointId].map(
    (id) => definition.points.find((point) => point.pointId === id)!.position,
  );
  const length = Math.hypot(
    points[1]![0] - points[0]![0],
    points[1]![1] - points[0]![1],
  );
  return compileSketchSolveProgram({
    definition: literalResolvedDefinition({
      ...definition,
      dimensionIds: [
        ...definition.dimensionIds,
        "edited_length" as DimensionId,
      ],
      dimensions: [
        ...definition.dimensions,
        {
          dimensionId: "edited_length" as DimensionId,
          kind: "lineLength",
          label: "Edited length",
          entityId: line.entityId,
          value: createLiteralAuthoredValue(length + 0.2),
        },
      ],
    }),
    tolerances: {
      coincidence: 1e-3,
      angleRadians: 1e-4,
      minimumSegmentLength: 1e-6,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
}

test("an infeasible equal-sided inscribed hexagon edit reports conflict without reflecting the fillets", () => {
  const program = filletedHexagon(true);
  const start = program.system.initialValues;
  const invariants = deriveDragBranchInvariants(
    program,
    program.system.scalarConstraints,
    start,
  );
  expect(invariants.margins.length).toBeGreaterThan(0);
  const solved = solveProgramValues(program, start);
  expect(
    invariants.refuses(solved.solved.values),
    "no row-derived branch invariant is crossed",
  ).toBe(false);
  expect(isAcceptableSolvedValues(program, solved.solved)).toBe(false);
  expect(
    solved.result.solvedSnapshot.dimensionStatuses.some(
      (status) => status.status === "unsatisfied",
    ),
  ).toBe(true);
});

test("a circle-only hexagon edit can solve on its original fillet branches", () => {
  const program = filletedHexagon(false);
  const start = program.system.initialValues;
  const invariants = deriveDragBranchInvariants(
    program,
    program.system.scalarConstraints,
    start,
  );
  const solved = solveProgramValues(program, start);
  expect(invariants.refuses(solved.solved.values)).toBe(false);
  expect(isAcceptableSolvedValues(program, solved.solved)).toBe(true);
});
