import {
  evaluateLoss,
  lineSearchWolfe,
  multiplyMatrixVector,
  solveBfgsOver,
  solveBfgsOverSteps,
} from "./bfgs";
import { pointVariableIndices } from "./compile-components";
import { solveConstrainedDragStage } from "./constrained-drag-stage";
import type {
  DraggedPointCandidate,
  SketchDragCurvature,
} from "./drag-candidates";
import { reevaluateDraggedPointCandidate } from "./drag-candidates";
import { createDragTargetConstraint } from "./drag-target-constraints";
import { resolveDragTargetFrame } from "./drag-target-frame";
import { createMinimumMotionAnchorConstraint } from "./minimum-motion-anchor";
import {
  dragFrozenAxisVariables,
  NO_FROZEN_VARIABLES,
  withFrozenVariables,
} from "./mirror-axis-preference";
import {
  addDiagonal,
  solvePivotedCholesky,
  sparseNormalMatrix,
  transpose,
} from "./normal-equations";
import {
  DRAG_CONDITIONING_MAX_ITERATIONS,
  DRAG_CONDITIONING_TARGET_LOSS,
  DRAG_MINIMUM_MOTION_EPSILON,
  DRAG_PREVIEW_RAW_BLOCKS,
  DRAG_TARGET_WEIGHT,
} from "./solve-constants";
import { solveWithRebuildRetrySteps } from "./solve-program";
import type { SolveSteps, SolveWork } from "./solve-steps";
import { solveSystemValuesSteps } from "./solve-strategies";
import { solverWorkTrace } from "./solve-tracing";
import type { SketchDraggedPointTarget } from "./solve-types";
import { cloneValues, zeroVector } from "./solver-geometry";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveComponent,
  SketchCompiledSolveProgram,
  SketchCompiledSolveSession,
} from "./system-types";
import type { ConstraintId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

// D1/D2/D4: solve a single continuous drag frame for one cursor position.
//
// Phase A minimizes the hard constraints together with the soft drag objective
// and the uniform minimum-motion term (anchored to the previous accepted frame).
// If the hard constraints are satisfied, the frame is accepted directly (this is
// the feasible/reachable case, including rigid translation).
//
// Phase B (the sliding case) projects the phase-A candidate back onto the
// hard-constraint manifold by minimizing displacement FROM the phase-A position,
// with no drag term. This settles the dragged point at the closest feasible
// position instead of returning a compromise that violates authored constraints.
// Neither phase seeds or accepts reflected/discontinuous branches (D4): the frame
// is solved purely by continuous iteration from the previous accepted values.
//
// T13a2, with the BFGS strategy:
// - c2: phase A runs BFGS without the Gauss–Newton fallback. Phase A's loss
//   includes the soft cursor and anchor terms, so a converged frame can sit
//   above SOLVED_LOSS_THRESHOLD and wrongly trigger the fallback; acceptance
//   and phase B (which keeps the fallback, hard constraints only) judge it.
// - c3: phase A solves only the component's (authority) variables. Every
//   phase-A term's gradient is supported there: the component is the union
//   of its equations' projected supports, and an offset/derived output is
//   projected onto its seeds' authority variables, so relationships seeded in
//   the component are solved with it. Outside it the gradient is zero, so
//   the iterates equal the full solve's, and other components keep their
//   previous values (only `affectedVariables` are copied back, as before):
//   the restriction is bit-identical to the full solve. An interactive
//   preview frame also reuses the previous accepted frame's inverse
//   Hessian for the same drag problem (25–30 % faster frames). That keeps
//   the objective, stop test and acceptance but changes the path, and with
//   the 1e-6 anchor under the 1e-8 gradient stop the accepted frame moves
//   by O(1e-3) on fillet/offset outlines (path dependence within the
//   existing stop accuracy; accepted under D1 by the orchestrator). The
//   release frame starts from the identity, so the committed state does
//   not depend on the reuse path.
// - d1: when a session update with a reach tolerance (the release frame of
//   an editor drag, or a single solver call) has an accepted frame that
//   leaves the dragged point off the cursor (T17c6: any nonzero lag; a
//   driven mirror-output target: farther than `targetTolerance`), the point
//   is pinned at the cursor and the other component variables are
//   projected onto the hard constraints from that frame; the result
//   replaces the frame only if the frame acceptance accepts it.

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
  /** T13a2 (c3): reuse the session's curvature for this drag problem. */
  reuseCurvature?: boolean;
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
  if (frozen.size === 0 || preferred === null || preferred.accepted)
    return preferred;
  return yield* solveDragFrameStage(input, NO_FROZEN_VARIABLES);
}

