import { expect, test } from "vitest";
import type { NumericSketchDefinition } from "@/contracts/sketch/schema";
import { compileSketchSolveProgram } from "./compile-program";
import {
  chiralityMargin,
  deriveChiralityInvariants,
} from "./constrained-chirality";
import { guardedArcQuantities } from "./drag-acceptance";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "./solver-drag-conditioning.fixtures";
import { createCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";

// Logic lane: compiled drag sessions and row data; no scheduler or DOM.

const corner = dragConditioningFixture.cases.find(
  (row) => row.scenario === "drag-corner",
)!;

/** The k5d two-target corner: settle target 0, then target 1 (both drag the bottom-left corner). */
function secondPreview(dragStep: "penalty" | "constrained") {
  const session = startConditioningReplay(corner, { dragStep });
  const settle = (target: (typeof corner.targets)[number][0]) => {
    let kind = "pending";
    for (let calls = 0; kind === "pending" && calls < 40; calls += 1)
      kind = updateCompiledSketchSolveSession(session, target, null).kind;
    return kind;
  };
  const sides = () =>
    [
      ...guardedArcQuantities(
        session.program,
        session.values,
        session.lastAcceptedSnapshot,
      ),
    ].filter(([key]) => key.startsWith("side:"));
  const target = corner.targets[1]![0];
  if (target.kind !== "sketchPoint") throw new Error("premise: a point drag");
  const dragged = () =>
    session.lastAcceptedSnapshot.solvedPoints.find(
      (point) => point.pointId === target.pointId,
    )!.solvedPosition;
  settle(corner.targets[0]![0]);
  const before = { sides: sides(), corner: dragged(), values: session.values };
  const kind = settle(target);
  return {
    session,
    kind,
    before,
    after: { sides: sides(), corner: dragged() },
  };
}

test("the constrained step: the k5d second corner preview either moves the dragged corner on the accepted branch or is refused, never solved without motion", () => {
  expect(secondPreview("penalty").kind).toBe("blocked");
  const constrained = secondPreview("constrained");
  expect(
    constrained.after.sides.map(([key, side]) => [key, Math.sign(side)]),
    "Fillet 17 keeps its sides",
  ).toEqual(
    constrained.before.sides.map(([key, side]) => [key, Math.sign(side)]),
  );
  const motion = Math.hypot(
    constrained.after.corner[0] - constrained.before.corner[0],
    constrained.after.corner[1] - constrained.before.corner[1],
  );
  if (constrained.kind === "solved")
    expect(motion, "a solved preview moves the dragged corner").toBeGreaterThan(
      1e-6,
    );
  else {
    expect(constrained.kind).toBe("blocked");
    expect(
      constrained.session.values,
      "a refused preview keeps the accepted values",
    ).toBe(constrained.before.values);
  }
});

test("row-derived invariants: each margin is nonnegative where derived and its analytic gradient matches central differences", () => {
  const session = startConditioningReplay(corner, { dragStep: "constrained" });
  const invariants = deriveChiralityInvariants(
    session.program,
    session.program.system.scalarConstraints,
    session.values,
  );
  expect(invariants.length).toBeGreaterThan(0);
  for (const invariant of invariants) {
    const margin = chiralityMargin(session.program, invariant);
    const at = margin(session.values);
    expect(at.components[0]).toBeGreaterThanOrEqual(0);
    for (const point of invariant.points)
      for (const index of [point.baseIndex, point.baseIndex + 1]) {
        const shifted = (delta: number) => {
          const values = Float64Array.from(session.values);
          values[index] += delta;
          return margin(values).components[0]!;
        };
        expect(at.rows[0]![index]).toBeCloseTo(
          (shifted(1e-6) - shifted(-1e-6)) / 2e-6,
          5,
        );
      }
  }
});

/** Two disjoint unit lines A–B and C–D joined only by an equal-length constraint. */
function equalLengthDefinition(): NumericSketchDefinition {
  const point = (id: string, x: number, y: number) => ({
    pointId: `sketch_point_${id}` as const,
    label: id,
    target: {
      kind: "sketchPoint" as const,
      sketchId: "sketch_primary" as const,
      pointId: `sketch_point_${id}` as const,
    },
    position: [x, y] as const,
    isConstruction: false,
  });
  const line = (id: string, start: string, end: string) => ({
    kind: "lineSegment" as const,
    entityId: `sketch_entity_${id}` as const,
    label: id,
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as const,
      entityId: `sketch_entity_${id}` as const,
    },
    isConstruction: false,
    startPointId: `sketch_point_${start}` as const,
    endPointId: `sketch_point_${end}` as const,
  });
  const points = [
    point("a", 0, 0),
    point("b", 1, 0),
    point("c", 0.3, 1),
    point("d", 0.9, 1.8),
  ];
  const entities = [line("ab", "a", "b"), line("cd", "c", "d")];
  const constraints = [
    {
      constraintId: "constraint_equal" as const,
      kind: "equalLength" as const,
      label: "AB = CD",
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"] as const,
    },
  ];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entry) => entry.entityId),
    entities,
    constraintIds: constraints.map((entry) => entry.constraintId),
    constraints,
    dimensionIds: [],
    dimensions: [],
  };
}

test("row-derived invariants: a row that sees a point only through its distance to another (equal length) yields none", () => {
  const program = compileSketchSolveProgram({
    definition: equalLengthDefinition(),
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "failOnConflict",
  });
  const session = createCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_equal_length_chirality",
    program,
  });
  const equalRows = program.system.scalarConstraints.filter(
    (row) => row.id === "constraint_equal",
  );
  expect(equalRows).toHaveLength(1);
  expect(deriveChiralityInvariants(program, equalRows, session.values)).toEqual(
    [],
  );
});
