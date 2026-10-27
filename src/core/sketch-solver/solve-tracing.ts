/** T13e2: one Gauss–Newton fallback run, as recorded by `traceSketchSolverForTest`. */
export interface SketchGaussNewtonFallbackTrace {
  /** BFGS was already accepted, so no Gauss–Newton ran (C3). */
  skipped: boolean;
  /** BFGS's end loss. */
  bfgsLoss: number;
  /**
   * The loss Gauss–Newton evaluated at its own start values (C1: equal to
   * `bfgsLoss`, since it continues from BFGS's end values); null if skipped.
   */
  startLoss: number | null;
  /** Gauss–Newton iterations, including a final one without progress. */
  iterations: number;
  linearSolve: "pseudoInverse" | "pivotedCholesky";
}

export let gaussNewtonFallbackTrace: SketchGaussNewtonFallbackTrace[] | null = null;

/**
 * cadara-b3k.26: deterministic work counters of one traced run, so specs
 * can pin solver work without timing it. `lossEvaluations` counts every
 * `evaluateLoss`; `lineSearches` every Wolfe line search and
 * `lineSearchTrials` the candidate evaluations inside them. A line search
 * evaluates only its trial points (the start is the caller's current
 * state), so `lossEvaluations − lineSearchTrials` counts the evaluations
 * outside Wolfe searches (solver starts, candidate judging, Gauss–Newton
 * candidates), never one per BFGS iteration.
 */
export interface SketchSolverWorkTrace {
  gaussNewtonIterations: number;
  bfgsIterations: number;
  bfgsResets: number;
  dragConditioningIterations: number;
  /** Raw constraint-block evaluations, including every finite-difference probe. */
  dragConditioningResidualEvaluations: number;
  lossEvaluations: number;
  lineSearches: number;
  lineSearchTrials: number;
  constrainednessClassifications: number;
  componentResidualEvaluations: number;
  /** cadara-p4r5.2: drag stages that ran the constrained step (`SketchDragStep`). */
  constrainedStepStages: number;
  constrainedStepIterations: number;
  constrainedStepNewtonIterations: number;
  /** Stages whose step was unavailable (a row's Jacobian unavailable or non-finite). */
  constrainedStepJacobianUnavailable: number;
  /** Stages whose start could not be corrected onto the hard rows. */
  constrainedStepStartNotCorrectable: number;
  /** Stages stopped by a row unavailable after an accepted move (stop `rowUnavailable`). */
  constrainedStepRowUnavailableStops: number;
  /** Hard-row hinge components replaced by their restating inequalities, summed over stages. */
  constrainedStepRestatedComponents: number;
}

export let solverWorkTrace: SketchSolverWorkTrace | null = null;

/**
 * T13e2: runs `run` and returns the Gauss–Newton fallback runs it made, so
 * specs can pin the fallback's behaviour without timing it; with the
 * cadara-b3k.26 work counters.
 */
export function traceSketchSolverForTest<T>(run: () => T): {
  result: T;
  gaussNewtonFallbacks: SketchGaussNewtonFallbackTrace[];
  work: SketchSolverWorkTrace;
} {
  const previous = gaussNewtonFallbackTrace;
  const previousWork = solverWorkTrace;
  const trace: SketchGaussNewtonFallbackTrace[] = [];
  const work: SketchSolverWorkTrace = {
    gaussNewtonIterations: 0,
    bfgsIterations: 0,
    bfgsResets: 0,
    dragConditioningIterations: 0,
    dragConditioningResidualEvaluations: 0,
    lossEvaluations: 0,
    lineSearches: 0,
    lineSearchTrials: 0,
    constrainednessClassifications: 0,
    componentResidualEvaluations: 0,
    constrainedStepStages: 0,
    constrainedStepIterations: 0,
    constrainedStepNewtonIterations: 0,
    constrainedStepJacobianUnavailable: 0,
    constrainedStepStartNotCorrectable: 0,
    constrainedStepRowUnavailableStops: 0,
    constrainedStepRestatedComponents: 0,
  };
  gaussNewtonFallbackTrace = trace;
  solverWorkTrace = work;
  try {
    return { result: run(), gaussNewtonFallbacks: trace, work };
  } finally {
    gaussNewtonFallbackTrace = previous;
    solverWorkTrace = previousWork;
  }
}
