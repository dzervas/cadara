import {
  objectiveOperator,
  operatorTangentStep,
  rowSpaceSolver,
  StepCurvature,
} from "./constrained-step-operators";
import { traceConstrainedStepOperations } from "./solve-tracing";
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
 *   positive definite. Large systems apply the same model and null-space
 *   projection as operators (sparse row-Gram Cholesky, compact SR1, conjugate
 *   gradients); small systems retain the dense reference solve. The step is
 *   capped by a continuation radius that
 *   halves on a failed trial and doubles on a clean one. A trial is kept when its
 *   corrected point decreases ½‖f‖² (Armijo on the predicted decrease) and
 *   the corrector moved it at most half the predicted step.
 * - Inequalities: an inequality violated at the iterate, or newly violated
 *   by a trial (or jumped over by it: its minimum along the straight move
 *   is below its boundary), joins the iteration's active set and
 *   the trial is recomputed; the corrector holds an active inequality at
 *   g = 0 only while it is violated or on its boundary (`boundary`), so it
 *   projects onto g ≥ 0 and several inequalities that enter together cannot
 *   over-determine the rows. The active set restarts empty (plus the
 *   violated ones) at every iterate. The step ends at the first accepted
 *   move that reaches a `blocking` inequality's boundary (the corrector held
 *   it there, or the move ends on it), not merely one that had it active.
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
  /**
   * An inequality with g below this (absolute, in the rows' units) is on its
   * boundary: the step slides along it (the leaving test), and the corrector
   * holds an active one at g = 0, so a violated one, or one a shortened
   * trial landed just short of, lands on the boundary while one clear of it
   * is released. The caller sets it from its model tolerance, so it does not
   * depend on where the geometry sits.
   */
  boundary: number;
  /**
   * Inequalities whose boundary ends the step (stop "blocked") at the first
   * accepted move that reaches it: the corrector held it at its boundary, or
   * the move ends within `boundary` of it.
   */
  blocking?: readonly number[];
  /**
   * Stop before correcting a feasible trial back onto a blocking boundary.
   * Opt-in for a caller that refuses the whole frame at that trial, rather
   * than publishing the boundary move. The returned values are the last
   * accepted iterate, not the trial that crossed the boundary.
   */
  stopOnBlockingTrial?: boolean;
  /** Batch edits start off the equality manifold; their correction must also
   * enforce inequalities newly violated by a Newton iterate. */
  correctAllInequalities?: boolean;
  objective: readonly ConstrainedStepRow[];
}

/** One unit of work: an outer iteration, or one row's Jacobian evaluation. */
export type ConstrainedStepWork = { kind: "iteration" | "raw"; count: number };

export type ConstrainedStepStats = {
  iterations: number;
  newtonIterations: number;
  rejectedTrials: number;
  /** Trials accepted as moves (0: the result is the corrected start). */
  acceptedMoves: number;
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
       * `blocked`: an accepted move reached a `blocking` inequality's
       * boundary; the result is that move.
       * `blockingTrial`: the opt-in trial stop saw a corrected trial cross a
       * blocking inequality; the result is the preceding accepted iterate.
       */
      stop:
        | "stationary"
        | "radius"
        | "maxIterations"
        | "rowUnavailable"
        | "blocked"
        | "blockingTrial";
      stats: ConstrainedStepStats;
    }
  | {
      kind: "unavailable";
      reason: "jacobianUnavailable" | "startNotCorrectable";
      stats: ConstrainedStepStats;
    };

// Dense projection is cheaper on the small sketch cells; above this size
// the operator path avoids forming n columns and factoring an n×n matrix.
const DENSE_LINEAR_ALGEBRA_MAX_VARIABLES = 64;

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

/**
 * A non-blocking inequality reached within this fraction of a trial does not
 * shorten it: a sliver of a step would restart the radius from nothing; the
 * corrector holds it at g ≥ 0 at the same length. A `blocking` one always
 * shortens the trial to its boundary, where the step then ends.
 */
export const MIN_BLOCKED_FRACTION = 1e-3;

/** Bisections of the directional derivative that locate an inequality's minimum along a move. */
export const LINE_MINIMUM_BISECTIONS = 40;

/** An inequality's value and its derivative along a move at one point of it. */
export type MoveSample = { value: number; slope: number };

/**
 * Whether an inequality g dips below `below` inside a straight move t ∈ [0,
 * 1] although it may hold at both ends (an unsigned length through zero):
 * both ends' first-order models must cross `below` (`start`, `end`), and
 * then g's minimum along the move, where its slope changes sign, is located
 * by bisection (`sample`) and read. Non-finite inside the move counts as a
 * dip. `evaluations` counts the samples.
 */