/**
 * One stage of a drag frame: the T12b/T13a2 frame solve over the
 * component's variables minus `frozen` (phases A and B and the d1 step).
 * T13a2 (c3) curvature is keyed by the frozen set too, so a stage reuses
 * only its own stage's inverse Hessian (a different variable set or
 * objective restarts from the identity).
 */
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
  const solvedHardConstraints = withFrozenVariables(hardConstraints, frozen);
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
      return reached.accepted && lagOf(reached.values) <= targetTolerance
        ? { ...reached, curvature: candidate.curvature }
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
    return reached.accepted
      ? { ...reached, curvature: candidate.curvature }
      : candidate;
  };

  if (input.repeatsAcceptedFrame && input.startValues === undefined) {
    return exactReach({
      ...judge(cloneValues(session.values)),
      curvature: session.dragCurvature,
    });
  }

  // cadara-p4r5.2: the constrained step replaces phases A and B; where it is
  // unavailable at this frame, they run as without it.
  if (program.dragStep === "constrained") {
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
      variables: solvedVariables,
    });
    if (constrained) return exactReach(judge(candidateOf(constrained)));
  }

  // Phase A: hard constraints + soft cursor target + uniform minimum motion.
  const phaseAConstraints: ScalarConstraintRecord[] = [
    ...hardConstraints,
    ...input.dragConstraints,
    createMinimumMotionAnchorConstraint({
      id: `constraint_drag_minimum_motion_${input.constraintLabel}` as ConstraintId,
      parameterCount,
      anchorValues: previousFrame,
      variableIndices: nonDraggedVariableIndices,
      weight: DRAG_MINIMUM_MOTION_EPSILON,
      parameterProjection: program.system.parameterProjection,
    }),
  ];
  const curvatureKey = `${input.constraintLabel}|${component?.componentId ?? "all"}|${input.draggedVariableIndices.join(",")}${frozen.size === 0 ? "" : `|frozen:${[...frozen].join(",")}`}`;
  const reuse =
    input.reuseCurvature === true && input.startValues === undefined;
  let curvature: SketchDragCurvature | undefined;
  let solvedA: Float64Array;
  if (bfgs) {
    const start = input.startValues ?? session.values;
    // A recovery gesture starts outside the spline's regular domain (two fit
    // points coincide). Keep its existing BFGS/minimum-motion trajectory for
    // the whole gesture, including after the first separating frame: numerical
    // conditioning there changes untouched join residuals and downstream
    // topology/projection behavior. This optimization is for regular drags.
    const condition =
      program.degenerateSplineSpanRecovery.splineIds.size === 0 &&
      evaluateLoss(start, input.dragConstraints).loss >
      DRAG_CONDITIONING_TARGET_LOSS;
    const conditionedStart = condition
      ? yield* conditionDragStart(start, phaseAConstraints, solvedVariables)
      : start;
    const solved = yield* solveBfgsOverSteps(
      cloneValues(conditionedStart),
      phaseAConstraints,
      {
        variableIndices: solvedVariables,
        initialInverseHessian:
          reuse && !condition && session.dragCurvature?.key === curvatureKey
            ? session.dragCurvature.inverseHessian
            : null,
      },
    );
    solvedA = solved.values;
    curvature = reuse
      ? { key: curvatureKey, inverseHessian: solved.inverseHessian }
      : undefined;
  } else {
    solvedA = (
      yield* solveSystemValuesSteps(
        cloneValues(input.startValues ?? session.values),
        withFrozenVariables(phaseAConstraints, frozen),
        program.strategy,
      )
    ).values;
  }
  const candidateA = judge(candidateOf(solvedA));
  if (candidateA.accepted) {
    return exactReach({ ...candidateA, curvature });
  }

  // Phase B: project the phase-A candidate onto the hard-constraint manifold.
  const phaseBConstraints: ScalarConstraintRecord[] = [
    ...solvedHardConstraints,
  ];
  const solvedB = yield* solveSystemValuesSteps(
    cloneValues(candidateA.values),
    phaseBConstraints,
    program.strategy,
  );
  return exactReach({ ...judge(candidateOf(solvedB.values)), curvature });
}

