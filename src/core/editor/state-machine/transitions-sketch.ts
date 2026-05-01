import { isRegisteredSketchToolId } from '@/core/sketch-tools/registry'
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  clearActiveSketchTool,
  deleteSelectedSketchAnnotation,
  deleteSelectedSketchGeometry,
  deleteSketchHistoryOperation,
  deleteSketchReferenceTarget,
  finishSketchGeometryDrag,
  getConnectedSketchEntitySelectionTargets,
  getSketchSessionPreviewLabel,
  isEditableSketchGeometrySelection,
  moveSketchHistoryCursor,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  patchSketchDrawingToolValue,
  patchSketchEditToolValue,
  patchSketchStyleValue,
  pinSketchConstraintPreview,
  shouldDeferSketchConstraintPreviewPinToSelection,
  startSketchDraw,
  updateSketchGeometryDrag,
  updateSketchPointer,
} from '@/domain/editor/sketch-session'
import {
  enterSketchSpecialMode,
  getSketchSpecialModeSelectionFilter,
  handleSketchSpecialModeClick,
  handleSketchSpecialModeDoubleClick,
  handleSketchSpecialModeDragEnd,
  handleSketchSpecialModeDragMove,
  handleSketchSpecialModeDragStart,
  handleSketchSpecialModePanelAction,
  resolveSketchSpecialModeOpenRequest,
  sketchSessionHasActiveSpecialMode,
} from '@/core/sketch-special-modes/presentation'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import {
  getDefaultSelectionFilterForMode,
} from '@/core/editor/schema'
import type {
  EditorEvent,
  EditorTransitionResult,
  SketchEditorState,
  EditorState,
} from './types'
import type { EditorExtensionDependencies } from './dependencies'
import {
  emitSketchReferenceImageImportWithPayloads,
  emitSketchReferenceProjection,
  emitSketchSpecialModeEffect,
} from './effect-emitters'
import { withPreview } from './state-creators'
import {
  deriveSketchPointFromWorld,
  nextRequestId,
} from './utility-helpers'

export function handleSketchPointerMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.pointerMoved' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = updateSketchPointer(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
  )

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: session.status === 'drawing' ? 'editing' : 'collecting',
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

