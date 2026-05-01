import {
  getDefaultSelectionFilterForMode,
} from '@/core/editor/schema'
import {
  getFeaturePrimarySelectionTarget,
} from '@/domain/editor/feature-editing'
import {
  getSketchSessionPreviewLabel,
  updateSketchReferenceProjection,
} from '@/domain/editor/sketch-session'
import {
  applySketchSpecialModeEffectResult,
  getSketchSpecialModeSelectionFilter,
} from '@/core/sketch-special-modes/presentation'
import { isFeatureScopedModelingDiagnostic } from '@/contracts/modeling/diagnostics'
import type { SketchId } from '@/contracts/shared/ids'
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
  SketchEditorState,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import { advanceCursorPhase } from './cursor-lifecycle'
import {
  continueAfterSnapshotRefresh,
  eventMatchesDocument,
  eventMatchesOptionalDocument,
  isRefreshableDocumentCursorConflict,
  updateStateDocument,
  updateStateDocumentSnapshot,
} from './document-helpers'
import {
  createPreviewFailedDiagnostics,
  getDurableDiagnosticTarget,
} from './error-mapping'
import {
  emitFeaturePreview,
  emitSketchReferenceProjection,
  emitSnapshotFetch,
} from './effect-emitters'
import {
  createFeatureEditingState,
  enterSketchEditing,
  toIdleState,
  withPreview,
} from './state-creators'
import { isFeatureTool } from './utility-helpers'

export function handleEffectDocumentCursorMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.documentCursorMoved' }>,
): EditorTransitionResult {
  if (
    state.pendingHistoryCursorRequestId !== event.requestId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  if (!event.accepted) {
    const message =
      event.diagnostics[0]?.message ??
      `Document history cursor move rejected due to revision conflict (${event.actualRevisionId ?? 'unknown'}).`
    const nextState = withPreview(
      {
        ...state,
        pendingHistoryCursorRequestId: null,
      },
      {
        kind: 'selection',
        label: message,
        target: state.selection[0] ?? null,
      },
    )

    return isRefreshableDocumentCursorConflict(event)
      ? emitSnapshotFetch(nextState, null)
      : { state: nextState, effects: [] }
  }

  const nextState = {
    ...state,
    document: {
      ...state.document,
      revisionId: event.revisionId,
    },
    pendingHistoryCursorRequestId: null,
    preview: null,
  } satisfies EditorState

  if (!event.snapshot) {
    return emitSnapshotFetch(nextState, null)
  }

  return continueAfterSnapshotRefresh(updateStateDocumentSnapshot(nextState, event.snapshot))
}

export function handleEffectDocumentCursorMoveFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.documentCursorMoveFailed' }>,
): EditorTransitionResult {
  if (
    state.pendingHistoryCursorRequestId !== event.requestId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: withPreview(
      {
        ...state,
        pendingHistoryCursorRequestId: null,
      },
      {
        kind: 'selection',
        label: event.message,
        target: state.selection[0] ?? null,
      },
    ),
    effects: [],
  }
}

export function handleEffectSnapshotLoaded(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.snapshotLoaded' }>,
): EditorTransitionResult {
  if (state.pendingSnapshotRequestId !== event.payload.requestId) {
    return { state, effects: [] }
  }

  return continueAfterSnapshotRefresh(updateStateDocument(state, event.payload))
}

export function handleEffectSnapshotFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.snapshotFailed' }>,
): EditorTransitionResult {
  if (
    state.pendingSnapshotRequestId !== event.requestId ||
    !eventMatchesOptionalDocument(state, event.documentId, event.revisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: withPreview(
      {
        ...state,
        pendingSnapshotRequestId: null,
      },
      {
        kind: 'selection',
        label: event.error,
        target: state.selection[0] ?? null,
      },
    ),
    effects: [],
  }
}

export function handleEffectSketchSessionOpened(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchSessionOpened' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'selectionCommand' ||
    state.command.toolId !== 'sketch' ||
    state.pendingRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    !eventMatchesDocument(state, event.documentId, event.revisionId)
  ) {
    return { state, effects: [] }
  }

  return enterSketchEditing(state, event.session)
}

export function handleEffectSketchSessionOpenFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchSessionOpenFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'selectionCommand' ||
    state.command.toolId !== 'sketch' ||
    state.pendingRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    !eventMatchesDocument(state, event.documentId, event.revisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: withPreview(
      {
        ...state,
        pendingRequestId: null,
        command: {
          ...state.command,
          phase: 'armed',
        },
      },
      {
        kind: 'selection',
        label: event.message,
        target: state.selection[0] ?? null,
      },
    ),
    effects: [],
  }
}

export function handleEffectFeatureSessionHydrated(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.featureSessionHydrated' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'selectionCommand' ||
    !isFeatureTool(state.command.toolId) ||
    state.pendingRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    !eventMatchesDocument(state, event.documentId, event.revisionId)
  ) {
    return { state, effects: [] }
  }

  return emitFeaturePreview(
    createFeatureEditingState(
      {
        ...state,
        pendingRequestId: null,
      },
      state.command,
      event.session,
    ),
  )
}

export function handleEffectFeatureSessionHydrationFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.featureSessionHydrationFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'selectionCommand' ||
    !isFeatureTool(state.command.toolId) ||
    state.pendingRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    !eventMatchesDocument(state, event.documentId, event.revisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: withPreview(
      {
        ...state,
        pendingRequestId: null,
      },
      {
        kind: 'selection',
        label: event.message,
        target: state.selection[0] ?? null,
      },
    ),
    effects: [],
  }
}

export function handleEffectFeaturePreviewCompleted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.featurePreviewCompleted' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingFeature' ||
    state.pendingPreviewRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    state.document.revisionId !== event.baseRevisionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      pendingPreviewRequestId: null,
      previewRenderables: event.stale ? null : event.renderables,
      command: {
        ...state.command,
        phase: 'editing',
      },
      session: {
        ...state.session,
        status: event.stale ? 'idle' : 'previewReady',
        diagnostics: event.diagnostics,
        lastPreviewRevisionId: event.revisionId,
      },
    },
    effects: [],
  }
}

export function handleEffectFeaturePreviewFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.featurePreviewFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingFeature' ||
    state.pendingPreviewRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    state.document.revisionId !== event.baseRevisionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      pendingPreviewRequestId: null,
      previewRenderables: null,
      command: {
        ...state.command,
        phase: 'editing',
      },
      session: {
        ...state.session,
        status: 'idle',
        diagnostics: createPreviewFailedDiagnostics(
          event.message,
          getFeaturePrimarySelectionTarget(state.session),
        ),
      },
    },
    effects: [],
  }
}

export function handleEffectFeatureCommitted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.featureCommitted' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingFeature' ||
    state.pendingCommitRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    state.document.revisionId !== event.baseRevisionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  if (!event.accepted) {
    return {
      state: {
        ...state,
        pendingCommitRequestId: null,
        previewRenderables: null,
        command: {
          ...state.command,
          phase: 'editing',
        },
        session: {
          ...state.session,
          status: 'idle',
          diagnostics: event.diagnostics,
          lastPreviewRevisionId: event.actualRevisionId ?? state.session.lastPreviewRevisionId,
        },
      },
      effects: [],
    }
  }

  {
    const idleState = toIdleState(
      {
        ...state,
        document: {
          ...state.document,
          revisionId: event.revisionId,
        },
      },
      'part',
    )

    if (state.editSessionCursorContext?.phase === 'active') {
      return emitSnapshotFetch(
        {
          ...idleState,
          editSessionCursorContext: advanceCursorPhase(state.editSessionCursorContext, 'commitCompleted'),
        },
        state.command.commandSessionId,
        {
          preserveRenderRecordsOnFeatureDiagnostics: event.diagnostics.some((diagnostic) =>
            diagnostic.severity === 'error' && isFeatureScopedModelingDiagnostic(diagnostic),
          ),
        },
      )
    }

    const refresh = emitSnapshotFetch(
      withPreview(
        idleState,
        {
          kind: 'selection',
          label: `Committed feature ${event.featureId}`,
          target: { kind: 'feature', featureId: event.featureId },
        },
      ),
      state.command.commandSessionId,
      {
        preserveRenderRecordsOnFeatureDiagnostics: event.diagnostics.some((diagnostic) =>
          diagnostic.severity === 'error' && isFeatureScopedModelingDiagnostic(diagnostic),
        ),
      },
    )

    return {
      state: refresh.state,
      effects: refresh.effects,
    }
  }
}

export function handleEffectFeatureCommitFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.featureCommitFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingFeature' ||
    state.pendingCommitRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    state.document.revisionId !== event.baseRevisionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      pendingCommitRequestId: null,
      previewRenderables: null,
      command: {
        ...state.command,
        phase: 'editing',
      },
        session: {
          ...state.session,
          status: 'idle',
          diagnostics: [
            {
              code: 'feature-commit-failed',
              severity: 'error',
              message: event.message,
              target: getDurableDiagnosticTarget(getFeaturePrimarySelectionTarget(state.session)),
              detail: null,
            },
          ],
      },
    },
    effects: [],
  }
}

export function handleEffectSketchCommitted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchCommitted' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch' ||
    state.pendingCommitRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    state.document.revisionId !== event.baseRevisionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  if (!event.accepted) {
    const message =
      event.diagnostics[0]?.message ??
      `Sketch commit rejected due to revision conflict (${event.actualRevisionId ?? 'unknown'}).`
    const nextState: SketchEditorState = {
      ...state,
      document: event.actualRevisionId
        ? {
            ...state.document,
            revisionId: event.actualRevisionId,
          }
        : state.document,
      pendingCommitRequestId: null,
      command: {
        ...state.command,
        phase: 'editing',
      },
      preview: {
        kind: 'sketch',
        label: message,
        target: state.session.planeTarget,
      },
      session: {
        ...state.session,
        validationMessage: message,
      },
    }

    return event.actualRevisionId
      ? emitSnapshotFetch(nextState, state.command.commandSessionId)
      : { state: nextState, effects: [] }
  }

  {
    const idleState = toIdleState(
      {
        ...state,
        document: {
          ...state.document,
          revisionId: event.revisionId,
        },
      },
      'part',
    )

    if (state.editSessionCursorContext?.phase === 'active') {
      return emitSnapshotFetch(
        {
          ...idleState,
          editSessionCursorContext: advanceCursorPhase(state.editSessionCursorContext, 'commitCompleted'),
        },
        state.command.commandSessionId,
      )
    }

    const refresh = emitSnapshotFetch(idleState, state.command.commandSessionId)

    return {
      state: refresh.state,
      effects: refresh.effects,
    }
  }
}

