// cadara-b3k.26, logic lane, solver-core drag-session seam
// (`compileSketchSolveProgram`, `startCompiledSketchSolveSession`,
// `updateCompiledSketchSolveSession`) observed through the
// `traceSketchSolverForTest` work counters: a drag frame's loss evaluations
// are its line-search trials plus the few evaluations outside Wolfe searches
// (solver starts and candidate judging), never one more per iteration. Before
// the fix every Wolfe line search re-evaluated the loss at its start point,
// which the caller already held: 39% of all evaluations in the T18 drag
// profile (.scratch/sketch-product-readiness/b3k-evidence/cadara-b3k.26).
import { expect, test } from "vitest";

import type { SketchPointId } from "@/contracts/shared/ids";
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
