import { evaluateLoss, solveBfgsOver } from "./bfgs";
import {
  maxAbs,
  minimumNormStep,
  solveConstrainedMinimumMotionSteps,
} from "./constrained-minimum-motion";
import type { ConstrainedStepRow } from "./constrained-minimum-motion";
import { BRANCH_BOUNDARY_TOLERANCES } from "./constrained-drag-stage";
import {
  pointVariableIndices,
  uniqueSortedIndices,
} from "./compile-components";
import { materializeSolveResult } from "./materialize-result";
import { createMinimumMotionAnchorConstraint } from "./minimum-motion-anchor";
import {
  NO_FROZEN_VARIABLES,
  withFrozenVariables,
} from "./mirror-axis-preference";
import { rebuiltBlockedOffsets } from "./offset-requirements";
import { BFGS_MIN_LOSS, DRAG_MINIMUM_MOTION_EPSILON } from "./solve-constants";
import { finishSolve, immediateSolve } from "./solve-steps";
import type { SolveSteps } from "./solve-steps";
import type { SolvedSystemValues } from "./solve-strategies";
import { solveSystemValues } from "./solve-strategies";
import { cloneValues, uniformNorm } from "./solver-geometry";
import {
  isAcceptableSolvedSnapshot,
  isAcceptableSolvedValues,
} from "./start-session";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveComponent,
  SketchCompiledSolveProgram,
} from "./system-types";
import type { ConstraintId } from "@/contracts/shared/ids";

/**
 * [TECH] G16‴ + G16⁗: one solve from `startValues` with at most one
 * re-solve on rebuild.
 * - The blocked set is the offset relationships failing at `startValues`,
 *   decided once. A requirement naming one of them is held blocked for the
 *   whole solve, also at iterates where it builds again (re-review A-1:
 *   its real residual appearing there would reward staying failed).
 * - If a held relationship that a requirement names builds at the end
 *   values, the first result is re-evaluated there with those
 *   relationships out of the blocked set (their requirements use real
 *   residuals). If that is accepted, it is the result (the solver's own
 *   acceptance: a re-solve cannot be better). Otherwise the problem is
 *   re-solved exactly once from the end values with the reduced set, where
 *   a mid-solve failure is unbounded as in any solve.
 * - The re-solve is judged the same way (a held relationship building at
 *   its end values is re-evaluated, never re-solved again) and replaces
 *   the first result only when it is accepted.
 * Without a failure at the start this is the one plain solve.
 */
export function solveWithRebuildRetry<T>(input: {
  program: SketchCompiledSolveProgram;
  startValues: Float64Array;
  solve: () => T;
  retry: (from: Float64Array) => T;
  valuesOf: (result: T) => Float64Array | null;
  reevaluate: (values: Float64Array) => T;
  isAccepted: (result: T) => boolean;
}): T {
  return finishSolve(
    solveWithRebuildRetrySteps({
      ...input,
      solve: () => immediateSolve(input.solve),
      retry: (from) => immediateSolve(() => input.retry(from)),
    }),
  );
}