export function handleEffectSketchCommitFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchCommitFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch' ||
    state.pendingCommitRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    state.document.revisionId !== event.baseRevisionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      pendingCommitRequestId: null,
      command: {
        ...state.command,
        phase: 'editing',
      },
      preview: {
        kind: 'sketch',
        label: event.message,
        target: state.session.planeTarget,
      },
      session: {
        ...state.session,
        validationMessage: event.message,
      },
    },
    effects: [],
  }
}

export function handleEffectSketchReferencesProjected(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchReferencesProjected' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch' ||
    state.pendingProjectionRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  const session = updateSketchReferenceProjection(
    state.session,
    event.projectedReferences,
    event.diagnostics,
  )

  return {
    state: {
      ...state,
      pendingProjectionRequestId: null,
      session,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  }
}

export function handleEffectSketchReferenceProjectionFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchReferenceProjectionFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch' ||
    state.pendingProjectionRequestId !== event.requestId ||
    state.command.commandSessionId !== event.commandSessionId ||
    !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      pendingProjectionRequestId: null,
      preview: {
        kind: 'sketch',
        label: event.message,
        target: state.session.planeTarget,
      },
      session: {
        ...state.session,
        validationMessage: event.message,
      },
    },
    effects: [],
  }
}

export function handleEffectSketchReferenceImageImportCompleted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchReferenceImageImportCompleted' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch'
    || state.pendingImportRequestId !== event.requestId
    || state.command.commandSessionId !== event.commandSessionId
    || !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  if (event.status === 'cancelled' || !event.snapshot || !event.selectionCatalog || !event.session) {
    return {
      state: {
        ...state,
        pendingImportRequestId: null,
        command: {
          ...state.command,
          phase: 'editing',
        },
        preview: {
          kind: 'sketch',
          label: getSketchSessionPreviewLabel(state.session),
          target: state.session.planeTarget,
        },
      },
      effects: [],
    }
  }

  return emitSketchReferenceProjection(
    {
      ...state,
      document: {
        documentId: event.snapshot.documentId,
        revisionId: event.revisionId,
      },
      snapshot: event.snapshot,
      selectionCatalog: event.selectionCatalog,
      selection: [{ kind: 'sketch', sketchId: event.session.sketchId ?? ('sketch_draft' as SketchId) }],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      previewRenderables: null,
      command: {
        ...state.command,
        phase: 'editing',
      },
      session: event.session,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    },
    event.session,
  )
}

export function handleEffectSketchReferenceImageImportFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchReferenceImageImportFailed' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch'
    || state.pendingImportRequestId !== event.requestId
    || state.command.commandSessionId !== event.commandSessionId
    || !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      pendingImportRequestId: null,
      command: {
        ...state.command,
        phase: 'editing',
      },
      preview: {
        kind: 'sketch',
        label: event.message,
        target: state.session.planeTarget,
      },
      session: {
        ...state.session,
        validationMessage: event.message,
      },
    },
    effects: [],
  }
}

export function handleEffectSketchSpecialModeEffectCompleted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchSpecialModeEffectCompleted' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch'
    || state.command.commandSessionId !== event.commandSessionId
    || !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
    || state.session.activeSpecialMode?.pendingEffect?.requestId !== event.requestId
  ) {
    return { state, effects: [] }
  }

  const session = applySketchSpecialModeEffectResult({
    session: state.session,
    requestId: event.requestId,
    effectId: event.effectId,
    payload: event.payload,
    registry: dependencies.sketchSpecialModes,
  })

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: 'editing',
      },
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  }
}

export function handleEffectSketchSpecialModeEffectFailed(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'effect.sketchSpecialModeEffectFailed' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch'
    || state.command.commandSessionId !== event.commandSessionId
    || !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
    || state.session.activeSpecialMode?.pendingEffect?.requestId !== event.requestId
  ) {
    return { state, effects: [] }
  }

  const session = {
    ...state.session,
    validationMessage: event.message,
    activeSpecialMode: state.session.activeSpecialMode
      ? {
          ...state.session.activeSpecialMode,
          pendingEffect: null,
        }
      : null,
  }

  return {
    state: {
      ...state,
      session,
      selectionFilter:
        getSketchSpecialModeSelectionFilter(session, dependencies.sketchSpecialModes)
        ?? getDefaultSelectionFilterForMode('sketch'),
      command: {
        ...state.command,
        phase: 'editing',
      },
      preview: {
        kind: 'sketch',
        label: event.message,
        target: state.session.planeTarget,
      },
    },
    effects: [],
  }
}
