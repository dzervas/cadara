import type { ComponentJacobian } from "./automatic-differentiation";
import {
  chiralityMargin,
  deriveChiralityInvariants,
} from "./constrained-chirality";
import { solveConstrainedMinimumMotionSteps } from "./constrained-minimum-motion";
import type { SolveSteps } from "./solve-steps";
import { solverWorkTrace } from "./solve-tracing";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveProgram,
} from "./system-types";

/**
 * The row-derived branch invariants (`deriveChiralityInvariants`) of a drag
 * stage's hard rows at the last accepted frame (`previous`), as margins
 * g ≥ 0, and the boundary policy "block" over them: `refuses(values)` holds
 * when `values` leave the accepted branch, that is when a margin is below
 * its boundary (or not finite), or when one clear of its boundary at
 * `previous` sits on it at `values` (the step had to stop there). A margin
 * already on its boundary at `previous` refuses only a crossing, so a
 * triple held there does not freeze the drag by itself. "On its boundary"
 * is within `BRANCH_BOUNDARY_TOLERANCES` τ, the band in which the step lands
 * on and slides along an active inequality.
 */
export type DragBranchInvariants = {
  margins: readonly ((values: Float64Array) => ComponentJacobian)[];
  refuses: (values: Float64Array) => boolean;
};

export function deriveDragBranchInvariants(
  program: SketchCompiledSolveProgram,
  hardConstraints: readonly ScalarConstraintRecord[],
  previous: Float64Array,
): DragBranchInvariants {
  const margins = deriveChiralityInvariants(
    program,
    hardConstraints,
    previous,
  ).map((invariant) => chiralityMargin(program, invariant));
  const tolerance = BRANCH_BOUNDARY_TOLERANCES * program.modelingTolerance;
  const onBoundaryAtPrevious = margins.map(
    (margin) => margin(previous).components[0]! <= tolerance,
  );
  return {
    margins,
    refuses: (values) =>
      margins.some((margin, index) => {
        const at = margin(values).components[0]!;
        return (
          !(at >= -tolerance) ||
          (at <= tolerance && !onBoundaryAtPrevious[index])
        );
      }),
  };
}

/**
 * cadara-p4r5.2: one drag stage by the equality-constrained minimum-motion
 * step (`SketchDragStep` "constrained"), on row data only:
 * - equalities: every component of the stage's hard rows, except a component
 *   that an inequality restates (`hingeComponentIndices` with its
 *   `requirement`): that inequality is enforced instead (active set);
 * - inequalities: those restatements and the stage's branch invariants
 *   (`DragBranchInvariants`; the frame acceptance refuses a result that
 *   stopped on one), with the boundary band `BRANCH_BOUNDARY_TOLERANCES` τ;
 * - objective: the drag goal rows and the minimum-motion anchor.
 * Validity inequalities (segment length, radius) are not enforced: the
 * acceptance judge decides those frames as without the step. Null when the
 * step is unavailable at this frame (counted in the work trace), so the
 * caller runs phases A and B. `stalled`: the step accepted no move and
 * stopped because no trial length could be corrected (stop "radius"); its
 * values are the corrected start, so the caller yields no candidate (the
 * frame is refused) instead of reporting it solved without motion.
 */
export function* solveConstrainedDragStage(input: {
  program: SketchCompiledSolveProgram;
  hardConstraints: readonly ScalarConstraintRecord[];
  objective: readonly ScalarConstraintRecord[];
  start: Float64Array;
  invariants: DragBranchInvariants;
  variables: readonly number[];
}): SolveSteps<{ values: Float64Array; stalled: boolean } | null> {
  const { margins } = input.invariants;
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
    boundary: BRANCH_BOUNDARY_TOLERANCES * input.program.modelingTolerance,
    inequalities: [
      ...restated.map(
        (inequality) => (values: Float64Array) => inequality.evaluate(values),
      ),
      ...margins,
    ],
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
  if (result.kind !== "solved") return null;
  const stalled = result.stop === "radius" && result.stats.acceptedMoves === 0;
  if (solverWorkTrace) {
    solverWorkTrace.constrainedStepBoundaryInvariants += margins.length;
    if (stalled) solverWorkTrace.constrainedStepStalledStops += 1;
  }
  return { values: result.values, stalled };
}

/**
 * An inequality (branch invariant or restated hinge) within this many τ of
 * its boundary sits on it: the constrained step's boundary band and the
 * block rule's tolerance. In units of the model tolerance, so a drag does
 * not depend on where the sketch sits relative to the origin. A wider band
 * (1e-2) holds a margin that is merely close: the rounded-rectangle drag back
 * then stops following the cursor (0.16 lag).
 */
export const BRANCH_BOUNDARY_TOLERANCES = 1e-3;
