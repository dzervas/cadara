import { expect, test } from "vitest";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { traceSketchSolverForTest } from "./solve-tracing";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
// Logic lane: exact release, authored length and unrelated geometry.

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
  expect(preview.work.constrainedStepStages).toBeGreaterThan(0);
  const release = updateCompiledSketchSolveSession(
    started.session,
    target,
    1e-6,
  );
  for (const result of [preview.result, release]) {
    expect(result.kind).toBe("solved");
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
