import { preconditionValuesForPointAnchors } from "./compile-program";
import { classifySolvedConstrainedness } from "./materialize-result";
import { solveProgramValuesPreferringAxes } from "./mirror-axis-preference";
import {
  reevaluateProgramValues,
  solveWithRebuildRetry,
} from "./solve-program";
import type { SketchCoreSolveResult } from "./solve-types";
import { isAcceptableSolvedSnapshot } from "./start-session";
import type { SketchCompiledSolveProgram } from "./system-types";

export function solveCompiledSketchProgram(
  program: SketchCompiledSolveProgram,
  initialValues: Float64Array = program.system.initialValues,
): SketchCoreSolveResult {
  const preconditionedValues = preconditionValuesForPointAnchors(
    program,
    initialValues,
  );
  // [TECH] G16‴/G16⁗: the blocked set is decided on the solve's start
  // state, with one re-solve when a blocked offset builds at the end.
  const final = solveWithRebuildRetry({
    program,
    startValues: preconditionedValues,
    solve: () =>
      solveProgramValuesPreferringAxes(program, preconditionedValues),
    retry: (from) => solveProgramValuesPreferringAxes(program, from),
    valuesOf: (solved) => solved.solved.values,
    reevaluate: (values) => reevaluateProgramValues(program, values),
    isAccepted: (solved) =>
      isAcceptableSolvedSnapshot(solved.result.solvedSnapshot),
  });
  classifySolvedConstrainedness(program, final.solved.values, final.result);
  return final.result;
}
