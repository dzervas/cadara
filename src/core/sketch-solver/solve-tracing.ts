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
  lossEvaluations: number;
  lineSearches: number;
  lineSearchTrials: number;
  constrainednessClassifications: number;
  componentResidualEvaluations: number;
  /** Drag stages that ran the constrained minimum-motion step. */
  constrainedStepStages: number;
  /** Analytic row reads requested by drag steps, and reads actually evaluated. */
  constrainedDragJacobianReads: number;
  constrainedDragJacobianEvaluations: number;
  constrainedStepIterations: number;
  /** Multiply/add pairs in the step's linear-algebra kernels; excludes row evaluation and vector bookkeeping. */
  constrainedStepNormalOperations: number;
  constrainedStepProjectionOperations: number;
  constrainedStepFactorOperations: number;
  constrainedStepCurvatureOperations: number;
  constrainedStepNewtonIterations: number;
  /** Stages whose step was unavailable (a row's Jacobian unavailable or non-finite). */
  constrainedStepJacobianUnavailable: number;
  /** Stages whose start could not be corrected onto the hard rows. */
  constrainedStepStartNotCorrectable: number;
  /** Stages stopped by a row unavailable after an accepted move (stop `rowUnavailable`). */
  constrainedStepRowUnavailableStops: number;
  /** Stages whose step accepted no move before no trial could be corrected (the frame is refused). */
  constrainedStepStalledStops: number;
  /** Stages refused because a trial crossed or an accepted move reached a margin clear at the previous frame (policy "block"). */
  constrainedStepBoundaryRefusals: number;
  /** Boundary refusals decided at a corrected trial, before landing on the boundary. */
  constrainedStepBoundaryTrialRefusals: number;
  /** Row-derived branch invariants and validity margins taken into constrained steps (`DragBranchInvariants`). */
  constrainedStepBoundaryInvariants: number;
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
    lossEvaluations: 0,
    lineSearches: 0,
    lineSearchTrials: 0,
    constrainednessClassifications: 0,
    componentResidualEvaluations: 0,
    constrainedStepStages: 0,
    constrainedDragJacobianReads: 0,
    constrainedDragJacobianEvaluations: 0,
    constrainedStepIterations: 0,
    constrainedStepNormalOperations: 0,
    constrainedStepProjectionOperations: 0,
    constrainedStepFactorOperations: 0,
    constrainedStepCurvatureOperations: 0,
    constrainedStepNewtonIterations: 0,
    constrainedStepJacobianUnavailable: 0,
    constrainedStepStartNotCorrectable: 0,
    constrainedStepRowUnavailableStops: 0,
    constrainedStepStalledStops: 0,
    constrainedStepBoundaryRefusals: 0,
    constrainedStepBoundaryTrialRefusals: 0,
    constrainedStepBoundaryInvariants: 0,
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

/** Count arithmetic where it is performed, including correctors and polishing. */
export function traceConstrainedStepOperations(
  piece: "Normal" | "Projection" | "Factor" | "Curvature",
  count: number,
) {
  if (solverWorkTrace)
    solverWorkTrace[`constrainedStep${piece}Operations`] += count;
}