export function* solveWithRebuildRetrySteps<T>(input: {
  program: SketchCompiledSolveProgram;
  startValues: Float64Array;
  solve: () => SolveSteps<T>;
  retry: (from: Float64Array) => SolveSteps<T>;
  valuesOf: (result: T) => Float64Array | null;
  reevaluate: (values: Float64Array) => T;
  isAccepted: (result: T) => boolean;
}): SolveSteps<T> {
  const projection = input.program.system.parameterProjection;
  const run = function* (
    blocked: ReadonlySet<string>,
    solve: () => SolveSteps<T>,
  ) {
    const steps = solve();
    // Scope EACH resume, not creation of the generator. Yielding must restore
    // projection state for probes/other sessions, and a retry must resume with
    // its reduced blocked set rather than re-deciding from the accepted start.
    let next = projection.withBlockedRelationships(blocked, () => steps.next());
    while (!next.done) {
      yield next.value;
      next = projection.withBlockedRelationships(blocked, () => steps.next());
    }
    const result = next.value;
    return projection.withBlockedRelationships(blocked, () => {
      const values = blocked.size > 0 ? input.valuesOf(result) : null;
      return {
        result,
        values,
        rebuilt: values
          ? rebuiltBlockedOffsets(input.program, values)
          : new Set<string>(),
      };
    });
  };
  const without = (
    blocked: ReadonlySet<string>,
    rebuilt: ReadonlySet<string>,
  ): ReadonlySet<string> =>
    new Set([...blocked].filter((derivationId) => !rebuilt.has(derivationId)));
  const judged = (
    blocked: ReadonlySet<string>,
    solved: { result: T; values: Float64Array | null; rebuilt: ReadonlySet<string> },
  ) =>
    solved.rebuilt.size === 0
      ? solved.result
      : projection.withBlockedRelationships(
          without(blocked, solved.rebuilt),
          () => input.reevaluate(solved.values!),
        );

  const blockedAtStart = projection.relationshipFailuresAt(input.startValues);
  const first = yield* run(blockedAtStart, input.solve);
  if (first.rebuilt.size === 0) return first.result;
  const kept = judged(blockedAtStart, first);
  if (input.isAccepted(kept)) return kept;
  const blocked = without(blockedAtStart, first.rebuilt);
  const retried = judged(
    blocked,
    yield* run(blocked, () => input.retry(first.values!)),
  );
  return input.isAccepted(retried) ? retried : kept;
}

/**
 * The minimum-motion point of a batch solve: the nearest point to
 * `startValues` (Euclidean, over `variables`) on the hard rows' solution
 * set, by the equality-constrained minimum-motion step with the start as its
 * only objective (the anchor's weight does not matter: it is the whole
 * objective). An under-determined edit (a dimension change that a fillet's
 * radius or a free point could absorb) then lands where the least geometry
 * moves, as in a drag, instead of wherever the least-squares descent's first
 * steps happen to leave it on the solution set. A hinge component that an
 * explicit inequality restates is enforced as that inequality instead of as
 * an equality. Where the step is unavailable (a row's Jacobian unavailable,
 * or a start that cannot be corrected onto the rows, e.g. an inconsistent
 * system) the start is returned unchanged and the solve is the plain one.
 */
function solveConstrainedMinimumMotionStart(
  program: SketchCompiledSolveProgram,
  startValues: Float64Array,
  equations: readonly ScalarConstraintRecord[],
  variables: readonly number[],
): Float64Array {
  if (batchMinimumMotionStartTrace)
    batchMinimumMotionStartTrace.constrained += 1;
  const restated = program.system.inequalities.filter((inequality) =>
    equations.some(
      (row) =>
        row.id === inequality.requirement?.id &&
        row.hingeComponentIndices?.includes(
          inequality.requirement.componentIndex,
        ),
    ),
  );
  const anchor = createMinimumMotionAnchorConstraint({
    id: "constraint_batch_minimum_motion" as ConstraintId,
    parameterCount: program.system.parameterCount,
    anchorValues: startValues,
    variableIndices: variables,
    weight: 1,
    parameterProjection: program.system.parameterProjection,
  });
  const equalities = equations.map((row) => ({
    evaluate: (values: Float64Array) => row.evaluateComponentJacobian(values),
    excludedComponents: restated.flatMap((inequality) =>
      inequality.requirement!.id === row.id
        ? [inequality.requirement!.componentIndex]
        : [],
    ),
  }));
  const result = finishSolve(
    solveConstrainedMinimumMotionSteps({
      start: startValues,
      variables,
      equalities,
      // The restated hinges sit on their boundary at the start; the band is
      // the same τ-based one the drag step uses, so it does not depend on
      // where the geometry sits.
      boundary: BRANCH_BOUNDARY_TOLERANCES * program.modelingTolerance,
      inequalities: restated.map(
        (inequality) => (values: Float64Array) => inequality.evaluate(values),
      ),
      objective: [
        { evaluate: (values) => anchor.evaluateComponentJacobian(values) },
      ],
    }),
  );
  return result.kind === "solved"
    ? polishedOntoRows(result.values, equalities, variables)
    : startValues;
}

