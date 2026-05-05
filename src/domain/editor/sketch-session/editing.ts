import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  SketchAuthoringOperation,
  SketchDefinition,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  solveSketchDefinitionWithDraggedPointTarget,
  updateCompiledSketchSolveSession,
  type SketchCompiledSolveSession,
} from '@/contracts/sketch/solver-core'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import {
  type PrimitiveRef,
  primitiveRefEquals,
} from '@/core/editor/schema'
import {
  collectActiveReferenceImageOperations,
  createReferenceImageDeleteOperation,
} from '@/domain/reference-image/operations'
import {
  getSketchEditToolDefinition,
} from '@/core/sketch-edit-tools/registry'
import {
  type OffsetCurveDescriptor,
  type SketchEditOperationResult,
  createOffsetContribution,
  createSketchChamferMutation,
  createSketchDerivedTransformContribution,
  createSketchExtendMutation,
  createSketchFilletMutation,
  createSketchSlotContribution,
  createSketchSplitMutation,
  offsetCurveDescriptorFromProjectedGeometry,
  trimLineSegmentAtIntersections,
} from '@/domain/sketch-editing/operations'
import type {
  SketchEditToolState,
  SketchHistoryCursor,
  SketchHistoryItem,
  SketchHistoryOperation,
  SketchSessionState,
} from './types'
import {
  CONSTRAINED_DRAG_BLOCKED_MESSAGE,
  SKETCH_DIRECT_EDIT_TOLERANCES,
  applySketchHistoryContribution,
  cloneDefinition,
  createArcEntityDefinition,
  createDeleteAuthoringOperation,
  createEntityId,
  createLineEntityDefinition,
  createPointDefinition,
  createPointId,
  createSessionCommitFactories,
  createSplineEntityDefinition,
  deriveSolvedRegionsForSession,
  filterSketchDefinitionThroughCursor,
  getAppendBaseAuthoringOperations,
  getEntityPointIds,
  isDrawingSketchTool,
  rebuildSessionCommitRequest,
  rebuildSessionForDefinition,
  sketchHistoryCursorsEqual,
} from './internals'
import {
  appendReferenceImageOperations,
  updateReferenceImageOperationStates,
} from './references'
import {
  constraintReferencesSketchGeometry,
  dimensionReferencesSketchGeometry,
} from './state'
import {
  buildSketchEditToolPresentation,
  selectSketchEditTarget,
} from './tools'
import {
  applyPointPositionsToDefinition,
} from './definition-patches'
import {
  createTailSketchHistoryCursor,
  getSketchHistoryItems,
} from './history'
import {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
} from './selection'

export function getOperationOwnedStateTargetIds(operation: SketchAuthoringOperation) {
  return [
    ...(operation.targets.edited ?? []),
    ...(operation.targets.removed ?? []),
  ].flatMap((target) => target.kind === 'operation' ? [target.operationId] : [])
}

export function pruneDirectOperationDependents(
  operations: readonly SketchAuthoringOperation[],
  removedOperationIds: ReadonlySet<SketchAuthoringOperationId>,
) {
  const pendingRemovedIds = new Set(removedOperationIds)
  let remainingOperations = [...operations]
  let pruned = true

  while (pruned) {
    pruned = false
    remainingOperations = remainingOperations.filter((operation) => {
      const operationTargetIds = getOperationOwnedStateTargetIds(operation)
      if (
        operationTargetIds.length === 0
        || !operationTargetIds.every((targetOperationId) => pendingRemovedIds.has(targetOperationId))
      ) {
        return true
      }

      pendingRemovedIds.add(operation.operationId)
      pruned = true
      return false
    })
  }

  return remainingOperations
}

export function repairSketchHistoryCursorAfterOperationRemoval(
  previousItems: readonly SketchHistoryItem[],
  previousCursor: SketchHistoryCursor,
  remainingOperationIds: ReadonlySet<SketchAuthoringOperationId>,
): SketchHistoryCursor {
  if (previousCursor.kind === 'empty') {
    return previousCursor
  }

  if (remainingOperationIds.has(previousCursor.itemId as SketchAuthoringOperationId)) {
    return previousCursor
  }

  const previousCursorIndex = previousItems.findIndex((item) => item.id === previousCursor.itemId)
  for (let index = previousCursorIndex - 1; index >= 0; index -= 1) {
    const item = previousItems[index]
    if (item && remainingOperationIds.has(item.id as SketchAuthoringOperationId)) {
      return { kind: 'item', itemId: item.id }
    }
  }

  return { kind: 'empty' }
}