/**
 * cadara-b3k.35: the hard rows, soft target and minimum-motion anchor span very
 * different scales. A few Gauss–Newton steps on their RAW residual components
 * condition the far part of a move before BFGS polishes the same objective.
 * Differentiating the squared losses instead would lose rank near satisfaction.
 *
 * Only the stage's solved variables move (including its frozen-axis policy).
 * Wolfe requires a decrease in the existing objective; failure keeps the last
 * iterate. This is not acceptance: the normal hard-row judge, phase B and exact
 * release still run. The anchor remains the previous ACCEPTED frame throughout.
 * Every finite-difference block evaluation is traced, not hidden behind the
 * reduced BFGS iteration count. Small targets never enter this path.
 */
export function* conditionDragStart(
  values: Float64Array,
  constraints: ScalarConstraintRecord[],
  indices: readonly number[],
) {
  const evaluate = function* (
    at: Float64Array,
    split: boolean,
  ): SolveSteps<number[]> {
    const residuals: number[] = [];
    for (const constraint of constraints) {
      if (split) yield { kind: "raw", count: 1 };
      if (solverWorkTrace)
        solverWorkTrace.dragConditioningResidualEvaluations += 1;
      residuals.push(...constraint.evaluateComponents(at));
    }
    return residuals;
  };
  let current = cloneValues(values);
  let state = evaluateLoss(current, constraints);
  for (
    let iteration = 0;
    iteration < DRAG_CONDITIONING_MAX_ITERATIONS;
    iteration += 1
  ) {
    const blocks = (1 + 2 * indices.length) * constraints.length;
    // Keep ordinary Jacobians atomic (the measured T18 scheduling policy), but
    // split oversized ones by block so a single Jacobian cannot starve forever.
    const split = blocks > DRAG_PREVIEW_RAW_BLOCKS;
    if (!split) yield { kind: "raw", count: blocks } satisfies SolveWork;
    // Do not borrow BFGS's loose absolute loss/gradient stop: on a soft target
    // it can leave cursor lag (mirror previews pin this). Failed Wolfe progress
    // or the short iteration bound ends conditioning; BFGS still polishes.
    if (solverWorkTrace) solverWorkTrace.dragConditioningIterations += 1;
    const residuals = yield* evaluate(current, split);
    const jacobian = residuals.map(() => zeroVector(indices.length));
    for (let column = 0; column < indices.length; column += 1) {
      const index = indices[column]!;
      const plus = cloneValues(current);
      const minus = cloneValues(current);
      const step =
        Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(current[index]!));
      plus[index] += step;
      minus[index] -= step;
      const next = yield* evaluate(plus, split);
      const previous = yield* evaluate(minus, split);
      for (let row = 0; row < residuals.length; row += 1)
        jacobian[row]![column] = (next[row]! - previous[row]!) / (2 * step);
    }
    const normal = addDiagonal(
      sparseNormalMatrix(jacobian, indices.length),
      1e-8,
    );
    const rhs = multiplyMatrixVector(
      transpose(jacobian),
      Float64Array.from(residuals),
    );
    const delta = solvePivotedCholesky(normal, rhs, 1e-12);
    const direction = zeroVector(values.length);
    for (let index = 0; index < indices.length; index += 1)
      direction[indices[index]!] = -delta[index]!;
    const next = lineSearchWolfe(current, direction, state, constraints);
    if (!next) break;
    current = next.nextValues;
    state = next.next;
  }
  return current;
}

export function* solveDraggedPointFrame(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
  startValues?: Float64Array;
  exactReachTolerance?: number;
  reuseCurvature?: boolean;
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
    reuseCurvature: input.reuseCurvature,
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
  reuseCurvature: boolean;
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
        reuseCurvature: input.reuseCurvature,
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
