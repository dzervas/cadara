import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { traceSketchSolverForTest } from "./solve-tracing";
import { updateCompiledSketchSolveSession } from "./update-session";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "./solver-drag-conditioning.fixtures";
// Logic lane, heavy tier: twenty real interactive frames per captured T18 drag.
// The fast companion pins the first-frame work and reachable exact release.

// Bound the entire cubic locus, not just a few sampled points. The maximum of
// each coordinate's difference is at an endpoint or a zero of its derivative.
// Off-curve control poles are not geometric points (they may differ by more).
function cubicCoordinateDelta(
  before: readonly SketchPoint2D[],
  after: readonly SketchPoint2D[],
) {
  let maximum = 0;
  for (const coordinate of [0, 1] as const) {
    const [p0, p1, p2, p3] = before.map(
      (p, i) => after[i]![coordinate] - p[coordinate],
    );
    const a = -p0! + 3 * p1! - 3 * p2! + p3!;
    const b = 3 * p0! - 6 * p1! + 3 * p2!;
    const c = -3 * p0! + 3 * p1!;
    const candidates = [0, 1];
    if (a === 0) {
      if (b !== 0) candidates.push(-c / (2 * b));
    } else {
      const discriminant = 4 * b * b - 12 * a * c;
      if (discriminant >= 0)
        for (const sign of [-1, 1])
          candidates.push((-2 * b + sign * Math.sqrt(discriminant)) / (6 * a));
    }
    for (const t of candidates)
      if (t >= 0 && t <= 1)
        maximum = Math.max(maximum, Math.abs(((a * t + b) * t + c) * t + p0!));
  }
  return maximum;
}

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
        expect(trace.work.bfgsIterations + (trace.work.gaussNewtonIterations ?? 0), `frame ${frame}: shared iterative budget`).toBeLessThanOrEqual(48);
        expect(trace.work.dragConditioningResidualEvaluations, `frame ${frame}: raw GN budget`).toBeLessThanOrEqual(2500);
        // Wolfe has at most 15 trials per BFGS/conditioning step; fallback
        // damping has at most 12. These searches cannot escape the work cap.
        expect(trace.work.lineSearchTrials).toBeLessThanOrEqual(15 * (48 + trace.work.dragConditioningIterations));
      }
      if (row.scenario === "drag-small") {
        const geometry = [
          snapshot.solvedPoints.map((p) => [p.pointId, ...p.solvedPosition]),
          snapshot.solvedEntities.filter((e) => e.kind === "spline"),
        ];
        expect(
          createHash("sha256").update(JSON.stringify(geometry)).digest("hex"),
          `frame ${frame}: bitwise baseline geometry`,
        ).toBe(row.baselineFrameDigests[frame]);
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
    // path's existing whole-cubic gate as well as its 21 bitwise digests.
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