export function createEmptyAuthoringReplayDefinition(definition: SketchDefinition): SketchDefinition {
  return {
    ...cloneDefinition(definition),
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
    derivedRelationships: [],
    authoringOperations: [],
  }
}

export function deleteSelectedSketchGeometry(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
): SketchSessionState {
  const selectedReferenceImageOperationIds = getSelectedReferenceImageOperationIds(session, targets)
  let nextSession = session

  if (selectedReferenceImageOperationIds.length > 0) {
    nextSession = appendReferenceImageOperations(nextSession, [
      createReferenceImageDeleteOperation({
        sequence: nextSession.sequence + 1,
        removedOperationIds: selectedReferenceImageOperationIds,
      }),
    ])
    nextSession = {
      ...nextSession,
      activeTool: null,
      status: 'idle',
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      pointerDownPoint: null,
      livePoint: null,
      toolPlacedPoints: [],
      toolSettings: {},
      toolPresentation: null,
      constraintAuthoring: null,
      activeEditTool: null,
      activeStyleFocus: null,
      activeSnap: null,
      drawStartSnap: null,
      sequence: nextSession.sequence + 1,
    }
  }

  const selected = getSelectedSketchGeometryIds(nextSession, targets)

  if (!selected) {
    return nextSession
  }

  const beforeDefinition = cloneDefinition(nextSession.definition)
  const deletedEntityIds = new Set(selected.entityIds)
  for (const entity of beforeDefinition.entities) {
    if (getEntityPointIds(entity).some((pointId) => selected.pointIds.has(pointId))) {
      deletedEntityIds.add(entity.entityId)
    }
  }

  const remainingEntities = beforeDefinition.entities.filter((entity) => !deletedEntityIds.has(entity.entityId))
  const remainingEntityPointIds = new Set(remainingEntities.flatMap((entity) => getEntityPointIds(entity)))
  const deletedPointIds = new Set<SketchPointId>(
    beforeDefinition.pointIds.filter((pointId) =>
      selected.pointIds.has(pointId) || !remainingEntityPointIds.has(pointId),
    ),
  )
  const points = beforeDefinition.points.filter((point) => !deletedPointIds.has(point.pointId))
  const constraints = beforeDefinition.constraints.filter((constraint) =>
    !constraintReferencesSketchGeometry(constraint, deletedPointIds, deletedEntityIds),
  )
  const dimensions = beforeDefinition.dimensions.filter((dimension) =>
    !dimensionReferencesSketchGeometry(dimension, deletedPointIds, deletedEntityIds),
  )
  const remainingConstraintIds = new Set(constraints.map((constraint) => constraint.constraintId))
  const remainingDimensionIds = new Set(dimensions.map((dimension) => dimension.dimensionId))
  const deleteOperation = createDeleteAuthoringOperation({
    sequence: nextSession.sequence + 1,
    removedGraph: {
      points: beforeDefinition.points.filter((point) => deletedPointIds.has(point.pointId)),
      entities: beforeDefinition.entities.filter((entity) => deletedEntityIds.has(entity.entityId)),
      constraints: beforeDefinition.constraints.filter((constraint) => !remainingConstraintIds.has(constraint.constraintId)),
      dimensions: beforeDefinition.dimensions.filter((dimension) => !remainingDimensionIds.has(dimension.dimensionId)),
    },
  })
  const afterDefinition: SketchDefinition = {
    ...beforeDefinition,
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: remainingEntities.map((entity) => entity.entityId),
    entities: remainingEntities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
    authoringOperations: [
      ...getAppendBaseAuthoringOperations(beforeDefinition),
      deleteOperation,
    ],
  }
  const operation: SketchHistoryOperation = {
    itemId: deleteOperation.operationId,
    beforeCursor: nextSession.historyCursor,
    beforeDefinition,
    afterDefinition,
  }

  let rebuiltSession = rebuildSessionForDefinition(nextSession, {
      definition: afterDefinition,
      fullDefinition: afterDefinition,
      historyCursor: { kind: 'item', itemId: operation.itemId },
      historyOperations: [
        ...nextSession.historyOperations.filter((entry) =>
          !sketchHistoryCursorsEqual(entry.beforeCursor, nextSession.historyCursor),
        ),
        operation,
      ],
    })

  const referenceImageBindingUpdates = collectActiveReferenceImageOperations(rebuiltSession.definition)
    .map(({ operation: activeOperation, state }) => {
      const calibration = state.calibration
      if (!calibration) {
        return null
      }

      const anchors = calibration.anchors.filter((anchor) => !deletedPointIds.has(anchor.pointId as SketchPointId))
      return anchors.length === calibration.anchors.length
        ? null
        : {
            operationId: activeOperation.operationId,
            label: activeOperation.label,
            state: {
              ...state,
              calibration: {
                scaleMode: calibration.scaleMode,
                showExportedAnchorsInSketch: calibration.showExportedAnchorsInSketch,
                anchors,
              },
            },
          }
    })
    .filter((update): update is NonNullable<typeof update> => update !== null)

  if (referenceImageBindingUpdates.length > 0) {
    rebuiltSession = updateReferenceImageOperationStates({
      session: rebuiltSession,
      updates: referenceImageBindingUpdates,
    })
  }

  return {
    ...rebuiltSession,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeEditTool: null,
    activeStyleFocus: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: rebuiltSession.sequence,
  }
}

