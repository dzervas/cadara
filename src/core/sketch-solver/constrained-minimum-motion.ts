import type { ComponentJacobian } from "./automatic-differentiation";

/**
 * cadara-p4r5.2: the equality-constrained minimum-motion drag step, a feasible
 * projected Gauss–Newton (predictor–corrector) method on the hard rows'
 * manifold:
 *
 *   minimise ½‖f(x)‖² over `variables` subject to c(x) = 0 and g(x) ≥ 0,
 *
 * with f the objective rows (the drag goal and the minimum-motion anchor), c
 * the equality rows' components and g the inequality rows. It is a black box
 * over row data: it reads only each row's `ComponentJacobian` (analytic; no
 * finite differences) and knows nothing about the geometry behind a row.
 *
 * - Corrector: Newton on c with a regularised normal-equations solve,
 *   Δx = −Jᵀ(JJᵀ + δI)⁻¹c (the minimum-norm step; δ keeps redundant rows
 *   solvable).
 * - Predictor: the SQP step on f inside the null space of the active rows
 *   (an orthonormal row basis by modified Gram–Schmidt on the row-normalised
 *   Jacobian): the model Hessian is the Gauss–Newton JᵀJ of f plus W, a
 *   symmetric-rank-one (SR1) estimate of the rows' curvature Σλᵢ∇²cᵢ from
 *   the change of the analytic row Jacobians along accepted steps (λ the
 *   least-squares multipliers); W is dropped when the reduced model is not
 *   positive definite. The step is capped by a continuation radius that
 *   halves on a failed trial and doubles on a clean one. A trial is kept when its
 *   corrected point decreases ½‖f‖² (Armijo on the predicted decrease) and
 *   the corrector moved it at most half the predicted step.
 * - Inequalities: an inequality violated at the iterate, or newly violated
 *   by a trial, joins the iteration's active set as an equality g = 0 and the
 *   trial is recomputed; the active set restarts empty (plus the violated
 *   ones) at every iterate.
 * - A row whose Jacobian is `unavailable` or non-finite at the start makes
 *   the step unavailable (the caller decides what runs instead); at a trial
 *   point it only rejects the trial.
 */
export interface ConstrainedStepRow {
  evaluate(values: Float64Array): ComponentJacobian;
  /** Components that are not equalities (each is restated by an inequality row). */
  excludedComponents?: readonly number[];
}

export interface ConstrainedStepProblem {
  start: Float64Array;
  /** The variables the step moves; every other value is held. */
  variables: readonly number[];
  equalities: readonly ConstrainedStepRow[];
  /** g(x) ≥ 0; each evaluates one component. */
  inequalities: readonly ((values: Float64Array) => ComponentJacobian)[];
  objective: readonly ConstrainedStepRow[];
}

/** One unit of work: an outer iteration, or one row's Jacobian evaluation. */
export type ConstrainedStepWork = { kind: "iteration" | "raw"; count: number };

export type ConstrainedStepStats = {
  iterations: number;
  newtonIterations: number;
  rejectedTrials: number;
  /** The most inequalities active in one iteration. */
  activeInequalities: number;
};

export type ConstrainedStepResult =
  | {
      kind: "solved";
      values: Float64Array;
      /**
       * `rowUnavailable`: a row became unavailable or non-finite after at
       * least one accepted move; the result is that last accepted iterate.
       */
      stop: "stationary" | "radius" | "maxIterations" | "rowUnavailable";
      stats: ConstrainedStepStats;
    }
  | {
      kind: "unavailable";
      reason: "jacobianUnavailable" | "startNotCorrectable";
      stats: ConstrainedStepStats;
    };

export const MAX_ITERATIONS = 200;

export const MAX_TRIALS = 60;

export const MAX_NEWTON_ITERATIONS = 12;

/** ‖c‖∞ at which the corrector stops, relative to max(1, ‖x‖∞). */
export const FEASIBLE_TOLERANCE = 1e-12;

/** ‖c‖∞ still accepted when Newton stops decreasing (rounding floor). */
export const FEASIBLE_STALL_TOLERANCE = 1e-9;

