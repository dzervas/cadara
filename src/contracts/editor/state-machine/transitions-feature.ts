import {
  getFeatureEditorFormField,
  patchFeatureEditSession,
  getSelectionFilterForFeatureType,
} from '@/domain/editor/feature-editing'
import {
  getDefaultSelectionFilterForMode,
} from '@/domain/editor/schema'
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import {
  createFeatureSelectionPreview,
  createImportSelectionPreview,
  createSelectionPreview,
  emitFeaturePreview,
  getImportSessionFormField,
} from './helpers'

export function handleFormFeaturePatched(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'form.featurePatched' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingFeature') {
    return { state, effects: [] }
  }

  const nextSession = {
    ...patchFeatureEditSession(state.session, event.patch),
    status: 'idle' as const,
  }

  return emitFeaturePreview({
    ...state,
    session: nextSession,
    pendingPreviewRequestId: null,
    preview: createFeatureSelectionPreview(nextSession),
  })
}

export function handleFormReferencePickerActivated(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'form.referencePickerActivated' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingFeature' && state.kind !== 'importing') {
    return { state, effects: [] }
  }

  const field = state.kind === 'editingFeature'
    ? getFeatureEditorFormField(state.session, event.fieldId)
    : getImportSessionFormField(state.session, event.fieldId)

  if (field?.kind !== 'referencePicker' && field?.kind !== 'referenceCollection') {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      activeReferencePickerFieldId: field.id,
      selection: [],
      hoverTarget: null,
      selectionFilter: field.picker.selectionFilter,
      preview: createSelectionPreview({ ...state, selection: [] }, field.picker.selectionFilter),
      command: {
        ...state.command,
        phase: 'collecting',
      },
    },
    effects: [],
  }
}

export function handleFormReferencePickerCancelled(
  state: EditorState,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    (state.kind !== 'editingFeature' && state.kind !== 'importing')
    || !state.activeReferencePickerFieldId
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      activeReferencePickerFieldId: null,
      selection: [],
      hoverTarget: null,
      selectionFilter:
        state.kind === 'editingFeature'
          ? getSelectionFilterForFeatureType(state.session.featureType)
          : getDefaultSelectionFilterForMode('part'),
      preview:
        state.kind === 'editingFeature'
          ? createFeatureSelectionPreview(state.session)
          : createImportSelectionPreview(state.session, dependencies),
      command: {
        ...state.command,
        phase: 'editing',
      },
    },
    effects: [],
  }
}
