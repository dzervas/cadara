import type { RequestId, SketchAuthoringOperationId, SketchId } from '@/contracts/shared/ids'
import type { SketchOperationRef } from '@/contracts/shared/references'
import type { SketchSessionState } from '@/domain/editor/sketch-session'
import { sketchSelectionFilter, type PrimitiveRef, type SelectionFilter, type SelectionTargetCatalog } from '@/domain/editor/schema'
import type { SketchSpecialModeRegistry } from '@/domain/sketch-special-modes/registry'
import type {
  ActiveSketchSpecialModeSession,
  SketchSpecialModeDefinition,
  SketchSpecialModeEffectRequest,
  SketchSpecialModeHandleRef,
  SketchSpecialModeId,
  SketchSpecialModeOpenContext,
  SketchSpecialModeOperationOwnedStateOverride,
  SketchSpecialModePanelAction,
  SketchSpecialModePanelSchema,
  SketchSpecialModeTargetRef,
  SketchSpecialModeTransition,
  SketchSpecialModeViewportPresentation,
} from '@/domain/sketch-special-modes/schema'

function getSessionSketchId(session: SketchSessionState) {
  return (session.sketchId ?? 'sketch_draft') as SketchId
}

function createOperationTarget(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
): SketchOperationRef {
  return {
    kind: 'sketchOperation',
    sketchId,
    operationId,
  }
}

function resolveDefinition(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
): {
  activeMode: ActiveSketchSpecialModeSession
  definition: SketchSpecialModeDefinition
} | null {
  const activeMode = session.activeSpecialMode
  if (!activeMode || !registry.has(activeMode.modeId)) {
    return null
  }

  return {
    activeMode,
    definition: registry.get(activeMode.modeId),
  }
}

function scrubSessionForSpecialMode(session: SketchSessionState): SketchSessionState {
  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    validationMessage: null,
  }
}

function applyTransition(
  session: SketchSessionState,
  transition: SketchSpecialModeTransition | null | undefined,
  requestId?: RequestId | null,
): SketchSessionState {
  if (!transition) {
    return session
  }

  const baseSession = transition.session ?? session

  if (transition.exit && !transition.effect) {
    return {
      ...baseSession,
      activeSpecialMode: null,
    }
  }

  const activeMode = baseSession.activeSpecialMode
  if (!activeMode) {
    return baseSession
  }

  const nextGeneration = activeMode.generation + (transition.state !== undefined || transition.effect ? 1 : 0)
  const nextMode: ActiveSketchSpecialModeSession = {
    ...activeMode,
    state: transition.state ?? activeMode.state,
    generation: nextGeneration,
    hoverTarget: transition.hoverTarget !== undefined ? transition.hoverTarget : activeMode.hoverTarget,
    selectedTarget: transition.selectedTarget !== undefined ? transition.selectedTarget : activeMode.selectedTarget,
    activeDragHandle:
      transition.activeDragHandle !== undefined ? transition.activeDragHandle : activeMode.activeDragHandle,
    pendingEffect:
      transition.effect && requestId
        ? {
            requestId,
            generation: nextGeneration,
            effect: transition.effect,
          }
        : transition.effect === null
          ? null
          : activeMode.pendingEffect,
    pendingExit: transition.exit ? true : activeMode.pendingExit,
  }

  return {
    ...baseSession,
    activeSpecialMode: nextMode,
    validationMessage: null,
  }
}

export function sketchSessionHasActiveSpecialMode(session: SketchSessionState) {
  return session.activeSpecialMode !== null
}

export function getSketchSpecialModeSummaryLabel(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return null
  }

  return `Editing ${resolved.definition.label}`
}

