import {
  BFGS_MIN_LOSS,
  LINE_SEARCH_MAX_ITERATIONS,
  WOLFE_C1,
  WOLFE_C2,
} from "./solve-constants";
import { finishSolve } from "./solve-steps";
import type { SolveWork } from "./solve-steps";
import { solverWorkTrace } from "./solve-tracing";
import {
  addScaled,
  cloneValues,
  dot,
  euclideanNorm,
  uniformNorm,
  zeroVector,
} from "./solver-geometry";
import type {
  ConstraintEvaluationRecord,
  ScalarConstraintRecord,
} from "./system-types";

export function evaluateLoss(
  values: Float64Array,
  constraints: ScalarConstraintRecord[],
): {
  loss: number;
  gradient: Float64Array;
  perConstraint: Map<string, number>;
  evaluations: ConstraintEvaluationRecord[];
} {
  const perConstraint = new Map<string, number>();
  const gradient = zeroVector(values.length);
  const evaluations: ConstraintEvaluationRecord[] = [];
  let loss = 0;
  if (solverWorkTrace) solverWorkTrace.lossEvaluations += 1;

  for (const constraint of constraints) {
    const evaluation = constraint.evaluate(values);
    loss += evaluation.residual;
    addScaled(gradient, 1, evaluation.gradient);
    perConstraint.set(constraint.id, evaluation.residual);
    evaluations.push({
      id: constraint.id,
      targetKind: constraint.targetKind,
      residual: evaluation.residual,
      gradient: evaluation.gradient,
    });
  }

  return { loss, gradient, perConstraint, evaluations };
}

export function identityMatrix(size: number) {
  const matrix = Array.from({ length: size }, (_, rowIndex) => {
    const row = new Float64Array(size);
    row[rowIndex] = 1;
    return row;
  });
  return matrix;
}

export function multiplyMatrixVector(matrix: Float64Array[], vector: Float64Array) {
  const result = zeroVector(matrix.length);
  for (let row = 0; row < matrix.length; row += 1) {
    result[row] = dot(matrix[row]!, vector);
  }
  return result;
}

export function outer(left: Float64Array, right: Float64Array) {
  const matrix = Array.from({ length: left.length }, () =>
    zeroVector(right.length),
  );
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < right.length; column += 1) {
      matrix[row]![column] = left[row]! * right[column]!;
    }
  }
  return matrix;
}

export function addScaledMatrix(
  target: Float64Array[],
  scale: number,
  source: Float64Array[],
) {
  for (let row = 0; row < target.length; row += 1) {
    for (let column = 0; column < target[row]!.length; column += 1) {
      target[row]![column] += scale * source[row]![column]!;
    }
  }
}

/**
 * `current` is the caller's evaluation at `values` (cadara-b3k.26): every
 * caller keeps `state` in step with `values`, so re-evaluating the loss here
 * was one redundant `evaluateLoss` per iteration (39% of all evaluations in
 * the drag-frame profile) that returned the same numbers.
 */
export function lineSearchWolfe(
  values: Float64Array,
  direction: Float64Array,
  current: { loss: number; gradient: Float64Array },
  constraints: ScalarConstraintRecord[],
) {
  const slope = dot(current.gradient, direction);
  if (slope >= 0) {
    return null;
  }
  let alpha = 1;
  const initial = current;
  if (solverWorkTrace) solverWorkTrace.lineSearches += 1;
  for (
    let iteration = 0;
    iteration < LINE_SEARCH_MAX_ITERATIONS;
    iteration += 1
  ) {
    const candidate = cloneValues(values);
    addScaled(candidate, alpha, direction);
    if (solverWorkTrace) solverWorkTrace.lineSearchTrials += 1;
    const next = evaluateLoss(candidate, constraints);
    if (next.loss <= initial.loss + WOLFE_C1 * alpha * slope) {
      const curvature = dot(next.gradient, direction);
      if (curvature >= WOLFE_C2 * slope) {
        return { alpha, nextValues: candidate, next };
      }
      alpha *= 1.5;
    } else {
      alpha *= 0.5;
    }
  }
  return null;
}