export function handleSketchPointerReleased(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.pointerReleased' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const point = deriveSketchPointFromWorld(state.session.plane, event.point)
  const session =
    state.session.constraintAuthoring
      ? shouldDeferSketchConstraintPreviewPinToSelection(state.session, event.target)
        ? state.session
        : pinSketchConstraintPreview(state.session, point)
      : state.session.status === 'drawing'
      ? acceptSketchDraw(state.session, point)
      : startSketchDraw(state.session, point)

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: session.status === 'drawing' ? 'editing' : 'collecting',
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

export function handleSketchToolPatched(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.toolPatched' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  if (event.patch.intent === 'setDimensionAnnotationPlacement') {
    const session = patchSketchDimensionAnnotationPlacement(state.session, event.patch)

    return {
      state: {
        ...state,
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

  if (state.session.constraintAuthoring || state.session.activeAnnotationEdit) {
    const session = patchSketchConstraintValue(state.session, event.patch)

    return {
      state: {
        ...state,
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

  if (state.session.activeEditTool) {
    const session = patchSketchEditToolValue(state.session, event.patch)

    return {
      state: {
        ...state,
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
    event.patch.intent === 'setToolSetting'
    && state.session.activeTool
    && isRegisteredSketchToolId(state.session.activeTool)
  ) {
    const session = patchSketchDrawingToolValue(state.session, event.patch)

    return {
      state: {
        ...state,
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

  {
    const session = patchSketchStyleValue(state.session, state.selection, event.patch)

    return {
      state: {
        ...state,
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
}

export function handleSketchActiveToolCleared(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = clearActiveSketchTool(state.session)

  return {
    state: {
      ...state,
      selection: [],
      hoverTarget: null,
      session,
      command: {
        ...state.command,
        toolId: 'sketch',
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

export function handleSketchHistoryCursorRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.historyCursorRequested' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = moveSketchHistoryCursor(state.session, event.cursor)

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

export function handleSketchHistoryOperationDeleteRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.historyOperationDeleteRequested' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = deleteSketchHistoryOperation(state.session, event.operationId)

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

export function handleSketchAnnotationDeleteRequested(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const selected = state.selection[0] ?? null
  const referenceTarget = selected
    && (selected.kind === 'projectedReferenceGeometry' || selected.kind === 'sketchExternalReference')
    ? selected
    : null
  const session = referenceTarget
    ? deleteSketchReferenceTarget(state.session, referenceTarget)
    : isEditableSketchGeometrySelection(state.session, state.selection)
      ? deleteSelectedSketchGeometry(state.session, state.selection)
      : deleteSelectedSketchAnnotation(state.session)
  const nextState: SketchEditorState = {
    ...state,
    selection: [],
    hoverTarget: null,
    session,
    preview: {
      kind: 'sketch',
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  }

  return referenceTarget
    ? emitSketchReferenceProjection(nextState, session)
    : { state: nextState, effects: [] }
}

export function handleSketchAnnotationEditRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.annotationEditRequested' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = beginSketchAnnotationEdit(state.session, event.target)

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

export function handleSketchConnectedSelectionRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.connectedSelectionRequested' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'editingSketch'
    || sketchSessionHasActiveSpecialMode(state.session)
    || !(
      state.session.activeTool === null
      || (state.session.status === 'idle' && isRegisteredSketchToolId(state.session.activeTool))
    )
    || state.session.constructionTargetPicking
    || state.session.referenceTargetPicking
    || state.session.constraintAuthoring
    || state.session.activeEditTool
    || state.session.activeStyleFocus
  ) {
    return { state, effects: [] }
  }

  const targets = getConnectedSketchEntitySelectionTargets(state.session, event.target)

  if (targets.length === 0) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      selection: targets,
      hoverTarget: event.target,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(state.session),
        target: state.session.planeTarget,
      },
    },
    effects: [],
  }
}

export function handleSketchGeometryDragStarted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.geometryDragStarted' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const point = deriveSketchPointFromWorld(state.session.plane, event.point)
  const session = beginSketchGeometryDrag(state.session, event.target, point)

  return {
    state: {
      ...state,
      selection: event.target.kind === 'sketchPoint' ? [event.target] : state.selection,
      hoverTarget: event.target.kind === 'sketchPoint' ? event.target : state.hoverTarget,
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

export function handleSketchGeometryDragMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.geometryDragMoved' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = updateSketchGeometryDrag(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
  )

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
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  }
}

export function handleSketchGeometryDragEnded(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.geometryDragEnded' }>,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const session = finishSketchGeometryDrag(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
  )

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

export function handleSketchReferenceImagePayloadsPicked(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.referenceImagePayloadsPicked' }>,
  _transitionEditorState: (state: EditorState, event: EditorEvent) => EditorTransitionResult,
): EditorTransitionResult {
  if (state.kind === 'selectionCommand' && (state.command.toolId === 'sketch' || state.command.toolId === 'importImage')) {
    const session = state.snapshot
      ? openSketchSessionFromSelection(state.selection.slice(), state.snapshot)
      : null

    if (!session) {
      return { state, effects: [] }
    }

    const nextState: SketchEditorState = {
      kind: 'editingSketch',
      mode: 'sketch',
      document: state.document,
      snapshot: state.snapshot,
      previewRenderables: null,
      selection:
        session.sketchId === null
          ? [session.planeTarget]
          : [{ kind: 'sketch', sketchId: session.sketchId }],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: state.selectionCatalog,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      nextCommandSequence: state.nextCommandSequence,
      nextRequestSequence: state.nextRequestSequence,
      pendingSnapshotRequestId: state.pendingSnapshotRequestId,
      pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
      editSessionCursorContext: state.editSessionCursorContext,
      command: {
        ...state.command,
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    return !event.payloads || event.payloads.length === 0
      ? {
        state: {
          ...nextState,
          preview: {
            kind: 'sketch',
            label: event.message ?? getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
          session: event.message
            ? {
              ...session,
              validationMessage: event.message,
            }
            : session,
        },
        effects: [],
      }
      : emitSketchReferenceImageImportWithPayloads(nextState, event.payloads)
  }

  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  if (!event.payloads || event.payloads.length === 0) {
    return {
      state: {
        ...state,
        command: {
          ...state.command,
          phase: 'editing',
        },
        preview: {
          kind: 'sketch',
          label: event.message ?? getSketchSessionPreviewLabel(state.session),
          target: state.session.planeTarget,
        },
        session: event.message
          ? {
            ...state.session,
            validationMessage: event.message,
          }
          : state.session,
      },
      effects: [],
    }
  }

  return emitSketchReferenceImageImportWithPayloads(state, event.payloads)
}

export function handleSketchSpecialModeEntered(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModeEntered' }>,
  transitionEditorState: (state: EditorState, event: EditorEvent) => EditorTransitionResult,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind === 'selectionCommand' && (state.command.toolId === 'sketch' || state.command.toolId === 'importImage')) {
    const session = state.snapshot
      ? openSketchSessionFromSelection(state.selection.slice(), state.snapshot)
      : null

    if (!session) {
      return {
        state: withPreview(state, {
          kind: 'sketch',
          label: 'Reference-image import requires an active sketch plane.',
          target: state.selection[0] ?? null,
        }),
        effects: [],
      }
    }

    const nextState: SketchEditorState = {
      kind: 'editingSketch',
      mode: 'sketch',
      document: state.document,
      snapshot: state.snapshot,
      previewRenderables: null,
      selection:
        session.sketchId === null
          ? [session.planeTarget]
          : [{ kind: 'sketch', sketchId: session.sketchId }],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: state.selectionCatalog,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      nextCommandSequence: state.nextCommandSequence,
      nextRequestSequence: state.nextRequestSequence,
      pendingSnapshotRequestId: state.pendingSnapshotRequestId,
      pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
      editSessionCursorContext: state.editSessionCursorContext,
      command: {
        ...state.command,
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    return transitionEditorState(nextState, event)
  }

  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  const requestId = nextRequestId(state, 'sketch-special-enter')
  const session = enterSketchSpecialMode({
    session: state.session,
    registry: dependencies.sketchSpecialModes,
    modeId: event.modeId,
    operationId: event.operationId,
    payload: event.payload,
    requestId,
  })

  return emitSketchSpecialModeEffect({
    ...state,
    selection: [session.activeSpecialMode?.operationTarget ?? state.selection[0]].flatMap((target) => target ? [target] : []),
    hoverTarget: null,
    selectionFilter:
      getSketchSpecialModeSelectionFilter(session, dependencies.sketchSpecialModes)
      ?? getDefaultSelectionFilterForMode('sketch'),
  }, session, requestId, dependencies)
}

export function handleSketchSpecialModePanelActionInvoked(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModePanelActionInvoked' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch' || !sketchSessionHasActiveSpecialMode(state.session)) {
    return { state, effects: [] }
  }

  const requestId = nextRequestId(state, 'sketch-special-panel')
  const session = handleSketchSpecialModePanelAction(
    state.session,
    event.action,
    dependencies.sketchSpecialModes,
    requestId,
  )

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies)
}

export function handleSketchSpecialModeClickRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModeClickRequested' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch' || !sketchSessionHasActiveSpecialMode(state.session)) {
    return { state, effects: [] }
  }

  const requestId = nextRequestId(state, 'sketch-special-click')
  const session = handleSketchSpecialModeClick(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    event.target ?? null,
    state.selection,
    state.selectionCatalog,
    dependencies.sketchSpecialModes,
    requestId,
  )

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies)
}

export function handleSketchSpecialModeDoubleClickRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModeDoubleClickRequested' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch') {
    return { state, effects: [] }
  }

  if (!sketchSessionHasActiveSpecialMode(state.session)) {
    const point = deriveSketchPointFromWorld(state.session.plane, event.point)
    const request = resolveSketchSpecialModeOpenRequest({
      sketchSession: state.session,
      point,
      target: event.target ?? null,
      selection: state.selection,
      selectionCatalog: state.selectionCatalog,
    }, dependencies.sketchSpecialModes)

    if (!request) {
      return { state, effects: [] }
    }

    const requestId = nextRequestId(state, 'sketch-special-enter')
    const session = enterSketchSpecialMode({
      session: state.session,
      registry: dependencies.sketchSpecialModes,
      modeId: request.modeId,
      operationId: request.operationId,
      payload: request.payload,
      requestId,
    })

    return emitSketchSpecialModeEffect({
      ...state,
      selection: [session.activeSpecialMode?.operationTarget ?? state.selection[0]].flatMap((target) => target ? [target] : []),
      hoverTarget: null,
      selectionFilter:
        getSketchSpecialModeSelectionFilter(session, dependencies.sketchSpecialModes)
        ?? getDefaultSelectionFilterForMode('sketch'),
    }, session, requestId, dependencies)
  }

  const requestId = nextRequestId(state, 'sketch-special-double-click')
  const session = handleSketchSpecialModeDoubleClick(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    event.target ?? null,
    state.selection,
    state.selectionCatalog,
    dependencies.sketchSpecialModes,
    requestId,
  )

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies)
}

export function handleSketchSpecialModeDragStarted(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModeDragStarted' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch' || !sketchSessionHasActiveSpecialMode(state.session)) {
    return { state, effects: [] }
  }

  const requestId = nextRequestId(state, 'sketch-special-drag-start')
  const session = handleSketchSpecialModeDragStart(
    state.session,
    event.handle,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    dependencies.sketchSpecialModes,
    requestId,
  )

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies)
}

export function handleSketchSpecialModeDragMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModeDragMoved' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch' || !sketchSessionHasActiveSpecialMode(state.session)) {
    return { state, effects: [] }
  }

  const requestId = nextRequestId(state, 'sketch-special-drag-move')
  const session = handleSketchSpecialModeDragMove(
    state.session.activeSpecialMode?.activeDragHandle?.handleId === event.handle.handleId
      ? state.session
      : {
          ...state.session,
          activeSpecialMode: state.session.activeSpecialMode
            ? {
                ...state.session.activeSpecialMode,
                activeDragHandle: event.handle,
              }
            : null,
        },
    deriveSketchPointFromWorld(state.session.plane, event.point),
    dependencies.sketchSpecialModes,
    requestId,
  )

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies)
}

export function handleSketchSpecialModeDragEnded(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'sketch.specialModeDragEnded' }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== 'editingSketch' || !sketchSessionHasActiveSpecialMode(state.session)) {
    return { state, effects: [] }
  }

  const requestId = nextRequestId(state, 'sketch-special-drag-end')
  const session = handleSketchSpecialModeDragEnd(
    state.session.activeSpecialMode?.activeDragHandle?.handleId === event.handle.handleId
      ? state.session
      : {
          ...state.session,
          activeSpecialMode: state.session.activeSpecialMode
            ? {
                ...state.session.activeSpecialMode,
                activeDragHandle: event.handle,
              }
            : null,
        },
    deriveSketchPointFromWorld(state.session.plane, event.point),
    dependencies.sketchSpecialModes,
    requestId,
  )

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies)
}