/** The batch starts taken, as recorded by `traceBatchMinimumMotionStartsForTest`. */
let batchMinimumMotionStartTrace: {
  constrained: number;
  anchored: number;
} | null = null;

/** Runs `run` and counts which minimum-motion start each batch solve took. */
export function traceBatchMinimumMotionStartsForTest<T>(run: () => T) {
  const previous = batchMinimumMotionStartTrace;
  const starts = { constrained: 0, anchored: 0 };
  batchMinimumMotionStartTrace = starts;
  try {
    return { result: run(), starts };
  } finally {
    batchMinimumMotionStartTrace = previous;
  }
}

/** At most this many polishing Newton steps (each one squares the residual). */
const POLISH_NEWTON_ITERATIONS = 3;

/**
 * `values` after minimum-norm Newton steps on the equality components
 * while their largest residual strictly decreases. The step stops its
 * corrector at a feasibility tolerance (1e-12 relative), which leaves an
 * authored radius 8 measuring 7.999999999997 and two fit points joined by
 * a Coincident ~1e-12 apart (a zero-length span is what the degenerate-span
 * diagnostic reads); the quadratic convergence of one or two more steps
 * reaches the rounding floor, as the least-squares descent did. Each step
 * moves the geometry by about the residual, so the minimum-motion point is
 * kept.
 */
function polishedOntoRows(
  values: Float64Array,
  equalities: readonly ConstrainedStepRow[],
  variables: readonly number[],
): Float64Array {
  const linearize = (at: Float64Array) => {
    const residuals: number[] = [];
    const rows: Float64Array[] = [];
    for (const row of equalities) {
      const jacobian = row.evaluate(at);
      if (jacobian.unavailable) return null;
      const excluded = new Set(row.excludedComponents);
      jacobian.components.forEach((residual, component) => {
        if (excluded.has(component)) return;
        residuals.push(residual);
        rows.push(
          Float64Array.from(
            variables,
            (index) => jacobian.rows[component]![index]!,
          ),
        );
      });
    }
    return residuals.every(Number.isFinite) &&
      rows.every((row) => row.every(Number.isFinite))
      ? { residuals: Float64Array.from(residuals), rows }
      : null;
  };
  let scale = 1;
  for (const index of variables)
    scale = Math.max(scale, Math.abs(values[index]!));
  // Residuals at the rounding floor of the coordinates are left alone: a
  // step there only adds noise (an exact 0 coordinate would read ~1e-21).
  const floor = Number.EPSILON * scale;
  let current = values;
  let linear = linearize(current);
  for (
    let iteration = 0;
    linear &&
    iteration < POLISH_NEWTON_ITERATIONS &&
    maxAbs(linear.residuals) > floor;
    iteration += 1
  ) {
    const step = minimumNormStep(
      linear.rows,
      linear.residuals,
      variables.length,
    );
    const next = cloneValues(current);
    variables.forEach((index, column) => {
      next[index] -= step[column]!;
    });
    const nextLinear = linearize(next);
    if (
      !nextLinear ||
      !(maxAbs(nextLinear.residuals) < maxAbs(linear.residuals))
    )
      break;
    current = next;
    linear = nextLinear;
  }
  return current;
}