export const INEQUALITY_TOLERANCE = 1e-9;

export const STEP_TOLERANCE = 1e-13;

export const RANK_TOLERANCE = 1e-8;

export const NOISE_ROW = 1e-12;

export const REGULARISATION = 1e-12;

export const ARMIJO = 1e-4;

export const CORRECTOR_TRAVEL = 0.5;

export type Linearization =
  | { kind: "ok"; residuals: Float64Array; rows: Float64Array[] }
  | { kind: "unavailable" }
  | { kind: "nonFinite" };

export function* solveConstrainedMinimumMotionSteps(
  problem: ConstrainedStepProblem,
): Generator<ConstrainedStepWork, ConstrainedStepResult, void> {
  const { variables } = problem;
  const size = variables.length;
  const stats: ConstrainedStepStats = {
    iterations: 0,
    newtonIterations: 0,
    rejectedTrials: 0,
    activeInequalities: 0,
  };
  let scale = 1;
  for (const index of variables)
    scale = Math.max(scale, Math.abs(problem.start[index]!));

  const restrict = (jacobian: ComponentJacobian, component: number) => {
    const row = new Float64Array(size);
    const full = jacobian.rows[component]!;
    for (let column = 0; column < size; column += 1)
      row[column] = full[variables[column]!]!;
    return row;
  };
  const linearize = function* (
    rows: readonly ConstrainedStepRow[],
    inequalities: readonly number[],
    values: Float64Array,
  ): Generator<ConstrainedStepWork, Linearization, void> {
    const residuals: number[] = [];
    const restricted: Float64Array[] = [];
    let nonFinite = false;
    const append = (jacobian: ComponentJacobian, component: number) => {
      const row = restrict(jacobian, component);
      if (row.some((entry) => !Number.isFinite(entry))) return false;
      const residual = jacobian.components[component]!;
      if (!Number.isFinite(residual)) nonFinite = true;
      residuals.push(residual);
      restricted.push(row);
      return true;
    };
    for (const row of rows) {
      yield { kind: "raw", count: 1 };
      const jacobian = row.evaluate(values);
      if (jacobian.unavailable) return { kind: "unavailable" };
      const excluded = new Set(row.excludedComponents ?? []);
      for (
        let component = 0;
        component < jacobian.components.length;
        component += 1
      )
        if (!excluded.has(component) && !append(jacobian, component))
          return { kind: "unavailable" };
    }
    for (const index of inequalities) {
      yield { kind: "raw", count: 1 };
      const jacobian = problem.inequalities[index]!(values);
      if (jacobian.unavailable || !append(jacobian, 0))
        return { kind: "unavailable" };
    }
    return nonFinite
      ? { kind: "nonFinite" }
      : {
          kind: "ok",
          residuals: Float64Array.from(residuals),
          rows: restricted,
        };
  };
  /** The inequalities' values and restricted gradients (null if any is unavailable). */
  const inequalityState = function* (
    values: Float64Array,
  ): Generator<
    ConstrainedStepWork,
    { values: Float64Array; rows: Float64Array[] } | null,
    void
  > {
    const result = new Float64Array(problem.inequalities.length);
    const rows: Float64Array[] = [];
    for (let index = 0; index < result.length; index += 1) {
      yield { kind: "raw", count: 1 };
      const jacobian = problem.inequalities[index]!(values);
      const value = jacobian.components[0]!;
      const row = restrict(jacobian, 0);
      if (
        jacobian.unavailable ||
        !Number.isFinite(value) ||
        row.some((entry) => !Number.isFinite(entry))
      )
        return null;
      result[index] = value;
      rows.push(row);
    }
    return { values: result, rows };
  };
  const moved = (values: Float64Array, delta: Float64Array, scaleBy = 1) => {
    const next = Float64Array.from(values);
    for (let column = 0; column < size; column += 1)
      next[variables[column]!] += scaleBy * delta[column]!;
    return next;
  };
  type Correction =
    | { kind: "feasible"; values: Float64Array }
    | { kind: "unavailable" | "failed" };
  const correct = function* (
    values: Float64Array,
    active: readonly number[],
  ): Generator<ConstrainedStepWork, Correction, void> {
    let current = values;
    let previousNorm = Number.POSITIVE_INFINITY;
    for (let iteration = 0; ; iteration += 1) {
      const linear = yield* linearize(problem.equalities, active, current);
      if (linear.kind === "unavailable") return { kind: "unavailable" };
      if (linear.kind === "nonFinite") return { kind: "failed" };
      const largest = maxAbs(linear.residuals);
      if (largest <= FEASIBLE_TOLERANCE * scale)
        return { kind: "feasible", values: current };
      const norm = euclidean(linear.residuals);
      if (!(norm < previousNorm) || iteration === MAX_NEWTON_ITERATIONS)
        return largest <= FEASIBLE_STALL_TOLERANCE * scale
          ? { kind: "feasible", values: current }
          : { kind: "failed" };
      previousNorm = norm;
      stats.newtonIterations += 1;
      const delta = minimumNormStep(linear.rows, linear.residuals, size);
      current = moved(current, delta, -1);
    }
  };

  // The start (the last accepted frame) is corrected onto the rows first.
  const startBounds = yield* inequalityState(problem.start);
  const startObjective = yield* linearize(problem.objective, [], problem.start);
  if (!startBounds || startObjective.kind !== "ok")
    return { kind: "unavailable", reason: "jacobianUnavailable", stats };
  const startCorrection = yield* correct(
    problem.start,
    violatedInequalities(startBounds.values),
  );
  if (startCorrection.kind !== "feasible")
    return {
      kind: "unavailable",
      reason:
        startCorrection.kind === "unavailable"
          ? "jacobianUnavailable"
          : "startNotCorrectable",
      stats,
    };

  let current = startCorrection.values;
  let radius = Number.POSITIVE_INFINITY;
  let curvature = squareMatrix(size);
  const boundary = INEQUALITY_TOLERANCE * scale;
  // A row that becomes unavailable mid-solve is never silent zero motion:
  // before the first accepted move the whole step is unavailable (the caller
  // runs its fallback); after it, the stop says so.
  let movedOnce = false;
  let rowUnavailable = false;
  const unavailableStop = (): ConstrainedStepResult =>
    movedOnce
      ? { kind: "solved", values: current, stop: "rowUnavailable", stats }
      : { kind: "unavailable", reason: "jacobianUnavailable", stats };
  const radiusStop = (): ConstrainedStepResult =>
    rowUnavailable
      ? unavailableStop()
      : { kind: "solved", values: current, stop: "radius", stats };
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    yield { kind: "iteration", count: 1 };
    stats.iterations += 1;
    const objective = yield* linearize(problem.objective, [], current);
    const bounds = yield* inequalityState(current);
    if (objective.kind !== "ok" || !bounds) return unavailableStop();
    const merit = 0.5 * squaredNorm(objective.residuals);
    const gradient = transposeTimes(objective.rows, objective.residuals, size);
    const gaussNewton = normalMatrix(objective.rows, size);
    let hessian = addMatrices(gaussNewton, curvature);
    const active = violatedInequalities(bounds.values);
    let constraintRows: Float64Array[] = [];
    let direction: Float64Array | null = null;
    let accepted = false;
    for (let trial = 0; trial < MAX_TRIALS && !accepted; trial += 1) {
      // An inequality on its boundary joins the active set when the step
      // would leave through it.
      while (!direction) {
        const linear = yield* linearize(problem.equalities, active, current);
        if (linear.kind !== "ok") return unavailableStop();
        let candidate = tangentStep(linear.rows, gradient, hessian, size);
        if (!candidate) {
          // The reduced model is not positive definite: drop W.
          curvature = squareMatrix(size);
          hessian = gaussNewton;
          candidate = tangentStep(linear.rows, gradient, hessian, size)!;
        }
        constraintRows = linear.rows;
        const leaving = bounds.rows.flatMap((row, index) =>
          !active.includes(index) &&
          bounds.values[index]! <= boundary &&
          dot(row, candidate) < 0
            ? [index]
            : [],
        );
        if (leaving.length === 0) direction = candidate;
        else active.push(...leaving);
      }
      stats.activeInequalities = Math.max(
        stats.activeInequalities,
        active.length,
      );
      const length = euclidean(direction);
      if (maxAbs(direction) <= STEP_TOLERANCE * scale)
        return { kind: "solved", values: current, stop: "stationary", stats };
      const fraction = length > radius ? radius / length : 1;
      const step = direction.map((entry) => entry * fraction);
      const predicted = -(
        dot(gradient, step) +
        0.5 * dot(step, multiply(hessian, step))
      );
      if (!(predicted > 1e-14 * merit))
        return { kind: "solved", values: current, stop: "stationary", stats };
      const travelled = euclidean(step);
      const rejected = () => {
        stats.rejectedTrials += 1;
        radius = travelled / 2;
        return radius > STEP_TOLERANCE * scale;
      };
      const trialValues = moved(current, step);
      const corrected = yield* correct(trialValues, active);
      if (corrected.kind === "unavailable") rowUnavailable = true;
      if (
        corrected.kind !== "feasible" ||
        distance(corrected.values, trialValues, variables) >
          CORRECTOR_TRAVEL * travelled
      ) {
        if (!rejected()) return radiusStop();
        continue;
      }
      const after = yield* inequalityState(corrected.values);
      if (!after) rowUnavailable = true;
      const entering = after
        ? violatedInequalities(after.values).filter(
            (index) => !active.includes(index),
          )
        : [];
      if (entering.length > 0) {
        // A blocking inequality: shorten the step to its (linearly
        // interpolated) boundary, which the corrector then lands on.
        let blocked = 1;
        for (const index of entering) {
          const before = bounds.values[index]!;
          const now = after!.values[index]!;
          if (before > now)
            blocked = Math.min(blocked, Math.max(0, before / (before - now)));
        }
        active.push(...entering);
        stats.rejectedTrials += 1;
        if (blocked * travelled > STEP_TOLERANCE * scale)
          radius = blocked * travelled;
        else direction = null;
        continue;
      }
      const next = yield* linearize(problem.objective, [], corrected.values);
      if (next.kind !== "ok") rowUnavailable = true;
      const nextMerit =
        next.kind === "ok"
          ? 0.5 * squaredNorm(next.residuals)
          : Number.POSITIVE_INFINITY;
      if (!after || !(nextMerit <= merit - ARMIJO * predicted)) {
        if (!rejected()) return radiusStop();
        continue;
      }
      // SR1 on W: s = the accepted move, y = (J₊ − J)ᵀλ on the same rows.
      const nextRows = yield* linearize(
        problem.equalities,
        active,
        corrected.values,
      );
      if (
        nextRows.kind === "ok" &&
        nextRows.rows.length === constraintRows.length
      ) {
        const lambda = leastSquaresMultipliers(constraintRows, gradient);
        const change = new Float64Array(size);
        const y = new Float64Array(size);
        for (let column = 0; column < size; column += 1)
          change[column] =
            corrected.values[variables[column]!]! -
            current[variables[column]!]!;
        nextRows.rows.forEach((row, index) => {
          for (let column = 0; column < size; column += 1)
            y[column] +=
              (row[column]! - constraintRows[index]![column]!) * lambda[index]!;
        });
        const residual = y.map(
          (entry, index) => entry - dot(curvature[index]!, change),
        );
        const denominator = dot(residual, change);
        if (
          Math.abs(denominator) >
          1e-8 * euclidean(residual) * euclidean(change)
        )
          for (let row = 0; row < size; row += 1)
            for (let column = 0; column < size; column += 1)
              curvature[row]![column] +=
                (residual[row]! * residual[column]!) / denominator;
      }
      current = corrected.values;
      radius = 2 * travelled;
      accepted = true;
      movedOnce = true;
      rowUnavailable = false;
    }
    if (!accepted) return radiusStop();
  }
  return { kind: "solved", values: current, stop: "maxIterations", stats };
}