export function deleteSketchHistoryOperation(
  session: SketchSessionState,
  operationId: SketchAuthoringOperationId,
): SketchSessionState {
  const operations = session.fullDefinition.authoringOperations ?? []
  if (!operations.some((operation) => operation.operationId === operationId)) {
    return session
  }

  const previousItems = getSketchHistoryItems(session.fullDefinition)
  const survivingOperations = pruneDirectOperationDependents(
    operations.filter((operation) => operation.operationId !== operationId),
    new Set([operationId]),
  )
  const survivingOperationIds = new Set(survivingOperations.map((operation) => operation.operationId))
  const replayDefinition = {
    ...cloneDefinition(session.fullDefinition),
    authoringOperations: survivingOperations,
  }
  const fullDefinition = survivingOperations.length > 0
    ? filterSketchDefinitionThroughCursor(replayDefinition, createTailSketchHistoryCursor(replayDefinition))
    : createEmptyAuthoringReplayDefinition(session.fullDefinition)
  const historyCursor = repairSketchHistoryCursorAfterOperationRemoval(
    previousItems,
    session.historyCursor,
    survivingOperationIds,
  )
  const definition = filterSketchDefinitionThroughCursor(fullDefinition, historyCursor)

  return rebuildSessionForDefinition(session, {
    definition,
    fullDefinition,
    historyCursor,
    historyOperations: [],
  })
}

export function getOffsetPreview(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
) {
  const selectedTargets = activeEditTool.selectedTargets
  const sketchEntityTargets = selectedTargets
    .filter((target): target is Extract<PrimitiveRef, { kind: 'sketchEntity' }> => target.kind === 'sketchEntity')
  const projectedTarget = selectedTargets.length === 1 && selectedTargets[0]?.kind === 'projectedReferenceGeometry'
    ? selectedTargets[0]
    : null
  const projectedCurve = projectedTarget ? getOffsetCurveForProjectedTarget(session, projectedTarget) : null

  if (selectedTargets.length === 0) {
    return createOffsetContribution({
      definition: session.definition,
      entityIds: [],
      distance: null,
      side: activeEditTool.offsetSide,
      sequence: session.sequence + 1,
      factories: createSessionCommitFactories(session.sequence + 1, session.sketchId ?? ('sketch_draft' as SketchId)),
    })
  }

  const nextSequence = session.sequence + 1
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  return createOffsetContribution({
    definition: session.definition,
    entityIds: projectedCurve ? [] : sketchEntityTargets.map((target) => target.entityId),
    curve: projectedCurve ?? undefined,
    distance: activeEditTool.offsetDistance,
    side: activeEditTool.offsetSide,
    sequence: nextSequence,
    factories: createSessionCommitFactories(nextSequence, sketchId),
  })
}

