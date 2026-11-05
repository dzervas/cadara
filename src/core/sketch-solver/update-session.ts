import {
  acceptDraggedPointCandidate,
  solveDraggedPointFrameWithRebuildSteps,
} from "./drag-candidates";
import {
  deferredDragTargets,
  DRAG_MAX_SUBSTEPS,
  DRAG_SUBSTEP_LIMIT,
  dragContinuations,
  refusedDragGoals,
} from "./drag-continuations";
import { solveDragFrameGeneralWithRebuild } from "./drag-frame-stage";
import {
  findComponentForPoint,
  resolveDragTargetFrame,
} from "./drag-target-frame";
import {
  blockedDragResult,
  dragTargetDiagnosticTarget,
  dragTargetLabel,
  dragTargetMotion,
  exactZeroTangentFrame,
  interpolateDragTarget,
  validateDragTarget,
} from "./drag-target-motion";
import { classifySolvedConstrainedness } from "./materialize-result";
import {
  DRAG_PREVIEW_ITERATIONS,
  DRAG_PREVIEW_RAW_BLOCKS,
  DRAG_TARGET_WEIGHT,
} from "./solve-constants";
import { finishSolve } from "./solve-steps";
import type { SolveSteps } from "./solve-steps";
import type {
  SketchCoreSolveResult,
  SketchDraggedPointSolveResult,
  SketchDragPreviewSolveResult,
  SketchDragTarget,
} from "./solve-types";
import { makeDiagnostic } from "./solver-geometry";
import type { SketchCompiledSolveSession } from "./system-types";

/**
 * One drag update. `targetTolerance` is the exact-reach (T13a2 d1)
 * tolerance of a point drag. `null` marks an interactive preview frame: it
 * skips the exact-reach step. A frame with a tolerance (release or a single
 * solver call) runs that projection after the constrained frame.
 * Exception: a release that repeats a goal already refused from the same
 * accepted values returns that refusal, even when a preview computed it. A
 * refusal publishes nothing, so the committed state is still the last
 * accepted frame.
 */
export function updateCompiledSketchSolveSession(
  session: SketchCompiledSolveSession,
  dragTarget: SketchDragTarget,
  targetTolerance?: number,
): SketchDraggedPointSolveResult;

export function updateCompiledSketchSolveSession(
  session: SketchCompiledSolveSession,
  dragTarget: SketchDragTarget,
  targetTolerance: number | null,
): SketchDragPreviewSolveResult;

export function updateCompiledSketchSolveSession(
  session: SketchCompiledSolveSession,
  dragTarget: SketchDragTarget,
  targetTolerance: number | null = session.program.tolerances.coincidence,
): SketchDragPreviewSolveResult {
  // Reject invalid input before it can replace/coalesce a valid pending goal.
  if (session.disposed) {
    dragContinuations.delete(session);
    deferredDragTargets.delete(session);
    refusedDragGoals.delete(session);
    return finishSolve(
      updateCompiledSketchSolveSessionFrame(session, dragTarget, targetTolerance),
    );
  }
  const validationError = validateDragTarget(session, dragTarget);
  if (validationError) return validationError;
  let continuation = dragContinuations.get(session);
  if (targetTolerance !== null) {
    // A point goal is an absolute cursor, so the release target supersedes an
    // in-flight point goal: solve the release from the last accepted state
    // instead of draining the older goal first. Its already accepted substeps
    // stay applied. Translation goals are relative and still drain below.
    if (
      continuation?.target.kind === "sketchPoint" &&
      dragTarget.kind === "sketchPoint"
    ) {
      dragContinuations.delete(session);
      continuation = undefined;
    }
    // The release repeats a goal already refused (possibly by a preview) from
    // the current accepted state: return that verdict instead of solving it
    // again.
    const refused = refusedDragGoals.get(session);
    if (
      !continuation &&
      !deferredDragTargets.has(session) &&
      refused?.values === session.values &&
      refused.goal === JSON.stringify(dragTarget)
    ) {
      return refused.result;
    }
  }
  const coalesce = (
    older: SketchDragTarget | undefined,
    newer: SketchDragTarget,
  ): SketchDragTarget =>
    older?.kind === "sketchTranslate" && newer.kind === "sketchTranslate"
      ? {
          ...newer,
          delta: [older.delta[0] + newer.delta[0], older.delta[1] + newer.delta[1]],
        }
      : newer;
  if (continuation) {
    // Finish the in-flight goal against its original accepted-frame anchor
    // before coalescing newer goals. Translation inputs are RELATIVE, so none
    // of their withheld deltas may be dropped (including the release delta).
    continuation.deferred = coalesce(continuation.deferred, dragTarget);
  } else {
    dragTarget = coalesce(deferredDragTargets.get(session), dragTarget);
    deferredDragTargets.delete(session);
    const steps = updateCompiledSketchSolveSessionFrame(
      session,
      dragTarget,
      targetTolerance,
    );
    continuation = { target: dragTarget, steps, next: steps.next() };
  }
  let iterations = targetTolerance === null ? DRAG_PREVIEW_ITERATIONS : Infinity;
  let raw = targetTolerance === null ? DRAG_PREVIEW_RAW_BLOCKS : Infinity;
  while (!continuation.next.done) {
    const work = continuation.next.value;
    const available = work.kind === "iteration" ? iterations : raw;
    if (work.count > available) {
      dragContinuations.set(session, continuation);
      return {
        kind: "pending",
        solvedSnapshot: session.lastAcceptedSnapshot,
        diagnostics: session.lastAcceptedSnapshot.diagnostics,
      };
    }
    if (work.kind === "iteration") iterations -= work.count;
    else raw -= work.count;
    continuation.next = continuation.steps.next();
  }
  let result = continuation.next.value;
  dragContinuations.delete(session);
  // A refused goal accepted no substep, so `session.values` is still the
  // accepted state it was solved from.
  if (result.kind === "blocked") {
    refusedDragGoals.set(session, {
      goal: JSON.stringify(continuation.target),
      values: session.values,
      result,
    });
  } else {
    refusedDragGoals.delete(session);
  }
  if (continuation.deferred) {
    const deferred = continuation.deferred;
    const repeatsGoal = deferred.kind === "sketchTranslate"
      ? deferred.delta.every((coordinate) => coordinate === 0)
      : JSON.stringify(deferred) === JSON.stringify(continuation.target);
    if (targetTolerance === null && repeatsGoal) return result;
    if (targetTolerance !== null) {
      // Release flushes the preview first, then runs the actual release protocol
      // (including exact reach / zero-delta hard-row polishing) without caps.
      result = finishSolve(
        updateCompiledSketchSolveSessionFrame(
          session,
          continuation.deferred,
          targetTolerance,
        ),
      );
    } else {
      // Preserve the prototype's coalescing cadence: start the newer goal on the
      // next preview, not with a fresh per-phase budget in this call.
      deferredDragTargets.set(session, continuation.deferred);
      // The old goal's verdict does not decide the newer coalesced goal.
      return {
        kind: "pending",
        solvedSnapshot: session.lastAcceptedSnapshot,
        diagnostics: session.lastAcceptedSnapshot.diagnostics,
      };
    }
  }
  if (targetTolerance !== null && result.kind === "solved") {
    classifySolvedConstrainedness(session.program, session.values, {
      status: result.solvedSnapshot.status,
      solvedSnapshot: result.solvedSnapshot,
      diagnostics: result.diagnostics,
    });
  }
  return result;
}

