import type {
  CommitSketchRequest,
  SketchPlaneKey,
  SketchPoint,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  SketchPlaneDefinition,
  SketchPlaneSupportRef,
} from '@/contracts/shared/sketch-plane'
import {
  evaluateSketchDerivations,
} from '@/contracts/sketch/derived-geometry'
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchAuthoringOperation,
  SketchDefinition,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'
import {
  type PrimitiveRef,
  getPrimitiveRefKey,
} from '@/domain/editor/schema'
import {
  createStandardPlaneDefinition,
  deriveStandardPlaneKeyFromConstructionId,
} from '@/domain/modeling/opencascade-kernel-seed'
import {
  buildReferenceImageAnchorProjectedReferences,
} from '@/domain/reference-image-calibration/export/references'
import {
  materializeLegacyReferenceImageAnchorBindings,
} from '@/domain/reference-image/operations'
import type { SketchDraftEntity } from '@/domain/sketch-tools/definition'
import {
  mapSketchPointToWorkspaceWorld,
} from '@/domain/workspace/sketch-plane-mapping'
import type {
  SketchConstraintDisplayState,
  SketchConstraintDisplaySummary,
  SketchConstraintDisplayTargetState,
  SketchHistoryCursor,
  SketchHistoryItem,
  SketchSessionState,
} from './types'
import {
  cloneDefinition,
  createEmptyDefinition,
  createSketchConstraintRef,
  createSketchDimensionRef,
  createSketchEntityRef,
  createSketchOperationRef,
  createSketchPointRef,
  filterSketchDefinitionThroughCursor,
  getDefinitionSketchId,
  getEntityPointIds,
  getHistorySequence,
  getNextDefinitionSequence,
  getSessionSketchId,
  getSketchHistoryOperationForCursor,
  mapDefinitionEntityToDraftEntity,
  rebuildSessionForDefinition,
  sketchHistoryCursorsEqual,
} from './internals'
import {
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from './annotations'
import {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
} from './editing'

export function derivePlaneKeyFromTarget(target: SketchPlaneSupportRef): SketchPlaneKey | null {
  if (target.kind !== 'construction') {
    return null
  }

  return deriveStandardPlaneKeyFromConstructionId(target.constructionId)
}

export function normalizeSketchConstraintDisplayState(
  status: SolvedSketchSnapshot['status'],
  affectedTargetCount: number,
): SketchConstraintDisplayState {
  if (
    status.constraintState === 'overConstrained'
    || status.constraintState === 'inconsistent'
    || (status.solveState !== 'solved' && affectedTargetCount > 0)
  ) {
    return 'overconstrained'
  }

  if (status.constraintState === 'wellConstrained') {
    return 'constrained'
  }

  return 'underconstrained'
}

export function getSketchConstraintDisplaySummary(input: {
  sketchId: SketchId
  definition: SketchDefinition
  solvedSnapshot: SolvedSketchSnapshot
}): SketchConstraintDisplaySummary {
  const affectedTargetKeys = getSketchAffectedConstraintTargetKeys(input)

  return {
    state: normalizeSketchConstraintDisplayState(input.solvedSnapshot.status, affectedTargetKeys.size),
    affectedTargetKeys,
  }
}

export function getSketchConstraintDisplayForTarget(
  target: PrimitiveRef | null,
  summary: SketchConstraintDisplaySummary,
): SketchConstraintDisplayTargetState {
  return {
    state: summary.state,
    isAffectedOverconstraint: target !== null
      && summary.state === 'overconstrained'
      && summary.affectedTargetKeys.has(getPrimitiveRefKey(target)),
  }
}

export function getSketchAffectedConstraintTargetKeys(input: {
  sketchId: SketchId
  definition: SketchDefinition
  solvedSnapshot: SolvedSketchSnapshot
}) {
  const targetKeys = new Set<string>()

  for (const diagnostic of input.solvedSnapshot.diagnostics) {
    if (diagnostic.severity !== 'error' || !diagnostic.target) {
      continue
    }

    for (const target of getSketchDiagnosticAffectedTargets(input.sketchId, input.definition, diagnostic.target)) {
      targetKeys.add(getPrimitiveRefKey(target))
    }
  }

  for (const status of input.solvedSnapshot.constraintStatuses) {
    if (status.status === 'satisfied') {
      continue
    }

    targetKeys.add(getPrimitiveRefKey(createSketchConstraintRef(input.sketchId, status.constraintId)))
    const constraint = input.definition.constraints.find((entry) => entry.constraintId === status.constraintId)
    if (!constraint) {
      continue
    }

    for (const target of getConstraintAffectedGeometryRefs(input.sketchId, constraint)) {
      targetKeys.add(getPrimitiveRefKey(target))
    }
  }

  for (const status of input.solvedSnapshot.dimensionStatuses) {
    if (status.status !== 'unsatisfied') {
      continue
    }

    targetKeys.add(getPrimitiveRefKey(createSketchDimensionRef(input.sketchId, status.dimensionId)))
    const dimension = input.definition.dimensions.find((entry) => entry.dimensionId === status.dimensionId)
    if (!dimension) {
      continue
    }

    for (const target of getDimensionAffectedGeometryRefs(input.sketchId, dimension)) {
      targetKeys.add(getPrimitiveRefKey(target))
    }
  }

  return targetKeys
}

export function getSketchDiagnosticAffectedTargets(
  sketchId: SketchId,
  definition: SketchDefinition,
  target: NonNullable<SolvedSketchSnapshot['diagnostics'][number]['target']>,
): readonly PrimitiveRef[] {
  switch (target.kind) {
    case 'entity':
      return [createSketchEntityRef(sketchId, target.entityId)]
    case 'point':
      return [createSketchPointRef(sketchId, target.pointId)]
    case 'region':
      return [{ kind: 'region', sketchId, regionId: target.regionId }]
    case 'constraint': {
      const constraint = definition.constraints.find((entry) => entry.constraintId === target.constraintId)
      return constraint
        ? [createSketchConstraintRef(sketchId, target.constraintId), ...getConstraintAffectedGeometryRefs(sketchId, constraint)]
        : [createSketchConstraintRef(sketchId, target.constraintId)]
    }
    case 'dimension': {
      const dimension = definition.dimensions.find((entry) => entry.dimensionId === target.dimensionId)
      return dimension
        ? [createSketchDimensionRef(sketchId, target.dimensionId), ...getDimensionAffectedGeometryRefs(sketchId, dimension)]
        : [createSketchDimensionRef(sketchId, target.dimensionId)]
    }
  }
}

export function getAuthoringOperationHistoryTarget(
  sketchId: SketchId,
  operation: SketchAuthoringOperation,
): PrimitiveRef | null {
  if (operation.kind === 'referenceImage') {
    return createSketchOperationRef(sketchId, operation.operationId)
  }

  const target = [
    ...(operation.targets.created ?? []),
    ...(operation.targets.edited ?? []),
    ...(operation.targets.removed ?? []),
  ].find((entry) =>
    entry.kind === 'operation'
    || entry.kind === 'entity'
    || entry.kind === 'point'
    || entry.kind === 'constraint'
    || entry.kind === 'dimension',
  )

  if (!target) {
    return null
  }

  switch (target.kind) {
    case 'operation':
      return createSketchOperationRef(sketchId, target.operationId)
    case 'point':
      return createSketchPointRef(sketchId, target.pointId)
    case 'entity':
      return createSketchEntityRef(sketchId, target.entityId)
    case 'constraint':
      return createSketchConstraintRef(sketchId, target.constraintId)
    case 'dimension':
      return createSketchDimensionRef(sketchId, target.dimensionId)
  }
}

export function getSketchHistoryItems(definition: SketchDefinition): SketchHistoryItem[] {
  const sketchId = getDefinitionSketchId(definition)
  const operations = definition.authoringOperations ?? []
  if (operations.length > 0) {
    return operations.map((operation) => ({
      kind: 'operation' as const,
      id: operation.operationId,
      label: operation.label,
      operation,
      target: getAuthoringOperationHistoryTarget(sketchId, operation),
    }))
  }

  return [
    ...definition.entities.map((entity) => ({
      kind: 'entity' as const,
      id: entity.entityId,
      label: entity.label,
      target: createSketchEntityRef(sketchId, entity.entityId),
    })),
    ...definition.constraints.map((constraint) => ({
      kind: 'constraint' as const,
      id: constraint.constraintId,
      label: constraint.label,
      target: createSketchConstraintRef(sketchId, constraint.constraintId),
    })),
    ...definition.dimensions.map((dimension) => ({
      kind: 'dimension' as const,
      id: dimension.dimensionId,
      label: dimension.label,
      target: createSketchDimensionRef(sketchId, dimension.dimensionId),
    })),
  ].sort((left, right) => {
    const sequenceDelta = getHistorySequence(left.id) - getHistorySequence(right.id)
    return sequenceDelta === 0 ? left.id.localeCompare(right.id) : sequenceDelta
  })
}

export function createTailSketchHistoryCursor(definition: SketchDefinition): SketchHistoryCursor {
  const tail = getSketchHistoryItems(definition).at(-1)
  return tail ? { kind: 'item', itemId: tail.id } : { kind: 'empty' }
}

export function getSketchHistoryCursorIndex(
  items: readonly SketchHistoryItem[],
  cursor: SketchHistoryCursor,
) {
  if (cursor.kind === 'empty') {
    return -1
  }

  return items.findIndex((item) => item.id === cursor.itemId)
}

export function getSketchHistoryCursorForIndex(
  items: readonly SketchHistoryItem[],
  index: number,
): SketchHistoryCursor {
  const item = items[index]
  return item ? { kind: 'item', itemId: item.id } : { kind: 'empty' }
}

export function getPreviousSketchHistoryCursor(session: SketchSessionState): SketchHistoryCursor | null {
  const operation = getSketchHistoryOperationForCursor(session, session.historyCursor)
  if (operation) {
    return operation.beforeCursor
  }

  const items = getSketchHistoryItems(session.fullDefinition)
  const cursorIndex = getSketchHistoryCursorIndex(items, session.historyCursor)

  if (session.historyCursor.kind !== 'empty' && cursorIndex < 0) {
    return null
  }

  if (cursorIndex <= -1) {
    return null
  }

  const currentSequence = getHistorySequence(items[cursorIndex]?.id ?? '')
  let previousIndex = cursorIndex - 1
  while (previousIndex >= 0 && getHistorySequence(items[previousIndex]?.id ?? '') === currentSequence) {
    previousIndex -= 1
  }

  return getSketchHistoryCursorForIndex(items, previousIndex)
}

export function getNextSketchHistoryCursor(session: SketchSessionState): SketchHistoryCursor | null {
  const operation = session.historyOperations.find((entry) =>
    sketchHistoryCursorsEqual(entry.beforeCursor, session.historyCursor),
  )

  if (operation) {
    return { kind: 'item', itemId: operation.itemId }
  }

  const items = getSketchHistoryItems(session.fullDefinition)
  const cursorIndex = getSketchHistoryCursorIndex(items, session.historyCursor)

  if (session.historyCursor.kind !== 'empty' && cursorIndex < 0) {
    return null
  }

  const nextIndex = cursorIndex + 1
  if (nextIndex >= items.length) {
    return null
  }

  const nextSequence = getHistorySequence(items[nextIndex]?.id ?? '')
  let sequenceTailIndex = nextIndex
  while (
    sequenceTailIndex + 1 < items.length
    && getHistorySequence(items[sequenceTailIndex + 1]?.id ?? '') === nextSequence
  ) {
    sequenceTailIndex += 1
  }

  return getSketchHistoryCursorForIndex(items, sequenceTailIndex)
}

export function createSketchSessionFromSnapshot(sketch: SketchSnapshotRecord): SketchSessionState {
  const sketchId = sketch.sketchId
  const fullDefinition = materializeLegacyReferenceImageAnchorBindings(cloneDefinition(sketch.sketch.definition))
  const historyCursor = createTailSketchHistoryCursor(fullDefinition)
  const definition = filterSketchDefinitionThroughCursor(fullDefinition, historyCursor)
  const planeKey = sketch.planeKey ?? sketch.plane.key ?? null
  const projectedReferences = buildReferenceImageAnchorProjectedReferences(definition)

  return {
    sketchId,
    sketchLabel: sketch.label,
    plane: sketch.plane,
    planeTarget: sketch.planeTarget,
    planeKey,
    toolStagedEntities: [],
    definition,
    fullDefinition,
    historyCursor,
    historyOperations: [],
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
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: getNextDefinitionSequence(sketch.sketch.definition),
    solvedRegions: [...sketch.sketch.regions],
    projectedReferences,
    projectionDiagnostics: [],
    commitRequest: buildCommitRequest({
      sketchId,
      sketchLabel: sketch.label,
      plane: sketch.plane,
      planeTarget: sketch.planeTarget,
      planeKey,
      definition,
    }),
    validationMessage: null,
  }
}

export function createNewSketchSession(plane: SketchPlaneDefinition): SketchSessionState {
  const planeKey = plane.key
  const definition = createEmptyDefinition()

  return {
    sketchId: null,
    sketchLabel: 'Sketch Draft',
    plane,
    planeTarget: plane.support,
    planeKey,
    toolStagedEntities: [],
    definition,
    fullDefinition: cloneDefinition(definition),
    historyCursor: { kind: 'empty' },
    historyOperations: [],
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
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: 0,
    solvedRegions: [],
    projectedReferences: [],
    projectionDiagnostics: [],
    commitRequest: null,
    validationMessage: null,
  }
}

export function deriveSketchDisplayEntities(session: SketchSessionState): readonly SketchDraftEntity[] {
  const sketchId = getSessionSketchId(session)
  const displayDefinition = evaluateSketchDerivations(session.definition).definition
  const acceptedEntities = displayDefinition.entities.flatMap((entity) =>
    mapDefinitionEntityToDraftEntity(sketchId, displayDefinition.points, entity),
  )

  return session.toolStagedEntities.length === 0
    ? acceptedEntities
    : [...acceptedEntities, ...session.toolStagedEntities]
}

export function buildCommitRequest(input: {
  sketchId: SketchId | null
  sketchLabel: string
  plane: SketchPlaneDefinition
  planeTarget: CommitSketchRequest['planeTarget']
  planeKey: SketchPlaneKey | null
  definition: SketchDefinition
}): SketchSessionState['commitRequest'] {
  return {
    solverCorrelation: null,
    sketchId: input.sketchId,
    sketchLabel: input.sketchLabel,
    plane: input.plane,
    planeTarget: input.planeTarget,
    planeKey: input.planeKey,
    definition: cloneDefinition(input.definition),
  }
}

export function createNewSketchSessionFromSupport(planeTarget: SketchPlaneSupportRef): SketchSessionState {
  const planeKey = derivePlaneKeyFromTarget(planeTarget)
  const plane =
    planeTarget.kind === 'construction' && planeKey
      ? createStandardPlaneDefinition(planeKey)
      : {
          support: planeTarget,
          frame: createStandardPlaneDefinition('xy').frame,
          key: planeKey,
        }

  return createNewSketchSession(plane)
}

export function moveSketchHistoryCursor(
  session: SketchSessionState,
  cursor: SketchHistoryCursor,
): SketchSessionState {
  const operation = getSketchHistoryOperationForCursor(session, cursor)
  if (operation) {
    return rebuildSessionForDefinition(session, {
      definition: operation.afterDefinition,
      fullDefinition: operation.afterDefinition,
      historyCursor: cursor,
      historyOperations: session.historyOperations,
    })
  }

  const redoSourceOperation = session.historyOperations.find((entry) =>
    sketchHistoryCursorsEqual(entry.beforeCursor, cursor),
  )
  const fullDefinition = redoSourceOperation?.beforeDefinition ?? session.fullDefinition
  const items = getSketchHistoryItems(fullDefinition)
  const normalizedCursor =
    cursor.kind === 'empty' || items.some((item) => item.id === cursor.itemId)
      ? cursor
      : createTailSketchHistoryCursor(fullDefinition)
  const definition = filterSketchDefinitionThroughCursor(fullDefinition, normalizedCursor)

  return rebuildSessionForDefinition(session, {
    definition,
    fullDefinition,
    historyCursor: normalizedCursor,
    historyOperations: session.historyOperations,
  })
}

export function isEditableSketchGeometrySelection(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  return getSelectedSketchGeometryIds(session, targets) !== null
    || getSelectedReferenceImageOperationIds(session, targets).length > 0
}

export function getConnectedSketchEntitySelectionTargets(
  session: SketchSessionState,
  target: PrimitiveRef,
): PrimitiveRef[] {
  if (target.kind !== 'sketchEntity') {
    return []
  }

  const seedEntity = session.definition.entities.find((entity) =>
    entity.kind !== 'point' && entity.entityId === target.entityId
  )

  if (!seedEntity || seedEntity.target.sketchId !== target.sketchId) {
    return []
  }

  const entityIdsByPointId = new Map<SketchPointId, SketchEntityId[]>()
  const pointIdsByEntityId = new Map<SketchEntityId, readonly SketchPointId[]>()
  const targetsByEntityId = new Map<SketchEntityId, Extract<PrimitiveRef, { kind: 'sketchEntity' }>>()

  for (const entity of session.definition.entities) {
    if (entity.kind === 'point') {
      continue
    }

    const pointIds = getEntityPointIds(entity)
    pointIdsByEntityId.set(entity.entityId, pointIds)
    targetsByEntityId.set(entity.entityId, entity.target)

    for (const pointId of pointIds) {
      const entityIds = entityIdsByPointId.get(pointId)
      if (entityIds) {
        entityIds.push(entity.entityId)
      } else {
        entityIdsByPointId.set(pointId, [entity.entityId])
      }
    }
  }

  const visitedEntityIds = new Set<SketchEntityId>()
  const pendingEntityIds: SketchEntityId[] = [seedEntity.entityId]

  while (pendingEntityIds.length > 0) {
    const entityId = pendingEntityIds.pop()

    if (!entityId || visitedEntityIds.has(entityId)) {
      continue
    }

    visitedEntityIds.add(entityId)

    for (const pointId of pointIdsByEntityId.get(entityId) ?? []) {
      for (const connectedEntityId of entityIdsByPointId.get(pointId) ?? []) {
        if (!visitedEntityIds.has(connectedEntityId)) {
          pendingEntityIds.push(connectedEntityId)
        }
      }
    }
  }

  return session.definition.entityIds
    .filter((entityId) => visitedEntityIds.has(entityId))
    .map((entityId) => targetsByEntityId.get(entityId))
    .filter((entity): entity is Extract<PrimitiveRef, { kind: 'sketchEntity' }> => entity !== undefined)
}

export function constraintReferencesSketchGeometry(
  constraint: ConstraintDefinition,
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  switch (constraint.kind) {
    case 'coincident':
    case 'angle':
      return constraint.pointIds.some((pointId) => deletedPointIds.has(pointId))
    case 'horizontal':
    case 'vertical':
      return deletedEntityIds.has(constraint.entityId)
    case 'coincidentProjectedPoint':
    case 'pointOnProjectedCurve':
    case 'midpointProjectedLine':
      return deletedPointIds.has(constraint.point.pointId)
    case 'midpoint':
      return deletedPointIds.has(constraint.point.pointId) || deletedEntityIds.has(constraint.line.entityId)
    case 'pointOnCurve':
      return deletedPointIds.has(constraint.point.pointId) || deletedEntityIds.has(constraint.curve.entityId)
    case 'normal':
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId) ||
        deletedEntityIds.has(constraint.curve.entityId)
      )
    case 'normalProjectedCurve':
      return deletedPointIds.has(constraint.point.pointId) || deletedEntityIds.has(constraint.line.entityId)
    case 'symmetric':
      return constraint.pointIds.some((pointId) => deletedPointIds.has(pointId)) || deletedEntityIds.has(constraint.axis.entityId)
    case 'symmetricProjectedLine':
      return constraint.pointIds.some((pointId) => deletedPointIds.has(pointId))
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return deletedEntityIds.has(constraint.line.entityId)
    case 'tangentProjectedCurve':
    case 'concentricProjectedCurve':
      return deletedEntityIds.has(constraint.curve.entityId)
    case 'tangent':
    case 'concentric':
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
      return constraint.entityIds.some((entityId) => deletedEntityIds.has(entityId))
    case 'fixPoint':
      return deletedPointIds.has(constraint.pointId)
  }
}

