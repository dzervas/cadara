import {
  getActiveSketchStyleToolId,
  getSketchSessionPreviewLabel,
  selectSketchEditTarget,
  selectSketchEditToolTarget,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  selectSketchReferenceTarget,
  shouldPinSketchConstraintPreviewBeforeSelection,
  pinSketchConstraintPreview,
  toggleSketchConstructionTarget,
  updateSketchConstraintHover,
  updateSketchEditToolHover,
  updateSketchStyleFocusTarget,
} from '@/domain/editor/sketch-session'
import {
  doesSketchSpecialModeAcceptTarget,
  handleSketchSpecialModeHover,
  sketchSessionHasActiveSpecialMode,
} from '@/domain/sketch-special-modes/presentation'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import {
  createSectionViewSession,
} from '@/domain/section-view/session'
import {
  getDefaultSelectionFilterForMode,
  getSelectionFilterRejectionLabel,
  getSelectionPreviewLabel,
  resolveSelectionCandidate,
  selectionFilterAllowsTarget,
  sketchReferenceSelectionFilter,
  sketchStartSelectionFilter,
} from '@/domain/editor/schema'
import { getImportProviderById } from '@/domain/import/provider-registry'
import { resolveMeasureSelectionCandidate } from '@/domain/measure/measurement'
import { createFeatureEditorReferenceSelectionPatch } from '@/domain/feature-authoring/form-events'
import {
  applySelectionToFeatureEditSession,
  patchFeatureEditSession,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
  SketchEditorState,
} from './types'
import {
  createCommandState,
  createEditSessionCursorContext,
  createFeatureSelectionPreview,
  createImportSelectionPreview,
  createImportViewportSelectionPatch,
  createSectionViewEditingState,
  createSelectionPreview,
  emitDocumentCursorMove,
  emitFeaturePreview,
  emitSketchOpen,
  emitSketchReferenceProjection,
  enterSketchEditing,
  getActiveImportReferencePickerField,
  getActiveReferencePickerField,
  getDefaultImportSelectionField,
  isFeatureTool,
  withPreview,
  canReopenSketchDirectlyFromCurrentCursor,
} from './helpers'
import { getSelectionFilterForFeatureType } from '@/domain/editor/feature-editing'

