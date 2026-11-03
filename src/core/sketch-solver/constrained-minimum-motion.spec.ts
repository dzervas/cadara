import { expect, test } from "vitest";
import {
  solveConstrainedMinimumMotionSteps,
  type ConstrainedStepProblem,
  type ConstrainedStepRow,
  type ConstrainedStepResult,
} from "./constrained-minimum-motion";
import type { ComponentJacobian } from "./automatic-differentiation";
import { compileSketchSolveProgram } from "./compile-program";
import { traceSketchSolverForTest } from "./solve-tracing";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "./solver-drag-conditioning.fixtures";
// Logic lane: the cadara-p4r5.2 equality-constrained minimum-motion step over
// plain row data (no geometry): it lands on the rows, keeps an inequality,
// and reports an unavailable Jacobian instead of moving nothing.

/** The step over `problem`, with an inequality boundary band of 1e-6 unless given. */
function run(
  problem: Omit<ConstrainedStepProblem, "boundary"> & { boundary?: number },
): ConstrainedStepResult {
  const steps = solveConstrainedMinimumMotionSteps({
    boundary: 1e-6,
    ...problem,
  });
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

test("batch start correction enforces an inequality newly violated by Newton", () => {
  const result = run({
    start: Float64Array.from([1, 0]),
    variables: [0, 1],
    equalities: [row((x) => ({ components: [x + 1], rows: [[1, 0]] }))],
    inequalities: [row((x) => ({ components: [x], rows: [[1, 0]] })).evaluate],
    correctAllInequalities: true,
    objective: [anchor],
  });
  expect(result.kind).toBe("unavailable");
  if (result.kind !== "unavailable") return;
  expect(result.reason).toBe("startNotCorrectable");
});

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

test("inequalities entering together with incompatible boundaries do not over-determine the corrector: the step stops on the one that binds", () => {
  // The goal pulls x from 1 to −1; x/√2 ≥ 0.1 binds first (x = 0.1414),
  // x ≥ 0.1 enters on the same trial but is clear there. Holding both at
  // g = 0 would ask x = 0.1414 and x = 0.1 at once.
  const toward = row((x, y) => ({
    components: [0.1 * (x + 1), 0.1 * y],
    rows: [
      [0.1, 0],
      [0, 0.1],
    ],
  }));
  const result = run({
    start: Float64Array.from([1, 0]),
    variables: [0, 1],
    equalities: [],
    inequalities: [
      (values) => ({
        components: [values[0]! / Math.SQRT2 - 0.1],
        rows: [Float64Array.from([1 / Math.SQRT2, 0])],
      }),
      (values) => ({
        components: [values[0]! - 0.1],
        rows: [Float64Array.from([1, 0])],
      }),
    ],
    objective: [toward],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(result.stats.acceptedMoves).toBeGreaterThan(0);
  expect(Math.abs(result.values[0]! - 0.1 * Math.SQRT2)).toBeLessThan(1e-6);
});

// |p| ≥ 0.01: an unsigned distance, true at both ends of a move through 0.
const awayFromOrigin = (values: Float64Array): ComponentJacobian => {
  const length = Math.hypot(values[0]!, values[1]!);
  return {
    components: [length - 0.01],
    rows: [Float64Array.from([values[0]! / length, values[1]! / length])],
  };
};
const pullTo = (gx: number, gy: number) =>
  row((x, y) => ({
    components: [0.1 * (x - gx), 0.1 * (y - gy)],
    rows: [
      [0.1, 0],
      [0, 0.1],
    ],
  }));

test("a move that jumps over an inequality's boundary (an unsigned distance through zero) is stopped at the boundary", () => {
  const result = run({
    start: Float64Array.from([0.5, 0]),
    variables: [0, 1],
    equalities: [],
    inequalities: [awayFromOrigin],
    objective: [pullTo(-0.5, 0)],
    blocking: [0],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(result.stop).toBe("blocked");
  expect(result.values[0], "the point stays on its side").toBeGreaterThan(0);
  expect(Math.hypot(result.values[0]!, result.values[1]!)).toBeCloseTo(0.01, 6);
});

test("a move whose straight path passes beside an inequality's boundary is not stopped by it", () => {
  // From (0.5, 0) to (0, 0.5): the chord stays 0.35 from the origin, though
  // both ends' first-order models of |p| cross 0.01.
  const result = run({
    start: Float64Array.from([0.5, 0]),
    variables: [0, 1],
    equalities: [],
    inequalities: [awayFromOrigin],
    objective: [pullTo(0, 0.5)],
    blocking: [0],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(result.stop).not.toBe("blocked");
  expect(Math.hypot(result.values[0]!, result.values[1]! - 0.5)).toBeLessThan(
    1e-6,
  );
});

test("a blocking inequality that entered on a rejected trial does not stop a shorter accepted move that stays clear of its boundary", () => {
  // x ≥ 0 (blocking) and r(u) = 1 + u/2 + 0.8u², u = x − 1: the first trial
  // (x = −1) crosses x = 0 and is shortened to it, where r grows (Armijo
  // rejects it); the half-length trial x = 0.5 is accepted, clear of the
  // boundary, and the step goes on to r's minimum at x = 0.6875.
  const result = run({
    start: Float64Array.from([1, 0]),
    variables: [0],
    equalities: [],
    inequalities: [
      (values) => ({
        components: [values[0]!],
        rows: [Float64Array.from([1, 0])],
      }),
    ],
    objective: [
      row((x) => ({
        components: [1 + 0.5 * (x - 1) + 0.8 * (x - 1) ** 2],
        rows: [[0.5 + 1.6 * (x - 1), 0]],
      })),
    ],
    blocking: [0],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(
    result.stats.rejectedTrials,
    "premise: the entering trial and the shortened one were rejected",
  ).toBeGreaterThanOrEqual(2);
  expect(result.stop).not.toBe("blocked");
  expect(Math.abs(result.values[0]! - 0.6875)).toBeLessThan(1e-6);
});

test("a step whose every trial fails to correct stops on its radius with no accepted move", () => {
  // A row satisfied only at the start, with no gradient to correct along.
  const start = Float64Array.from([0, 1]);
  const pinned = {
    evaluate: (values: Float64Array): ComponentJacobian => ({
      components: [values[0] === start[0] && values[1] === start[1] ? 0 : 1],
      rows: [Float64Array.from([0, 0])],
    }),
  };
  const result = run({
    start,
    variables: [0, 1],
    equalities: [pinned],
    inequalities: [],
    objective: [goal, anchor],
  });
  expect(result.kind).toBe("solved");
  if (result.kind !== "solved") return;
  expect(result.stop).toBe("radius");
  expect(result.stats.acceptedMoves).toBe(0);
  expect([...result.values]).toEqual([...start]);
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

test.each([1, 1e-6, 1e6])(
  "a padded nonlinear problem with redundant rows keeps the dense step's constrained minimum at row scale %s",
  (rowScale) => {
    // Padding moves the same circle problem above the operator crossover.
    // Independent anchored variables must not change its minimum or active set.
    const reference = run({
      start: Float64Array.from([0, 1]),
      variables: [0, 1],
      equalities: [circle],
      inequalities: [],
      objective: [goal, anchor],
    });
    const size = 80;
    const pad = (source: ConstrainedStepProblem["objective"][number]) => ({
      evaluate: (values: Float64Array): ComponentJacobian => {
        const evaluated = source.evaluate(values);
        return {
          ...evaluated,
          rows: evaluated.rows.map((sourceRow) => {
            const padded = new Float64Array(size);
            padded.set(sourceRow);
            return padded;
          }),
        };
      },
    });
    const paddedAnchor = {
      evaluate: (values: Float64Array): ComponentJacobian => ({
        components: Array.from(values.slice(2)),
        rows: Array.from({ length: size - 2 }, (_, index) => {
          const entry = new Float64Array(size);
          entry[index + 2] = 1;
          return entry;
        }),
      }),
    };
    const start = new Float64Array(size);
    start[1] = 1;
    const padded = run({
      start,
      variables: Array.from({ length: size }, (_, index) => index),
      equalities: [1, rowScale].map((scaleBy) => ({
        evaluate: (values: Float64Array): ComponentJacobian => {
          const evaluated = pad(circle).evaluate(values);
          return {
            ...evaluated,
            components: evaluated.components.map((value) => value * scaleBy),
            rows: evaluated.rows.map((entry) =>
              entry.map((value) => value * scaleBy),
            ),
          };
        },
      })),
      inequalities: [],
      objective: [pad(goal), pad(anchor), paddedAnchor],
    });
    expect(reference.kind).toBe("solved");
    expect(padded.kind).toBe("solved");
    if (reference.kind !== "solved" || padded.kind !== "solved") return;
    expect(
      Math.hypot(
        ...padded.values.map(
          (value, index) => value - (reference.values[index] ?? 0),
        ),
      ),
    ).toBeLessThan(1e-7);
    expect(padded.stats.iterations).toBeLessThanOrEqual(15);
  },
);

function identityObjective(
  target: Float64Array,
  scaleBy = 1,
): ConstrainedStepRow {
  return {
    evaluate: (values) => ({
      components: Array.from(
        values,
        (value, index) => scaleBy * (value - target[index]!),
      ),
      rows: Array.from(values, (_, index) => {
        const gradient = new Float64Array(values.length);
        gradient[index] = scaleBy;
        return gradient;
      }),
    }),
  };
}

test.each([65, 80])(
  "padding to %s variables preserves the dense rank decision on nearly dependent rows",
  (size) => {
    const solve = (count: number) => {
      const target = new Float64Array(count);
      target[1] = 1;
      target[2] = 10;
      return run({
        start: new Float64Array(count),
        variables: Array.from({ length: count }, (_, index) => index),
        equalities: [
          {
            evaluate: (values) => {
              const first = new Float64Array(count);
              first[0] = 1;
              const second = Float64Array.from(first);
              second[1] = 1e-7;
              return {
                components: [values[0]!, values[0]! + 1e-7 * values[1]!],
                rows: [first, second],
              };
            },
          },
        ],
        inequalities: [],
        objective: [identityObjective(target)],
      });
    };
    const reference = solve(64);
    const padded = solve(size);
    expect(reference.kind).toBe("solved");
    expect(padded.kind).toBe("solved");
    if (reference.kind !== "solved" || padded.kind !== "solved") return;
    expect(padded.stop).toBe("stationary");
    expect(
      Math.hypot(
        ...padded.values.map(
          (value, index) => value - (reference.values[index] ?? 0),
        ),
      ),
    ).toBeLessThan(1e-8);
    expect(padded.stats.iterations).toBeLessThanOrEqual(
      reference.stats.iterations + 1,
    );
    expect(padded.stats.newtonIterations).toBeLessThanOrEqual(
      reference.stats.newtonIterations + 1,
    );
  },
);

test.each([1e-8, 1, 1e8])(
  "padding preserves the dense minimum at objective row scale %s",
  (scaleBy) => {
    const solve = (size: number) => {
      const target = new Float64Array(size);
      target[0] = 1;
      return run({
        start: new Float64Array(size),
        variables: Array.from({ length: size }, (_, index) => index),
        equalities: [],
        inequalities: [],
        objective: [identityObjective(target, scaleBy)],
      });
    };
    const reference = solve(3);
    const padded = solve(80);
    expect(reference.kind).toBe("solved");
    expect(padded.kind).toBe("solved");
    if (reference.kind !== "solved" || padded.kind !== "solved") return;
    expect(
      Math.hypot(
        ...padded.values.map(
          (value, index) => value - (reference.values[index] ?? 0),
        ),
      ),
    ).toBeLessThan(1e-8);
    expect(padded.stats.acceptedMoves).toBeGreaterThan(0);
    expect(padded.stats.iterations).toBeLessThanOrEqual(
      reference.stats.iterations + 1,
    );
  },
);
