import {
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
} from '@/domain/editor/sketch-session'
import { getPrimitiveRefKey } from '@/core/editor/schema'
import {
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
} from '@/domain/modeling/document-history'
import {
  hydrateFeatureEditSession as hydrateFeatureEditSessionFromEntry,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { FeatureId } from '@/contracts/shared/ids'
import type {
  EditorHistoryAvailability,
  EditorState,
} from './types'
import { hasPendingDocumentCursorRefresh } from './document-helpers'

export function getEditorHistoryAvailability(state: EditorState): EditorHistoryAvailability {
  if (state.kind === 'editingSketch') {
    if (state.pendingCommitRequestId !== null) {
      return { canUndo: false, canRedo: false }
    }

    return {
      canUndo: getPreviousSketchHistoryCursor(state.session) !== null,
      canRedo: getNextSketchHistoryCursor(state.session) !== null,
    }
  }

  if (
    state.kind !== 'idle'
  ) {
    return { canUndo: false, canRedo: false }
  }

  if (hasPendingDocumentCursorRefresh(state)) {
    return { canUndo: false, canRedo: false }
  }

  return {
    canUndo: state.snapshot ? getPreviousDocumentHistoryCursor(state.snapshot) !== null : false,
    canRedo: state.snapshot ? getNextDocumentHistoryCursor(state.snapshot) !== null : false,
  }
}

export function getEditorViewState(state: EditorState) {
  return {
    mode: state.mode,
    activeCommand: state.kind === 'idle' ? null : state.command,
    selection: state.selection,
    selectionCatalog: state.selectionCatalog,
    selectionFilter: state.selectionFilter,
    hoverTarget: state.hoverTarget,
    preview: state.preview,
    activeEditSession: state.kind === 'editingFeature' ? state.session : null,
    activeSketchPlaneEditSession: state.kind === 'editingSketchPlane' ? state.session : null,
    activeImportSession: state.kind === 'importing' ? state.session : null,
    activeReferencePickerFieldId:
      state.kind === 'editingFeature' || state.kind === 'editingSketchPlane' || state.kind === 'importing'
        ? state.activeReferencePickerFieldId
        : null,
    sketchSession: state.kind === 'editingSketch' ? state.session : null,
    activeSectionView: state.kind === 'inspectingSection' ? state.section : null,
    snapshot: state.snapshot,
    previewRenderables: state.previewRenderables,
    history: getEditorHistoryAvailability(state),
  }
}

export function hydrateFeatureSessionFromSnapshot(
  snapshot: WorkspaceSnapshot,
  featureId: FeatureId,
): FeatureEditSessionState | null {
  const feature = snapshot.document.features.find((entry) => entry.featureId === featureId)

  return feature ? hydrateFeatureEditSessionFromEntry(feature) : null
}

export const getEditorSelectionKey = getPrimitiveRefKey
