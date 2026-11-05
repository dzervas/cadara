import { expect, test } from "vitest";
import type { SketchPointId } from "@/contracts/shared/ids";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { traceSketchSolverForTest } from "./solve-tracing";
import type { SketchSolverWorkTrace } from "./solve-tracing";
import type { SketchDragTarget } from "./solve-types";
import {
  dragReplayFixture,
  startDragReplay,
} from "./solver-drag-replay.fixtures";
import { suspendDragContinuation } from "./drag-continuation.fixtures";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
// Logic lane: release work, goal supersession and refused-verdict reuse at
// the compiled-session continuation seam.

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
  work.constrainedStepIterations + work.constrainedStepNewtonIterations +
  work.bfgsIterations + work.gaussNewtonIterations;

test("a release at a new cursor drops the obsolete in-flight point goal: it costs no more than the release goal alone and reaches the cursor exactly", () => {
  const session = startDragWorkSession(
    "interactive_sketch_solve_drop_point_goal",
  );
  suspendDragContinuation(session, { kind: "sketchPoint", pointId: id("d"), position: [2, 2] });
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
  const corner = dragReplayFixture.cases.find(
    (row) => row.scenario === "drag-corner",
  )!;
  const session = startDragReplay(corner);
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
  const corner = dragReplayFixture.cases.find(
    (row) => row.scenario === "drag-corner",
  )!;
  const session = startDragReplay(corner);
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
  suspendDragContinuation(session, refusedGoal);
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
  expect(released.work.constrainedStepStages).toBeGreaterThan(0);
});