export function violatedInequalities(values: Float64Array) {
  const violated: number[] = [];
  values.forEach((value, index) => {
    if (value < -INEQUALITY_TOLERANCE) violated.push(index);
  });
  return violated;
}

/** Jᵀ(JJᵀ + δI)⁻¹c, the minimum-norm solution of J·Δ = c (δ: rank deficiency). */
export function minimumNormStep(
  rows: readonly Float64Array[],
  residuals: Float64Array,
  size: number,
) {
  const count = rows.length;
  const gram = Array.from({ length: count }, () => new Float64Array(count));
  let largest = 0;
  for (let first = 0; first < count; first += 1)
    for (let second = 0; second <= first; second += 1) {
      const value = dot(rows[first]!, rows[second]!);
      gram[first]![second] = value;
      gram[second]![first] = value;
      if (first === second) largest = Math.max(largest, value);
    }
  const regularisation = REGULARISATION * Math.max(largest, 1e-300);
  for (let index = 0; index < count; index += 1)
    gram[index]![index] += regularisation;
  const multipliers = solveCholesky(gram, residuals) ?? new Float64Array(count);
  const step = new Float64Array(size);
  for (let row = 0; row < count; row += 1)
    for (let column = 0; column < size; column += 1)
      step[column] += rows[row]![column]! * multipliers[row]!;
  return step;
}

