import { expect, test } from "vitest";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { traceSketchSolverForTest } from "./solve-tracing";
import {
  updateCompiledSketchSolveSession,
  updateCompiledSketchSolveSessionFrame,
} from "./update-session";
import { finishSolve } from "./solve-steps";
import {
  dragConditioningFixture,
  startConditioningReplay,
  approvedFirstGoalGeometry,
  cubicCoordinateDelta,
  dragSnapshotGeometry,
  type ApprovedDragGeometry,
} from "./solver-drag-conditioning.fixtures";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
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

for (const row of dragConditioningFixture.cases) {
  if (row.scenario === "drag-small") continue;
  const baseline = approvedFirstGoalGeometry[row.scenario];
  const [goal] = row.targets[0]!;
  const unchangedGoal =
    goal.kind === "sketchTranslate"
      ? { ...goal, delta: [0, 0] as const }
      : goal;

  test(`${row.scenario}: identical goals progress privately and publish the uninterrupted accepted iterate`, () => {
    const session = startConditioningReplay(row);
    const initial = session.lastAcceptedSnapshot;
    const uninterrupted = startConditioningReplay(row);
    const expectedPreview = finishSolve(
      updateCompiledSketchSolveSessionFrame(uninterrupted, goal, null),
    );
    expectAuthored(expectedPreview.solvedSnapshot!);
    let frames = 0;
    for (; frames < 80; frames += 1) {
      const trace = traceSketchSolverForTest(() =>
        updateCompiledSketchSolveSession(
          session,
          frames === 0 ? goal : unchangedGoal,
          null,
        ),
      );
      expect(
        trace.work.bfgsIterations + (trace.work.gaussNewtonIterations ?? 0),
      ).toBeLessThanOrEqual(48);
      expect(
        trace.work.dragConditioningResidualEvaluations,
      ).toBeLessThanOrEqual(2500);
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
    const session = startConditioningReplay(row);
    const initial = session.lastAcceptedSnapshot;
    const preview = updateCompiledSketchSolveSession(session, goal, null);
    expect(preview.solvedSnapshot).toBe(initial);
    const release = updateCompiledSketchSolveSession(
      session,
      unchangedGoal,
      1e-4,
    );
    expectAuthored(release.solvedSnapshot!);
    const uninterrupted = startConditioningReplay(row);
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

test("a Jacobian larger than one raw budget resumes its blocks; relative translation accumulates through substeps and release", () => {
  const fixture = makeSketchFixture();
  const pointIds = Array.from({ length: 34 }, (_, i) => fixture.point(`p${i}`, i, 0));
  for (let i = 1; i < pointIds.length; i += 1) {
    fixture.line(`l${i}`, `p${i - 1}`, `p${i}`);
    fixture.lineLength(`l${i}`, 1);
  }
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_large_jacobian",
    program: compileSketchSolveProgram({
      definition: literalResolvedDefinition(fixture.definition()),
      projectedReferences: [],
      tolerances: { coincidence: 1e-6, angleRadians: 1e-6, minimumSegmentLength: 1e-6 },
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  expect(started.kind).toBe("started");
  if (started.kind !== "started") return;
  const session = started.session;
  const initial = session.lastAcceptedSnapshot;
  const target = { kind: "sketchTranslate", pointIds, delta: [6, 3] } as const;
  const first = traceSketchSolverForTest(() => updateCompiledSketchSolveSession(session, target, null));
  expect(first.result.solvedSnapshot).toBe(initial);
  expect(first.work.dragConditioningResidualEvaluations).toBe(2500);
  // A second relative goal must be deferred, not substituted for the first.
  const second = traceSketchSolverForTest(() => updateCompiledSketchSolveSession(session, { ...target, delta: [2, 1] }, null));
  expect(second.work.dragConditioningResidualEvaluations).toBeLessThanOrEqual(2500);
  expectAuthored(second.result.solvedSnapshot!);
  let frames = 0;
  while (session.lastAcceptedSnapshot === initial && frames < 100) {
    const trace = traceSketchSolverForTest(() => updateCompiledSketchSolveSession(session, { ...target, delta: [0, 0] }, null));
    expect(trace.work.dragConditioningResidualEvaluations).toBeLessThanOrEqual(2500);
    expect(trace.work.bfgsIterations + (trace.work.gaussNewtonIterations ?? 0)).toBeLessThanOrEqual(48);
    expectAuthored(trace.result.solvedSnapshot!);
    frames += 1;
  }
  expect(frames).toBeLessThan(100);
  expect(session.lastAcceptedSnapshot).not.toBe(initial);
  const released = updateCompiledSketchSolveSession(session, { ...target, delta: [1, 2] }, 1e-6);
  expectAuthored(released.solvedSnapshot!);
  for (const [i, id] of pointIds.entries()) {
    const position = released.solvedSnapshot!.solvedPoints.find((p) => p.pointId === id)!.solvedPosition;
    expect(position[0]).toBeCloseTo(i + 9, 5);
    expect(position[1]).toBeCloseTo(6, 5);
  }
  // The old accepted target must not trigger the repeated-frame shortcut while
  // a DIFFERENT goal is private. Release drains that goal first, then pins the
  // reachable cursor exactly rather than publishing the private intermediate.
  const pointId = pointIds.at(-1)!;
  const acceptedGoal = { kind: "sketchPoint", pointId, position: [42, 6] } as const;
  const accepted = updateCompiledSketchSolveSession(session, acceptedGoal, 1e-6);
  const pending = updateCompiledSketchSolveSession(session, { ...acceptedGoal, position: [45, 8] }, null);
  expect(pending.solvedSnapshot).toBe(accepted.solvedSnapshot);
  const pointRelease = updateCompiledSketchSolveSession(session, acceptedGoal, 1e-6);
  expectAuthored(pointRelease.solvedSnapshot!);
  expect(pointRelease.solvedSnapshot!.solvedPoints.find((p) => p.pointId === pointId)!.solvedPosition).toEqual(acceptedGoal.position);
});
