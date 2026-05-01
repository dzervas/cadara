import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import {
  getDocumentHistoryCursorBeforeTarget,
  type DocumentHistoryOrderEntry,
} from '@/domain/modeling/document-history'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import { isFeatureScopedModelingDiagnostic } from '@/contracts/modeling/diagnostics'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { DocumentId, RevisionId } from '@/contracts/shared/ids'
import { getDefaultSelectionFilterForMode } from '@/core/editor/schema'
import { emitEditSessionCursorRestore, emitFeatureHydration, emitSketchOpen } from './effect-emitters'
import {
  advanceCursorPhase,
  getCursorPhaseAction,
} from './cursor-lifecycle'
import { enterSketchEditing } from './state-creators'
import { isFeatureTool } from './utility-helpers'
import type {
  EditorEvent,
  EditorState,
  EditorTransitionResult,
  IdleEditorState,
  SelectionCommandEditorState,
  SnapshotLoadedPayload,
  EditSessionCursorContext,
} from './types'

export function updateStateDocument(state: EditorState, payload: SnapshotLoadedPayload): EditorState {
  const snapshot = applyRenderPreservationForFeatureDiagnostics(
    state.snapshot,
    payload.snapshot,
    payload.preserveRenderRecordsOnFeatureDiagnostics === true,
  )

  return {
    ...state,
    document: {
      documentId: payload.documentId,
      revisionId: payload.revisionId,
    },
    snapshot,
    selectionCatalog: payload.selectionCatalog,
    pendingSnapshotRequestId:
      state.pendingSnapshotRequestId === payload.requestId ? null : state.pendingSnapshotRequestId,
  }
}

function hasFeatureScopedError(snapshot: WorkspaceSnapshot) {
  return snapshot.document.diagnostics.some((diagnostic) =>
    diagnostic.severity === 'error' && isFeatureScopedModelingDiagnostic(diagnostic),
  )
}

export function applyRenderPreservationForFeatureDiagnostics(
  previousSnapshot: WorkspaceSnapshot | null,
  nextSnapshot: WorkspaceSnapshot,
  shouldPreserve: boolean,
): WorkspaceSnapshot {
  if (!shouldPreserve || !previousSnapshot || !hasFeatureScopedError(nextSnapshot)) {
    return nextSnapshot
  }

  const render = {
    ...nextSnapshot.document.render,
    records: previousSnapshot.document.render.records,
  }

  return {
    ...nextSnapshot,
    document: {
      ...nextSnapshot.document,
      render,
    },
  }
}

export function updateStateDocumentSnapshot(state: EditorState, snapshot: WorkspaceSnapshot): EditorState {
  return {
    ...state,
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    selectionCatalog: buildSelectionTargetCatalog(snapshot),
    pendingSnapshotRequestId: null,
  }
}

export function replaceStateDocumentSnapshot(state: EditorState, snapshot: WorkspaceSnapshot): IdleEditorState {
  return {
    kind: 'idle',
    mode: 'part',
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    previewRenderables: null,
    selection: [],
    hoverTarget: null,
    selectionFilter: getDefaultSelectionFilterForMode('part'),
    selectionCatalog: buildSelectionTargetCatalog(snapshot),
    preview: null,
    nextCommandSequence: state.nextCommandSequence,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: null,
    pendingHistoryCursorRequestId: null,
    editSessionCursorContext: null,
  }
}

export function continueAfterSnapshotRefresh(updatedState: EditorState): EditorTransitionResult {
  const cursorContext = updatedState.editSessionCursorContext

  if (!cursorContext) {
    return {
      state: updatedState,
      effects: [],
    }
  }

  // `getCursorPhaseAction` reports the follow-up step after the current phase
  // completes, so this is intentionally read before advancing the phase.
  const nextPhaseAction = getCursorPhaseAction(cursorContext)
  const nextCursorContext = advanceCursorPhase(cursorContext, 'snapshotRefreshed')
  const nextState: EditorState = {
    ...updatedState,
    editSessionCursorContext: nextCursorContext,
  }

  if (
    nextPhaseAction
    && (nextPhaseAction === 'openSession' || nextPhaseAction === 'hydrateFeature')
    && nextCursorContext
    && updatedState.kind === 'selectionCommand'
  ) {
    const activeState: SelectionCommandEditorState = {
      ...updatedState,
      editSessionCursorContext: nextCursorContext,
    }

    if (nextPhaseAction === 'openSession' && cursorContext.target.kind === 'sketch' && activeState.command.toolId === 'sketch') {
      const target = { kind: 'sketch', sketchId: cursorContext.target.sketchId } as const
      const session = activeState.snapshot
        ? openSketchSessionFromSelection([target], activeState.snapshot)
        : null

      return session
        ? enterSketchEditing(activeState, session)
        : emitSketchOpen(
            {
              ...activeState,
              selection: [target],
              hoverTarget: null,
            },
            [target],
          )
    }

    if (nextPhaseAction === 'hydrateFeature' && cursorContext.target.kind === 'feature' && isFeatureTool(activeState.command.toolId)) {
      return emitFeatureHydration(
        {
          ...activeState,
          selection: [{ kind: 'feature', featureId: cursorContext.target.featureId }],
          hoverTarget: null,
        },
        cursorContext.target.featureId,
      )
    }
  }

  if (nextPhaseAction === 'restore') {
    return emitEditSessionCursorRestore(nextState)
  }

  return {
    state: nextState,
    effects: [],
  }
}

export function hasPendingDocumentCursorRefresh(state: EditorState) {
  return state.pendingHistoryCursorRequestId !== null || state.pendingSnapshotRequestId !== null
}

export function isRefreshableDocumentCursorConflict(event: Extract<EditorEvent, { type: 'effect.documentCursorMoved' }>) {
  return event.actualRevisionId !== undefined
    || event.diagnostics.some((diagnostic) =>
      diagnostic.code === 'repository-head-conflict' || diagnostic.detail?.kind === 'revisionConflict',
    )
}

export function eventMatchesDocument(
  state: EditorState,
  documentId: DocumentId,
  revisionId: RevisionId | null,
) {
  if (state.document.documentId !== null && state.document.documentId !== documentId) {
    return false
  }

  if (revisionId !== null && state.document.revisionId !== null && state.document.revisionId !== revisionId) {
    return false
  }

  return true
}

export function eventMatchesOptionalDocument(
  state: EditorState,
  documentId: DocumentId | null,
  revisionId: RevisionId | null,
) {
  if (documentId === null) {
    return true
  }

  return eventMatchesDocument(state, documentId, revisionId)
}

export function createEditSessionCursorContext(
  snapshot: WorkspaceSnapshot | null,
  target: DocumentHistoryOrderEntry,
): EditSessionCursorContext | null {
  if (!snapshot) {
    return null
  }

  const rollbackCursor = getDocumentHistoryCursorBeforeTarget(
    snapshot.presentation.documentHistory,
    target,
  )

  if (!rollbackCursor) {
    return null
  }

  return {
    target,
    rollbackCursor,
    restoreCursor: structuredClone(snapshot.document.cursor),
    phase: 'rollingBack',
  }
}

export function canReopenSketchDirectlyFromCurrentCursor(
  snapshot: WorkspaceSnapshot | null,
  target: Extract<import('@/core/editor/schema').PrimitiveRef, { kind: 'sketch' }>,
) {
  return snapshot?.document.cursor.kind === 'sketch'
    && snapshot.document.cursor.sketchId === target.sketchId
}