export function dimensionReferencesSketchGeometry(
  dimension: DimensionDefinition,
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  const operandReferencesDeletedGeometry = (operand: { kind: string; pointId?: SketchPointId; entityId?: SketchEntityId }) =>
    (operand.kind === 'localPoint' && operand.pointId !== undefined && deletedPointIds.has(operand.pointId))
    || (operand.kind === 'localEntity' && operand.entityId !== undefined && deletedEntityIds.has(operand.entityId))

  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      return dimension.pointIds.some((pointId) => deletedPointIds.has(pointId))
    case 'pointDatumDistance':
      return deletedPointIds.has(dimension.point.pointId)
    case 'circleRadius':
    case 'diameter':
      return deletedEntityIds.has(dimension.entityId)
    case 'lineLength':
      return deletedEntityIds.has(dimension.entityId)
    case 'lineDistance':
    case 'lineAngle':
      return dimension.lines.some(operandReferencesDeletedGeometry)
    case 'linePointDistance':
      return operandReferencesDeletedGeometry(dimension.line) || operandReferencesDeletedGeometry(dimension.point)
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return deletedEntityIds.has(dimension.entityId) || deletedPointIds.has(dimension.pointId)
  }
}

export function isSketchConstructionSelected(session: SketchSessionState) {
  return session.constructionTargetPicking || session.constructionModifierActive
}

export function isSketchReferenceToolSelected(session: SketchSessionState) {
  return session.referenceTargetPicking
}

export function mapSketchPointToWorld(
  plane: SketchPlaneDefinition,
  point: SketchPoint,
): readonly [number, number, number] {
  return mapSketchPointToWorkspaceWorld(plane, point)
}