export function getOffsetCurveForProjectedTarget(
  session: SketchSessionState,
  target: Extract<PrimitiveRef, { kind: 'projectedReferenceGeometry' }>,
): OffsetCurveDescriptor | null {
  const projectedReference = session.projectedReferences.find((entry) => entry.referenceId === target.referenceId)
  if (!projectedReference || projectedReference.status !== 'projected') {
    return null
  }

  const geometry = projectedReference.geometry.find((entry) =>
    entry.geometryId === target.geometryId && entry.kind === target.geometryKind,
  )
  return geometry ? offsetCurveDescriptorFromProjectedGeometry(geometry) : null
}

export function getSelectedSketchEntityIds(activeEditTool: SketchEditToolState): SketchEntityId[] {
  return activeEditTool.selectedTargets
    .filter((target): target is Extract<PrimitiveRef, { kind: 'sketchEntity' }> => target.kind === 'sketchEntity')
    .map((target) => target.entityId)
}

export function getSketchEditOperatorResult(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
): SketchEditOperationResult {
  const entityIds = getSelectedSketchEntityIds(activeEditTool)
  const nextSequence = session.sequence + 1
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const factories = createSessionCommitFactories(nextSequence, sketchId)

  switch (activeEditTool.toolId) {
    case 'sketchFillet':
      return createSketchFilletMutation({
        definition: session.definition,
        entityIds,
        radius: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'sketchChamfer':
      return createSketchChamferMutation({
        definition: session.definition,
        entityIds,
        distance: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'sketchExtend':
      return createSketchExtendMutation({
        definition: session.definition,
        entityIds,
        sequence: nextSequence,
        factories,
      })
    case 'sketchSplit':
      return createSketchSplitMutation({
        definition: session.definition,
        entityIds,
        sequence: nextSequence,
        factories,
      })
    case 'sketchSlot':
      return createSketchSlotContribution({
        definition: session.definition,
        entityIds,
        width: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'sketchMirror':
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: 'mirror',
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'sketchLinearPattern':
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: 'linearPattern',
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'sketchCircularPattern':
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: 'circularPattern',
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'sketchTransform':
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: 'transform',
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      })
    case 'trim':
    case 'offset':
      return {
        valid: false,
        message: null,
        definition: null,
        contribution: null,
        previewEntities: [],
      }
  }
}

export function applySketchEditOperationResult(
  session: SketchSessionState,
  result: SketchEditOperationResult,
) {
  const nextSequence = session.sequence + 1
  if (result.definition) {
    const historyCursor = createTailSketchHistoryCursor(result.definition)
    return {
      definition: result.definition,
      fullDefinition: cloneDefinition(result.definition),
      historyCursor,
      historyOperations: session.historyOperations,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, result.definition),
      solvedRegions: deriveSolvedRegionsForSession(session, result.definition),
    }
  }

  if (result.contribution) {
    const history = applySketchHistoryContribution(session, result.contribution)
    return {
      definition: history.definition,
      fullDefinition: history.fullDefinition,
      historyCursor: history.historyCursor,
      historyOperations: history.historyOperations,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, history.definition),
      solvedRegions: deriveSolvedRegionsForSession(session, history.definition),
    }
  }

  return null
}

export function updateSketchEditToolHover(
  session: SketchSessionState,
  target: PrimitiveRef | null,
): SketchSessionState {
  if (!session.activeEditTool) {
    return session
  }

  const activeEditTool = {
    ...session.activeEditTool,
    hoverTarget: target,
  }
  const preview = activeEditTool.toolId === 'offset'
    ? getOffsetPreview(session, activeEditTool)
    : activeEditTool.toolId === 'trim'
      ? null
      : getSketchEditOperatorResult(session, activeEditTool)

  return {
    ...session,
    activeEditTool,
    toolPresentation: buildSketchEditToolPresentation(
      activeEditTool,
      session.validationMessage,
      preview?.previewEntities ?? [],
    ),
  }
}

export function selectSketchEditToolTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  const activeEditTool = session.activeEditTool
  if (!activeEditTool) {
    return session
  }

  if (activeEditTool.toolId === 'trim') {
    if (target.kind !== 'sketchEntity') {
      return session
    }

    const nextSequence = session.sequence + 1
    const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
    const result = trimLineSegmentAtIntersections({
      definition: session.definition,
      entityId: target.entityId,
      nextPointId: (suffix) => createPointId(nextSequence, suffix),
      nextEntityId: (suffix) => createEntityId(nextSequence, suffix),
      createPoint: (label, pointId, position) =>
        createPointDefinition(sketchId, pointId, label, position, false),
      createLine: (label, entityId, startPointId, endPointId) =>
        createLineEntityDefinition(sketchId, entityId, label, startPointId, endPointId, false),
      createArc: (label, entityId, centerPointId, startPointId, endPointId, sweepDirection) =>
        createArcEntityDefinition(sketchId, entityId, label, centerPointId, startPointId, endPointId, sweepDirection, false),
      createSpline: (label, entityId, fitPointIds) =>
        createSplineEntityDefinition(sketchId, entityId, label, fitPointIds, false),
    })

    if (!result.changed) {
      return {
        ...session,
        validationMessage: result.message,
        toolPresentation: buildSketchEditToolPresentation(activeEditTool, result.message),
      }
    }

    const historyCursor = createTailSketchHistoryCursor(result.definition)

    return {
      ...session,
      definition: result.definition,
      fullDefinition: cloneDefinition(result.definition),
      historyCursor,
      toolStagedEntities: [],
      sequence: nextSequence,
      validationMessage: null,
      commitRequest: rebuildSessionCommitRequest(session, result.definition),
      solvedRegions: deriveSolvedRegionsForSession(session, result.definition),
      toolPresentation: buildSketchEditToolPresentation(activeEditTool),
      activeEditTarget: null,
      activeDrag: null,
    }
  }

  if (activeEditTool.toolId === 'offset' && target.kind !== 'sketchEntity' && target.kind !== 'projectedReferenceGeometry') {
    return session
  }

  if (activeEditTool.toolId === 'offset') {
    const nextSelectedTargets = activeEditTool.selectedTargets.some((selected) => primitiveRefEquals(selected, target))
      ? activeEditTool.selectedTargets.filter((selected) => !primitiveRefEquals(selected, target))
      : [...activeEditTool.selectedTargets, target]
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: nextSelectedTargets[0] ?? null,
      selectedTargets: nextSelectedTargets,
      hoverTarget: null,
    }
    const preview = getOffsetPreview(session, nextEditTool)

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool, preview.message, preview.previewEntities),
    }
  }

  if (target.kind !== 'sketchEntity') {
    const message = getSketchEditToolDefinition(activeEditTool.toolId).metadata.validationMessages.unsupportedTarget
    return {
      ...session,
      validationMessage: message,
      toolPresentation: buildSketchEditToolPresentation(activeEditTool, message),
    }
  }

  const metadata = getSketchEditToolDefinition(activeEditTool.toolId).metadata
  const isSelected = activeEditTool.selectedTargets.some((selected) => primitiveRefEquals(selected, target))
  const nextSelectedTargets = isSelected
    ? activeEditTool.selectedTargets.filter((selected) => !primitiveRefEquals(selected, target))
    : metadata.selection.allowsMultiple || activeEditTool.selectedTargets.length < metadata.selection.requiredCount
      ? [...activeEditTool.selectedTargets, target]
      : [...activeEditTool.selectedTargets.slice(1), target]
  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: nextSelectedTargets[0] ?? null,
    selectedTargets: nextSelectedTargets,
    hoverTarget: null,
  }
  const preview = getSketchEditOperatorResult(session, nextEditTool)

  if (
    (nextEditTool.toolId === 'sketchExtend' || nextEditTool.toolId === 'sketchSplit' || nextEditTool.toolId === 'sketchMirror')
    && nextSelectedTargets.length >= metadata.selection.requiredCount
    && preview.valid
  ) {
    const applied = applySketchEditOperationResult(session, preview)
    if (applied) {
      const resetEditTool = {
        ...nextEditTool,
        selectedTarget: null,
        selectedTargets: [],
      }
      return {
        ...session,
        ...applied,
        activeEditTool: resetEditTool,
        toolStagedEntities: [],
        validationMessage: null,
        toolPresentation: buildSketchEditToolPresentation(resetEditTool),
        activeEditTarget: null,
        activeDrag: null,
      }
    }
  }

  return {
    ...session,
    activeEditTool: nextEditTool,
    toolStagedEntities: preview.previewEntities,
    validationMessage: preview.valid ? null : preview.message,
    toolPresentation: buildSketchEditToolPresentation(nextEditTool, preview.message, preview.previewEntities),
  }
}

