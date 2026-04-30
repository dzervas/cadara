import type {
  CommitSketchRequest,
  SketchPlaneKey,
} from '@/contracts/modeling/schema'
import type {
  SketchId,
} from '@/contracts/shared/ids'
import type {
  SketchPlaneDefinition,
} from '@/contracts/shared/sketch-plane'
import type {
  SketchAuthoringOperation,
  SketchDefinition,
} from '@/contracts/sketch/schema'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchOperationRef,
  SketchPointRef,
} from '@/contracts/shared/references'
import type {
  PrimitiveRef,
} from '@/domain/editor/schema'
import type {
  SketchHistoryCursor,
  SketchHistoryItem,
  SketchSessionState,
} from './types'

function cloneDefinition(definition: SketchDefinition): SketchDefinition {
  return {
    ...definition,
    schemaVersion: definition.schemaVersion,
    referenceIds: [...definition.referenceIds],
    references: [...definition.references],
    pointIds: [...definition.pointIds],
    points: [...definition.points],
    entityIds: [...definition.entityIds],
    entities: [...definition.entities],
    constraintIds: [...definition.constraintIds],
    constraints: [...definition.constraints],
    dimensionIds: [...definition.dimensionIds],
    dimensions: [...definition.dimensions],
    styleIds: definition.styleIds ? [...definition.styleIds] : undefined,
    styles: definition.styles ? [...definition.styles] : undefined,
    svgRenderingEnabled: definition.svgRenderingEnabled ?? true,
    derivedRelationships: definition.derivedRelationships ? [...definition.derivedRelationships] : undefined,
    authoringOperations: definition.authoringOperations ? [...definition.authoringOperations] : undefined,
  }
}

function getHistorySequence(id: string) {
  const match = id.match(/_(\d+)_/)
  const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

function getDefinitionSketchId(definition: SketchDefinition) {
  return definition.entities[0]?.target.sketchId
    ?? definition.points[0]?.target.sketchId
    ?? ('sketch_draft' as SketchId)
}

function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: SketchDefinition['constraintIds'][number],
): SketchConstraintRef {
  return { kind: 'constraint', sketchId, constraintId }
}

function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: SketchDefinition['dimensionIds'][number],
): SketchDimensionRef {
  return { kind: 'dimension', sketchId, dimensionId }
}

function createSketchEntityRef(
  sketchId: SketchId,
  entityId: SketchDefinition['entityIds'][number],
): SketchEntityRef {
  return { kind: 'sketchEntity', sketchId, entityId }
}

function createSketchOperationRef(
  sketchId: SketchId,
  operationId: SketchAuthoringOperation['operationId'],
): SketchOperationRef {
  return { kind: 'sketchOperation', sketchId, operationId }
}

function createSketchPointRef(
  sketchId: SketchId,
  pointId: SketchDefinition['pointIds'][number],
): SketchPointRef {
  return { kind: 'sketchPoint', sketchId, pointId }
}

function getAuthoringOperationHistoryTarget(
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
