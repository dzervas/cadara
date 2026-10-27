import type { SolveSteps, SolveWork } from "./solve-steps";
import type {
  SketchDraggedPointSolveResult,
  SketchDragTarget,
} from "./solve-types";
import type { SketchCompiledSolveSession } from "./system-types";

// A suspended stack is the typed continuation: it owns the unaccepted iterate,
// Hessian, recentlyReset, iteration stop, anchor, goal, frozen stage and rebuild
// context. Nothing from that stack is published until the normal judge accepts.
export type DragContinuation = {
  target: SketchDragTarget;
  steps: SolveSteps<SketchDraggedPointSolveResult>;
  next: IteratorResult<SolveWork, SketchDraggedPointSolveResult>;
  deferred?: SketchDragTarget;
};

export const dragContinuations = new WeakMap<
  SketchCompiledSolveSession,
  DragContinuation
>();

export const deferredDragTargets = new WeakMap<
  SketchCompiledSolveSession,
  SketchDragTarget
>();

export const DRAG_MAX_SUBSTEPS = 8;

export const DRAG_SUBSTEP_LIMIT = 4;
