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

/**
 * The last goal a drag update refused, with the accepted `session.values`
 * object it was solved from. A refused goal leaves `session.values`
 * untouched, so while that object is still current the same goal would be
 * refused again from the same accepted state.
 */
export type RefusedDragGoal = {
  goal: string;
  values: Float64Array;
  result: SketchDraggedPointSolveResult;
};

export const refusedDragGoals = new WeakMap<
  SketchCompiledSolveSession,
  RefusedDragGoal
>();

export const DRAG_MAX_SUBSTEPS = 8;

export const DRAG_SUBSTEP_LIMIT = 4;