export function dipsBelowAlongMove(
  sample: (t: number) => MoveSample,
  below: number,
  start: MoveSample,
  end: MoveSample,
): { dips: boolean; evaluations: number } {
  if (!(start.value + start.slope < below) || !(end.value - end.slope < below))
    return { dips: false, evaluations: 0 };
  let low = 0;
  let high = 1;
  for (
    let evaluations = 1;
    evaluations <= LINE_MINIMUM_BISECTIONS;
    evaluations += 1
  ) {
    const middle = (low + high) / 2;
    const { value, slope } = sample(middle);
    if (!Number.isFinite(value) || value < below)
      return { dips: true, evaluations };
    if (slope < 0) low = middle;
    else high = middle;
  }
  return { dips: false, evaluations: LINE_MINIMUM_BISECTIONS };
}

export type Linearization =
  | { kind: "ok"; residuals: Float64Array; rows: Float64Array[] }
  | { kind: "unavailable" }
  | { kind: "nonFinite" };

function* linearizeConstrainedStep(
  problem: Pick<ConstrainedStepProblem, "variables" | "inequalities">,
  rows: readonly ConstrainedStepRow[],
  inequalities: readonly number[],
  values: Float64Array,
  polish = false,
): Generator<ConstrainedStepWork, Linearization, void> {
  const residuals: number[] = [];
  const restricted: Float64Array[] = [];
  let nonFinite = false;
  let unavailable = false;
  const append = (jacobian: ComponentJacobian, component: number) => {
    const row = Float64Array.from(
      problem.variables,
      (index) => jacobian.rows[component]![index]!,
    );
    if (row.some((entry) => !Number.isFinite(entry))) {
      if (!polish) return false;
      unavailable = true;
    }
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
  return unavailable
    ? { kind: "unavailable" }
    : nonFinite
      ? { kind: "nonFinite" }
      : {
          kind: "ok",
          residuals: Float64Array.from(residuals),
          rows: restricted,
        };
}

/** At most three equality-only Newton steps reach the coordinate rounding floor. */
const POLISH_NEWTON_ITERATIONS = 3;

function correctedValues(
  current: Float64Array,
  linear: Extract<Linearization, { kind: "ok" }>,
  variables: readonly number[],
  polish: boolean,
) {
  const delta = minimumNormStep(
    linear.rows,
    linear.residuals,
    variables.length,
  );
  const next = Float64Array.from(current);
  for (let column = 0; column < variables.length; column += 1) {
    // Preserve each caller's floating-point update, including signed zero.
    if (polish) next[variables[column]!] -= delta[column]!;
    else next[variables[column]!] += -1 * delta[column]!;
  }
  return next;
}

/** `held`: the active inequalities the corrector held at g = 0 on the way. */
export type ConstrainedStepCorrection =
  | { kind: "feasible"; values: Float64Array; held: ReadonlySet<number> }
  | { kind: "unavailable" | "failed" };
/**
 * Minimum-norm Newton correction on the selected rows. Normal correction
 * enforces active inequalities and tests L2 decrease at feasibility tolerances.
 * Polish is equality-only: keep only strict maximum-residual improvements,
 * stop at the coordinate rounding floor or after three steps, and retain the
 * last good point if a row becomes unavailable. It does not report step stats.
 */
export function* correctConstrainedStep(
  problem: Pick<
    ConstrainedStepProblem,
    | "variables"
    | "equalities"
    | "inequalities"
    | "boundary"
    | "correctAllInequalities"
  >,
  values: Float64Array,
  active: readonly number[],
  scale: number,
  options: { polish?: boolean; onNewton?: () => void } = {},
): Generator<ConstrainedStepWork, ConstrainedStepCorrection, void> {
  const { boundary, variables } = problem;
  let current = values;
  if (options.polish) {
    const held = new Set<number>();
    const floor = Number.EPSILON * scale;
    let linear = yield* linearizeConstrainedStep(
      problem,
      problem.equalities,
      [],
      current,
      true,
    );
    for (
      let iteration = 0;
      linear.kind === "ok" &&
      iteration < POLISH_NEWTON_ITERATIONS &&
      maxAbs(linear.residuals) > floor;
      iteration += 1
    ) {
      const next = correctedValues(current, linear, variables, true);
      const nextLinear = yield* linearizeConstrainedStep(
        problem,
        problem.equalities,
        [],
        next,
        true,
      );
      if (
        nextLinear.kind !== "ok" ||
        !(maxAbs(nextLinear.residuals) < maxAbs(linear.residuals))
      )
        break;
      current = next;
      linear = nextLinear;
    }
    return { kind: "feasible", values: current, held };
  }
  let previousNorm = Number.POSITIVE_INFINITY;
  let enforcedKey = "";
  const held = new Set<number>();
  for (let iteration = 0; ; iteration += 1) {
    // An active inequality is held at g = 0 only while it is violated or
    // on its boundary at the Newton iterate (projection onto g ≥ 0); a
    // change of that set restarts the norm-decrease test.
    const enforced: number[] = [];
    for (const index of problem.correctAllInequalities
      ? problem.inequalities.map((_, index) => index)
      : active) {
      yield { kind: "raw", count: 1 };
      if (problem.inequalities[index]!(current).components[0]! < boundary)
        enforced.push(index);
    }
    if (enforced.join(",") !== enforcedKey)
      previousNorm = Number.POSITIVE_INFINITY;
    enforcedKey = enforced.join(",");
    for (const index of enforced) held.add(index);
    const linear = yield* linearizeConstrainedStep(
      problem,
      problem.equalities,
      enforced,
      current,
    );
    if (linear.kind === "unavailable") return { kind: "unavailable" };
    if (linear.kind === "nonFinite") return { kind: "failed" };
    const largest = maxAbs(linear.residuals);
    if (largest <= FEASIBLE_TOLERANCE * scale)
      return { kind: "feasible", values: current, held };
    const norm = euclidean(linear.residuals);
    if (!(norm < previousNorm) || iteration === MAX_NEWTON_ITERATIONS)
      return largest <= FEASIBLE_STALL_TOLERANCE * scale
        ? { kind: "feasible", values: current, held }
        : { kind: "failed" };
    previousNorm = norm;
    options.onNewton?.();
    current = correctedValues(current, linear, variables, false);
  }
}

export function* solveConstrainedMinimumMotionSteps(
  problem: ConstrainedStepProblem,
): Generator<ConstrainedStepWork, ConstrainedStepResult, void> {
  const { variables } = problem;
  const size = variables.length;
  const stats: ConstrainedStepStats = {
    iterations: 0,
    newtonIterations: 0,
    rejectedTrials: 0,
    acceptedMoves: 0,
    activeInequalities: 0,
  };
  let scale = 1;
  for (const index of variables)
    scale = Math.max(scale, Math.abs(problem.start[index]!));
  const { boundary } = problem;
  const blocking = new Set(problem.blocking);

  const restrict = (jacobian: ComponentJacobian, component: number) => {
    const row = new Float64Array(size);
    const full = jacobian.rows[component]!;
    for (let column = 0; column < size; column += 1)
      row[column] = full[variables[column]!]!;
    return row;
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
  const correct = (values: Float64Array, active: readonly number[]) =>
    correctConstrainedStep(problem, values, active, scale, {
      onNewton: () => {
        stats.newtonIterations += 1;
      },
    });

  // The start (the last accepted frame) is corrected onto the rows first.
  const startBounds = yield* inequalityState(problem.start);
  const startObjective = yield* linearizeConstrainedStep(
    problem,
    problem.objective,
    [],
    problem.start,
  );
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
  // Keep the dense reference for small systems, where it is cheaper and
  // avoids perturbing the established small-sketch iteration path.
  const operatorMode = size > DENSE_LINEAR_ALGEBRA_MAX_VARIABLES;
  let curvature = squareMatrix(operatorMode ? 0 : size);
  const compactCurvature = new StepCurvature();
  // A row that becomes unavailable mid-solve is never silent zero motion:
  // before the first accepted move the whole step is unavailable (the caller
  // runs its fallback); after it, the stop says so.
  let rowUnavailable = false;
  const unavailableStop = (): ConstrainedStepResult =>
    stats.acceptedMoves > 0
      ? { kind: "solved", values: current, stop: "rowUnavailable", stats }
      : { kind: "unavailable", reason: "jacobianUnavailable", stats };
  const radiusStop = (): ConstrainedStepResult =>
    rowUnavailable
      ? unavailableStop()
      : { kind: "solved", values: current, stop: "radius", stats };
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    yield { kind: "iteration", count: 1 };
    stats.iterations += 1;
    const objective = yield* linearizeConstrainedStep(
      problem,
      problem.objective,
      [],
      current,
    );
    const bounds = yield* inequalityState(current);
    if (objective.kind !== "ok" || !bounds) return unavailableStop();
    const merit = 0.5 * squaredNorm(objective.residuals);
    const gradient = transposeTimes(objective.rows, objective.residuals, size);
    const gaussNewton = operatorMode ? [] : normalMatrix(objective.rows, size);
    const objectiveModel = operatorMode
      ? objectiveOperator(objective.rows, size)
      : null;
    const applyHessian = (vector: Float64Array) => {
      if (!objectiveModel) return multiply(hessian, vector);
      const result = objectiveModel.multiply(vector);
      const extra = compactCurvature.multiply(vector);
      return result.map((value, index) => value + extra[index]!);
    };
    let hessian = addMatrices(gaussNewton, curvature);
    const active = violatedInequalities(bounds.values);
    let constraintRows: Float64Array[] = [];
    let direction: Float64Array | null = null;
    let accepted = false;
    for (let trial = 0; trial < MAX_TRIALS && !accepted; trial += 1) {
      // An inequality on its boundary joins the active set when the step
      // would leave through it.
      while (!direction) {
        const linear = yield* linearizeConstrainedStep(
          problem,
          problem.equalities,
          active,
          current,
        );
        if (linear.kind !== "ok") return unavailableStop();
        const tangent = () => {
          if (!objectiveModel)
            return tangentStep(linear.rows, gradient, hessian, size);
          traceConstrainedStepOperations(
            "Projection",
            linear.rows.length * size,
          );
          let largestRow = 0;
          const norms = linear.rows.map((row) => {
            const norm = euclidean(row);
            largestRow = Math.max(largestRow, norm);
            return norm;
          });
          const normalized = linear.rows.flatMap((row, index) =>
            norms[index]! > NOISE_ROW * largestRow
              ? [row.map((value) => value / norms[index]!)]
              : [],
          );
          const solver = rowSpaceSolver(normalized, size, REGULARISATION);
          if (!solver || !(solver.projectionLeakageBound <= RANK_TOLERANCE)) {
            // Damping cannot decide rank: nearly dependent rows retained by
            // MGS must not become soft directions merely because n grew.
            return tangentStep(
              linear.rows,
              gradient,
              compactCurvature.addTo(normalMatrix(objective.rows, size)),
              size,
            );
          }
          // A second projection removes the regularisation leakage from the
          // first (O(δ²)), so CG does not chase nearly-normal directions.
          return operatorTangentStep(
            (vector) => solver.project(solver.project(vector)),
            gradient,
            applyHessian,
            Math.max(
              compactCurvature.largestDiagonal(objectiveModel.diagonal),
              1e-300,
            ),
            REGULARISATION,
          );
        };
        let candidate = tangent();
        if (!candidate) {
          // The reduced model is not positive definite: drop W.
          curvature = squareMatrix(operatorMode ? 0 : size);
          compactCurvature.clear();
          hessian = gaussNewton;
          candidate = tangent();
          // Singular objectives or numerically difficult row spaces retain
          // the reference solve rather than silently producing zero motion.
          if (!candidate) {
            const dense = normalMatrix(objective.rows, size);
            candidate = tangentStep(linear.rows, gradient, dense, size)!;
          }
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
        0.5 * dot(step, applyHessian(step))
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
      // An inequality the move jumps over enters too, though it holds at
      // both ends (an unsigned length through zero): both ends' first-order
      // models cross its boundary, and its minimum along the straight move
      // (where its directional derivative changes sign) is below it.
      const move = new Float64Array(size);
      for (let column = 0; column < size; column += 1)
        move[column] =
          corrected.values[variables[column]!]! - current[variables[column]!]!;
      const forward = (index: number) =>
        bounds.values[index]! + dot(bounds.rows[index]!, move);
      const jumpedOver = function* (
        index: number,
      ): Generator<ConstrainedStepWork, boolean, void> {
        const { dips, evaluations } = dipsBelowAlongMove(
          (t) => {
            const jacobian = problem.inequalities[index]!(
              moved(current, move, t),
            );
            return {
              value: jacobian.components[0]!,
              slope: dot(restrict(jacobian, 0), move),
            };
          },
          -INEQUALITY_TOLERANCE,
          {
            value: bounds.values[index]!,
            slope: dot(bounds.rows[index]!, move),
          },
          {
            value: after!.values[index]!,
            slope: dot(after!.rows[index]!, move),
          },
        );
        if (evaluations > 0) yield { kind: "raw", count: evaluations };
        return dips;
      };
      const entering: number[] = [];
      if (after)
        for (let index = 0; index < after.values.length; index += 1)
          if (
            !active.includes(index) &&
            (after.values[index]! < -INEQUALITY_TOLERANCE ||
              (yield* jumpedOver(index)))
          )
            entering.push(index);
      if (
        problem.stopOnBlockingTrial &&
        entering.some((index) => blocking.has(index))
      )
        return {
          kind: "solved",
          values: current,
          stop: "blockingTrial",
          stats,
        };
      if (entering.length > 0) {
        // An entering inequality: shorten the step to its (linearly
        // interpolated) boundary, which the corrector then lands on (see
        // `MIN_BLOCKED_FRACTION`).
        let blocked = 1;
        for (const index of entering) {
          const before = bounds.values[index]!;
          const now = Math.min(after!.values[index]!, forward(index));
          const fraction =
            before > now ? Math.max(0, before / (before - now)) : 1;
          if (blocking.has(index) || fraction >= MIN_BLOCKED_FRACTION)
            blocked = Math.min(blocked, fraction);
        }
        active.push(...entering);
        stats.rejectedTrials += 1;
        if (blocked * travelled > STEP_TOLERANCE * scale)
          radius = blocked * travelled;
        else direction = null;
        continue;
      }
      const next = yield* linearizeConstrainedStep(
        problem,
        problem.objective,
        [],
        corrected.values,
      );
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
      const nextRows = yield* linearizeConstrainedStep(
        problem,
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
        traceConstrainedStepOperations(
          "Curvature",
          nextRows.rows.length * size,
        );
        nextRows.rows.forEach((row, index) => {
          for (let column = 0; column < size; column += 1)
            y[column] +=
              (row[column]! - constraintRows[index]![column]!) * lambda[index]!;
        });
        if (!operatorMode)
          traceConstrainedStepOperations("Curvature", 2 * size * size);
        const curvatureChange = operatorMode
          ? compactCurvature.multiply(change)
          : multiply(curvature, change);
        const residual = y.map(
          (entry, index) => entry - curvatureChange[index]!,
        );
        const denominator = dot(residual, change);
        if (
          Math.abs(denominator) >
          1e-8 * euclidean(residual) * euclidean(change)
        ) {
          if (operatorMode) compactCurvature.update(residual, denominator);
          else
            for (let row = 0; row < size; row += 1)
              for (let column = 0; column < size; column += 1)
                curvature[row]![column] +=
                  (residual[row]! * residual[column]!) / denominator;
        }
      }
      current = corrected.values;
      radius = 2 * travelled;
      accepted = true;
      stats.acceptedMoves += 1;
      // The move reached a blocking inequality's boundary: the corrector
      // held it there on the way, or the move ends on it.
      if (
        [...blocking].some(
          (index) =>
            corrected.held.has(index) || after.values[index]! <= boundary,
        )
      )
        return { kind: "solved", values: current, stop: "blocked", stats };
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
  if (size > DENSE_LINEAR_ALGEBRA_MAX_VARIABLES) {
    const solver = rowSpaceSolver(rows, size, REGULARISATION);
    if (solver) return solver.minimumNorm(residuals);
  }
  const count = rows.length;
  traceConstrainedStepOperations(
    "Normal",
    (count * (count + 1) * (rows[0]?.length ?? 0)) / 2,
  );
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
  traceConstrainedStepOperations("Projection", 2 * rows.length * size);
  let largestRow = 0;
  for (const row of rows) largestRow = Math.max(largestRow, euclidean(row));
  for (const row of rows) {
    const norm = euclidean(row);
    if (!(norm > NOISE_ROW * largestRow)) continue;
    const vector = row.map((entry) => entry / norm);
    traceConstrainedStepOperations("Projection", 4 * basis.length * size);
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
  traceConstrainedStepOperations(
    "Projection",
    size * (size * size + 4 * basis.length * size),
  );
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
  if (gradient.length > DENSE_LINEAR_ALGEBRA_MAX_VARIABLES) {
    const solver = rowSpaceSolver(rows, gradient.length, REGULARISATION);
    if (solver) return solver.multipliers(gradient);
  }
  const count = rows.length;
  traceConstrainedStepOperations(
    "Normal",
    (count * (count + 1) * (rows[0]?.length ?? 0)) / 2,
  );
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
  traceConstrainedStepOperations(
    "Factor",
    (size * (size - 1) * (size + 1)) / 6 + size * (size - 1),
  );
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
  let operations = 0;
  for (const row of rows)
    for (let first = 0; first < size; first += 1) {
      const value = row[first]!;
      if (value === 0) continue;
      operations += size;
      for (let second = 0; second < size; second += 1)
        matrix[first]![second] += value * row[second]!;
    }
  traceConstrainedStepOperations("Normal", operations);
  return matrix;
}

export function transposeTimes(
  rows: readonly Float64Array[],
  vector: Float64Array,
  size: number,
) {
  traceConstrainedStepOperations("Normal", rows.length * size);
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
