import { expect, test } from "vitest";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { compileSketchSolveProgram } from "./compile-program";
import { solveProgramValues } from "./solve-program";
import { solveSystemValues } from "./solve-strategies";
import { traceSketchSolverForTest } from "./solve-tracing";
import { isAcceptableSolvedValues } from "./start-session";

// Logic lane, heavy tier: one edited length on a connected under-determined
// chain. The compiled batch seam proves both accepted geometry and arithmetic
// scaling; the plain descent supplies a conservative work budget (one n²
// matrix-vector multiply per BFGS iteration, excluding all its updates).
test("an 802-variable chain's minimum-motion start costs at most twice plain descent's matrix-vector work", () => {
  const lines = 400;
  const fixture = makeSketchFixture();
  for (let index = 0; index <= lines; index += 1)
    fixture.point(`p${index}`, index, (index % 2) * 0.5);
  for (let index = 0; index < lines; index += 1) {
    fixture.line(`l${index}`, `p${index}`, `p${index + 1}`);
    fixture.lineLength(
      `l${index}`,
      Math.hypot(1, 0.5) + (index === lines / 2 ? 0.2 : 0),
    );
  }
  const program = compileSketchSolveProgram({
    definition: literalResolvedDefinition(fixture.definition()),
    tolerances: {
      coincidence: 1e-3,
      angleRadians: 1e-4,
      minimumSegmentLength: 1e-3,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
  const start = program.system.initialValues;
  const plain = traceSketchSolverForTest(() =>
    solveSystemValues(start, program.system.scalarConstraints, "bfgs"),
  );
  const batch = traceSketchSolverForTest(() =>
    solveProgramValues(program, start),
  );
  expect(isAcceptableSolvedValues(program, plain.result)).toBe(true);
  expect(isAcceptableSolvedValues(program, batch.result.solved)).toBe(true);
  const { work } = batch;
  const operations =
    work.constrainedStepNormalOperations +
    work.constrainedStepProjectionOperations +
    work.constrainedStepFactorOperations +
    work.constrainedStepCurvatureOperations;
  expect(operations).toBeGreaterThan(0);
  expect(operations).toBeLessThanOrEqual(
    2 * plain.work.bfgsIterations * start.length ** 2,
  );
  const motion = (values: Float64Array) =>
    Math.hypot(...values.map((value, index) => value - start[index]!));
  expect(motion(batch.result.solved.values)).toBeLessThanOrEqual(
    motion(plain.result.values) + 1e-6,
  );
});
