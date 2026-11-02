import { expect, test } from "vitest";
import type { SketchPointId } from "@/contracts/shared/ids";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { traceSketchSolverForTest } from "./solve-tracing";
import type { SketchSolverWorkTrace } from "./solve-tracing";
import type { SketchDragTarget } from "./solve-types";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "./solver-drag-conditioning.fixtures";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
// cadara-b3k.26, logic lane, solver-core drag-session seam
// (`compileSketchSolveProgram`, `startCompiledSketchSolveSession`,
// `updateCompiledSketchSolveSession`) observed through the
// `traceSketchSolverForTest` work counters: a drag frame's loss evaluations
// are its line-search trials plus the few evaluations outside Wolfe searches
// (solver starts and candidate judging), never one more per iteration. Before
// the fix every Wolfe line search re-evaluated the loss at its start point,
// which the caller already held: 39% of all evaluations in the T18 drag
// profile (evidence in bead cadara-b3k.26).

const TOLERANCES = {
  coincidence: 1e-3,
  angleRadians: 1e-4,
  minimumSegmentLength: 1e-3,
};
const id = (name: string) => `sketch_point_${name}` as SketchPointId;

/** Spline a → b → c → d with a point on it and a dimensioned line. */
function definition() {
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 1, 1);
  fixture.point("c", 2, -1);
  fixture.point("d", 3, 0);
  fixture.point("p", 1.5, 0);
  fixture.point("e", 3, -1);
  fixture.spline("s", ["a", "b", "c", "d"], "open");
  fixture.pointOnCurve("p", "s");
  fixture.line("l", "d", "e");
  fixture.lineLength("l", 1);
  return literalResolvedDefinition(fixture.definition());
}