export function enterSketchSpecialMode(input: {
  session: SketchSessionState
  registry: SketchSpecialModeRegistry
  modeId: SketchSpecialModeId
  operationId: SketchAuthoringOperationId
  payload?: Record<string, unknown>
  requestId?: RequestId
}): SketchSessionState {
  if (!input.registry.has(input.modeId)) {
    return {
      ...input.session,
      validationMessage: `Sketch special mode ${input.modeId} is not registered.`,
    }
  }

  const operationExists = input.session.definition.authoringOperations?.some(
    (operation) => operation.operationId === input.operationId,
  ) ?? false

  if (!operationExists) {
    return {
      ...input.session,
      validationMessage: `Sketch operation ${input.operationId} is not available for special editing.`,
    }
  }

  const sketchId = getSessionSketchId(input.session)
  const operationTarget = createOperationTarget(sketchId, input.operationId)
  const definition = input.registry.get(input.modeId)
  const entered = definition.enter({
    sketchSession: input.session,
    operationTarget,
    payload: input.payload,
  })
  const baseSession = scrubSessionForSpecialMode(input.session)

  return {
    ...baseSession,
    activeSpecialMode: {
      modeId: input.modeId,
      operationTarget,
      state: entered.state,
      generation: entered.effect ? 1 : 0,
      hoverTarget: null,
      selectedTarget: null,
      activeDragHandle: null,
      pendingEffect:
        entered.effect && input.requestId
          ? {
              requestId: input.requestId,
              generation: 1,
              effect: entered.effect,
            }
          : null,
      pendingExit: false,
    },
  }
}

export function resolveSketchSpecialModeOpenRequest(
  input: SketchSpecialModeOpenContext,
  registry: SketchSpecialModeRegistry,
): {
  modeId: SketchSpecialModeId
  operationId: SketchAuthoringOperationId
  payload?: Record<string, unknown>
} | null {
  for (const definition of registry.getAll()) {
    const request = definition.resolveOpenRequest?.(input)
    if (!request) {
      continue
    }

    return {
      modeId: definition.id,
      operationId: request.operationId,
      payload: request.payload,
    }
  }

  return null
}

function resolveSketchSpecialModeSelectionInput(
  session: SketchSessionState,
  target: PrimitiveRef,
  selection: readonly PrimitiveRef[],
  selectionCatalog: SelectionTargetCatalog | null,
  registry: SketchSpecialModeRegistry,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return null
  }

  return {
    resolved,
    input: {
      sketchSession: session,
      activeMode: resolved.activeMode,
      target,
      selection,
      selectionCatalog,
    },
  }
}

export function resolveSketchSpecialModeTarget(
  session: SketchSessionState,
  target: PrimitiveRef | null,
  selection: readonly PrimitiveRef[],
  selectionCatalog: SelectionTargetCatalog | null,
  registry: SketchSpecialModeRegistry,
) {
  if (!target) {
    return null
  }

  const resolvedSelection = resolveSketchSpecialModeSelectionInput(
    session,
    target,
    selection,
    selectionCatalog,
    registry,
  )

  if (!resolvedSelection) {
    return null
  }

  const { resolved, input } = resolvedSelection
  return resolved.definition.selection?.resolveTarget?.(input) ?? null
}

export function doesSketchSpecialModeAcceptTarget(
  session: SketchSessionState,
  target: PrimitiveRef | null,
  selection: readonly PrimitiveRef[],
  selectionCatalog: SelectionTargetCatalog | null,
  registry: SketchSpecialModeRegistry,
) {
  if (!target) {
    return false
  }

  const resolvedSelection = resolveSketchSpecialModeSelectionInput(
    session,
    target,
    selection,
    selectionCatalog,
    registry,
  )

  if (!resolvedSelection) {
    return false
  }

  const { resolved, input } = resolvedSelection
  const selectionContract = resolved.definition.selection

  if (selectionContract?.allowedKinds && !selectionContract.allowedKinds.includes(target.kind)) {
    return false
  }

  if (selectionContract?.acceptsTarget && !selectionContract.acceptsTarget(input)) {
    return false
  }

  return selectionContract
    ? selectionContract.resolveTarget?.(input) !== null || !selectionContract.resolveTarget
    : sketchSelectionFilter.allowedKinds.includes(target.kind)
}

