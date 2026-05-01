import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import {
  createImportSelectionPreview,
} from './selection-helpers'
import {
  createImportingState,
  toIdleState,
} from './state-creators'

export function handleImportFileSelected(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'import.fileSelected' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  return {
    state: createImportingState(state, event.session, dependencies),
    effects: [],
  }
}

export function handleImportProviderSelected(
  state: EditorState,
): EditorTransitionResult {
  return { state, effects: [] }
}

export function handleImportSelectionPatched(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'import.selectionPatched' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'importing') {
    return { state, effects: [] }
  }

  const provider = dependencies.importProviders.getById(state.session.providerId)
  if (!provider) {
    return { state, effects: [] }
  }

  const nextSelections = provider.applySelectionPatch(
    state.session.review,
    state.session.selections,
    event.patch,
  )
  const nextSession = {
    ...state.session,
    selections: nextSelections,
    formSchema: provider.getReviewFormSchema(state.session.review, nextSelections),
  }

  return {
    state: {
      ...state,
      session: nextSession,
      preview: createImportSelectionPreview(nextSession, dependencies, 'Selected'),
      command: {
        ...state.command,
        phase: 'collecting',
      },
    },
    effects: [],
  }
}

export function handleImportCommitRequested(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== 'importing') {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
    },
    effects: [],
  }
}

export function handleImportCancelled(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== 'importing') {
    return { state, effects: [] }
  }

  return {
    state: toIdleState(state, 'part'),
    effects: [],
  }
}

export function handleImportCommitted(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== 'importing') {
    return { state, effects: [] }
  }

  return {
    state: toIdleState(state, 'part'),
    effects: [],
  }
}

export function handleImportFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'import.failed' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'importing') {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      session: {
        ...state.session,
        diagnostics: event.diagnostics,
      },
      command: {
        ...state.command,
        phase: 'editing',
      },
      preview: createImportSelectionPreview(state.session, dependencies, 'Import failed'),
    },
    effects: [],
  }
}
