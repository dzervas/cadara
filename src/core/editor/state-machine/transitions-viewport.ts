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
} from '@/core/sketch-special-modes/presentation'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import {
  createSectionViewSession,
} from '@/core/section-view/session'
import {
  getDefaultSelectionFilterForMode,
  getSelectionFilterRejectionLabel,
  getSelectionPreviewLabel,
  resolveSelectionCandidate,
  selectionFilterAllowsTarget,
  sketchReferenceSelectionFilter,
  sketchStartSelectionFilter,
} from '@/core/editor/schema'
import type { PrimitiveRef } from '@/core/editor/schema'
import { resolveMeasureSelectionCandidate } from '@/domain/measure/measurement'
import { createFeatureEditorReferenceSelectionPatch } from '@/core/feature-authoring/form-events'
import {
  applySelectionToFeatureEditSession,
  getSelectionFilterForFeatureType,
  patchFeatureEditSession,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import { hydrateSketchPlaneEditSession } from '@/domain/editor/sketch-plane-editing'
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
  SketchEditorState,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import {
  createImportViewportSelectionPatch,
  getActiveImportReferencePickerField,
  getActiveReferencePickerField,
  getDefaultImportSelectionField,
} from './form-traversal'
import {
  createFeatureSelectionPreview,
  createImportSelectionPreview,
  createSelectionPreview,
} from './selection-helpers'
import {
  createCommandState,
  createSketchPlaneEditingState,
  createSectionViewEditingState,
  enterSketchEditing,
  withPreview,
} from './state-creators'
import {
  canReopenSketchDirectlyFromCurrentCursor,
  createEditSessionCursorContext,
} from './document-helpers'
import {
  emitDocumentCursorMove,
  emitFeaturePreview,
  emitSketchOpen,
  emitSketchReferenceProjection,
} from './effect-emitters'
import { isFeatureTool } from './utility-helpers'

export function handleViewportHoverCleared(
  state: EditorState,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind === 'editingSketch' && sketchSessionHasActiveSpecialMode(state.session)) {
    const session = handleSketchSpecialModeHover(
      state.session,
      null,
      state.selection,
      state.selectionCatalog,
      dependencies.sketchSpecialModes,
    )

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
                ? createImportSelectionPreview(state.session, dependencies)
                : state.preview,
    ),
    effects: [],
  }
}

export function handleViewportHovered(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'viewport.hovered' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind === 'editingSketch' && sketchSessionHasActiveSpecialMode(state.session)) {
    if (
      !doesSketchSpecialModeAcceptTarget(
        state.session,
        event.target,
        state.selection,
        state.selectionCatalog,
        dependencies.sketchSpecialModes,
      )
    ) {
      return { state, effects: [] }
    }

    const session = handleSketchSpecialModeHover(
      state.session,
      event.target,
      state.selection,
      state.selectionCatalog,
      dependencies.sketchSpecialModes,
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
  dependencies: EditorExtensionDependencies,
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
              ? createImportSelectionPreview(state.session, dependencies)
            : state.preview,
    ),
    effects: [],
  }
}

function rejectViewportSelection(state: EditorState, label: string, target: PrimitiveRef | null): EditorTransitionResult {
  return {
    state: withPreview(state, {
      kind: 'selection',
      label,
      target,
    }),
    effects: [],
  }
}

