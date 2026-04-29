import { isRegisteredSketchToolId } from '@/domain/sketch-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'
import { isRegisteredSketchEditToolId } from '@/domain/sketch-edit-tools/registry'
import {
  adoptCompatibleSketchEditToolTargets,
  beginSketchTool,
  focusSketchStyleTool,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  getSketchSessionPreviewLabel,
  moveSketchHistoryCursor,
  toggleSketchSvgRendering,
} from '@/domain/editor/sketch-session'
import {
  cancelSketchSpecialMode,
  commitSketchSpecialMode,
  sketchSessionHasActiveSpecialMode,
} from '@/domain/sketch-special-modes/presentation'
import {
  getDefaultSelectionFilterForMode,
  getSelectionFilterForCommand,
  selectionFilterAllowsTarget,
  sketchStartSelectionFilter,
  sketchReferenceSelectionFilter,
} from '@/domain/editor/schema'
import {
  getSelectionFilterForFeatureType,
  adoptCompatibleFeatureSelection,
  createFeatureEditSession,
} from '@/domain/editor/feature-editing'
import {
  getDocumentHistoryCursorIndex,
  isValidDocumentHistoryCursor,
} from '@/domain/modeling/document-history'
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
} from './types'
import {
  adoptSelectionForFilter,
  createCommandState,
  createEditSessionCursorContext,
  createFeatureEditingState,
  createSelectionPreview,
  emitDocumentCursorMove,
  emitEditSessionCursorRestore,
  emitFeatureCommit,
  emitFeaturePreview,
  emitSketchCommit,
  emitSketchOpen,
  emitSketchSpecialModeEffect,
  emitSnapshotFetch,
  hasPendingDocumentCursorRefresh,
  isFeatureTool,
  isPassiveSketchTool,
  nextRequestId,
  toIdleState,
  updateStateDocumentSnapshot,
  withActivationSelection,
  withPreview,
} from './helpers'
import { getEditorHistoryAvailability } from './runtime'
import {
  handleSketchPointerMoved,
  handleSketchPointerReleased,
  handleSketchToolPatched,
  handleSketchActiveToolCleared,
  handleSketchHistoryCursorRequested,
  handleSketchHistoryOperationDeleteRequested,
  handleSketchAnnotationDeleteRequested,
  handleSketchAnnotationEditRequested,
  handleSketchConnectedSelectionRequested,
  handleSketchGeometryDragStarted,
  handleSketchGeometryDragMoved,
  handleSketchGeometryDragEnded,
  handleSketchReferenceImagePayloadsPicked,
  handleSketchSpecialModeEntered,
  handleSketchSpecialModePanelActionInvoked,
  handleSketchSpecialModeClickRequested,
  handleSketchSpecialModeDoubleClickRequested,
  handleSketchSpecialModeDragStarted,
  handleSketchSpecialModeDragMoved,
  handleSketchSpecialModeDragEnded,
} from './transitions-sketch'
import {
  handleFormFeaturePatched,
  handleFormReferencePickerActivated,
  handleFormReferencePickerCancelled,
} from './transitions-feature'
import {
  handleViewportHoverCleared,
  handleViewportHovered,
  handleSelectionCleared,
  handleViewportSelectionRequested,
  handleAuthoringReopenRequested,
} from './transitions-viewport'
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
  handleSectionOffsetUpdated,
  handleSectionFlipRequested,
  handleSectionCleared,
} from './transitions-section'
import {
  handleEffectDocumentCursorMoved,
  handleEffectDocumentCursorMoveFailed,
  handleEffectSnapshotLoaded,
  handleEffectSnapshotFailed,
  handleEffectSketchSessionOpened,
  handleEffectSketchSessionOpenFailed,
  handleEffectFeatureSessionHydrated,
  handleEffectFeatureSessionHydrationFailed,
  handleEffectFeaturePreviewCompleted,
  handleEffectFeaturePreviewFailed,
  handleEffectFeatureCommitted,
  handleEffectFeatureCommitFailed,
  handleEffectSketchCommitted,
  handleEffectSketchCommitFailed,
  handleEffectSketchReferencesProjected,
  handleEffectSketchReferenceProjectionFailed,
  handleEffectSketchReferenceImageImportCompleted,
  handleEffectSketchReferenceImageImportFailed,
  handleEffectSketchSpecialModeEffectCompleted,
  handleEffectSketchSpecialModeEffectFailed,
} from './transitions-effects'

