import { canUndoSketchDraftPoint } from "@/domain/editor/sketch-session";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import {
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
} from "@/core/modeling/document-history";
import {
  hydrateFeatureEditSession as hydrateFeatureEditSessionFromEntry,
  type FeatureEditSessionState,
} from "@/core/editor/feature-editing";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { FeatureId } from "@/contracts/shared/ids";
import type { EditorHistoryAvailability, EditorState } from "./types";
import { hasPendingDocumentCursorRefresh } from "./document-helpers";

export function getEditorHistoryAvailability(
  state: EditorState,
): EditorHistoryAvailability {
  if (state.kind === "editingSketch") {
    if (state.pendingCommitRequestId !== null) {
      return { canUndo: false, canRedo: false };
    }

    const availability = state.session.actionAvailability ?? {
      canUndo: false,
      canRedo: false,
    };
    return {
      ...availability,
      canUndo: canUndoSketchDraftPoint(state.session) || availability.canUndo,
    };
  }

  if (state.kind !== "idle") {
    return { canUndo: false, canRedo: false };
  }

  if (hasPendingDocumentCursorRefresh(state)) {
    return { canUndo: false, canRedo: false };
  }

  return {
    canUndo: state.snapshot
      ? getPreviousDocumentHistoryCursor(state.snapshot) !== null
      : false,
    canRedo: state.snapshot
      ? getNextDocumentHistoryCursor(state.snapshot) !== null
      : false,
  };
}

/**
 * T17-20 (T17k2; T17b0 P-8 S1): the notice for a sketch being edited that
 * another session deleted (the shared sketch is gone from the document).
 * Its history can't be applied (issue 09) and re-creating it is not a
 * feature, so Finish is refused and the author can only discard and leave.
 * Null when the edited sketch was never published or still exists.
 */
export function getPeerDeletedSketchNotice(state: EditorState): string | null {
  if (
    state.kind !== "editingSketch" ||
    state.session.sketchId === null ||
    !state.snapshot ||
    state.snapshot.document.sketches.some(
      (sketch) => sketch.sketchId === state.session.sketchId,
    )
  )
    return null;
  return `‘${state.session.sketchLabel}’ was deleted by another session; your changes can't be published.`;
}

export function getEditorViewState(state: EditorState) {
  return {
    mode: state.mode,
    activeCommand: state.kind === "idle" ? null : state.command,
    selection: state.selection,
    selectionCatalog: state.selectionCatalog,
    selectionFilter: state.selectionFilter,
    hoverTarget: state.hoverTarget,
    preview: state.preview,
    activeEditSession: state.kind === "editingFeature" ? state.session : null,
    activeSketchPlaneEditSession:
      state.kind === "editingSketchPlane" ? state.session : null,
    activeImportSession: state.kind === "importing" ? state.session : null,
    activeReferencePickerFieldId:
      state.kind === "editingFeature" ||
      state.kind === "editingSketchPlane" ||
      state.kind === "importing"
        ? state.activeReferencePickerFieldId
        : null,
    sketchSession: state.kind === "editingSketch" ? state.session : null,
    annotationContext:
      state.kind === "editingSketch" ? (state.annotationContext ?? null) : null,
    showAllAnnotations:
      state.kind === "editingSketch"
        ? (state.showAllAnnotations ?? false)
        : false,
    activeSectionView:
      state.kind === "inspectingSection" ? state.section : null,
    snapshot: state.snapshot,
    previewRenderables: state.previewRenderables,
    history: getEditorHistoryAvailability(state),
  };
}

export function hydrateFeatureSessionFromSnapshot(
  snapshot: WorkspaceSnapshot,
  featureId: FeatureId,
): FeatureEditSessionState | null {
  const feature = snapshot.document.features.find(
    (entry) => entry.featureId === featureId,
  );

  return feature ? hydrateFeatureEditSessionFromEntry(feature) : null;
}

export const getEditorSelectionKey = getPrimitiveRefKey;