export function patchSketchEditToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const activeEditTool = session.activeEditTool
  if (!activeEditTool) {
    return session
  }

  if (activeEditTool.toolId !== 'offset') {
    return patchSketchEditOperatorValue(session, activeEditTool, patch)
  }

  if (patch.intent === 'cancelOffset') {
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: null,
      selectedTargets: [],
    }

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    }
  }

  if ('value' in patch && patch.intent !== 'commitOffset') {
    const nextEditTool = {
      ...activeEditTool,
      offsetDistance: patch.intent === 'setOffsetSide'
        ? activeEditTool.offsetDistance
        : typeof patch.value === 'number' ? patch.value : null,
      offsetSide: patch.intent === 'setOffsetSide' && (patch.value === 'left' || patch.value === 'right')
        ? patch.value
        : activeEditTool.offsetSide,
    }
    const preview = getOffsetPreview(session, nextEditTool)

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool, preview.message, preview.previewEntities),
    }
  }

  if (patch.intent !== 'commitOffset') {
    return session
  }

  const preview = getOffsetPreview(session, activeEditTool)
  if (!preview.valid || !preview.contribution) {
    return {
      ...session,
      validationMessage: preview.message,
      toolPresentation: buildSketchEditToolPresentation(activeEditTool, preview.message, preview.previewEntities),
    }
  }

  const nextSequence = session.sequence + 1
  const history = applySketchHistoryContribution(session, preview.contribution)
  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: null,
    selectedTargets: [],
  }

  return {
    ...session,
    activeEditTool: nextEditTool,
    toolStagedEntities: [],
    definition: history.definition,
    fullDefinition: history.fullDefinition,
    historyCursor: history.historyCursor,
    historyOperations: history.historyOperations,
    sequence: nextSequence,
    commitRequest: rebuildSessionCommitRequest(session, history.definition),
    solvedRegions: deriveSolvedRegionsForSession(session, history.definition),
    validationMessage: null,
    toolPresentation: buildSketchEditToolPresentation(nextEditTool),
  }
}

