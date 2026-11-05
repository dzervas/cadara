import { dragContinuations } from "./drag-continuations";
import { DRAG_PREVIEW_ITERATIONS } from "./solve-constants";
import type { SolveSteps } from "./solve-steps";
import type {
  SketchDraggedPointSolveResult,
  SketchDragTarget,
} from "./solve-types";
import type { SketchCompiledSolveSession } from "./system-types";
import { updateCompiledSketchSolveSessionFrame } from "./update-session";

/**
 * Exercise the suspension seam without depending on an optimizer's speed.
 * An explicit goal resumes its real frame. Without one, a held neutral frame
 * completes first and the editor's newer cursor remains deferred normally.
 */
export function suspendDragContinuation(
  session: SketchCompiledSolveSession,
  goal?: SketchDragTarget,
  pendingPreviews = 1,
) {
  const target: SketchDragTarget = goal ?? {
    kind: "sketchTranslate",
    pointIds: session.lastAcceptedSnapshot.solvedPoints.map(
      (point) => point.pointId,
    ),
    delta: [0, 0],
  };
  function* suspended(): SolveSteps<SketchDraggedPointSolveResult> {
    for (let preview = 0; preview <= pendingPreviews; preview += 1)
      yield { kind: "iteration", count: DRAG_PREVIEW_ITERATIONS };
    if (goal)
      return yield* updateCompiledSketchSolveSessionFrame(session, goal, null);
    return {
      kind: "solved",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: session.lastAcceptedSnapshot.diagnostics,
    };
  }
  const steps = suspended();
  dragContinuations.set(session, { target, steps, next: steps.next() });
}