/**
 * The Gauss–Newton step on ½‖f‖² restricted to the null space of `rows`:
 * (PHP + μI)d = −Pg, with P the orthogonal projector onto that null space.
 */
export function tangentStep(
  rows: readonly Float64Array[],
  gradient: Float64Array,
  hessian: Float64Array[],
  size: number,
) {
  const basis: Float64Array[] = [];
  // A row this far below the largest is rounding noise (an identically
  // satisfied row), not a direction: normalised it would remove a random one.
  let largestRow = 0;
  for (const row of rows) largestRow = Math.max(largestRow, euclidean(row));
  for (const row of rows) {
    const norm = euclidean(row);
    if (!(norm > NOISE_ROW * largestRow)) continue;
    const vector = row.map((entry) => entry / norm);
    for (let pass = 0; pass < 2; pass += 1)
      for (const unit of basis) {
        const projection = dot(unit, vector);
        for (let index = 0; index < size; index += 1)
          vector[index] -= projection * unit[index]!;
      }
    const remaining = euclidean(vector);
    if (remaining <= RANK_TOLERANCE) continue;
    basis.push(vector.map((entry) => entry / remaining));
  }
  const project = (vector: Float64Array) => {
    const result = Float64Array.from(vector);
    for (const unit of basis) {
      const projection = dot(unit, result);
      for (let index = 0; index < size; index += 1)
        result[index] -= projection * unit[index]!;
    }
    return result;
  };
  // PHP column by column: P·(H·(P·e_j)), and P symmetric.
  const projectedColumns = Array.from({ length: size }, (_, column) => {
    const unit = new Float64Array(size);
    unit[column] = 1;
    return project(multiply(hessian, project(unit)));
  });
  let largest = 0;
  for (let index = 0; index < size; index += 1)
    largest = Math.max(largest, hessian[index]![index]!);
  const matrix = Array.from({ length: size }, (_, row) => {
    const values = new Float64Array(size);
    for (let column = 0; column < size; column += 1)
      values[column] = projectedColumns[column]![row]!;
    values[row] += REGULARISATION * Math.max(largest, 1e-300);
    return values;
  });
  const rhs = project(gradient).map((entry) => -entry);
  const solution = solveCholesky(matrix, rhs);
  return solution && project(solution);
}

