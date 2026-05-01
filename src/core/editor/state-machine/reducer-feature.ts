import type {
  EditorTransitionResult,
  FeatureEditorState,
  FeatureEvent,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import {
  emitEditSessionCursorRestore,
  emitFeatureCommit,
} from './effect-emitters'
import { toIdleState } from './state-creators'
import {
  handleFormFeaturePatched,
  handleFormReferencePickerActivated,
  handleFormReferencePickerCancelled,
} from './transitions-feature'

export function reduceFeatureWorkflow(
  state: FeatureEditorState,
  event: FeatureEvent,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  switch (event.type) {
    case 'command.cancelled':
      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] }
      }

      if (state.editSessionCursorContext?.phase === 'active') {
        return emitEditSessionCursorRestore(toIdleState(state, state.mode))
      }

      return {
        state: toIdleState(state, state.mode),
        effects: [],
      }
    case 'command.commitRequested':
      return state.command.commandSessionId === event.commandSessionId
        ? emitFeatureCommit(state)
        : { state, effects: [] }
    case 'form.featurePatched':
      return handleFormFeaturePatched(state, event)
    case 'form.referencePickerActivated':
      return handleFormReferencePickerActivated(state, event)
    case 'form.referencePickerCancelled':
      return handleFormReferencePickerCancelled(state, dependencies)
  }

  return { state, effects: [] }
}
