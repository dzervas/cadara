import { solveConstrainedMinimumMotionSteps } from "./constrained-minimum-motion";
import type { SolveSteps } from "./solve-steps";
import { solverWorkTrace } from "./solve-tracing";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveProgram,
} from "./system-types";

/**
 * cadara-p4r5.2: one drag stage by the equality-constrained minimum-motion
 * step (`SketchDragStep` "constrained"), on row data only:
 * - equalities: every component of the stage's hard rows, except a component
 *   that an inequality restates (`hingeComponentIndices` with its
 *   `requirement`): that inequality is enforced instead (active set);
 * - objective: the drag goal rows and the minimum-motion anchor.
 * Validity inequalities (segment length, radius) are not enforced: the
 * acceptance judge and its entity guard decide those frames as without the
 * step. Null when the step is unavailable at this frame (counted in the work
 * trace), so the caller runs phases A and B.
 */
export function* solveConstrainedDragStage(input: {
  program: SketchCompiledSolveProgram;
  hardConstraints: readonly ScalarConstraintRecord[];
  objective: readonly ScalarConstraintRecord[];
  start: Float64Array;
  variables: readonly number[];
}): SolveSteps<Float64Array | null> {
  const restated = input.program.system.inequalities.filter((inequality) =>
    input.hardConstraints.some(
      (row) =>
        row.id === inequality.requirement?.id &&
        row.hingeComponentIndices?.includes(
          inequality.requirement.componentIndex,
        ),
    ),
  );
  const result = yield* solveConstrainedMinimumMotionSteps({
    start: input.start,
    variables: input.variables,
    equalities: input.hardConstraints.map((row) => ({
      evaluate: (values) => row.evaluateComponentJacobian(values),
      excludedComponents: restated.flatMap((inequality) =>
        inequality.requirement!.id === row.id
          ? [inequality.requirement!.componentIndex]
          : [],
      ),
    })),
    inequalities: restated.map(
      (inequality) => (values: Float64Array) => inequality.evaluate(values),
    ),
    objective: input.objective.map((row) => ({
      evaluate: (values: Float64Array) => row.evaluateComponentJacobian(values),
    })),
  });
  if (solverWorkTrace) {
    solverWorkTrace.constrainedStepStages += 1;
    solverWorkTrace.constrainedStepRestatedComponents += restated.length;
    if (result.kind === "solved" && result.stop === "rowUnavailable")
      solverWorkTrace.constrainedStepRowUnavailableStops += 1;
    solverWorkTrace.constrainedStepIterations += result.stats.iterations;
    solverWorkTrace.constrainedStepNewtonIterations +=
      result.stats.newtonIterations;
    if (result.kind === "unavailable") {
      if (result.reason === "jacobianUnavailable")
        solverWorkTrace.constrainedStepJacobianUnavailable += 1;
      else solverWorkTrace.constrainedStepStartNotCorrectable += 1;
    }
  }
  return result.kind === "solved" ? result.values : null;
}
