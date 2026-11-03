import { expect, test } from "vitest";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  compileSketchSolveProgram,
  preconditionValuesForPointAnchors,
} from "./compile-program";
import {
  solveProgramValues,
  traceBatchMinimumMotionStartsForTest,
} from "./solve-program";
import { solveSystemValues } from "./solve-strategies";
import {
  isAcceptableSolvedValues,
  startCompiledSketchSolveSession,
} from "./start-session";

// Logic lane; seam: the batch solve (`solveProgramValues`) and the drag
// session start that runs it. A closed regular polygon of `sides` lines,
// each with its length dimensioned, one length edited by +20 %: an
// under-determined edit on one connected component of 2·sides variables
// that the whole ring has to absorb by bending, where the plain
// least-squares descent lands measurably farther from the start than the
// nearest solution.
function editedRingProgram(sides: number) {
  const sketch = makeSketchFixture();
  const radius = sides / (2 * Math.PI);
  const side = 2 * radius * Math.sin(Math.PI / sides);
  for (let index = 0; index < sides; index += 1) {
    const angle = (2 * Math.PI * index) / sides;
    sketch.point(
      `p${index}`,
      radius * Math.cos(angle),
      radius * Math.sin(angle),
    );
  }
  for (let index = 0; index < sides; index += 1) {
    sketch.line(`l${index}`, `p${index}`, `p${(index + 1) % sides}`);
    sketch.lineLength(`l${index}`, side * (index === 0 ? 1.2 : 1));
  }
  return compileSketchSolveProgram({
    definition: literalResolvedDefinition(sketch.definition()),
    tolerances: {
      coincidence: 1e-3,
      angleRadians: 1e-4,
      minimumSegmentLength: 1e-3,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
}

test.each([30, 33, 40])(
  "a %s-sided ring edit: the batch solve and the drag session start take the constrained minimum-motion start (including above 64 moving variables), and the accepted result moves at least 1 % less than the plain least-squares descent",
  (sides) => {
    const program = editedRingProgram(sides);
    const start = preconditionValuesForPointAnchors(
      program,
      program.system.initialValues,
    );
    const batch = traceBatchMinimumMotionStartsForTest(() =>
      solveProgramValues(program, start),
    );
    expect(batch.starts).toEqual({
      constrained: 1,
      anchored: 0,
    });
    expect(isAcceptableSolvedValues(program, batch.result.solved)).toBe(true);
    const motion = (values: Float64Array) =>
      Math.hypot(
        ...Array.from(values, (value, index) => value - start[index]!),
      );
    const plain = solveSystemValues(
      start,
      program.system.scalarConstraints,
      "bfgs",
      (candidate) => isAcceptableSolvedValues(program, candidate),
    );
    expect(isAcceptableSolvedValues(program, plain)).toBe(true);
    // Measured (Node 24): 0.3022 vs 0.3060 at 30 sides, 0.3289 vs 0.3535
    // at 40.
    expect(motion(batch.result.solved.values)).toBeLessThan(
      motion(plain.values) * 0.99,
    );
    const session = traceBatchMinimumMotionStartsForTest(() =>
      startCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_ring",
        program,
      }),
    );
    expect(session.result.kind).toBe("started");
    expect(
      session.starts,
      "the drag start uses the same minimum-motion solve",
    ).toEqual(batch.starts);
  },
);