export function getSketchSpecialModeSelectionFilter(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
): SelectionFilter | null {
  const resolved = resolveDefinition(session, registry)
  const selectionContract = resolved?.definition.selection

  if (!selectionContract) {
    return null
  }

  const allowedKinds = selectionContract.allowedKinds ?? sketchSelectionFilter.allowedKinds
  const label = selectionContract.label ?? resolved.definition.label
  const description = selectionContract.description ?? `Select a ${resolved.definition.label} target.`

  return {
    kind: 'sketchSession',
    allowedKinds,
    label,
    requirements: [{
      id: `sketch-special-mode:${resolved.definition.id}`,
      label,
      description,
      slots: [{
        id: `sketch-special-mode:${resolved.definition.id}:target`,
        label,
        description,
        acceptedKinds: allowedKinds,
        acceptedSemantics: [],
      }],
    }],
  }
}

export function cancelSketchSpecialMode(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.cancel?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
    }) ?? { exit: true },
    requestId,
  )
}

export function commitSketchSpecialMode(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.commit?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
    }) ?? { exit: true },
    requestId,
  )
}

export function exitSketchSpecialMode(session: SketchSessionState) {
  if (!session.activeSpecialMode) {
    return session
  }

  return {
    ...session,
    activeSpecialMode: null,
  }
}

export function handleSketchSpecialModeHover(
  session: SketchSessionState,
  target: PrimitiveRef | null,
  selection: readonly PrimitiveRef[],
  selectionCatalog: SelectionTargetCatalog | null,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.handleHover?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
      target,
      resolvedTarget: resolveSketchSpecialModeTarget(session, target, selection, selectionCatalog, registry),
    }),
    requestId,
  )
}

export function handleSketchSpecialModeClick(
  session: SketchSessionState,
  point: import('@/contracts/modeling/schema').SketchPoint,
  target: PrimitiveRef | null,
  selection: readonly PrimitiveRef[],
  selectionCatalog: SelectionTargetCatalog | null,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.handleClick?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
      point,
      target,
      resolvedTarget: resolveSketchSpecialModeTarget(session, target, selection, selectionCatalog, registry),
    }),
    requestId,
  )
}

export function handleSketchSpecialModeDoubleClick(
  session: SketchSessionState,
  point: import('@/contracts/modeling/schema').SketchPoint,
  target: PrimitiveRef | null,
  selection: readonly PrimitiveRef[],
  selectionCatalog: SelectionTargetCatalog | null,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.handleDoubleClick?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
      point,
      target,
      resolvedTarget: resolveSketchSpecialModeTarget(session, target, selection, selectionCatalog, registry),
    }),
    requestId,
  )
}

export function handleSketchSpecialModeDragStart(
  session: SketchSessionState,
  handle: SketchSpecialModeHandleRef,
  point: import('@/contracts/modeling/schema').SketchPoint,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    {
      activeDragHandle: handle,
      ...(resolved.definition.handleDragStart?.({
        sketchSession: session,
        activeMode: resolved.activeMode,
        handle,
        point,
      }) ?? {}),
    },
    requestId,
  )
}

export function handleSketchSpecialModeDragMove(
  session: SketchSessionState,
  point: import('@/contracts/modeling/schema').SketchPoint,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)
  const handle = session.activeSpecialMode?.activeDragHandle

  if (!resolved || !handle) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.handleDragMove?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
      handle,
      point,
    }),
    requestId,
  )
}

export function handleSketchSpecialModeDragEnd(
  session: SketchSessionState,
  point: import('@/contracts/modeling/schema').SketchPoint,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  const resolved = resolveDefinition(session, registry)
  const handle = session.activeSpecialMode?.activeDragHandle

  if (!resolved || !handle) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.handleDragEnd?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
      handle,
      point,
    }),
    requestId,
  )
}