export function handleViewportHoverCleared(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind === 'editingSketch' && sketchSessionHasActiveSpecialMode(state.session)) {
    const session = handleSketchSpecialModeHover(state.session, null, state.selection, state.selectionCatalog)

    return {
      state: {
        ...state,
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

  if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
    const session = updateSketchConstraintHover(state.session, null)

    return {
      state: {
        ...state,
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

  if (state.kind === 'editingSketch' && state.session.activeEditTool) {
    const session = updateSketchEditToolHover(state.session, null)

    return {
      state: {
        ...state,
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

  return {
    state: withPreview(
      {
        ...state,
        hoverTarget: null,
      },
      state.kind === 'editingSketch'
        ? {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(state.session),
            target: state.session.planeTarget,
          }
        : state.kind === 'selectionCommand'
          ? createSelectionPreview(state, state.selectionFilter)
          : state.kind === 'editingFeature'
            ? createFeatureSelectionPreview(state.session)
            : state.kind === 'importing'
              ? createImportSelectionPreview(state.session)
            : state.preview,
    ),
    effects: [],
  }
}

export function handleViewportHovered(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'viewport.hovered' }>,
): EditorTransitionResult {
  if (state.kind === 'editingSketch' && sketchSessionHasActiveSpecialMode(state.session)) {
    if (!doesSketchSpecialModeAcceptTarget(state.session, event.target, state.selection, state.selectionCatalog)) {
      return { state, effects: [] }
    }

    const session = handleSketchSpecialModeHover(
      state.session,
      event.target,
      state.selection,
      state.selectionCatalog,
    )

    return {
      state: {
        ...state,
        hoverTarget: event.target,
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
    !selectionFilterAllowsTarget(
      state.selectionFilter,
      state.selection,
      event.target,
      state.selectionCatalog,
    )
  ) {
    return { state, effects: [] }
  }

  if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
    const session = updateSketchConstraintHover(state.session, event.target)

    return {
      state: {
        ...state,
        hoverTarget: event.target,
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

  if (state.kind === 'editingSketch' && state.session.activeEditTool) {
    const session = updateSketchEditToolHover(state.session, event.target)

    return {
      state: {
        ...state,
        hoverTarget: event.target,
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

  return {
    state: withPreview(
      {
        ...state,
        hoverTarget: event.target,
      },
      state.kind === 'selectionCommand'
        ? {
            kind: 'selection',
            label: getSelectionPreviewLabel(state.selectionFilter, event.target, 'hover'),
            target: event.target,
          }
        : state.preview,
    ),
    effects: [],
  }
}

export function handleSelectionCleared(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
    const session = updateSketchConstraintHover(state.session, null)

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

  if (state.kind === 'editingSketch' && state.session.activeEditTool) {
    const session = updateSketchEditToolHover(state.session, null)

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

  if (state.kind === 'editingSketch' && getActiveSketchStyleToolId(state.session)) {
    const session = updateSketchStyleFocusTarget(state.session, [])

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

  const clearedState = {
    ...state,
    selection: [],
    hoverTarget: null,
  }

  return {
    state: withPreview(
      clearedState,
      state.kind === 'editingSketch'
        ? {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(state.session),
            target: state.session.planeTarget,
          }
        : state.kind === 'selectionCommand'
          ? createSelectionPreview(clearedState, state.selectionFilter)
          : state.kind === 'editingFeature'
            ? createFeatureSelectionPreview(state.session)
            : state.kind === 'importing'
              ? createImportSelectionPreview(state.session)
            : state.preview,
    ),
    effects: [],
  }
}

export function handleViewportSelectionRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'viewport.selectionRequested' }>,
): EditorTransitionResult {
  if (
    !selectionFilterAllowsTarget(
      state.selectionFilter,
      state.selection,
      event.target,
      state.selectionCatalog,
    )
  ) {
    return {
      state: withPreview(state, {
        kind: 'selection',
        label: getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
        target: state.preview?.target ?? null,
      }),
      effects: [],
    }
  }

  if (state.kind === 'selectionCommand' && (state.command.toolId === 'sketch' || state.command.toolId === 'importImage')) {
    return emitSketchOpen(
      {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
      },
      [event.target],
    )
  }

  if (state.kind === 'selectionCommand' && state.command.toolId === 'sectionView') {
    if (
      (event.target.kind !== 'construction' && event.target.kind !== 'face' && event.target.kind !== 'region')
      || !event.cameraPosition
    ) {
      return {
        state: withPreview(state, {
          kind: 'selection',
          label: 'Section view requires a viewport-picked planar face, closed region, or construction plane.',
          target: state.selection[0] ?? null,
        }),
        effects: [],
      }
    }

    const section = createSectionViewSession({
      snapshot: state.snapshot,
      seed: event.target,
      cameraPosition: event.cameraPosition,
    })

    if (!section) {
      return {
        state: withPreview(state, {
          kind: 'selection',
          label: 'Selected target does not resolve to a usable section plane.',
          target: event.target,
        }),
        effects: [],
      }
    }

    return {
      state: createSectionViewEditingState(state, section),
      effects: [],
    }
  }

  if (state.kind === 'editingFeature') {
    const activeReferenceField = getActiveReferencePickerField(state)
    const nextSelection = [event.target]
    const nextSession: FeatureEditSessionState = {
      ...(activeReferenceField
        ? patchFeatureEditSession(
            state.session,
            createFeatureEditorReferenceSelectionPatch(activeReferenceField, event.target),
          )
        : applySelectionToFeatureEditSession(state.session, event.target)),
      status: 'idle',
    }

    return emitFeaturePreview({
      ...state,
      selection: nextSelection,
      hoverTarget: event.target,
      command: {
        ...state.command,
        phase: 'collecting',
      },
      preview: createFeatureSelectionPreview(nextSession, 'Selected'),
      session: nextSession,
      activeReferencePickerFieldId: activeReferenceField?.id ?? state.activeReferencePickerFieldId,
      pendingPreviewRequestId: null,
    })
  }

  if (state.kind === 'importing') {
    const activeReferenceField = getActiveImportReferencePickerField(state)
      ?? getDefaultImportSelectionField(state.session)
    const nextPatch = createImportViewportSelectionPatch(state, activeReferenceField, event.target)
    const provider = getImportProviderById(state.session.providerId)

    if (!provider || !nextPatch) {
      return { state, effects: [] }
    }

    const nextSelections = provider.applySelectionPatch(
      state.session.review,
      state.session.selections,
      nextPatch,
    )
    const nextSession = {
      ...state.session,
      selections: nextSelections,
      formSchema: provider.getReviewFormSchema(state.session.review, nextSelections),
    }

    return {
      state: {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
        session: nextSession,
        selectionFilter:
          activeReferenceField?.kind === 'referencePicker'
            ? getDefaultSelectionFilterForMode('part')
            : state.selectionFilter,
        command: {
          ...state.command,
          phase: activeReferenceField?.kind === 'referencePicker' ? 'editing' : 'collecting',
        },
        preview: createImportSelectionPreview(nextSession, 'Selected'),
        activeReferencePickerFieldId:
          activeReferenceField?.kind === 'referencePicker'
            ? null
            : activeReferenceField?.id ?? state.activeReferencePickerFieldId,
      },
      effects: [],
    }
  }

  if (state.kind === 'editingSketch' && getActiveSketchStyleToolId(state.session)) {
    const nextSelection = [event.target]
    const session = updateSketchStyleFocusTarget(state.session, nextSelection)

    return {
      state: {
        ...state,
        selection: nextSelection,
        hoverTarget: event.target,
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

  if (state.kind === 'editingSketch' && state.session.constructionTargetPicking) {
    const session = toggleSketchConstructionTarget(state.session, event.target)

    return {
      state: {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
        session,
        command: {
          ...state.command,
          toolId: session.activeTool ?? 'sketch',
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

  if (state.kind === 'editingSketch' && state.session.referenceTargetPicking) {
    const session = selectSketchReferenceTarget(state.session, event.target)
    const nextState: SketchEditorState = {
      ...state,
      selection: [event.target],
      hoverTarget: event.target,
      selectionFilter: session.referenceTargetPicking
        ? sketchReferenceSelectionFilter
        : getDefaultSelectionFilterForMode('sketch'),
      session,
      command: {
        ...state.command,
        toolId: session.activeTool ?? 'sketch',
        phase: 'editing',
      },
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    }

    return emitSketchReferenceProjection(nextState, session)
  }

  if (state.kind === 'editingSketch' && state.session.activeEditTool) {
    const session = selectSketchEditToolTarget(state.session, event.target)

    return {
      state: {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
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

  if (
    state.kind === 'editingSketch'
    && shouldPinSketchConstraintPreviewBeforeSelection(state.session)
  ) {
    const session = pinSketchConstraintPreview(
      state.session,
      state.session.constraintAuthoring?.pointer ?? null,
    )

    return {
      state: {
        ...state,
        session,
        command: {
          ...state.command,
          phase: 'collecting',
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

  if (
    state.kind === 'editingSketch'
    && (event.target.kind === 'constraint' || event.target.kind === 'dimension')
  ) {
    const session = selectSketchAnnotation(state.session, event.target)

    return {
      state: {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
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

  if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
    const session = selectSketchConstraintTarget(state.session, event.target)

    return {
      state: {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
        session,
        command: {
          ...state.command,
          phase: 'collecting',
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

  if (state.kind === 'editingSketch' && event.target.kind === 'sketchPoint') {
    const session = selectSketchEditTarget(state.session, event.target)

    return {
      state: {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
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

  if (state.kind === 'inspectingSection') {
    return { state, effects: [] }
  }

  if (state.kind === 'selectionCommand' && state.command.toolId === 'measure') {
    const candidate = resolveMeasureSelectionCandidate(state.snapshot, state.selection, event.target)

    if (!candidate.accepted) {
      return {
        state: withPreview(state, {
          kind: 'selection',
          label: candidate.reason ?? getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
          target: state.selection[0] ?? null,
        }),
        effects: [],
      }
    }

    return {
      state: {
        ...state,
        selection: candidate.nextSelection,
        hoverTarget: event.target,
        command: {
          ...state.command,
          phase: 'collecting',
        },
        preview: {
          kind: 'selection',
          label: getSelectionPreviewLabel(state.selectionFilter, event.target, 'select'),
          target: event.target,
        },
      },
      effects: [],
    }
  }

  const candidate = resolveSelectionCandidate(
    state.selectionFilter,
    state.selection,
    event.target,
    state.selectionCatalog,
  )

  if (!candidate.accepted) {
    return { state, effects: [] }
  }

  if (state.kind === 'selectionCommand') {
    return {
      state: {
        ...state,
        selection: candidate.nextSelection,
        hoverTarget: event.target,
        command: {
          ...state.command,
          phase: 'collecting',
        },
        preview: {
          kind: 'selection',
          label: getSelectionPreviewLabel(state.selectionFilter, event.target, 'select'),
          target: event.target,
        },
      },
      effects: [],
    }
  }

  return {
    state: {
      ...state,
      selection: candidate.nextSelection,
      hoverTarget: event.target,
    },
    effects: [],
  }
}

export function handleAuthoringReopenRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'authoring.reopenRequested' }>,
): EditorTransitionResult {
  if (event.target.kind === 'sketch' && event.toolId === 'sketch') {
    const nextState = createCommandState(
      state,
      'sketch',
      state.mode,
      sketchStartSelectionFilter,
      createSelectionPreview(state, sketchStartSelectionFilter),
    )

    if (canReopenSketchDirectlyFromCurrentCursor(state.snapshot, event.target)) {
      const session = openSketchSessionFromSelection([event.target], state.snapshot)

      if (session) {
        return enterSketchEditing(
          {
            ...nextState,
            selection: [event.target],
            hoverTarget: event.target,
          },
          session,
        )
      }
    }

    const cursorContext = createEditSessionCursorContext(state.snapshot, {
      kind: 'sketch',
      sketchId: event.target.sketchId,
    })

    if (!cursorContext) {
      return {
        state: withPreview(nextState, {
          kind: 'selection',
          label: `Sketch ${event.target.sketchId} is not in document history.`,
          target: event.target,
        }),
        effects: [],
      }
    }

    return emitDocumentCursorMove(
      {
        ...nextState,
        selection: [event.target],
        hoverTarget: event.target,
        editSessionCursorContext: cursorContext,
        preview: {
          kind: 'selection',
          label: `Rolling back before sketch ${event.target.sketchId}`,
          target: event.target,
        },
      },
      cursorContext.rollbackCursor,
      true,
    )
  }

  if (event.target.kind !== 'feature' || !isFeatureTool(event.toolId)) {
    return { state, effects: [] }
  }

  const selectionFilter = getSelectionFilterForFeatureType(event.toolId)
  const nextState = createCommandState(
    state,
    event.toolId,
    'part',
    selectionFilter,
    createSelectionPreview(state, selectionFilter),
  )
  const cursorContext = createEditSessionCursorContext(state.snapshot, {
    kind: 'feature',
    featureId: event.target.featureId,
  })

  if (!cursorContext) {
    return {
      state: withPreview(nextState, {
        kind: 'selection',
        label: `Feature ${event.target.featureId} is not in document history.`,
        target: event.target,
      }),
      effects: [],
    }
  }

  return emitDocumentCursorMove(
    {
      ...nextState,
      selection: [event.target],
      hoverTarget: event.target,
      editSessionCursorContext: cursorContext,
      preview: {
        kind: 'selection',
        label: `Rolling back before feature ${event.target.featureId}`,
        target: event.target,
      },
    },
    cursorContext.rollbackCursor,
    true,
  )
}