export function patchSketchEditOperatorValue(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (patch.intent === 'cancelSketchEditOperator') {
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: null,
      selectedTargets: [],
    }

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    }
  }

  if ('value' in patch && patch.intent !== 'commitSketchEditOperator') {
    const nextEditTool = {
      ...activeEditTool,
      toolValue: typeof patch.value === 'number' ? patch.value : null,
    }
    const preview = getSketchEditOperatorResult(session, nextEditTool)

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool, preview.message, preview.previewEntities),
    }
  }

  if (patch.intent !== 'commitSketchEditOperator') {
    return session
  }

  const preview = getSketchEditOperatorResult(session, activeEditTool)
  if (!preview.valid) {
    return {
      ...session,
      validationMessage: preview.message,
      toolPresentation: buildSketchEditToolPresentation(activeEditTool, preview.message, preview.previewEntities),
    }
  }

  const applied = applySketchEditOperationResult(session, preview)
  if (!applied) {
    return session
  }

  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: null,
    selectedTargets: [],
  }

  return {
    ...session,
    ...applied,
    activeEditTool: nextEditTool,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    activeEditTarget: null,
    activeDrag: null,
  }
}

export function beginSketchGeometryDrag(
  session: SketchSessionState,
  target: PrimitiveRef,
  point: SketchPoint,
): SketchSessionState {
  if (
    target.kind !== 'sketchPoint'
    || session.status === 'drawing'
    || (session.activeTool !== null && !isDrawingSketchTool(session.activeTool))
  ) {
    return session
  }

  const selected = selectSketchEditTarget(session, target)

  if (!selected.activeEditTarget || selected.activeEditTarget.pointId !== target.pointId) {
    return session
  }

  return {
    ...selected,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    toolStagedEntities: [],
    activeDrag: {
      target,
      startPoint: point,
      currentPoint: point,
      status: 'dragging',
      message: null,
      interactiveSolveSession: createInteractiveSolveSessionForDrag(
        selected.definition,
        selected.projectedReferences,
        target.pointId,
      ),
    },
    validationMessage: null,
  }
}

export function updateSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (!session.activeDrag) {
    return session
  }

  return applySketchGeometryDrag(session, point, false)
}