/**
 * Pure editor transition function for Phase 1.
 * The reducer never performs async work directly and emits only typed effect requests.
 */
export function transitionEditorState(state: EditorState, event: EditorEvent): EditorTransitionResult {
  switch (event.type) {
    case 'session.started':
      return emitSnapshotFetch(state, null)
    case 'tool.activated': {
      if (event.toolId === 'undo') {
        return transitionEditorState(state, { type: 'history.undoRequested' })
      }

      if (event.toolId === 'redo') {
        return transitionEditorState(state, { type: 'history.redoRequested' })
      }

      if (event.toolId === 'import') {
        return {
          state,
          effects: [],
        }
      }

      if (event.toolId === 'importImage') {
        return state.kind === 'editingSketch'
          ? {
            state: {
              ...state,
              command: {
                ...state.command,
                phase: 'editing',
              },
              preview: {
                kind: 'sketch',
                label: 'Select reference images',
                target: state.session.planeTarget,
              },
            },
            effects: [],
          }
          : state.kind === 'selectionCommand' && (state.command.toolId === 'sketch' || state.command.toolId === 'importImage')
            ? {
              state: {
                ...state,
                command: {
                  ...state.command,
                  phase: 'collecting',
                },
                preview: {
                  kind: 'sketch',
                  label: 'Select reference images',
                  target: state.selection[0] ?? null,
                },
              },
              effects: [],
            }
          : {
              state,
              effects: [],
            }
      }

      if (event.toolId === 'finishSketch' && state.kind === 'editingSketch') {
        return emitSketchCommit(state)
      }

      if (event.toolId === 'svgRendering' && state.kind === 'editingSketch') {
        const session = toggleSketchSvgRendering(state.session)

        return {
          state: {
            ...state,
            mode: 'sketch',
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

      if (
        state.kind === 'editingSketch' &&
        isRegisteredSketchEditToolId(event.toolId)
      ) {
        const adoptedSelection = adoptCompatibleSketchEditToolTargets(
          state.session,
          event.toolId,
          state.selection,
        )
        const activationState = withActivationSelection(state, adoptedSelection)
        const session = beginSketchTool(
          activationState.session,
          event.toolId,
          adoptedSelection,
        )

        return {
          state: {
            ...activationState,
            mode: 'sketch',
            selectionFilter: getDefaultSelectionFilterForMode('sketch'),
            command: {
              ...activationState.command,
              toolId: event.toolId,
              phase: 'editing',
            },
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

      if (
        state.kind === 'editingSketch' &&
        (
          isRegisteredSketchToolId(event.toolId)
          || isRegisteredSketchConstraintToolId(event.toolId)
          || event.toolId === 'dimension'
          || event.toolId === 'construction'
          || event.toolId === 'projectReference'
        )
      ) {
        const session = beginSketchTool(
          state.session,
          event.toolId === 'dimension' ? 'dimensionDistance' : event.toolId,
        )

        return {
          state: {
            ...state,
            mode: 'sketch',
            selectionFilter: event.toolId === 'projectReference'
              ? sketchReferenceSelectionFilter
              : getDefaultSelectionFilterForMode('sketch'),
            command: {
              ...state.command,
              toolId: event.toolId,
              phase: 'editing',
            },
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

      if (state.kind === 'editingSketch' && isPassiveSketchTool(event.toolId)) {
        const session = focusSketchStyleTool(state.session, state.selection, event.toolId)

        return {
          state: {
            ...state,
            mode: 'sketch',
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

      if (event.toolId === 'sketch') {
        const adoptedSelection = adoptSelectionForFilter(
          state.selection,
          sketchStartSelectionFilter,
          state.selectionCatalog,
        )
        const nextState = createCommandState(
          withActivationSelection(state, adoptedSelection),
          event.toolId,
          state.mode,
          sketchStartSelectionFilter,
          createSelectionPreview(withActivationSelection(state, adoptedSelection), sketchStartSelectionFilter),
        )

        const selectedTarget = nextState.selection[0] ?? null

        if (
          selectedTarget &&
          selectionFilterAllowsTarget(
            sketchStartSelectionFilter,
            [],
            selectedTarget,
            nextState.selectionCatalog,
          )
        ) {
          if (selectedTarget.kind === 'sketch') {
            const cursorContext = createEditSessionCursorContext(state.snapshot, {
              kind: 'sketch',
              sketchId: selectedTarget.sketchId,
            })

            if (!cursorContext) {
              return {
                state: withPreview(nextState, {
                  kind: 'selection',
                  label: `Sketch ${selectedTarget.sketchId} is not in document history.`,
                  target: selectedTarget,
                }),
                effects: [],
              }
            }

            return emitDocumentCursorMove(
              {
                ...nextState,
                editSessionCursorContext: cursorContext,
                preview: {
                  kind: 'selection',
                  label: `Rolling back before sketch ${selectedTarget.sketchId}`,
                  target: selectedTarget,
                },
              },
              cursorContext.rollbackCursor,
              true,
            )
          }

          return emitSketchOpen(nextState, [selectedTarget])
        }

        return {
          state: nextState,
          effects: [],
        }
      }

      if (event.toolId === 'sectionView') {
        const selectionFilter = getSelectionFilterForCommand(event.toolId, 'part')

        return {
          state: createCommandState(
            state,
            event.toolId,
            'part',
            selectionFilter,
            createSelectionPreview(state, selectionFilter),
          ),
          effects: [],
        }
      }

      if (event.toolId === 'measure') {
        const selectionFilter = getSelectionFilterForCommand(event.toolId, 'part')

        return {
          state: createCommandState(
            state,
            event.toolId,
            'part',
            selectionFilter,
            createSelectionPreview(state, selectionFilter),
          ),
          effects: [],
        }
      }

      if (isFeatureTool(event.toolId)) {
        const selectionFilter = getSelectionFilterForFeatureType(event.toolId)
        const activationSelection =
          state.selection.length === 1 && state.selection[0]?.kind === 'feature'
            ? state.selection
            : adoptCompatibleFeatureSelection(event.toolId, state.selection)
        const activationState = withActivationSelection(state, activationSelection)
        const nextState = createCommandState(
          activationState,
          event.toolId,
          'part',
          selectionFilter,
          createSelectionPreview(activationState, selectionFilter),
        )

        const selectedTarget = nextState.selection[0] ?? null

        if (selectedTarget?.kind === 'feature') {
          const cursorContext = createEditSessionCursorContext(state.snapshot, {
            kind: 'feature',
            featureId: selectedTarget.featureId,
          })

          if (!cursorContext) {
            return {
              state: withPreview(nextState, {
                kind: 'selection',
                label: `Feature ${selectedTarget.featureId} is not in document history.`,
                target: selectedTarget,
              }),
              effects: [],
            }
          }

          return emitDocumentCursorMove(
            {
              ...nextState,
              editSessionCursorContext: cursorContext,
              preview: {
                kind: 'selection',
                label: `Rolling back before feature ${selectedTarget.featureId}`,
                target: selectedTarget,
              },
            },
            cursorContext.rollbackCursor,
            true,
          )
        }

        const session = createFeatureEditSession({
          featureType: event.toolId,
          selectedTargets: nextState.selection,
        })

        return emitFeaturePreview(createFeatureEditingState(nextState, nextState.command, session))
      }

      const mode =
        event.toolId === 'line'
          || event.toolId === 'rectangle'
          || event.toolId === 'circle'
          || event.toolId === 'construction'
          || event.toolId === 'projectReference'
          || isRegisteredSketchConstraintToolId(event.toolId)
          ? 'sketch'
          : state.mode
      const filter = getSelectionFilterForCommand(event.toolId, mode)

      return {
        state: createCommandState(
          state,
          event.toolId,
          mode,
          filter,
          createSelectionPreview(state, filter),
        ),
        effects: [],
      }
    }
    case 'history.undoRequested': {
      if (!getEditorHistoryAvailability(state).canUndo) {
        return { state, effects: [] }
      }

      if (state.kind === 'editingSketch') {
        const cursor = getPreviousSketchHistoryCursor(state.session)
        if (!cursor) {
          return { state, effects: [] }
        }

        const session = moveSketchHistoryCursor(state.session, cursor)

        return {
          state: {
            ...state,
            selection: [],
            hoverTarget: null,
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

      return { state, effects: [] }
    }
    case 'history.redoRequested': {
      if (!getEditorHistoryAvailability(state).canRedo) {
        return { state, effects: [] }
      }

      if (state.kind === 'editingSketch') {
        const cursor = getNextSketchHistoryCursor(state.session)
        if (!cursor) {
          return { state, effects: [] }
        }

        const session = moveSketchHistoryCursor(state.session, cursor)

        return {
          state: {
            ...state,
            selection: [],
            hoverTarget: null,
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

      return { state, effects: [] }
    }
    case 'command.cancelled': {
      if (state.kind === 'idle') {
        return { state, effects: [] }
      }

      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] }
      }

      if (state.kind === 'editingSketch' && sketchSessionHasActiveSpecialMode(state.session)) {
        const requestId = nextRequestId(state, 'sketch-special-cancel')
        const session = cancelSketchSpecialMode(state.session, requestId)

        return emitSketchSpecialModeEffect(state, session, requestId)
      }

      if (state.editSessionCursorContext?.phase === 'active') {
        return emitEditSessionCursorRestore(
          toIdleState(state, state.kind === 'editingSketch' ? 'part' : state.mode),
        )
      }

      return {
        state: toIdleState(state, state.kind === 'editingSketch' ? 'part' : state.mode),
        effects: [],
      }
    }
    case 'command.commitRequested':
      if (state.kind === 'editingSketch' && state.command.commandSessionId === event.commandSessionId) {
        if (sketchSessionHasActiveSpecialMode(state.session)) {
          const requestId = nextRequestId(state, 'sketch-special-commit')
          const session = commitSketchSpecialMode(state.session, requestId)
          return emitSketchSpecialModeEffect(state, session, requestId)
        }
      }

      if (state.kind === 'editingFeature' && state.command.commandSessionId === event.commandSessionId) {
        return emitFeatureCommit(state)
      }

      return { state, effects: [] }
    case 'document.refreshRequested':
      return emitSnapshotFetch(state, null)
    case 'document.snapshotLoaded':
      return {
        state: updateStateDocumentSnapshot(state, event.snapshot),
        effects: [],
      }
    case 'document.historyCursorRequested':
      if (
        state.kind !== 'idle' ||
        !state.snapshot ||
        hasPendingDocumentCursorRefresh(state) ||
        !isValidDocumentHistoryCursor(state.snapshot.presentation.documentHistory, event.cursor) ||
        getDocumentHistoryCursorIndex(state.snapshot.presentation.documentHistory, event.cursor)
          === getDocumentHistoryCursorIndex(state.snapshot.presentation.documentHistory, state.snapshot.document.cursor)
      ) {
        return { state, effects: [] }
      }

      return emitDocumentCursorMove(state, event.cursor, false)

    // Import events
    case 'import.fileSelected':
      return handleImportFileSelected(state, event)
    case 'import.providerSelected':
      return handleImportProviderSelected(state)
    case 'import.selectionPatched':
      return handleImportSelectionPatched(state, event)
    case 'import.commitRequested':
      return handleImportCommitRequested(state)
    case 'import.cancelled':
      return handleImportCancelled(state)
    case 'import.committed':
      return handleImportCommitted(state)
    case 'import.failed':
      return handleImportFailed(state, event)

    // Section events
    case 'section.offsetUpdated':
      return handleSectionOffsetUpdated(state, event)
    case 'section.flipRequested':
      return handleSectionFlipRequested(state, event)
    case 'section.cleared':
      return handleSectionCleared(state, event)

    // Viewport/selection events
    case 'viewport.hoverCleared':
      return handleViewportHoverCleared(state)
    case 'viewport.hovered':
      return handleViewportHovered(state, event)
    case 'selection.cleared':
      return handleSelectionCleared(state)
    case 'viewport.selectionRequested':
      return handleViewportSelectionRequested(state, event)
    case 'authoring.reopenRequested':
      return handleAuthoringReopenRequested(state, event)

    // Sketch events
    case 'sketch.connectedSelectionRequested':
      return handleSketchConnectedSelectionRequested(state, event)
    case 'sketch.specialModeEntered':
      return handleSketchSpecialModeEntered(state, event, transitionEditorState)
    case 'sketch.specialModePanelActionInvoked':
      return handleSketchSpecialModePanelActionInvoked(state, event)
    case 'sketch.specialModeClickRequested':
      return handleSketchSpecialModeClickRequested(state, event)
    case 'sketch.specialModeDoubleClickRequested':
      return handleSketchSpecialModeDoubleClickRequested(state, event)
    case 'sketch.specialModeDragStarted':
      return handleSketchSpecialModeDragStarted(state, event)
    case 'sketch.specialModeDragMoved':
      return handleSketchSpecialModeDragMoved(state, event)
    case 'sketch.specialModeDragEnded':
      return handleSketchSpecialModeDragEnded(state, event)
    case 'sketch.geometryDragStarted':
      return handleSketchGeometryDragStarted(state, event)
    case 'sketch.geometryDragMoved':
      return handleSketchGeometryDragMoved(state, event)
    case 'sketch.geometryDragEnded':
      return handleSketchGeometryDragEnded(state, event)
    case 'sketch.referenceImagePayloadsPicked':
      return handleSketchReferenceImagePayloadsPicked(state, event, transitionEditorState)
    case 'sketch.pointerMoved':
      return handleSketchPointerMoved(state, event)
    case 'sketch.pointerReleased':
      return handleSketchPointerReleased(state, event)
    case 'sketch.toolPatched':
      return handleSketchToolPatched(state, event)
    case 'sketch.activeToolCleared':
      return handleSketchActiveToolCleared(state)
    case 'sketch.historyCursorRequested':
      return handleSketchHistoryCursorRequested(state, event)
    case 'sketch.historyOperationDeleteRequested':
      return handleSketchHistoryOperationDeleteRequested(state, event)
    case 'sketch.annotationDeleteRequested':
      return handleSketchAnnotationDeleteRequested(state)
    case 'sketch.annotationEditRequested':
      return handleSketchAnnotationEditRequested(state, event)

    // Feature form events
    case 'form.featurePatched':
      return handleFormFeaturePatched(state, event)
    case 'form.referencePickerActivated':
      return handleFormReferencePickerActivated(state, event)
    case 'form.referencePickerCancelled':
      return handleFormReferencePickerCancelled(state)

    // Effect response events
    case 'effect.documentCursorMoved':
      return handleEffectDocumentCursorMoved(state, event)
    case 'effect.documentCursorMoveFailed':
      return handleEffectDocumentCursorMoveFailed(state, event)
    case 'effect.snapshotLoaded':
      return handleEffectSnapshotLoaded(state, event)
    case 'effect.snapshotFailed':
      return handleEffectSnapshotFailed(state, event)
    case 'effect.sketchSessionOpened':
      return handleEffectSketchSessionOpened(state, event)
    case 'effect.sketchSessionOpenFailed':
      return handleEffectSketchSessionOpenFailed(state, event)
    case 'effect.featureSessionHydrated':
      return handleEffectFeatureSessionHydrated(state, event)
    case 'effect.featureSessionHydrationFailed':
      return handleEffectFeatureSessionHydrationFailed(state, event)
    case 'effect.featurePreviewCompleted':
      return handleEffectFeaturePreviewCompleted(state, event)
    case 'effect.featurePreviewFailed':
      return handleEffectFeaturePreviewFailed(state, event)
    case 'effect.featureCommitted':
      return handleEffectFeatureCommitted(state, event)
    case 'effect.featureCommitFailed':
      return handleEffectFeatureCommitFailed(state, event)
    case 'effect.sketchCommitted':
      return handleEffectSketchCommitted(state, event)
    case 'effect.sketchCommitFailed':
      return handleEffectSketchCommitFailed(state, event)
    case 'effect.sketchReferencesProjected':
      return handleEffectSketchReferencesProjected(state, event)
    case 'effect.sketchReferenceProjectionFailed':
      return handleEffectSketchReferenceProjectionFailed(state, event)
    case 'effect.sketchReferenceImageImportCompleted':
      return handleEffectSketchReferenceImageImportCompleted(state, event)
    case 'effect.sketchReferenceImageImportFailed':
      return handleEffectSketchReferenceImageImportFailed(state, event)
    case 'effect.sketchSpecialModeEffectCompleted':
      return handleEffectSketchSpecialModeEffectCompleted(state, event)
    case 'effect.sketchSpecialModeEffectFailed':
      return handleEffectSketchSpecialModeEffectFailed(state, event)

    default:
      return { state, effects: [] }
  }
}