/** λ = −(JJᵀ + δI)⁻¹Jg: the least-squares multipliers of the rows at a gradient g. */
export function leastSquaresMultipliers(
  rows: readonly Float64Array[],
  gradient: Float64Array,
) {
  const count = rows.length;
  const gram = Array.from({ length: count }, () => new Float64Array(count));
  let largest = 0;
  for (let first = 0; first < count; first += 1)
    for (let second = 0; second <= first; second += 1) {
      const value = dot(rows[first]!, rows[second]!);
      gram[first]![second] = value;
      gram[second]![first] = value;
      if (first === second) largest = Math.max(largest, value);
    }
  for (let index = 0; index < count; index += 1)
    gram[index]![index] += REGULARISATION * Math.max(largest, 1e-300);
  const projected = Float64Array.from(rows, (row) => -dot(row, gradient));
  return solveCholesky(gram, projected) ?? new Float64Array(count);
}

export function squareMatrix(size: number) {
  return Array.from({ length: size }, () => new Float64Array(size));
}

export function addMatrices(
  left: readonly Float64Array[],
  right: readonly Float64Array[],
) {
  return left.map((row, index) =>
    row.map((entry, column) => entry + right[index]![column]!),
  );
}

/** Solves A·x = b for a symmetric positive definite A (Cholesky); null if A is not. */
export function solveCholesky(matrix: Float64Array[], rhs: Float64Array) {
  const size = rhs.length;
  const factor = matrix.map((row) => Float64Array.from(row));
  for (let column = 0; column < size; column += 1) {
    let pivot = factor[column]![column]!;
    for (let inner = 0; inner < column; inner += 1)
      pivot -= factor[column]![inner]! ** 2;
    if (!(pivot > 0)) return null;
    const root = Math.sqrt(pivot);
    factor[column]![column] = root;
    for (let row = column + 1; row < size; row += 1) {
      let value = factor[row]![column]!;
      for (let inner = 0; inner < column; inner += 1)
        value -= factor[row]![inner]! * factor[column]![inner]!;
      factor[row]![column] = value / root;
    }
  }
  const forward = new Float64Array(size);
  for (let row = 0; row < size; row += 1) {
    let value = rhs[row]!;
    for (let inner = 0; inner < row; inner += 1)
      value -= factor[row]![inner]! * forward[inner]!;
    forward[row] = value / factor[row]![row]!;
  }
  const solution = new Float64Array(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = forward[row]!;
    for (let inner = row + 1; inner < size; inner += 1)
      value -= factor[inner]![row]! * solution[inner]!;
    solution[row] = value / factor[row]![row]!;
  }
  return solution;
}

