import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { traceSketchSolverForTest } from "./solve-tracing";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  dragConditioningFixture,
  startConditioningReplay,
  uninterruptedFarDragDigests,
} from "./solver-drag-conditioning.fixtures";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
// Logic lane: compiled drag sessions; no scheduler, DOM or timing assumptions.

function digest(snapshot: SolvedSketchSnapshot) {
  return createHash("sha256").update(JSON.stringify([
    snapshot.solvedPoints.map((p) => [p.pointId, ...p.solvedPosition]),
    snapshot.solvedEntities.filter((e) => e.kind === "spline"),
  ])).digest("hex");
}

function expectAuthored(snapshot: SolvedSketchSnapshot) {
  expect(snapshot.constraintStatuses.every((s) => s.status === "satisfied")).toBe(true);
  expect(snapshot.dimensionStatuses.every((s) => s.status === "driving")).toBe(true);
}

for (const row of dragConditioningFixture.cases) {
  if (row.scenario === "drag-small") continue;
  const baseline = uninterruptedFarDragDigests[row.scenario];
  const [goal] = row.targets[0]!;
  const unchangedGoal = goal.kind === "sketchTranslate" ? { ...goal, delta: [0, 0] as const } : goal;

  test(`${row.scenario}: identical goals progress privately and publish the uninterrupted accepted iterate`, () => {
    const session = startConditioningReplay(row);
    const initial = session.lastAcceptedSnapshot;
    let frames = 0;
    for (; frames < 80; frames += 1) {
      const trace = traceSketchSolverForTest(() => updateCompiledSketchSolveSession(session, frames === 0 ? goal : unchangedGoal, null));
      expect(trace.work.bfgsIterations + (trace.work.gaussNewtonIterations ?? 0)).toBeLessThanOrEqual(48);
      expect(trace.work.dragConditioningResidualEvaluations).toBeLessThanOrEqual(2500);
      expectAuthored(trace.result.solvedSnapshot!);
      if (session.lastAcceptedSnapshot !== initial) break;
      expect(trace.result.solvedSnapshot).toBe(initial);
    }
    expect(frames).toBeGreaterThan(0); // Fails on the unbudgeted solver.
    expect(frames).toBeLessThan(80); // A cap without continuation never finishes.
    expect(digest(session.lastAcceptedSnapshot)).toBe(baseline.preview);
    const release = updateCompiledSketchSolveSession(session, unchangedGoal, 1e-4);
    expectAuthored(release.solvedSnapshot!);
    expect(digest(release.solvedSnapshot!)).toBe(baseline.release);
  });

  test(`${row.scenario}: release after the first exhausted budget flushes the private iterate`, () => {
    const session = startConditioningReplay(row);
    const initial = session.lastAcceptedSnapshot;
    const preview = updateCompiledSketchSolveSession(session, goal, null);
    expect(preview.solvedSnapshot).toBe(initial);
    const release = updateCompiledSketchSolveSession(session, unchangedGoal, 1e-4);
    expectAuthored(release.solvedSnapshot!);
    expect(digest(release.solvedSnapshot!)).toBe(baseline.release);
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