export function finishSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (!session.activeDrag) {
    return session
  }

  const interactiveSolveSession = session.activeDrag.interactiveSolveSession
  const updated = applySketchGeometryDrag(session, point, true)
  if (interactiveSolveSession) {
    interactiveSolveSession.disposed = true
  }

  return {
    ...updated,
    activeDrag: null,
  }
}

export function applySketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  complete: boolean,
): SketchSessionState {
  const drag = session.activeDrag

  if (!drag) {
    return session
  }

  const edit = solveDraggedPointEdit(
    session.definition,
    session.projectedReferences,
    drag.target.pointId,
    point,
    drag.interactiveSolveSession,
  )

  if (edit.kind === 'blocked') {
    return {
      ...session,
      activeDrag: complete
        ? null
        : {
            ...drag,
            currentPoint: point,
            status: 'blocked',
            message: edit.message,
          },
      validationMessage: edit.message,
    }
  }

  const definition = edit.definition
  const fullDefinition = applyPointPositionsToDefinition(session.fullDefinition, definition.points)

  return {
    ...session,
    definition,
    fullDefinition,
    toolStagedEntities: [],
    activeDrag: complete
      ? null
      : {
          ...drag,
          currentPoint: point,
          status: 'dragging',
          message: null,
          interactiveSolveSession: edit.interactiveSolveSession,
    },
    commitRequest: rebuildSessionCommitRequest(session, definition),
    solvedRegions: complete
      ? deriveSolvedRegionsForSession(session, definition, edit.solvedSnapshot)
      : session.solvedRegions,
    liveRegionState: {
      freshness: complete ? 'current' : 'pendingRefresh',
      pendingSinceSequence: complete ? null : session.sequence,
      debounceMs: 100,
    },
    validationMessage: null,
  }
}

export function solveDraggedPointEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  pointId: SketchPointId,
  position: SketchPoint,
  interactiveSolveSession: SketchCompiledSolveSession | null = null,
): { kind: 'accepted'; definition: SketchDefinition; solvedSnapshot?: SolvedSketchSnapshot; interactiveSolveSession: SketchCompiledSolveSession | null } | { kind: 'blocked'; message: string } {
  if (!definition.points.some((point) => point.pointId === pointId)) {
    return { kind: 'blocked', message: 'Sketch point is no longer editable.' }
  }

  if (definition.constraints.length === 0 && definition.dimensions.length === 0) {
    return {
      kind: 'accepted',
      definition: applyPointPositionsToDefinition(definition, [{ pointId, position }]),
      interactiveSolveSession: null,
    }
  }

  const solveSession = interactiveSolveSession ?? createInteractiveSolveSessionForDrag(
    definition,
    projectedReferences,
    pointId,
  )
  const solved = solveSession
    ? updateCompiledSketchSolveSession(
        solveSession,
        {
          kind: 'sketchPoint',
          pointId,
          position,
        },
        1e-4,
      )
    : solveSketchDefinitionWithDraggedPointTarget({
        definition,
        projectedReferences,
        dragTarget: {
          kind: 'sketchPoint',
          pointId,
          position,
        },
        tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
        partialSolvePolicy: 'failOnConflict',
        targetTolerance: 1e-4,
      })

  if (solved.kind !== 'solved') {
    return { kind: 'blocked', message: CONSTRAINED_DRAG_BLOCKED_MESSAGE }
  }

  return {
    kind: 'accepted',
    definition: applyPointPositionsToDefinition(
      definition,
      solved.solvedSnapshot.solvedPoints.map((point) => ({
        pointId: point.pointId,
        position: point.solvedPosition,
      })),
    ),
    solvedSnapshot: solved.solvedSnapshot,
    interactiveSolveSession: solveSession,
  }
}

function createInteractiveSolveSessionForDrag(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  pointId: SketchPointId,
): SketchCompiledSolveSession | null {
  if (
    !definition.points.some((point) => point.pointId === pointId)
    || (definition.constraints.length === 0 && definition.dimensions.length === 0)
  ) {
    return null
  }

  const program = compileSketchSolveProgram({
    definition,
    projectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'failOnConflict',
  })
  return createCompiledSketchSolveSession({
    sessionId: `interactive_sketch_solve_drag_${pointId}`,
    program,
  })
}
