import { evaluateLoss, multiplyMatrixVector } from "./bfgs";
import {
  addDiagonal,
  multiplyMatrices,
  solvePivotedCholesky,
  sparseNormalMatrix,
  symmetricPseudoInverse,
  transpose,
} from "./normal-equations";
import type { SolveWork } from "./solve-steps";
import type { SolvedSystemValues } from "./solve-strategies";
import { solverWorkTrace } from "./solve-tracing";
import { addScaled, cloneValues } from "./solver-geometry";
import type { ScalarConstraintRecord } from "./system-types";

export function* solveGaussNewtonLikeSteps(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    maxIterations: number;
    minLoss: number;
    stepSize: number;
    damping: number;
    pseudoInverseEpsilon: number;
    /**
     * T13e2 (C2): how the damped normal equations are solved. The
     * Gauss–Newton fallback uses the pivoted Cholesky; the explicit
     * strategies keep the Jacobi pseudo-inverse.
     */
    linearSolve?: "pseudoInverse" | "pivotedCholesky";
    /**
     * T13e2 (C1): only a strict loss decrease is progress (the fallback). An
     * equal loss is otherwise accepted, so a stalled inconsistent system runs
     * to `maxIterations`; the explicit strategies keep that behaviour.
     */
    strictDecrease?: boolean;
    /**
     * T13e2 (review A-1): the fallback's goal is an accepted result, so it
     * stops at the first accepted iterate instead of polishing a rescue to
     * `minLoss` or the iteration cap.
     */
    stopWhenAccepted?: (solved: SolvedSystemValues) => boolean;
  },
) {
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);
  const startLoss = state.loss;
  const cholesky = options.linearSolve === "pivotedCholesky";
  let iterations = 0;

  for (
    let iteration = 0;
    iteration < options.maxIterations && state.loss > options.minLoss;
    iteration += 1
  ) {
    yield { kind: "iteration", count: 1 } satisfies SolveWork;
    if (solverWorkTrace) solverWorkTrace.gaussNewtonIterations += 1;
    iterations += 1;
    const jacobian = state.evaluations.map((evaluation) =>
      cloneValues(evaluation.gradient),
    );
    const losses = new Float64Array(
      state.evaluations.map((evaluation) => evaluation.residual),
    );
    const jT = transpose(jacobian);
    const normal = cholesky
      ? sparseNormalMatrix(jacobian, values.length)
      : multiplyMatrices(jT, jacobian);
    const normalWithDamping = addDiagonal(
      normal,
      options.damping + options.pseudoInverseEpsilon,
    );
    const rhs = multiplyMatrixVector(jT, losses);
    const delta = cholesky
      ? solvePivotedCholesky(
          normalWithDamping,
          rhs,
          options.pseudoInverseEpsilon,
        )
      : multiplyMatrixVector(
          symmetricPseudoInverse(
            normalWithDamping,
            options.pseudoInverseEpsilon,
          ),
          rhs,
        );

    if (!Array.from(delta).every(Number.isFinite)) {
      break;
    }

    let accepted = false;
    let stepScale = options.stepSize;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const nextValues = cloneValues(values);
      addScaled(nextValues, -stepScale, delta);
      if (!Array.from(nextValues).every(Number.isFinite)) {
        stepScale *= 0.5;
        continue;
      }

      const nextState = evaluateLoss(nextValues, constraints);
      if (
        Number.isFinite(nextState.loss) &&
        (options.strictDecrease
          ? nextState.loss < state.loss
          : nextState.loss <= state.loss)
      ) {
        values = nextValues;
        state = nextState;
        accepted = true;
        break;
      }
      stepScale *= 0.5;
    }

    if (
      !accepted ||
      options.stopWhenAccepted?.({
        values,
        loss: state.loss,
        perConstraint: state.perConstraint,
      })
    ) {
      break;
    }
  }

  return {
    values,
    loss: state.loss,
    perConstraint: state.perConstraint,
    iterations,
    startLoss,
  };
}