/**
 * One batch solve of `program` from `startValues` (no rebuild handling).
 *
 * The descent starts from the minimum-motion point of the hard rows
 * (`solveConstrainedMinimumMotionStart`), so an accepted under-determined
 * result is the minimum-motion one; from there the least-squares descent only
 * polishes (or, where the constrained step was unavailable, solves from the
 * start).
 *
 * T13e2 (B4): a rejected result is re-solved with the drag minimum-motion
 * term anchored at the start (`createMinimumMotionAnchorConstraint`,
 * `DRAG_MINIMUM_MOTION_EPSILON`), and that result is reported. An
 * inconsistent system has no exact solution, and the plain least-squares
 * descent can slide towards an unattained infimum (kilometres along a
 * line's extension); the anchored solve is the nearest compromise. Only the
 * components holding an unsatisfied requirement (or a degenerate solved
 * line) are re-solved, from their start values; every other component keeps
 * its plain solution, so a consistent part that needs a large move is not
 * pulled back by the anchor. The anchor only changes rejected results (it
 * may also find an accepted one near the start). Statuses are judged on the
 * hard requirements alone. A solve whose start already has a failing offset
 * relationship is left to the [TECH] G16‴/G16⁗ blocked-set and rebuild
 * handling, unchanged. Only the normal `"bfgs"` strategy re-solves: the
 * explicit Gauss–Newton/Levenberg–Marquardt/gradient strategies keep their
 * own result (the re-solve is a BFGS solve), and the redundancy probe's
 * `"bfgsWithoutFallback"` trials only need the verdict, which is never
 * displayed or stored (the re-solve would double the cost of a rejected
 * trial).
 */