test("a far drag frame evaluates the loss once per line-search trial plus a few outside the searches, never once more per line search", () => {
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_b3k26",
    program: compileSketchSolveProgram({
      definition: definition(),
      projectedReferences: [],
      tolerances: TOLERANCES,
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  expect(started.kind).toBe("started");
  if (started.kind !== "started") return;

  const traced = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(
      started.session,
      { kind: "sketchPoint", pointId: id("d"), position: [6, 3] },
      1e-4,
    ),
  );
  expect(traced.result.kind, "the far frame still solves").toBe("solved");
  const { lossEvaluations, lineSearches, lineSearchTrials } = traced.work;
  expect(
    lineSearches,
    "the frame is a real replay with many iterations, not a trivial one",
  ).toBeGreaterThanOrEqual(20);
  // The start-point loss belongs to the caller: the evaluations outside the
  // trials are a handful however many iterations ran. For this fixture the
  // √18 drag runs as two accepted substeps: four original outside-search
  // evaluations plus the conditioning predicate and warm-up start each. The
  // numerical raw-component probes have their own explicit work counter.
  const outsideSearches = lossEvaluations - lineSearchTrials;
  expect(
    outsideSearches,
    `${lossEvaluations} loss evaluations for ${lineSearchTrials} trials over ${lineSearches} line searches: a line search must not re-evaluate its start`,
  ).toBeLessThan(lineSearches);
  expect(outsideSearches).toBeLessThanOrEqual(12);
});

// Release work at the same seam: a release does not re-solve work the
// session already knows is obsolete (an older absolute cursor goal still in
// flight) or already refused (the same goal from the same accepted state).
function startDragWorkSession(sessionId: `interactive_sketch_solve_${string}`) {
  const started = startCompiledSketchSolveSession({
    sessionId,
    program: compileSketchSolveProgram({
      definition: definition(),
      projectedReferences: [],
      tolerances: TOLERANCES,
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  if (started.kind !== "started") throw new Error("The fixture must start");
  return started.session;
}

const solveIterations = (work: SketchSolverWorkTrace) =>
  work.bfgsIterations + work.gaussNewtonIterations;

test("a release at a new cursor drops the obsolete in-flight point goal: it costs no more than the release goal alone and reaches the cursor exactly", () => {
  const session = startDragWorkSession(
    "interactive_sketch_solve_drop_point_goal",
  );
  const initial = session.lastAcceptedSnapshot;
  const preview = updateCompiledSketchSolveSession(
    session,
    { kind: "sketchPoint", pointId: id("d"), position: [2, 2] },
    null,
  );
  expect(preview.kind, "the preview goal is still in flight").toBe("pending");
  expect(session.lastAcceptedSnapshot, "no substep was accepted yet").toBe(
    initial,
  );

  const releaseGoal = {
    kind: "sketchPoint",
    pointId: id("d"),
    position: [1.5, 1],
  } as const;
  const released = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(session, releaseGoal, 1e-4),
  );
  const alone = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(
      startDragWorkSession("interactive_sketch_solve_release_alone"),
      releaseGoal,
      1e-4,
    ),
  );
  expect(released.result.kind).toBe("solved");
  expect(
    solveIterations(alone.work),
    "the release goal needs real work",
  ).toBeGreaterThan(0);
  expect(
    solveIterations(released.work),
    "the release must not first drain the superseded cursor goal",
  ).toBeLessThanOrEqual(solveIterations(alone.work));
  expect(released.work.lossEvaluations).toBeLessThanOrEqual(
    alone.work.lossEvaluations,
  );
  expect(
    released.result.solvedSnapshot!.solvedPoints.find(
      (p) => p.pointId === id("d"),
    )!.solvedPosition,
  ).toEqual(releaseGoal.position);
});

test("a release at the goal the last preview refused returns that verdict without solving it again", () => {
  // The k5d two-target corner replay: the second corner goal is refused.
  const corner = dragConditioningFixture.cases.find(
    (row) => row.scenario === "drag-corner",
  )!;
  const session = startConditioningReplay(corner);
  const settle = (goal: SketchDragTarget) => {
    let result = updateCompiledSketchSolveSession(session, goal, null);
    for (let calls = 0; result.kind === "pending" && calls < 40; calls += 1)
      result = updateCompiledSketchSolveSession(session, goal, null);
    return result;
  };
  expect(settle(corner.targets[0]![0]).kind).toBe("solved");
  const refusedGoal = corner.targets[1]![0];
  const refused = settle(refusedGoal);
  expect(refused.kind).toBe("blocked");

  const released = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(session, refusedGoal, 1e-4),
  );
  expect(released.result.kind).toBe("blocked");
  expect(solveIterations(released.work)).toBe(0);
  expect(released.work.lossEvaluations).toBe(0);
  expect(released.result.solvedSnapshot).toBe(refused.solvedSnapshot);
  expect(released.result.diagnostics).toEqual(refused.diagnostics);
});

// Guard for the stale-verdict check: a release drains an in-flight goal that
// ends refused, then accepts the release's own deferred translation. The
// stored refusal was solved from values that are no longer current, so a
// later release at that goal must solve it again.
test("a refused verdict is not reused once a later frame was accepted", () => {
  const corner = dragConditioningFixture.cases.find(
    (row) => row.scenario === "drag-corner",
  )!;
  const session = startConditioningReplay(corner);
  let settled = updateCompiledSketchSolveSession(
    session,
    corner.targets[0]![0]!,
    null,
  );
  for (let calls = 0; settled.kind === "pending" && calls < 40; calls += 1)
    settled = updateCompiledSketchSolveSession(
      session,
      corner.targets[0]![0]!,
      null,
    );
  expect(settled.kind).toBe("solved");
  const refusedGoal = corner.targets[1]![0]!;
  if (refusedGoal.kind !== "sketchPoint") throw new Error("point target");
  expect(
    updateCompiledSketchSolveSession(session, refusedGoal, null).kind,
  ).toBe("pending");
  const refusedFrom = session.values;
  const translated = updateCompiledSketchSolveSession(
    session,
    {
      kind: "sketchTranslate",
      pointIds: [refusedGoal.pointId],
      delta: [0.1, 0],
    },
    1e-4,
  );
  expect(translated.kind, "the deferred translation is accepted").toBe(
    "solved",
  );
  expect(session.values).not.toBe(refusedFrom);

  const released = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(session, refusedGoal, 1e-4),
  );
  expect(released.work.lossEvaluations).toBeGreaterThan(0);
});