/**
 * BFGS over `variableIndices` (every index by default); the other indices
 * keep their initial values and their gradient is not part of the stop test. T13a2 (c3): restricting to a set outside of
 * which every constraint's gradient is zero leaves the iterates unchanged
 * (the identity start keeps those coordinates decoupled), and
 * `initialInverseHessian` only changes the path: the objective, the stop
 * test and a reset to the identity on a failed line search are the same.
 */
export function solveBfgsOver(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    variableIndices?: readonly number[];
    initialInverseHessian?: Float64Array[] | null;
  } = {},
) {
  return finishSolve(solveBfgsOverSteps(initialValues, constraints, options));
}

export function* solveBfgsOverSteps(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    variableIndices?: readonly number[];
    initialInverseHessian?: Float64Array[] | null;
  } = {},
) {
  const indices =
    options.variableIndices ??
    Array.from({ length: initialValues.length }, (_, index) => index);
  const dimension = indices.length;
  const restrict = (full: Float64Array) => {
    const restricted = zeroVector(dimension);
    for (let index = 0; index < dimension; index += 1) {
      restricted[index] = full[indices[index]!]!;
    }
    return restricted;
  };
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);
  let gradient = restrict(state.gradient);
  let inverseHessian =
    options.initialInverseHessian?.length === dimension
      ? options.initialInverseHessian.map((row) => cloneValues(row))
      : identityMatrix(dimension);
  let recentlyReset = false;

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    // The stop test reads the gradient over the solved variables only:
    // a held (e.g. pinned) variable's gradient cannot be reduced.
    if (state.loss < BFGS_MIN_LOSS || uniformNorm(gradient) < 1e-8) {
      break;
    }

    yield { kind: "iteration", count: 1 } satisfies SolveWork;
    if (solverWorkTrace) solverWorkTrace.bfgsIterations += 1;

    const searchDirection = multiplyMatrixVector(inverseHessian, gradient);
    const fullDirection = zeroVector(values.length);
    for (let index = 0; index < dimension; index += 1) {
      searchDirection[index] = -searchDirection[index]!;
      fullDirection[indices[index]!] = searchDirection[index]!;
    }

    const step = lineSearchWolfe(values, fullDirection, state, constraints);
    if (!step) {
      if (recentlyReset) {
        break;
      }
      inverseHessian = identityMatrix(dimension);
      if (solverWorkTrace) solverWorkTrace.bfgsResets += 1;
      recentlyReset = true;
      continue;
    }
    recentlyReset = false;

    const s = cloneValues(searchDirection);
    for (let index = 0; index < s.length; index += 1) {
      s[index] *= step.alpha;
    }

    const nextGradient = restrict(step.next.gradient);
    const y = cloneValues(nextGradient);
    addScaled(y, -1, gradient);
    let sDotY = dot(s, y);
    if (Math.abs(sDotY) < 1e-16) {
      sDotY += 1e-6;
    }

    const hy = multiplyMatrixVector(inverseHessian, y);
    const factor = (sDotY + dot(y, hy)) / (sDotY * sDotY);
    addScaledMatrix(inverseHessian, factor, outer(s, s));
    addScaledMatrix(inverseHessian, -1 / sDotY, outer(hy, s));
    addScaledMatrix(inverseHessian, -1 / sDotY, outer(s, hy));

    values = step.nextValues;
    state = step.next;
    gradient = nextGradient;
  }

  return {
    values,
    loss: state.loss,
    perConstraint: state.perConstraint,
    inverseHessian,
  };
}

export function* solveGradientDescentSteps(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);

  for (let iteration = 0; iteration < 10000; iteration += 1) {
    if (state.loss < 1e-14 || euclideanNorm(state.gradient) < 1e-10) {
      break;
    }

    yield { kind: "iteration", count: 1 } satisfies SolveWork;
    const direction = cloneValues(state.gradient);
    for (let index = 0; index < direction.length; index += 1) {
      direction[index] = -direction[index]!;
    }

    const step = lineSearchWolfe(values, direction, state, constraints);
    if (!step) {
      break;
    }

    values = step.nextValues;
    state = step.next;
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint };
}
