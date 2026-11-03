import type { ComponentJacobian } from "./automatic-differentiation";
import {
  chiralityMargin,
  deriveChiralityInvariants,
} from "./constrained-chirality";
import {
  dipsBelowAlongMove,
  solveConstrainedMinimumMotionSteps,
} from "./constrained-minimum-motion";
import type { SolveSteps } from "./solve-steps";
import { solverWorkTrace } from "./solve-tracing";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveProgram,
} from "./system-types";

/**
 * The boundary margins g ≥ 0 of a drag at the last accepted frame
 * (`previous`): the row-derived branch invariants (`deriveChiralityInvariants`)
 * of the stage's hard rows, and the row layer's entity validity inequalities
 * (`BuildSystemResult.inequalities` that restate no requirement: a
 * segment's length, a radius, at least τ) that hold at `previous` and read
 * one of `variables` (every one when omitted).
 *
 * The boundary policy "block": a drag stops at a boundary. The constrained
 * step refuses a frame whose step reached the boundary of a margin that was
 * clear of it at `previous` (`clearAtPrevious`), even if it slid off again:
 * sliding along a collinear triple is a flip path, sliding along a length of
 * τ a fold path. A margin already on its boundary at `previous` does not
 * block, so a triple held there does not freeze the drag by itself. A
 * result reached without a step path (a projection, phases A and B, a
 * re-check) shows only its end state, so the same rule reads it there:
 * `refuses(values)` holds when a margin is below its boundary (or not
 * finite), or when one clear of it at `previous` is on it at `values`, the
 * boundary was reached. A result that is a straight move from a known
 * candidate (the exact-reach projection) is also read along that move:
 * `refusesMove(from, to)` holds as well when a margin dips below its
 * boundary inside it (an unsigned length through zero, `dipsBelowAlongMove`).
 * "On its boundary" is within `BRANCH_BOUNDARY_TOLERANCES` τ, the band in
 * which the step lands on and slides along an active inequality.
 */
export type DragBranchInvariants = {
  margins: readonly ((values: Float64Array) => ComponentJacobian)[];
  clearAtPrevious: readonly boolean[];
  refuses: (values: Float64Array) => boolean;
  refusesMove: (from: Float64Array, to: Float64Array) => boolean;
};

export function deriveDragBranchInvariants(
  program: SketchCompiledSolveProgram,
  hardConstraints: readonly ScalarConstraintRecord[],
  previous: Float64Array,
  variables?: readonly number[],
): DragBranchInvariants {
  // A validity row already violated (or not finite) at `previous` is not
  // enforced: the drag does not repair it.
  const read = variables && new Set(variables);
  const validity = program.system.inequalities.filter(
    (inequality) =>
      inequality.requirement === undefined &&
      (!read || inequality.variableIndices.some((index) => read.has(index))) &&
      inequality.evaluate(previous).components[0]! >= 0,
  );
  const margins = [
    ...deriveChiralityInvariants(program, hardConstraints, previous).map(
      (invariant) => chiralityMargin(program, invariant),
    ),
    ...validity.map(
      (inequality) => (values: Float64Array) => inequality.evaluate(values),
    ),
  ];
  const tolerance = BRANCH_BOUNDARY_TOLERANCES * program.modelingTolerance;
  const onBoundaryAtPrevious = margins.map(
    (margin) => margin(previous).components[0]! <= tolerance,
  );
  const refuses = (values: Float64Array) =>
    margins.some((margin, index) => {
      const at = margin(values).components[0]!;
      return (
        !(at >= -tolerance) || (at <= tolerance && !onBoundaryAtPrevious[index])
      );
    });
  return {
    margins,
    clearAtPrevious: onBoundaryAtPrevious.map((onBoundary) => !onBoundary),
    refuses,
    refusesMove: (from, to) => {
      if (refuses(to)) return true;
      const move = to.map((value, index) => value - from[index]!);
      const sampleOf = (jacobian: ComponentJacobian) => ({
        value: jacobian.components[0]!,
        slope: jacobian.rows[0]!.reduce(
          (sum, entry, index) => sum + entry * move[index]!,
          0,
        ),
      });
      return margins.some(
        (margin) =>
          dipsBelowAlongMove(
            (t) =>
              sampleOf(
                margin(from.map((value, index) => value + t * move[index]!)),
              ),
            -tolerance,
            sampleOf(margin(from)),
            sampleOf(margin(to)),
          ).dips,
      );
    },
  };
}

/**
 * cadara-p4r5.2: one drag stage by the equality-constrained minimum-motion
 * step (`SketchDragStep` "constrained"), on row data only:
 * - equalities: every component of the stage's hard rows, except a component
 *   that an inequality restates (`hingeComponentIndices` with its
 *   `requirement`): that inequality is enforced instead (active set);
 * - inequalities: those restatements (ordinary sliding constraints) and
 *   the stage's branch invariants and validity margins
 *   (`DragBranchInvariants`), with the boundary band
 *   `BRANCH_BOUNDARY_TOLERANCES` τ;
 * - objective: the drag goal rows and the minimum-motion anchor.
 * Null when the step is unavailable at this frame (counted in the work
 * trace), so the caller runs phases A and B. "refused" (the caller yields no
 * candidate, so no re-check can accept the frame):
 * - "boundaryReached": an accepted move held a margin that was clear of its
 *   boundary at `previous` (policy "block");
 * - "stalled": the step accepted no move and stopped because no trial
 *   length could be corrected (stop "radius"); its values are the corrected
 *   start, which would read as solved without motion.
 */
export function* solveConstrainedDragStage(input: {
  program: SketchCompiledSolveProgram;
  hardConstraints: readonly ScalarConstraintRecord[];
  objective: readonly ScalarConstraintRecord[];
  start: Float64Array;
  invariants: DragBranchInvariants;
  variables: readonly number[];
}): SolveSteps<
  | { kind: "moved"; values: Float64Array }
  | { kind: "refused"; reason: "boundaryReached" | "stalled" }
  | null
> {
  const { margins, clearAtPrevious } = input.invariants;
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
    blocking: clearAtPrevious.flatMap((clear, index) =>
      clear ? [restated.length + index] : [],
    ),
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
  const boundaryReached = result.stop === "blocked";
  if (solverWorkTrace) {
    solverWorkTrace.constrainedStepBoundaryInvariants += margins.length;
    if (stalled) solverWorkTrace.constrainedStepStalledStops += 1;
    else if (boundaryReached)
      solverWorkTrace.constrainedStepBoundaryRefusals += 1;
  }
  if (stalled) return { kind: "refused", reason: "stalled" };
  if (boundaryReached) return { kind: "refused", reason: "boundaryReached" };
  return { kind: "moved", values: result.values };
}

/**
 * An inequality (boundary margin or restated hinge) within this many τ of
 * its boundary sits on it: the constrained step's boundary band and the
 * block rule's tolerance. In units of the model tolerance, so a drag does
 * not depend on where the sketch sits relative to the origin. A wider band
 * (1e-2) holds a margin that is merely close: the rounded-rectangle drag back
 * then stops following the cursor (0.16 lag).
 */
export const BRANCH_BOUNDARY_TOLERANCES = 1e-3;
