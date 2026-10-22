// Logic lane: compiled drag-session work, exact release and minimum motion.
import { expect, test } from "vitest";
import {
  compileSketchSolveProgram,
  startCompiledSketchSolveSession,
  traceSketchSolverForTest,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "@/contracts/sketch/solver-drag-conditioning.fixtures";

for (const row of dragConditioningFixture.cases.filter(
  (r) => r.scenario !== "drag-small",
)) {
  test(`${row.scenario}: far-frame conditioning bounds BFGS work and exposes every numerical residual probe`, () => {
    const session = startConditioningReplay(row);
    const previous = session.lastAcceptedSnapshot;
    const [target, tolerance] = row.targets[0]!;
    const trace = traceSketchSolverForTest(() =>
      updateCompiledSketchSolveSession(session, target, tolerance),
    );
    expect(trace.result.kind).toBe("pending");
    // Unbudgeted GN10 needs 71 / 55 BFGS steps and 11210 / 10620 raw
    // blocks. A bare cap/fallback must not move that work into another phase.
    expect(trace.work.bfgsIterations + (trace.work.gaussNewtonIterations ?? 0)).toBeLessThanOrEqual(48);
    expect(trace.result.solvedSnapshot).toBe(previous);
    expect(trace.work.dragConditioningIterations).toBeGreaterThan(0);
    expect(trace.work.dragConditioningIterations).toBeLessThanOrEqual(10);
    // Ten Jacobians, each with one base + two evaluations per solved variable,
    // over 19 / 18 constraint blocks. Don't hide this cost as "71 iterations".
    const blocks = row.scenario === "drag-large" ? 19 : 18;
    expect(trace.work.dragConditioningResidualEvaluations).toBe(
      trace.work.dragConditioningIterations * (1 + 2 * 29) * blocks,
    );
    expect(trace.work.dragConditioningResidualEvaluations).toBeLessThanOrEqual(
      2500,
    );
    expect(trace.work.lossEvaluations).toBeLessThanOrEqual(200);
    expect(trace.work.lineSearchTrials).toBeLessThanOrEqual(190);
    expect(
      trace.result.solvedSnapshot!.constraintStatuses.every(
        (s) => s.status === "satisfied",
      ),
    ).toBe(true);
    expect(
      trace.result.solvedSnapshot!.dimensionStatuses.every(
        (s) => s.status === "driving",
      ),
    ).toBe(true);
  });
}

test("a reachable far point release is exact, preserves length, and leaves unrelated geometry untouched", () => {
  const fixture = makeSketchFixture();
  const a = fixture.point("a", 0, 0);
  const b = fixture.point("b", 1, 0);
  const c = fixture.point("c", 50, 50);
  const d = fixture.point("d", 55, 53);
  fixture.line("moving", "a", "b");
  fixture.lineLength("moving", 1);
  fixture.line("unrelated", "c", "d");
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_conditioned_exact_release",
    program: compileSketchSolveProgram({
      definition: literalResolvedDefinition(fixture.definition()),
      projectedReferences: [],
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  expect(started.kind).toBe("started");
  if (started.kind !== "started") return;
  const target = { kind: "sketchPoint", pointId: b, position: [6, 3] } as const;
  const preview = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(started.session, target, null),
  );
  expect(preview.work.dragConditioningIterations).toBeGreaterThan(0);
  const release = updateCompiledSketchSolveSession(
    started.session,
    target,
    1e-6,
  );
  for (const result of [preview.result, release]) {
    expect(result.kind).toBe(result === preview.result ? "pending" : "solved");
    const points = new Map(
      result.solvedSnapshot!.solvedPoints.map((p) => [
        p.pointId,
        p.solvedPosition,
      ]),
    );
    const pa = points.get(a)!,
      pb = points.get(b)!;
    expect(
      Math.abs(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) - 1),
    ).toBeLessThanOrEqual(1e-6);
    expect(points.get(c)).toEqual([50, 50]);
    expect(points.get(d)).toEqual([55, 53]);
    // The non-grabbed endpoint moves less than a rigid translation of the
    // whole line ([5,3], squared distance 34), retaining minimum-motion choice.
    expect(pa[0] ** 2 + pa[1] ** 2).toBeLessThan(33);
  }
  expect(
    release.solvedSnapshot!.solvedPoints.find((p) => p.pointId === b)!
      .solvedPosition,
  ).toEqual(target.position);
});