function applySketchSelectionState(
  state: SketchEditorState,
  session: SketchEditorState['session'],
  target: PrimitiveRef,
  commandPhase?: SketchEditorState['command']['phase'],
): SketchEditorState {
  return {
    ...state,
    selection: [target],
    hoverTarget: target,
    session,
    command: commandPhase
      ? {
          ...state.command,
          phase: commandPhase,
        }
      : state.command,
    preview: {
      kind: 'sketch',
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  }
}

function createSketchPreviewState(
  state: SketchEditorState,
  session: SketchEditorState['session'],
): SketchEditorState {
  return {
    ...state,
    session,
    preview: {
      kind: 'sketch',
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  }
}

function handleSelectionCommandViewportSelection(
  state: Extract<EditorState, { kind: 'selectionCommand' }>,
  event: Extract<EditorEvent, { type: 'viewport.selectionRequested' }>,
): EditorTransitionResult | null {
  if (state.command.toolId === 'sketch' || state.command.toolId === 'importImage') {
    return emitSketchOpen(
      {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
      },
      [event.target],
    )
  }

  if (state.command.toolId === 'sectionView') {
    if (
      (event.target.kind !== 'construction' && event.target.kind !== 'face' && event.target.kind !== 'region')
      || !event.cameraPosition
    ) {
      return rejectViewportSelection(
        state,
        'Section view requires a viewport-picked planar face, closed region, or construction plane.',
        state.selection[0] ?? null,
      )
    }

    const section = createSectionViewSession({
      snapshot: state.snapshot,
      seed: event.target,
      cameraPosition: event.cameraPosition,
    })

    if (!section) {
      return rejectViewportSelection(
        state,
        'Selected target does not resolve to a usable section plane.',
        event.target,
      )
    }

    return {
      state: createSectionViewEditingState(state, section),
      effects: [],
    }
  }

  if (state.command.toolId === 'measure') {
    const candidate = resolveMeasureSelectionCandidate(state.snapshot, state.selection, event.target)

    if (!candidate.accepted) {
      return rejectViewportSelection(
        state,
        candidate.reason ?? getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
        state.selection[0] ?? null,
      )
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

  return null
}

function handleEditingFeatureViewportSelection(
  state: Extract<EditorState, { kind: 'editingFeature' }>,
  event: Extract<EditorEvent, { type: 'viewport.selectionRequested' }>,
): EditorTransitionResult {
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

function handleImportViewportSelection(
  state: Extract<EditorState, { kind: 'importing' }>,
  event: Extract<EditorEvent, { type: 'viewport.selectionRequested' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  const activeReferenceField = getActiveImportReferencePickerField(state)
    ?? getDefaultImportSelectionField(state.session)
  const nextPatch = createImportViewportSelectionPatch(state, activeReferenceField, event.target)
  const provider = dependencies.importProviders.getById(state.session.providerId)

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
      preview: createImportSelectionPreview(nextSession, dependencies, 'Selected'),
      activeReferencePickerFieldId:
        activeReferenceField?.kind === 'referencePicker'
          ? null
          : activeReferenceField?.id ?? state.activeReferencePickerFieldId,
    },
    effects: [],
  }
}

function handleEditingSketchViewportSelection(
  state: SketchEditorState,
  event: Extract<EditorEvent, { type: 'viewport.selectionRequested' }>,
): EditorTransitionResult {
  if (getActiveSketchStyleToolId(state.session)) {
    const session = updateSketchStyleFocusTarget(state.session, [event.target])
    return {
      state: applySketchSelectionState(state, session, event.target),
      effects: [],
    }
  }

  if (state.session.constructionTargetPicking) {
    const session = toggleSketchConstructionTarget(state.session, event.target)
    return {
      state: {
        ...applySketchSelectionState(state, session, event.target, 'editing'),
        command: {
          ...state.command,
          toolId: session.activeTool ?? 'sketch',
          phase: 'editing',
        },
      },
      effects: [],
    }
  }

  if (state.session.referenceTargetPicking) {
    const session = selectSketchReferenceTarget(state.session, event.target)
    const nextState: SketchEditorState = {
      ...applySketchSelectionState(state, session, event.target, 'editing'),
      selectionFilter: session.referenceTargetPicking
        ? sketchReferenceSelectionFilter
        : getDefaultSelectionFilterForMode('sketch'),
      command: {
        ...state.command,
        toolId: session.activeTool ?? 'sketch',
        phase: 'editing',
      },
    }

    return emitSketchReferenceProjection(nextState, session)
  }

  if (state.session.activeEditTool) {
    const session = selectSketchEditToolTarget(state.session, event.target)
    return {
      state: applySketchSelectionState(state, session, event.target, 'editing'),
      effects: [],
    }
  }

  if (shouldPinSketchConstraintPreviewBeforeSelection(state.session)) {
    const session = pinSketchConstraintPreview(
      state.session,
      state.session.constraintAuthoring?.pointer ?? null,
    )

    return {
      state: {
        ...createSketchPreviewState(state, session),
        command: {
          ...state.command,
          phase: 'collecting',
        },
      },
      effects: [],
    }
  }

  if (event.target.kind === 'constraint' || event.target.kind === 'dimension') {
    const session = selectSketchAnnotation(state.session, event.target)
    return {
      state: applySketchSelectionState(state, session, event.target),
      effects: [],
    }
  }

  if (state.session.constraintAuthoring) {
    const session = selectSketchConstraintTarget(state.session, event.target)
    return {
      state: applySketchSelectionState(state, session, event.target, 'collecting'),
      effects: [],
    }
  }

  if (event.target.kind === 'sketchPoint') {
    const session = selectSketchEditTarget(state.session, event.target)
    return {
      state: applySketchSelectionState(state, session, event.target),
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

  return {
    state: {
      ...state,
      selection: candidate.nextSelection,
      hoverTarget: event.target,
    },
    effects: [],
  }
}

export function handleViewportSelectionRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'viewport.selectionRequested' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    !selectionFilterAllowsTarget(
      state.selectionFilter,
      state.selection,
      event.target,
      state.selectionCatalog,
    )
  ) {
    return rejectViewportSelection(
      state,
      getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
      state.preview?.target ?? null,
    )
  }

  if (state.kind === 'selectionCommand') {
    const result = handleSelectionCommandViewportSelection(state, event)
    if (result) {
      return result
    }
  }

  if (state.kind === 'editingFeature') {
    return handleEditingFeatureViewportSelection(state, event)
  }

  if (state.kind === 'importing') {
    return handleImportViewportSelection(state, event, dependencies)
  }

  if (state.kind === 'editingSketch') {
    return handleEditingSketchViewportSelection(state, event)
  }

  if (state.kind === 'inspectingSection') {
    return { state, effects: [] }
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
    }, 'sketchAuthoring')

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
  }, 'featureEdit')

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

export function handleSketchPlaneEditRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketchPlaneEdit.requested' }>,
): EditorTransitionResult {
  const nextState = createCommandState(
    state,
    'sketchPlaneEdit',
    'part',
    getDefaultSelectionFilterForMode('part'),
    {
      kind: 'selection',
      label: `Change sketch plane for ${event.target.sketchId}`,
      target: event.target,
    },
  )

  const session = state.snapshot
    ? hydrateSketchPlaneEditSession(state.snapshot, event.target.sketchId)
    : null

  if (!session) {
    return {
      state: withPreview(nextState, {
        kind: 'selection',
        label: `Sketch ${event.target.sketchId} does not support origin-plane reassignment.`,
        target: event.target,
      }),
      effects: [],
    }
  }

  if (canReopenSketchDirectlyFromCurrentCursor(state.snapshot, event.target)) {
    return {
      state: createSketchPlaneEditingState(
        {
          ...nextState,
          selection: [event.target],
          hoverTarget: event.target,
        },
        session,
      ),
      effects: [],
    }
  }

  const cursorContext = createEditSessionCursorContext(state.snapshot, {
    kind: 'sketch',
    sketchId: event.target.sketchId,
  }, 'sketchPlaneEdit')

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
