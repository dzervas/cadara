import type {
  EditorState,
  EditorTransitionResult,
  ImportEditorState,
  ImportEvent,
  ImportWorkflowEvent,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import { toIdleState } from './state-creators'
import {
  handleImportFileSelected,
  handleImportProviderSelected,
  handleImportSelectionPatched,
  handleImportCommitRequested,
  handleImportCancelled,
  handleImportCommitted,
  handleImportFailed,
} from './transitions-import'
import {
  handleFormReferencePickerActivated,
  handleFormReferencePickerCancelled,
} from './transitions-feature'

export function startImportWorkflow(
  state: EditorState,
  event: Extract<ImportEvent, { type: 'import.fileSelected' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  return handleImportFileSelected(state, event, dependencies)
}

export function reduceImportWorkflow(
  state: ImportEditorState,
  event: ImportWorkflowEvent,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  switch (event.type) {
    case 'command.cancelled':
      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] }
      }

      return {
        state: toIdleState(state, state.mode),
        effects: [],
      }
    case 'form.referencePickerActivated':
      return handleFormReferencePickerActivated(state, event)
    case 'form.referencePickerCancelled':
      return handleFormReferencePickerCancelled(state, dependencies)
    case 'import.providerSelected':
      return handleImportProviderSelected(state)
    case 'import.selectionPatched':
      return handleImportSelectionPatched(state, event, dependencies)
    case 'import.commitRequested':
      return handleImportCommitRequested(state)
    case 'import.cancelled':
      return handleImportCancelled(state)
    case 'import.committed':
      return handleImportCommitted(state)
    case 'import.failed':
      return handleImportFailed(state, event, dependencies)
  }

  return { state, effects: [] }
}
