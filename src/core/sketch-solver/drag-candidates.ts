import { evaluateLoss } from "./bfgs";
import { createDraggedPointAcceptance } from "./drag-acceptance";
import { solveDraggedPointFrame } from "./drag-frame-stage";
import { materializeSolveResult } from "./materialize-result";
import { solveWithRebuildRetrySteps } from "./solve-program";
import { finishSolve } from "./solve-steps";
import type { SolveSteps } from "./solve-steps";
import type {
  SketchCoreSolveResult,
  SketchDraggedPointSolveResult,
  SketchDraggedPointTarget,
} from "./solve-types";
import { cloneValues } from "./solver-geometry";
import type {
  SketchCompiledSolveComponent,
  SketchCompiledSolveProgram,
  SketchCompiledSolveSession,
} from "./system-types";

/**
 * [TECH] G16′: an accepted frame's values with every driven index set to
 * its accepted (projected) value, so an offset relationship that fails in a
 * later frame holds the last accepted frame's outputs, not the drag start's.
 * Authority indices are unchanged, and a driven raw value is never read
 * while its relationship evaluates, so nothing changes without a failure.
 */
export function heldDrivenValues(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
) {
  return program.system.parameterProjection.projectValues(values);
}

/** One drag frame's candidate values, materialized, and whether the frame accepts them. */
export type DraggedPointCandidate = {
  accepted: boolean;
  values: Float64Array;
  materialized: SketchCoreSolveResult;
  /** T13a2 (c3): phase A's curvature estimate, kept when the frame is accepted. */
  curvature?: SketchDragCurvature;
};

/** T13a2 (c3): a BFGS inverse Hessian over one drag problem's variables. */
export type SketchDragCurvature = { key: string; inverseHessian: Float64Array[] };

/** [TECH] G16⁗: a drag frame's candidate re-materialized and re-judged at `values`. */
export function reevaluateDraggedPointCandidate(
  session: SketchCompiledSolveSession,
  values: Float64Array,
): DraggedPointCandidate {
  const { materialized } = materializeDraggedPointCandidate(session, values);
  return {
    accepted: createDraggedPointAcceptance({
      session,
      values,
      materialized,
    }).accepted,
    values,
    materialized,
  };
}

/**
 * [TECH] G16‴/G16⁗: one drag frame toward `dragTarget`, a solve whose start
 * state is the last accepted frame (`session.values`): its blocked set is
 * decided there, with one re-solve (from the frame's end values) when a
 * blocked offset builds at the end. `interactive` is a session update's
 * frame (not a DOF probe): a preview frame (`null` tolerance) reuses the
 * curvature (T13a2 c3), a frame with a tolerance (the release, a single
 * solver call) runs the exact-reach step (d1) instead. The session is not
 * mutated.
 */
export function solveDraggedPointFrameWithRebuild(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
  interactive?: { targetTolerance: number | null };
}): DraggedPointCandidate | null {
  return finishSolve(solveDraggedPointFrameWithRebuildSteps(input));
}

export function* solveDraggedPointFrameWithRebuildSteps(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
  interactive?: { targetTolerance: number | null };
}): SolveSteps<DraggedPointCandidate | null> {
  const { session, component, dragTarget, interactive } = input;
  return yield* solveWithRebuildRetrySteps<DraggedPointCandidate | null>({
    program: session.program,
    startValues: session.values,
    solve: () =>
      solveDraggedPointFrame({
        session,
        component,
        dragTarget,
        exactReachTolerance: interactive?.targetTolerance ?? undefined,
        reuseCurvature: interactive?.targetTolerance === null,
        repeatsAcceptedFrame:
          interactive !== undefined &&
          session.lastPointDragTarget?.pointId === dragTarget.pointId &&
          session.lastPointDragTarget.position[0] === dragTarget.position[0] &&
          session.lastPointDragTarget.position[1] === dragTarget.position[1],
      }),
    retry: (from) =>
      solveDraggedPointFrame({
        session,
        component,
        dragTarget,
        startValues: from,
        exactReachTolerance: interactive?.targetTolerance ?? undefined,
      }),
    valuesOf: (candidate) => candidate?.values ?? null,
    reevaluate: (values) => reevaluateDraggedPointCandidate(session, values),
    isAccepted: (candidate) => candidate?.accepted === true,
  });
}

export function materializeDraggedPointCandidate(
  session: SketchCompiledSolveSession,
  values: Float64Array,
) {
  const state = evaluateLoss(values, session.program.system.scalarConstraints);
  const materialized = materializeSolveResult(session.program, values, {
    values: cloneValues(values),
    loss: state.loss,
    perConstraint: state.perConstraint,
  });
  // Interactive previews keep the prior accepted constrainedness; only final
  // public solves compute rank, never repeated drag candidate/acceptance checks.
  if (materialized.status.solveState === "solved")
    materialized.status.constraintState =
      session.lastAcceptedSnapshot.status.constraintState;
  return { state, materialized };
}

export function acceptDraggedPointCandidate(
  session: SketchCompiledSolveSession,
  values: Float64Array,
  materialized: SketchCoreSolveResult,
  curvature?: SketchDragCurvature,
): SketchDraggedPointSolveResult {
  session.values = heldDrivenValues(session.program, values);
  session.lastAcceptedSnapshot = materialized.solvedSnapshot;
  session.dragCurvature = curvature;
  session.lastPointDragTarget = undefined;
  return {
    kind: "solved",
    solvedSnapshot: materialized.solvedSnapshot,
    diagnostics: materialized.diagnostics,
  };
}