export function solveProgramValues(
  program: SketchCompiledSolveProgram,
  startValues: Float64Array,
  /**
   * T15c (axis preference): `frozen` variables are excluded from the solved
   * set (stage 1); `components` restricts the solve, and its B4 re-solve,
   * to those components' equations, every other variable keeping its start
   * value (stage 2). Absent: the whole system, as before.
   */
  stage: {
    frozen?: ReadonlySet<number>;
    components?: readonly SketchCompiledSolveComponent[];
  } = {},
) {
  const frozen = stage.frozen ?? NO_FROZEN_VARIABLES;
  const scope = stage.components;
  // A restricted solve reports its loss over every equation.
  const judged = (candidate: SolvedSystemValues): SolvedSystemValues => {
    if (!scope) return candidate;
    const state = evaluateLoss(
      candidate.values,
      program.system.scalarConstraints,
    );
    return {
      values: candidate.values,
      loss: state.loss,
      perConstraint: state.perConstraint,
    };
  };
  const equations = scope
    ? scope.flatMap((component) =>
        component.equationIndices.map(
          (equationIndex) => program.system.scalarConstraints[equationIndex]!,
        ),
      )
    : program.system.scalarConstraints;
  const constraints = withFrozenVariables(equations, frozen);
  // A start the descent would keep (its own stop test) stays bit-unchanged:
  // its minimum-motion point is itself within the tolerances, and a solve
  // of an unchanged sketch (Undo, reopen, Finish) must not move it.
  const startState = evaluateLoss(startValues, constraints);
  const startKept =
    startState.loss < BFGS_MIN_LOSS || uniformNorm(startState.gradient) < 1e-8;
  // Components share no variables or equations, so the step only takes the
  // ones whose own start fails that test: a dimension edit in one profile
  // does not pay a dense step over every other profile of the sketch.
  const moving =
    program.strategy === "bfgs" && !startKept
      ? (scope ?? program.components).filter((component) => {
          const state = evaluateLoss(
            startValues,
            component.equationIndices.map(
              (equationIndex) =>
                program.system.scalarConstraints[equationIndex]!,
            ),
          );
          return !(
            state.loss < BFGS_MIN_LOSS ||
            component.variableIndices.every(
              (index) =>
                frozen.has(index) || Math.abs(state.gradient[index]!) < 1e-8,
            )
          );
        })
      : [];
  const minimumMotionStart =
    moving.length > 0
      ? solveConstrainedMinimumMotionStart(
          program,
          startValues,
          moving.flatMap((component) =>
            component.equationIndices.map(
              (equationIndex) =>
                program.system.scalarConstraints[equationIndex]!,
            ),
          ),
          uniqueSortedIndices(
            moving.flatMap((component) =>
              component.variableIndices.filter((index) => !frozen.has(index)),
            ),
          ),
        )
      : startValues;
  const solved = judged(
    solveSystemValues(
      minimumMotionStart,
      constraints,
      program.strategy,
      (candidate) => isAcceptableSolvedValues(program, judged(candidate)),
    ),
  );
  const plain = {
    solved,
    result: materializeSolveResult(program, solved.values, solved),
  };
  const snapshot = plain.result.solvedSnapshot;
  if (
    isAcceptableSolvedSnapshot(snapshot) ||
    program.strategy !== "bfgs" ||
    // T15b (review A6): any relationship failing at the start (offset or mirror).
    program.system.parameterProjection.relationshipFailuresAt(startValues)
      .size > 0
  ) {
    return plain;
  }
  const unsatisfiedIds = new Set<string>([
    ...snapshot.constraintStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.constraintId] : [],
    ),
    ...snapshot.dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.dimensionId] : [],
    ),
  ]);
  const degenerateVariables = new Set(
    snapshot.diagnostics.flatMap((diagnostic) => {
      if (
        diagnostic.code !== "degenerate-solved-line-segment" ||
        diagnostic.target?.kind !== "entity"
      )
        return [];
      const entityId = diagnostic.target.entityId;
      const line = program.definition.entities.find(
        (entity) => entity.entityId === entityId,
      );
      return line?.kind === "lineSegment"
        ? [line.startPointId, line.endPointId].flatMap((pointId) =>
            pointVariableIndices(program.system.pointRecords.get(pointId)),
          )
        : [];
    }),
  );
  const conflicted = (scope ?? program.components).filter(
    (component) =>
      component.equationIndices.some((equationIndex) =>
        unsatisfiedIds.has(program.system.scalarConstraints[equationIndex]!.id),
      ) ||
      component.variableIndices.some((index) => degenerateVariables.has(index)),
  );
  if (conflicted.length === 0) {
    return plain;
  }
  const variableIndices = uniqueSortedIndices(
    conflicted.flatMap((component) =>
      component.variableIndices.filter((index) => !frozen.has(index)),
    ),
  );
  const anchor = createMinimumMotionAnchorConstraint({
    id: "constraint_commit_minimum_motion" as ConstraintId,
    parameterCount: program.system.parameterCount,
    anchorValues: startValues,
    variableIndices,
    weight: DRAG_MINIMUM_MOTION_EPSILON,
    parameterProjection: program.system.parameterProjection,
  });
  const restart = cloneValues(solved.values);
  for (const index of variableIndices) restart[index] = startValues[index]!;
  const anchoredValues = solveBfgsOver(
    restart,
    [
      ...conflicted.flatMap((component) =>
        component.equationIndices.map(
          (equationIndex) => program.system.scalarConstraints[equationIndex]!,
        ),
      ),
      anchor,
    ],
    { variableIndices },
  ).values;
  const state = evaluateLoss(anchoredValues, program.system.scalarConstraints);
  const anchored: SolvedSystemValues = {
    values: anchoredValues,
    loss: state.loss,
    perConstraint: state.perConstraint,
  };
  return {
    solved: anchored,
    result: materializeSolveResult(program, anchored.values, anchored),
  };
}

/** [TECH] G16⁗: a batch or session solve result re-materialized at `values`. */
export function reevaluateProgramValues(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
) {
  const state = evaluateLoss(values, program.system.scalarConstraints);
  const solved: SolvedSystemValues = {
    values: cloneValues(values),
    loss: state.loss,
    perConstraint: state.perConstraint,
  };
  return {
    solved,
    result: materializeSolveResult(program, solved.values, solved),
  };
}