export function normalMatrix(rows: readonly Float64Array[], size: number) {
  const matrix = Array.from({ length: size }, () => new Float64Array(size));
  for (const row of rows)
    for (let first = 0; first < size; first += 1) {
      const value = row[first]!;
      if (value === 0) continue;
      for (let second = 0; second < size; second += 1)
        matrix[first]![second] += value * row[second]!;
    }
  return matrix;
}

export function transposeTimes(
  rows: readonly Float64Array[],
  vector: Float64Array,
  size: number,
) {
  const result = new Float64Array(size);
  rows.forEach((row, index) => {
    for (let column = 0; column < size; column += 1)
      result[column] += row[column]! * vector[index]!;
  });
  return result;
}

export function multiply(matrix: readonly Float64Array[], vector: Float64Array) {
  return Float64Array.from(matrix, (row) => dot(row, vector));
}

export function dot(left: ArrayLike<number>, right: ArrayLike<number>) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1)
    sum += left[index]! * right[index]!;
  return sum;
}

export function squaredNorm(vector: Float64Array) {
  return dot(vector, vector);
}

export function euclidean(vector: Float64Array) {
  return Math.sqrt(squaredNorm(vector));
}

export function maxAbs(vector: Float64Array) {
  let largest = 0;
  for (const value of vector) largest = Math.max(largest, Math.abs(value));
  return largest;
}

export function distance(
  left: Float64Array,
  right: Float64Array,
  variables: readonly number[],
) {
  let sum = 0;
  for (const index of variables) sum += (left[index]! - right[index]!) ** 2;
  return Math.sqrt(sum);
}