export function handleSketchSpecialModePanelAction(
  session: SketchSessionState,
  action: SketchSpecialModePanelAction,
  registry: SketchSpecialModeRegistry,
  requestId?: RequestId,
) {
  if (action.kind === 'command') {
    if (action.command === 'cancel') {
      return cancelSketchSpecialMode(session, registry, requestId)
    }
    if (action.command === 'commit') {
      return commitSketchSpecialMode(session, registry, requestId)
    }
    return exitSketchSpecialMode(session)
  }

  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return session
  }

  return applyTransition(
    session,
    resolved.definition.handlePanelAction?.({
      sketchSession: session,
      activeMode: resolved.activeMode,
      action,
    }),
    requestId,
  )
}

export function resolveSketchSpecialModeEffectRequest(session: SketchSessionState): SketchSpecialModeEffectRequest | null {
  return session.activeSpecialMode?.pendingEffect?.effect ?? null
}

export function getSketchSpecialModeOperationOwnedStateOverride(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
): SketchSpecialModeOperationOwnedStateOverride | null {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return null
  }

  return resolved.definition.getOperationOwnedStateOverride?.({
    sketchSession: session,
    activeMode: resolved.activeMode,
  }) ?? null
}

export function applySketchSpecialModeEffectResult(input: {
  session: SketchSessionState
  requestId: RequestId
  effectId: string
  payload: Record<string, unknown>
  registry: SketchSpecialModeRegistry
}) {
  const resolved = resolveDefinition(input.session, input.registry)
  const pendingEffect = input.session.activeSpecialMode?.pendingEffect

  if (
    !resolved
    || !pendingEffect
    || pendingEffect.requestId !== input.requestId
    || pendingEffect.effect.effectId !== input.effectId
  ) {
    return input.session
  }

  const transitioned = applyTransition(
    input.session,
    resolved.definition.handleEffectResult?.({
      sketchSession: input.session,
      activeMode: resolved.activeMode,
      effectId: input.effectId,
      payload: input.payload,
    }) ?? { effect: null },
  )

  if (!transitioned.activeSpecialMode) {
    return transitioned
  }

  if (transitioned.activeSpecialMode.pendingExit && transitioned.activeSpecialMode.pendingEffect === null) {
    return {
      ...transitioned,
      activeSpecialMode: null,
    }
  }

  return {
    ...transitioned,
    activeSpecialMode: {
      ...transitioned.activeSpecialMode,
      pendingEffect: null,
      pendingExit: false,
    },
  }
}

export function getSketchSpecialModePanel(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
): SketchSpecialModePanelSchema | null {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return null
  }

  return resolved.definition.buildPanel?.({
    sketchSession: session,
    activeMode: resolved.activeMode,
  }) ?? null
}

export function getSketchSpecialModeViewportPresentation(
  session: SketchSessionState,
  registry: SketchSpecialModeRegistry,
): SketchSpecialModeViewportPresentation | null {
  const resolved = resolveDefinition(session, registry)

  if (!resolved) {
    return null
  }

  return resolved.definition.buildViewport?.({
    sketchSession: session,
    activeMode: resolved.activeMode,
  }) ?? null
}

export function createSketchSpecialModeTargetRef(
  operationId: SketchAuthoringOperationId,
  targetId: string,
): SketchSpecialModeTargetRef {
  return {
    kind: 'sketchSpecialTarget',
    operationId,
    targetId: `sketch_special_target_${targetId}` as const,
  }
}

export function createSketchSpecialModeHandleRef(
  operationId: SketchAuthoringOperationId,
  handleId: string,
): SketchSpecialModeHandleRef {
  return {
    kind: 'sketchSpecialHandle',
    operationId,
    handleId: `sketch_special_handle_${handleId}` as const,
  }
}
