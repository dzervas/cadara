import type { EditSessionCursorContext } from './types'

export type CursorLifecycleTrigger =
  | 'snapshotRefreshed'
  | 'sessionOpened'
  | 'commitCompleted'
  | 'restoreStarted'

export type CursorPhaseAction =
  | 'openSketchSession'
  | 'hydrateFeature'
  | 'openSketchPlaneEdit'
  | 'restore'
  | 'complete'
  | null

/**
 * Returns the follow-up action to run after the current phase completes.
 * For example, `rollingBack` maps to the next open/hydrate step that should run
 * once the rollback refresh finishes.
 */

export function advanceCursorPhase(
  context: EditSessionCursorContext,
  trigger: CursorLifecycleTrigger,
): EditSessionCursorContext | null {
  switch (trigger) {
    case 'snapshotRefreshed':
      if (context.phase === 'rollingBack') {
        return {
          ...context,
          phase: 'opening',
        }
      }

      if (context.phase === 'restoring') {
        return null
      }

      return context
    case 'sessionOpened':
      return context.phase === 'opening'
        ? {
          ...context,
          phase: 'active',
        }
        : context
    case 'commitCompleted':
      return context.phase === 'active'
        ? {
          ...context,
          phase: 'restorePending',
        }
        : context
    case 'restoreStarted':
      return context.phase === 'restorePending'
        ? {
          ...context,
          phase: 'restoring',
        }
        : context
  }
}

export function getCursorPhaseAction(
  context: EditSessionCursorContext,
): CursorPhaseAction {
  switch (context.phase) {
    case 'rollingBack':
      if (context.sessionKind === 'sketchAuthoring') {
        return 'openSketchSession'
      }

      if (context.sessionKind === 'sketchPlaneEdit') {
        return 'openSketchPlaneEdit'
      }

      return 'hydrateFeature'
    case 'restorePending':
      return 'restore'
    case 'restoring':
      return 'complete'
    case 'opening':
    case 'active':
      return null
  }
}
