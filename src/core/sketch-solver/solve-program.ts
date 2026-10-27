import { evaluateLoss, solveBfgsOver } from "./bfgs";
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
import { DRAG_MINIMUM_MOTION_EPSILON } from "./solve-constants";
import { finishSolve, immediateSolve } from "./solve-steps";
import type { SolveSteps } from "./solve-steps";
import type { SolvedSystemValues } from "./solve-strategies";
import { solveSystemValues } from "./solve-strategies";
import { cloneValues } from "./solver-geometry";
import {
  isAcceptableSolvedSnapshot,
  isAcceptableSolvedValues,
} from "./start-session";
import type {
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
 * One batch solve of `program` from `startValues` (no rebuild handling).
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
  const solved = judged(
    solveSystemValues(
      startValues,
      withFrozenVariables(
        scope
          ? scope.flatMap((component) =>
              component.equationIndices.map(
                (equationIndex) =>
                  program.system.scalarConstraints[equationIndex]!,
              ),
            )
          : program.system.scalarConstraints,
        frozen,
      ),
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
