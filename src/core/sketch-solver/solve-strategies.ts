import {
  solveBfgsOver,
  solveBfgsOverSteps,
  solveGradientDescentSteps,
} from "./bfgs";
import { solveGaussNewtonLikeSteps } from "./gauss-newton";
import { SOLVED_LOSS_THRESHOLD } from "./solve-constants";
import { finishSolve } from "./solve-steps";
import { gaussNewtonFallbackTrace } from "./solve-tracing";
import type { SketchSolveStrategy } from "./solve-types";
import type { ScalarConstraintRecord } from "./system-types";

export type SolvedSystemValues = Pick<
  ReturnType<typeof solveBfgsOver>,
  "values" | "loss" | "perConstraint"
>;

/**
 * BFGS, then (when it is not accepted) Gauss–Newton as a polish or saddle
 * escape. T13e2:
 * - C3: an accepted BFGS result is returned as is. Without an acceptance
 *   callback (drag phase B) a low loss stands for acceptance, as before.
 * - C1: Gauss–Newton continues from BFGS's end values, not from the start:
 *   restarted from the start it re-solved the whole problem on the
 *   half-squared rows (hundreds of iterations on an inconsistent sketch)
 *   and never beat BFGS there.
 * - C2: its normal equations are solved by a pivoted Cholesky.
 * - Review A-1: with an acceptance callback it stops at the first accepted
 *   iterate (a rescue no longer polishes to the 1000-iteration cap).
 */
export function* solveBfgsWithGaussNewtonFallbackSteps(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  isAccepted?: (solved: SolvedSystemValues) => boolean,
) {
  const bfgs = yield* solveBfgsOverSteps(initialValues, constraints);
  // A low total loss is not acceptance: each requirement is judged against
  // its own document tolerance, which can be tighter than this threshold.
  if (isAccepted ? isAccepted(bfgs) : bfgs.loss < SOLVED_LOSS_THRESHOLD) {
    gaussNewtonFallbackTrace?.push({
      skipped: true,
      bfgsLoss: bfgs.loss,
      startLoss: null,
      iterations: 0,
      linearSolve: "pivotedCholesky",
    });
    return bfgs;
  }

  const gaussNewton = yield* solveGaussNewtonLikeSteps(bfgs.values, constraints, {
    maxIterations: 1000,
    minLoss: 1e-14,
    stepSize: 1,
    damping: 0,
    pseudoInverseEpsilon: 1e-12,
    linearSolve: "pivotedCholesky",
    strictDecrease: true,
    ...(isAccepted ? { stopWhenAccepted: isAccepted } : {}),
  });
  gaussNewtonFallbackTrace?.push({
    skipped: false,
    bfgsLoss: bfgs.loss,
    startLoss: gaussNewton.startLoss,
    iterations: gaussNewton.iterations,
    linearSolve: "pivotedCholesky",
  });
  return gaussNewton.loss < bfgs.loss ? gaussNewton : bfgs;
}

export function solveSystemValues(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  strategy: SketchSolveStrategy,
  /** Absent (drag phase B): a low loss stands for acceptance. */
  isAccepted?: (solved: SolvedSystemValues) => boolean,
) {
  return finishSolve(
    solveSystemValuesSteps(initialValues, constraints, strategy, isAccepted),
  );
}

export function* solveSystemValuesSteps(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  strategy: SketchSolveStrategy,
  isAccepted?: (solved: SolvedSystemValues) => boolean,
) {
  return strategy === "gradientDescent"
    ? yield* solveGradientDescentSteps(initialValues, constraints)
    : strategy === "gaussNewton"
      ? yield* solveGaussNewtonLikeSteps(initialValues, constraints, {
          maxIterations: 500,
          minLoss: 1e-8,
          stepSize: 1,
          damping: 0,
          pseudoInverseEpsilon: 1e-6,
        })
      : strategy === "levenbergMarquardt"
        ? yield* solveGaussNewtonLikeSteps(initialValues, constraints, {
            maxIterations: 1000,
            minLoss: 1e-10,
            stepSize: 0.1,
            damping: 1e-5,
            pseudoInverseEpsilon: 1e-6,
          })
        : strategy === "bfgsWithoutFallback"
          ? yield* solveBfgsOverSteps(initialValues, constraints)
          : yield* solveBfgsWithGaussNewtonFallbackSteps(
              initialValues,
              constraints,
              isAccepted,
            );
}
