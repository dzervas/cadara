import { dragContinuations } from "./drag-continuations";
import { DRAG_PREVIEW_RAW_BLOCKS } from "./solve-constants";
import type { SolveSteps } from "./solve-steps";
import type { SketchDraggedPointSolveResult } from "./solve-types";
import { expect, test } from "vitest";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { traceSketchSolverForTest } from "./solve-tracing";
import {
  updateCompiledSketchSolveSession,
  updateCompiledSketchSolveSessionFrame,
} from "./update-session";
import { suspendDragContinuation } from "./drag-continuation.fixtures";
import { finishSolve } from "./solve-steps";
import {
  dragReplayFixture,
  startDragReplay,
  approvedFirstGoalGeometry,
  cubicCoordinateDelta,
  dragSnapshotGeometry,
  type ApprovedDragGeometry,
} from "./solver-drag-replay.fixtures";
// Logic lane: compiled drag sessions; no scheduler, DOM or timing assumptions.

function expectApprovedGeometry(
  snapshot: SolvedSketchSnapshot,
  approved: ApprovedDragGeometry,
) {
  // Points and the complete cubic locus share the far-drag contract's existing
  // coordinate accuracy. Control poles alone are not points on the curve.
  const coordinateAccuracy = 0.05;
  expect(snapshot.solvedPoints).toHaveLength(approved.points.length);
  for (const [id, x, y] of approved.points) {
    const point = snapshot.solvedPoints.find(
      (p) => p.pointId === id,
    )!.solvedPosition;
    expect(
      Math.max(Math.abs(point[0] - x), Math.abs(point[1] - y)),
      `point ${id}`,
    ).toBeLessThanOrEqual(coordinateAccuracy);
  }
  const splines = snapshot.solvedEntities.filter((e) => e.kind === "spline");
  expect(splines).toHaveLength(approved.splines.length);
  for (const before of approved.splines) {
    const after = splines.find((e) => e.entityId === before.entityId)!;
    expect(after.reconstruction.spans).toHaveLength(before.poles.length);
    for (const [index, poles] of before.poles.entries())
      expect(
        cubicCoordinateDelta(poles, after.reconstruction.spans[index]!.poles),
        `approved spline ${before.entityId} span ${index}`,
      ).toBeLessThanOrEqual(coordinateAccuracy);
  }
}

function expectAuthored(snapshot: SolvedSketchSnapshot) {
  expect(
    snapshot.constraintStatuses.every((s) => s.status === "satisfied"),
  ).toBe(true);
  expect(snapshot.dimensionStatuses.every((s) => s.status === "driving")).toBe(
    true,
  );
}

for (const row of dragReplayFixture.cases) {
  if (row.scenario === "drag-small") continue;
  const baseline = approvedFirstGoalGeometry[row.scenario];
  const [goal] = row.targets[0]!;
  const unchangedGoal =
    goal.kind === "sketchTranslate"
      ? { ...goal, delta: [0, 0] as const }
      : goal;

  test(`${row.scenario}: identical goals progress privately and publish the uninterrupted accepted iterate`, () => {
    const session = startDragReplay(row);
    suspendDragContinuation(session, goal);
    const initial = session.lastAcceptedSnapshot;
    const uninterrupted = startDragReplay(row);
    const expectedPreview = finishSolve(
      updateCompiledSketchSolveSessionFrame(uninterrupted, goal, null),
    );
    expectAuthored(expectedPreview.solvedSnapshot!);
    let frames = 0;
    for (; frames < 80; frames += 1) {
      const trace = traceSketchSolverForTest(() =>
        updateCompiledSketchSolveSession(session, unchangedGoal, null),
      );
      expectAuthored(trace.result.solvedSnapshot!);
      if (session.lastAcceptedSnapshot !== initial) break;
      expect(trace.result.solvedSnapshot).toBe(initial);
    }
    expect(frames).toBeGreaterThan(0); // Fails on the unbudgeted solver.
    expect(frames).toBeLessThan(80); // A cap without continuation never finishes.
    expect(dragSnapshotGeometry(session.lastAcceptedSnapshot)).toEqual(
      dragSnapshotGeometry(expectedPreview.solvedSnapshot!),
    );
    expectApprovedGeometry(session.lastAcceptedSnapshot, baseline.preview);
    const release = updateCompiledSketchSolveSession(
      session,
      unchangedGoal,
      1e-4,
    );
    const expectedRelease = updateCompiledSketchSolveSession(
      uninterrupted,
      unchangedGoal,
      1e-4,
    );
    expect(release.kind).toBe(expectedRelease.kind);
    expectAuthored(release.solvedSnapshot!);
    expect(dragSnapshotGeometry(release.solvedSnapshot!)).toEqual(
      dragSnapshotGeometry(expectedRelease.solvedSnapshot!),
    );
    expectApprovedGeometry(release.solvedSnapshot!, baseline.release);
  });

  test(`${row.scenario}: release after the first exhausted budget flushes the private iterate`, () => {
    const session = startDragReplay(row);
    suspendDragContinuation(session, goal);
    const initial = session.lastAcceptedSnapshot;
    const preview = updateCompiledSketchSolveSession(
      session,
      unchangedGoal,
      null,
    );
    expect(preview.solvedSnapshot).toBe(initial);
    const release = updateCompiledSketchSolveSession(
      session,
      unchangedGoal,
      1e-4,
    );
    expectAuthored(release.solvedSnapshot!);
    const uninterrupted = startDragReplay(row);
    finishSolve(
      updateCompiledSketchSolveSessionFrame(uninterrupted, goal, null),
    );
    const expectedRelease = updateCompiledSketchSolveSession(
      uninterrupted,
      unchangedGoal,
      1e-4,
    );
    expect(release.kind).toBe(expectedRelease.kind);
    expect(dragSnapshotGeometry(release.solvedSnapshot!)).toEqual(
      dragSnapshotGeometry(expectedRelease.solvedSnapshot!),
    );
    expectApprovedGeometry(release.solvedSnapshot!, baseline.release);
  });
}

test("raw row work exceeding one preview budget remains private and resumes before release", () => {
  const row = dragReplayFixture.cases.find(
    (entry) => entry.scenario === "drag-small",
  )!;
  const session = startDragReplay(row);
  const [goal] = row.targets[0]!;
  if (goal.kind !== "sketchTranslate") throw new Error("Translation fixture");
  const initial = session.lastAcceptedSnapshot;
  let evaluated = 0;
  function* steps(): SolveSteps<SketchDraggedPointSolveResult> {
    yield { kind: "raw", count: DRAG_PREVIEW_RAW_BLOCKS };
    evaluated += DRAG_PREVIEW_RAW_BLOCKS;
    yield { kind: "raw", count: 1 };
    evaluated += 1;
    return yield* updateCompiledSketchSolveSessionFrame(session, goal, null);
  }
  const work = steps();
  dragContinuations.set(session, {
    target: goal,
    steps: work,
    next: work.next(),
  });
  const pending = updateCompiledSketchSolveSession(session, goal, null);
  expect(pending.kind).toBe("pending");
  expect(evaluated).toBe(DRAG_PREVIEW_RAW_BLOCKS);
  expect(pending.solvedSnapshot).toBe(initial);
  const released = updateCompiledSketchSolveSession(
    session,
    { ...goal, delta: [0, 0] },
    1e-4,
  );
  expect(evaluated).toBe(DRAG_PREVIEW_RAW_BLOCKS + 1);
  expect(released.kind).toBe("solved");
  expect(session.lastAcceptedSnapshot).not.toBe(initial);
});