export function* updateCompiledSketchSolveSessionFrame(
  session: SketchCompiledSolveSession,
  dragTarget: SketchDragTarget,
  targetTolerance: number | null,
): SolveSteps<SketchDraggedPointSolveResult> {
  if (session.disposed) {
    return {
      kind: "blocked",
      reason: "staleSession",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: [
        makeDiagnostic(
          "stale-interactive-solve-session",
          "error",
          `Interactive solve session ${session.sessionId} has been disposed.`,
          dragTargetDiagnosticTarget(dragTarget),
        ),
      ],
    };
  }

  // Validate the target references exist in the program.
  const validationError = validateDragTarget(session, dragTarget);
  if (validationError) return validationError;

  // Compute the substep distance from the motion metric of this target type.
  const motion = dragTargetMotion(session, dragTarget);
  if (!motion) {
    return {
      kind: "blocked",
      reason: "missingPoint",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: [
        makeDiagnostic(
          "drag-target-missing-point",
          "error",
          "Drag target references a missing solver element.",
          dragTargetDiagnosticTarget(dragTarget),
        ),
      ],
    };
  }

  const substeps = Math.max(
    1,
    Math.min(DRAG_MAX_SUBSTEPS, Math.ceil(motion.distance / DRAG_SUBSTEP_LIMIT)),
  );

  const projectedValues =
    session.program.system.parameterProjection.projectValues(session.values);

  let lastAccepted: SketchCoreSolveResult | null = null;

  for (let step = 1; step <= substeps; step += 1) {
    const fraction = step / substeps;
    const stepTarget = interpolateDragTarget(dragTarget, motion, fraction);

    if (stepTarget.kind === "sketchPoint") {
      // Point path: the minimum-motion frame solve with the exact-reach
      // step (T13a2 d1; whole-component translation is never shortcut).
      const component = findComponentForPoint(
        session.program,
        stepTarget.pointId,
      );
      const frame = yield* solveDraggedPointFrameWithRebuildSteps({
        session,
        component,
        dragTarget: stepTarget,
        interactive: { targetTolerance },
      });
      if (frame && frame.accepted) {
        acceptDraggedPointCandidate(
          session,
          frame.values,
          frame.materialized,
        );
        session.lastPointDragTarget = stepTarget;
        lastAccepted = frame.materialized;
        continue;
      }
      if (!lastAccepted) {
        return blockedDragResult(session, frame, dragTarget);
      }
      break;
    }

    // Generalized path for translate/radius/tangent targets.
    const resolved = resolveDragTargetFrame(
      session.program,
      stepTarget,
      projectedValues,
      DRAG_TARGET_WEIGHT,
    );
    if (!resolved) {
      if (!lastAccepted) {
        return blockedDragResult(session, null, dragTarget);
      }
      break;
    }

    const solvedFrame = yield* solveDragFrameGeneralWithRebuild({
      session,
      resolved,
      constraintLabel: dragTargetLabel(dragTarget),
    });
    const frame =
      stepTarget.kind === "sketchTangentVector" && stepTarget.exactZero
        ? exactZeroTangentFrame(session, resolved, solvedFrame)
        : solvedFrame;
    if (frame && frame.accepted) {
      acceptDraggedPointCandidate(
        session,
        frame.values,
        frame.materialized,
      );
      lastAccepted = frame.materialized;
      continue;
    }
    if (!lastAccepted) {
      return blockedDragResult(session, frame, dragTarget);
    }
    break;
  }

  return {
    kind: "solved",
    solvedSnapshot: session.lastAcceptedSnapshot,
    diagnostics:
      lastAccepted?.diagnostics ?? session.lastAcceptedSnapshot.diagnostics,
  };
}
