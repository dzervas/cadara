import { expect, test } from "vitest";
import { traceSketchSolverForTest } from "./solve-tracing";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  approvedSmallDragFrames,
  cubicCoordinateDelta,
  dragConditioningFixture,
  startConditioningReplay,
} from "./solver-drag-conditioning.fixtures";
// Logic lane, heavy tier: twenty real interactive frames per captured T18 drag.
// The fast companion pins the first-frame work and reachable exact release.

test("release-coordinate bounds include interior cubic extrema, not only fit points", () => {
  const zero = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ] as const;
  expect(
    cubicCoordinateDelta(zero, [
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 0],
    ]),
  ).toBe(0.75);
  expect(
    cubicCoordinateDelta(zero, [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 0],
    ]),
  ).toBeCloseTo(Math.sqrt(3) / 6, 14);
  expect(
    cubicCoordinateDelta(zero, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0.01],
    ]),
  ).toBe(0.01);
});

for (const row of dragConditioningFixture.cases) {
  test(`${row.scenario}: authored requirements, release geometry and small-delta approval survive the full replay`, () => {
    const session = startConditioningReplay(row);
    let moveIterations = 0;
    let publishedFrames = 0;
    for (const [frame, [target, tolerance]] of row.targets.entries()) {
      const previous = session.lastAcceptedSnapshot;
      const trace = traceSketchSolverForTest(() =>
        updateCompiledSketchSolveSession(session, target, tolerance),
      );
      const result = trace.result;
      const snapshot = result.solvedSnapshot!;
      expect(
        snapshot.constraintStatuses.every((s) => s.status === "satisfied"),
        `frame ${frame}: authored constraints`,
      ).toBe(true);
      expect(
        snapshot.dimensionStatuses.every((s) => s.status === "driving"),
        `frame ${frame}: authored dimensions`,
      ).toBe(true);
      if (snapshot !== previous) publishedFrames += 1;
      // A pending preview returns the last accepted object, not a new candidate
      // labelled nonconvergent. Once work finishes, the unchanged corner judge
      // still refuses every goal after the first (cadara-9sz owns reachability).
      if (tolerance !== null || row.scenario === "drag-small")
        expect(result.kind).toBe(row.baselineKinds[frame]);
      // cadara-9sz tracks why the corner's later targets are refused. This
      // performance change must not relabel them solved or publish bad values.
      if (result.kind === "blocked") expect(snapshot).toBe(previous);
      if (frame < row.targets.length - 1) {
        moveIterations += trace.work.bfgsIterations;
        expect(
          trace.work.bfgsIterations + (trace.work.gaussNewtonIterations ?? 0),
          `frame ${frame}: shared iterative budget`,
        ).toBeLessThanOrEqual(48);
        expect(
          trace.work.dragConditioningResidualEvaluations,
          `frame ${frame}: raw GN budget`,
        ).toBeLessThanOrEqual(2500);
        // Wolfe has at most 15 trials per BFGS/conditioning step; fallback
        // damping has at most 12. These searches cannot escape the work cap.
        expect(trace.work.lineSearchTrials).toBeLessThanOrEqual(
          15 * (48 + trace.work.dragConditioningIterations),
        );
      }
      if (row.scenario === "drag-small") {
        const approved = approvedSmallDragFrames[frame]!;
        expect(snapshot.solvedPoints).toHaveLength(approved.points.length);
        for (const [id, x, y] of approved.points) {
          const point = snapshot.solvedPoints.find(
            (p) => p.pointId === id,
          )!.solvedPosition;
          expect(
            Math.hypot(point[0] - x, point[1] - y),
            `frame ${frame}: approved point ${id}`,
          ).toBeLessThanOrEqual(
            dragConditioningFixture.compile.modelingTolerance,
          );
        }
        const splines = snapshot.solvedEntities.filter(
          (e) => e.kind === "spline",
        );
        expect(splines).toHaveLength(approved.splines.length);
        for (const before of approved.splines) {
          const after = splines.find((e) => e.entityId === before.entityId)!;
          expect(after.reconstruction.spans).toHaveLength(before.poles.length);
          for (const [index, poles] of before.poles.entries())
            expect(
              // Each coordinate is bounded by tolerance / sqrt(2), so the
              // whole 2D cubic stays within the configured modeling accuracy.
              cubicCoordinateDelta(
                poles,
                after.reconstruction.spans[index]!.poles,
              ),
              `frame ${frame}: approved spline ${before.entityId} span ${index}`,
            ).toBeLessThanOrEqual(
              dragConditioningFixture.compile.modelingTolerance / Math.SQRT2,
            );
        }
        expect(trace.work.dragConditioningIterations).toBe(0);
        expect(trace.work.dragConditioningResidualEvaluations).toBe(0);
      }
    }
    if (row.scenario !== "drag-small") {
      if (row.scenario === "drag-corner") expect(publishedFrames).toBe(1);
      expect(moveIterations / 20).toBeLessThanOrEqual(
        row.scenario === "drag-large" ? 90 : 240,
      );
      const snapshot = session.lastAcceptedSnapshot;
      const points = new Map(
        snapshot.solvedPoints.map((p) => [p.pointId, p.solvedPosition]),
      );
      expect(points.size).toBe(row.baselineReleasePoints.length);
      for (const [id, x, y] of row.baselineReleasePoints) {
        const point = points.get(id)!;
        expect(
          Math.max(Math.abs(point[0] - x), Math.abs(point[1] - y)),
          `release point ${id}`,
        ).toBeLessThanOrEqual(0.05);
      }
    }
    // The approved continued far-drag gate is stored free-point coordinates,
    // not a freehand curve-locus bound. Keep the deterministic small-delta
    // path's original final whole-cubic gate in addition to every-frame approval.
    if (row.scenario === "drag-small") {
      const snapshot = session.lastAcceptedSnapshot;
      const splines = snapshot.solvedEntities.filter(
        (e) => e.kind === "spline",
      );
      expect(splines.length).toBe(row.baselineReleaseSplines.length);
      for (const before of row.baselineReleaseSplines) {
        const after = splines.find((e) => e.entityId === before.entityId)!;
        expect(after.reconstruction.spans.length).toBe(before.poles.length);
        for (const [index, poles] of before.poles.entries())
          expect(
            cubicCoordinateDelta(
              poles,
              after.reconstruction.spans[index]!.poles,
            ),
            `release spline ${before.entityId} span ${index}`,
          ).toBeLessThanOrEqual(0.01);
      }
    }
  }, 60_000);
}
