import { solveBfgsOver } from "./bfgs";
import { pointVariableIndices } from "./compile-components";
import {
  deriveDragBranchInvariants,
  solveConstrainedDragStage,
  type DragBranchInvariants,
} from "./constrained-drag-stage";
import type { DraggedPointCandidate } from "./drag-candidates";
import { reevaluateDraggedPointCandidate } from "./drag-candidates";
import { createDragTargetConstraint } from "./drag-target-constraints";
import { resolveDragTargetFrame } from "./drag-target-frame";
import { createMinimumMotionAnchorConstraint } from "./minimum-motion-anchor";
import {
  dragFrozenAxisVariables,
  NO_FROZEN_VARIABLES,
} from "./mirror-axis-preference";
import {
  DRAG_MINIMUM_MOTION_EPSILON,
  DRAG_TARGET_WEIGHT,
} from "./solve-constants";
import { solveWithRebuildRetrySteps } from "./solve-program";
import type { SolveSteps } from "./solve-steps";
import type { SketchDraggedPointTarget } from "./solve-types";
import { cloneValues } from "./solver-geometry";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveComponent,
  SketchCompiledSolveProgram,
  SketchCompiledSolveSession,
} from "./system-types";
import type { ConstraintId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

// A frame minimizes cursor error and previous-frame motion subject to hard
// rows and row-derived branch/validity margins. A refused or unavailable step
// publishes nothing. Point release may project to the exact cursor, but uses
// the same acceptance and reads branch margins along that projection.

export const mirrorOutputVariablesByProgram = new WeakMap<
  SketchCompiledSolveProgram,
  ReadonlySet<number>
>();

/**
 * T15c: whether `index` is a mirror output point's (driven) slot. Other
 * driven outputs (offset, pattern, transform) are one-way (T12 D9) and keep
 * today's release frame.
 */
export function isMirrorOutputVariable(
  program: SketchCompiledSolveProgram,
  index: number,
) {
  let variables = mirrorOutputVariablesByProgram.get(program);
  if (!variables) {
    variables = new Set(
      (program.definition.derivedRelationships ?? []).flatMap((relationship) =>
        relationship.kind === "mirror"
          ? relationship.outputs.flatMap((output) =>
              output.outputPointIds.flatMap((pointId) =>
                pointVariableIndices(program.system.pointRecords.get(pointId)),
              ),
            )
          : [],
      ),
    );
    mirrorOutputVariablesByProgram.set(program, variables);
  }
  return variables.has(index);
}

export type DragFrameInput = {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragConstraints: ScalarConstraintRecord[];
  draggedVariableIndices: number[];
  constraintLabel: string;
  startValues?: Float64Array;
  /**
   * T13a2 (d1): the cursor and the existing target tolerance. T15c: `pin`
   * is the drag target as a hard (weight 1) wrapped requirement, used when
   * the dragged point is driven (a mirror output).
   */
  exactReach?: {
    position: SketchPoint2D;
    targetTolerance: number;
    pin: ScalarConstraintRecord;
  };
  /**
   * T13a2 (review R-1): the target is the last accepted frame's; that frame
   * is this frame's solution (a re-solve only re-walks the path), so only
   * the exact-reach step runs on it.
   */
  repeatsAcceptedFrame?: boolean;
};

/**
 * T12b: generalized drag frame solver that accepts pre-resolved constraints
 * and dragged variable indices. All drag target types (point, translate,
 * radius, tangent vector) reduce to this common frame solver.
 *
 * T15c (issue 15 axis preference; [TECH] T-6 + R-7, A-1): stage 1 is the
 * frame solve with the frozen mirror axes (`dragFrozenAxisVariables`)
 * excluded from the solved set; the drag target stays a requirement on its
 * own (possibly driven) slots, never a pre-reflected target. It is kept
 * whenever the frame accepts it, however far the cursor lags (the cursor is
 * a soft objective, D1). Only a stage-1 frame that is not accepted runs
 * stage 2, today's unrestricted frame, kept only if accepted (otherwise the
 * caller keeps the last accepted frame). Without a frozen axis the frame is
 * the unchanged single stage.
 */
export function* solveDragFrameGeneral(
  input: DragFrameInput,
): SolveSteps<DraggedPointCandidate | null> {
  const frozen = dragFrozenAxisVariables(
    input.session.program,
    input.session.lastAcceptedSnapshot,
    input.component,
    input.draggedVariableIndices,
  );
  const preferred = yield* solveDragFrameStage(input, frozen);
  // A refused or stalled (null) preferred stage runs the unrestricted one.
  if (frozen.size === 0 || preferred?.accepted) return preferred;
  return yield* solveDragFrameStage(input, NO_FROZEN_VARIABLES);
}

/** One constrained stage over the component's authority variables minus frozen axes. */
export function* solveDragFrameStage(
  input: DragFrameInput,
  frozen: ReadonlySet<number>,
): SolveSteps<DraggedPointCandidate | null> {
  const { session, component } = input;
  const program = session.program;
  const parameterCount = program.system.parameterCount;
  const bfgs = program.strategy === "bfgs";

  const componentConstraintSet = new Set(component?.equationIndices ?? []);
  const hardConstraints = program.system.scalarConstraints.filter((_, index) =>
    component ? componentConstraintSet.has(index) : true,
  );
  const affectedVariables = Array.from(
    component?.variableIndices ??
      Array.from({ length: parameterCount }, (_, index) => index),
  );
  const solvedVariables =
    frozen.size === 0
      ? affectedVariables
      : affectedVariables.filter((index) => !frozen.has(index));
  const draggedSet = new Set(input.draggedVariableIndices);
  const nonDraggedVariableIndices = solvedVariables.filter(
    (index) => !draggedSet.has(index),
  );

  const previousFrame = cloneValues(session.values);
  const candidateOf = (solved: Float64Array) => {
    const candidate = cloneValues(session.values);
    for (const index of affectedVariables) {
      candidate[index] = solved[index]!;
    }
    return candidate;
  };
  const judge = (values: Float64Array) =>
    reevaluateDraggedPointCandidate(session, values);
  // Under the constrained step the frame's boundary margins; the exact-reach
  // projection is a straight move from the candidate, read along its way too
  // (`refusesMove`), so it cannot fold a length through zero.
  let derivedInvariants: DragBranchInvariants | undefined;
  const frameInvariants = () =>
    (derivedInvariants ??= deriveDragBranchInvariants(
      program,
      hardConstraints,
      previousFrame,
      solvedVariables,
    ));
  const projectedAcross = (from: Float64Array, to: Float64Array) =>
    frameInvariants().refusesMove(from, to);
  const exactReach = (candidate: DraggedPointCandidate) => {
    if (!bfgs || !input.exactReach || !candidate.accepted) return candidate;
    const [x, y] = input.draggedVariableIndices;
    const { position, targetTolerance, pin } = input.exactReach;
    if (
      x !== undefined &&
      y !== undefined &&
      isMirrorOutputVariable(program, x) &&
      isMirrorOutputVariable(program, y)
    ) {
      // T15c (T13a2 d1 for a driven target, a mirror output point):
      // pinning its slots is overwritten by the projection, so the target
      // is pinned as a hard requirement on them and the stage's variables
      // (frozen axes stay) are projected from the frame; kept only if
      // accepted and within the reach tolerance.
      const lagOf = (values: Float64Array) => {
        const projected =
          program.system.parameterProjection.projectValues(values);
        return Math.hypot(
          projected[x]! - position[0],
          projected[y]! - position[1],
        );
      };
      if (lagOf(candidate.values) <= targetTolerance) return candidate;
      const projected = solveBfgsOver(
        cloneValues(candidate.values),
        [...hardConstraints, pin],
        { variableIndices: solvedVariables },
      );
      const reached = judge(candidateOf(projected.values));
      return reached.accepted &&
        !projectedAcross(candidate.values, reached.values) &&
        lagOf(reached.values) <= targetTolerance
        ? reached
        : candidate;
    }
    const affected = new Set(affectedVariables);
    if (
      x === undefined ||
      y === undefined ||
      !affected.has(x) ||
      !affected.has(y)
    )
      return candidate;
    const lag = Math.hypot(
      candidate.values[x]! - position[0],
      candidate.values[y]! - position[1],
    );
    // T17c6 (D-3): any nonzero lag runs the step, not only a lag above
    // the reach tolerance, so a reachable release (a fit point dropped on
    // its neighbour) lands exactly at the cursor, not ~1e-15–1e-6 away.
    if (lag === 0) return candidate;
    const pinned = cloneValues(candidate.values);
    pinned[x] = position[0];
    pinned[y] = position[1];
    const projected = solveBfgsOver(pinned, hardConstraints, {
      variableIndices: nonDraggedVariableIndices,
    });
    const reached = judge(candidateOf(projected.values));
    return reached.accepted &&
      !projectedAcross(candidate.values, reached.values)
      ? reached
      : candidate;
  };

  if (input.repeatsAcceptedFrame && input.startValues === undefined) {
    return exactReach({
      ...judge(cloneValues(session.values)),
    });
  }

  const constrained = yield* solveConstrainedDragStage({
    program,
    hardConstraints,
    objective: [
      ...input.dragConstraints,
      createMinimumMotionAnchorConstraint({
        id: `constraint_drag_minimum_motion_${input.constraintLabel}` as ConstraintId,
        parameterCount,
        anchorValues: previousFrame,
        variableIndices: nonDraggedVariableIndices,
        weight: DRAG_MINIMUM_MOTION_EPSILON,
        parameterProjection: program.system.parameterProjection,
      }),
    ],
    start: input.startValues ?? session.values,
    invariants: frameInvariants(),
    variables: solvedVariables,
  });
  // A refused step (it reached a boundary, or could not move) yields no
  // candidate, so no re-check of its values can accept the frame.
  if (!constrained || constrained.kind === "refused") return null;
  return exactReach(judge(candidateOf(constrained.values)));
}

export function* solveDraggedPointFrame(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
  startValues?: Float64Array;
  exactReachTolerance?: number;
  repeatsAcceptedFrame?: boolean;
}): SolveSteps<DraggedPointCandidate | null> {
  const { session, component, dragTarget } = input;
  const constraint = createDragTargetConstraint(
    session.program.system,
    dragTarget,
    DRAG_TARGET_WEIGHT,
  );
  if (!constraint) return null;
  const draggedRecord = session.program.system.pointRecords.get(
    dragTarget.pointId,
  );
  const draggedVariableIndices = draggedRecord
    ? [draggedRecord.baseIndex, draggedRecord.baseIndex + 1]
    : [];
  return yield* solveDragFrameGeneral({
    session,
    component,
    dragConstraints: [constraint],
    draggedVariableIndices,
    constraintLabel: dragTarget.pointId,
    startValues: input.startValues,
    exactReach:
      input.exactReachTolerance === undefined
        ? undefined
        : {
            position: dragTarget.position,
            targetTolerance: input.exactReachTolerance,
            // T15c: the existing point is resolved above, so never null.
            pin: createDragTargetConstraint(
              session.program.system,
              dragTarget,
            )!,
          },
    repeatsAcceptedFrame: input.repeatsAcceptedFrame,
  });
}

/**
 * T12b: generalized frame solve with rebuild retry for any drag target type.
 */
export function* solveDragFrameGeneralWithRebuild(input: {
  session: SketchCompiledSolveSession;
  resolved: NonNullable<ReturnType<typeof resolveDragTargetFrame>>;
  constraintLabel: string;
}): SolveSteps<DraggedPointCandidate | null> {
  const { session, resolved, constraintLabel } = input;
  return yield* solveWithRebuildRetrySteps<DraggedPointCandidate | null>({
    program: session.program,
    startValues: session.values,
    solve: () =>
      solveDragFrameGeneral({
        session,
        component: resolved.component,
        dragConstraints: resolved.constraints,
        draggedVariableIndices: resolved.draggedVariableIndices,
        constraintLabel,
      }),
    retry: (from) =>
      solveDragFrameGeneral({
        session,
        component: resolved.component,
        dragConstraints: resolved.constraints,
        draggedVariableIndices: resolved.draggedVariableIndices,
        constraintLabel,
        startValues: from,
      }),
    valuesOf: (candidate) => candidate?.values ?? null,
    reevaluate: (values) => reevaluateDraggedPointCandidate(session, values),
    isAccepted: (candidate) => candidate?.accepted === true,
  });
}
