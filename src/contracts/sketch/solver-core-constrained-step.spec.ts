// Logic lane: the cadara-p4r5.2 equality-constrained minimum-motion step over
// plain row data (no geometry): it lands on the rows, keeps an inequality,
// and reports an unavailable Jacobian instead of moving nothing.
import { expect, test } from "vitest";
import {
  solveConstrainedMinimumMotionSteps,
  type ConstrainedStepProblem,
  type ConstrainedStepResult,
} from "@/contracts/sketch/solver-core-constrained-step";
import type { ComponentJacobian } from "@/contracts/sketch/solver-core-jacobian";
import {
  compileSketchSolveProgram,
  traceSketchSolverForTest,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "@/contracts/sketch/solver-drag-conditioning.fixtures";

function run(problem: ConstrainedStepProblem): ConstrainedStepResult {
  const steps = solveConstrainedMinimumMotionSteps(problem);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

const row = (
  evaluate: (
    x: number,
    y: number,
  ) => {
    components: number[];
    rows: [number, number][];
  },
) => ({
  evaluate: (values: Float64Array): ComponentJacobian => {
    const { components, rows } = evaluate(values[0]!, values[1]!);
    return { components, rows: rows.map((entry) => Float64Array.from(entry)) };
  },
});
// x² + y² − 1 = 0
const circle = row((x, y) => ({
  components: [x * x + y * y - 1],
  rows: [[2 * x, 2 * y]],
}));
// √w·(p − g) toward g = (2, 0.5), w = 1e-2, and the 1e-6 anchor at (0, 1).
const goal = row((x, y) => ({
  components: [0.1 * (x - 2), 0.1 * (y - 0.5)],
  rows: [
    [0.1, 0],
    [0, 0.1],
  ],
}));
const anchor = row((x, y) => ({
  components: [1e-3 * x, 1e-3 * (y - 1)],
  rows: [
    [1e-3, 0],
    [0, 1e-3],
  ],
}));

test("an unreachable goal ends on the constraint manifold at its constrained minimum", () => {
  const result = run({
    start: Float64Array.from([0, 1]),
    variables: [0, 1],
    equalities: [circle],
    inequalities: [],
    objective: [goal, anchor],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  const [x, y] = result.values;
  expect(Math.abs(x! * x! + y! * y! - 1)).toBeLessThan(1e-12);
  // The nearest circle point to (2, 0.5), pulled by the anchor by ~1e-4.
  const angle = Math.atan2(y!, x!);
  expect(Math.abs(angle - Math.atan2(0.5, 2))).toBeLessThan(1e-3);
  // The row-curvature (SR1) term: 7 iterations here; plain projected
  // Gauss–Newton, which ignores the circle's curvature, takes 72.
  expect(result.stats.iterations).toBeGreaterThan(0);
  expect(result.stats.iterations).toBeLessThanOrEqual(15);
});

test("an inequality that a step would violate joins the active set and holds the boundary", () => {
  // y ≥ 0.6 on the circle: the goal pulls below it, the step stops at y = 0.6.
  const floor = (values: Float64Array): ComponentJacobian => ({
    components: [values[1]! - 0.6],
    rows: [Float64Array.from([0, 1])],
  });
  const result = run({
    start: Float64Array.from([0, 1]),
    variables: [0, 1],
    equalities: [circle],
    inequalities: [floor],
    objective: [goal, anchor],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(result.values[1]).toBeGreaterThan(0.6 - 1e-9);
  expect(Math.abs(result.values[1]! - 0.6)).toBeLessThan(1e-6);
  expect(result.stats.activeInequalities).toBe(1);
});

test("a hinge component restated by an inequality is not an equality", () => {
  // Component 1 is 0 inside (y ≥ 0.6) and positive outside: as an equality
  // it would pin y ≥ 0.6 only by its kink; excluded, the inequality holds it.
  const hinged = row((x, y) => ({
    components: [x * x + y * y - 1, Math.max(0, 0.6 - y)],
    rows: [
      [2 * x, 2 * y],
      [0, y < 0.6 ? -1 : 0],
    ],
  }));
  const result = run({
    start: Float64Array.from([0, 1]),
    variables: [0, 1],
    equalities: [{ ...hinged, excludedComponents: [1] }],
    inequalities: [
      (values) => ({
        components: [values[1]! - 0.6],
        rows: [Float64Array.from([0, 1])],
      }),
    ],
    objective: [goal, anchor],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(Math.abs(result.values[1]! - 0.6)).toBeLessThan(1e-6);
});

test("an unavailable Jacobian at the start makes the step unavailable, never a zero-motion result", () => {
  const failed = {
    evaluate: (): ComponentJacobian => ({
      components: [0],
      rows: [Float64Array.from([Number.NaN, Number.NaN])],
      unavailable: [{ derivationId: "derivation_test", reason: "failed" }],
    }),
  };
  const result = run({
    start: Float64Array.from([0, 1]),
    variables: [0, 1],
    equalities: [circle, failed],
    inequalities: [],
    objective: [goal, anchor],
  });
  expect(result).toMatchObject({
    kind: "unavailable",
    reason: "jacobianUnavailable",
  });
});

test("redundant rows (a duplicated equality) are solved through the regularised normal equations", () => {
  const result = run({
    start: Float64Array.from([0.1, 1.2]),
    variables: [0, 1],
    equalities: [circle, circle],
    inequalities: [],
    objective: [goal, anchor],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(
    Math.abs(result.values[0]! ** 2 + result.values[1]! ** 2 - 1),
  ).toBeLessThan(1e-12 * 1.2 + 1e-15);
});

test('dragStep "constrained": a T18 drag-small frame runs the step instead of phases A/B and is accepted with every authored requirement satisfied', () => {
  const row = dragConditioningFixture.cases.find(
    (candidate) => candidate.scenario === "drag-small",
  )!;
  const session = startConditioningReplay(row, { dragStep: "constrained" });
  expect(session.program.dragStep).toBe("constrained");
  const [target, tolerance] = row.targets[0]!;
  const trace = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(session, target, tolerance),
  );
  expect(trace.result.kind).toBe("solved");
  const snapshot = trace.result.solvedSnapshot!;
  expect(
    snapshot.constraintStatuses.every((entry) => entry.status === "satisfied"),
  ).toBe(true);
  expect(
    snapshot.dimensionStatuses.every((entry) => entry.status === "driving"),
  ).toBe(true);
  expect(trace.work.constrainedStepStages).toBeGreaterThan(0);
  expect(trace.work.constrainedStepIterations).toBeGreaterThan(0);
  expect(
    trace.work.constrainedStepJacobianUnavailable +
      trace.work.constrainedStepStartNotCorrectable,
  ).toBe(0);
  expect(trace.work.bfgsIterations + trace.work.gaussNewtonIterations).toBe(0);
});

test("without the option (and without the test-only environment override) a program keeps the penalty drag step", () => {
  const program = compileSketchSolveProgram({
    ...dragConditioningFixture.compile,
  });
  expect(
    "dragStep" in program,
    "CADARA_SKETCH_DRAG_CONSTRAINED_STEP must not be set for this lane",
  ).toBe(false);
});

test("a row of rounding noise (an identically satisfied component) does not remove a tangent direction", () => {
  const noise = row(() => ({ components: [0], rows: [[1e-17, 0]] }));
  const result = run({
    start: Float64Array.from([0, 1]),
    variables: [0, 1],
    equalities: [circle, noise],
    inequalities: [],
    objective: [goal, anchor],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  const [x, y] = result.values;
  expect(Math.abs(Math.atan2(y!, x!) - Math.atan2(0.5, 2))).toBeLessThan(1e-3);
});

test("a hinge component at its kink (one-sided derivative) does not lock the boundary: the step leaves it inward", () => {
  // At y = 0.6 the hinge's branch reports the outside derivative (−1); as an
  // equality that row would pin y = 0.6. Excluded, the restating inequality
  // lets the goal (above) pull the point off the boundary.
  const hinged = row((x, y) => ({
    components: [x * x + y * y - 1, Math.max(0, 0.6 - y)],
    rows: [
      [2 * x, 2 * y],
      [0, y <= 0.6 ? -1 : 0],
    ],
  }));
  const upward = row((x, y) => ({
    components: [0.1 * (x - 0.5), 0.1 * (y - 2)],
    rows: [
      [0.1, 0],
      [0, 0.1],
    ],
  }));
  const result = run({
    start: Float64Array.from([0.8, 0.6]),
    variables: [0, 1],
    equalities: [{ ...hinged, excludedComponents: [1] }],
    inequalities: [
      (values) => ({
        components: [values[1]! - 0.6],
        rows: [Float64Array.from([0, 1])],
      }),
    ],
    objective: [upward],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(
    Math.abs(
      Math.atan2(result.values[1]!, result.values[0]!) - Math.atan2(2, 0.5),
    ),
  ).toBeLessThan(1e-3);
});

test("a row that becomes unavailable after the start (before any accepted move) makes the step unavailable, never a zero-motion 'solved'", () => {
  // Available exactly at the start, unavailable (NaN rows) everywhere else.
  const brittle = {
    evaluate: (values: Float64Array): ComponentJacobian =>
      values[0] === 0 && values[1] === 1
        ? { components: [0], rows: [Float64Array.from([0, 0])] }
        : {
            components: [0],
            rows: [Float64Array.from([Number.NaN, Number.NaN])],
            unavailable: [
              { derivationId: "derivation_test", reason: "failedDuringSolve" },
            ],
          },
  };
  const result = run({
    start: Float64Array.from([0, 1]),
    variables: [0, 1],
    equalities: [circle, brittle],
    inequalities: [],
    objective: [goal, anchor],
  });
  expect(result).toMatchObject({
    kind: "unavailable",
    reason: "jacobianUnavailable",
  });
});

test('dragStep "constrained": a hard row unavailable at the frame runs phases A/B instead (counted), and the T18 step restates hinge components as inequalities', () => {
  const row = dragConditioningFixture.cases.find(
    (candidate) => candidate.scenario === "drag-small",
  )!;
  const [target, tolerance] = row.targets[0]!;
  const regular = startConditioningReplay(row, { dragStep: "constrained" });
  const stepped = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(regular, target, tolerance),
  );
  expect(stepped.work.constrainedStepRestatedComponents).toBeGreaterThan(0);

  const session = startConditioningReplay(row, { dragStep: "constrained" });
  // One hard row reports an unavailable Jacobian (as a failed derived
  // relationship's row does); its loss path is untouched.
  const rows = session.program.system.scalarConstraints;
  const index = rows.findIndex((record) =>
    record.id.startsWith("constraint_17_fillet-tangent-a_"),
  );
  const original = rows[index]!;
  rows[index] = {
    ...original,
    evaluateComponentJacobian: (values) => {
      const jacobian = original.evaluateComponentJacobian(values);
      return {
        components: jacobian.components,
        rows: jacobian.rows.map((entry) => entry.map(() => Number.NaN)),
        unavailable: [{ derivationId: "derivation_test", reason: "failed" }],
      };
    },
  };
  const trace = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(session, target, tolerance),
  );
  expect(trace.result.kind).toBe("solved");
  expect(trace.work.constrainedStepJacobianUnavailable).toBeGreaterThan(0);
  expect(trace.work.bfgsIterations).toBeGreaterThan(0);
});
