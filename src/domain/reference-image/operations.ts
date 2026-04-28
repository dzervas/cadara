import type {
  ReferenceImageOperationState,
  ReferenceImagePayload,
} from '@/contracts/reference-image/schema'
import type {
  SketchAuthoringOperation,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import type { SketchAuthoringOperationId, SketchId } from '@/contracts/shared/ids'
import {
  createDefaultReferenceImageCalibrationState,
  stripReferenceImageRuntimeState,
} from '@/domain/reference-image-calibration/state'

const DEFAULT_REFERENCE_IMAGE_EXTENT = 200

export interface CreateReferenceImageOperationInput {
  sequence: number
  sketchId: SketchId
  payload: ReferenceImagePayload
}

export interface EditReferenceImageOperationInput {
  sequence: number
  operationId: SketchAuthoringOperationId
  state: ReferenceImageOperationState
  label?: string
  createdPoints?: readonly SketchPointDefinition[]
  createdEntities?: readonly SketchEntityDefinition[]
}

export interface ActiveReferenceImageOperation {
  operation: SketchAuthoringOperation
  state: ReferenceImageOperationState
}

export interface ReferenceImageOperationStateOverride {
  state: ReferenceImageOperationState
  label?: string
}

export function createReferenceImageOperation(
  input: CreateReferenceImageOperationInput,
): SketchAuthoringOperation {
  const placement = createReferenceImagePlacement(input.payload)
  const operationId = `sketch_operation_${input.sequence}_reference-image` as SketchAuthoringOperationId

  return {
    operationId,
    label: input.payload.fileName?.trim() || `Reference image ${input.sequence}`,
    kind: 'referenceImage',
    targets: {
      created: [{ kind: 'operation', operationId }],
    },
    ownedState: {
      kind: 'referenceImage',
      image: input.payload,
      placement,
      calibration: createDefaultReferenceImageCalibrationState(),
    },
  }
}

export function createReferenceImageEditOperation(
  input: EditReferenceImageOperationInput,
): SketchAuthoringOperation {
  const createdPointTargets = (input.createdPoints ?? []).map((point) => ({
    kind: 'point' as const,
    pointId: point.pointId,
  }))
  const createdEntityTargets = (input.createdEntities ?? []).map((entity) => ({
    kind: 'entity' as const,
    entityId: entity.entityId,
  }))
  return {
    operationId: `sketch_operation_${input.sequence}_edit-reference-image` as SketchAuthoringOperationId,
    label: input.label ?? input.state.image.fileName?.trim() ?? `Edit reference image ${input.sequence}`,
    kind: 'edit',
    targets: {
      ...((createdPointTargets.length > 0 || createdEntityTargets.length > 0)
        ? { created: [...createdPointTargets, ...createdEntityTargets] }
        : {}),
      edited: [{ kind: 'operation', operationId: input.operationId }],
    },
    ...((input.createdPoints && input.createdPoints.length > 0) || (input.createdEntities && input.createdEntities.length > 0)
      ? {
          createdGraph: {
            points: input.createdPoints,
            entities: input.createdEntities,
          },
        }
      : {}),
    ownedState: stripReferenceImageRuntimeState(input.state),
  }
}

export function createReferenceImagePlacement(
  payload: Pick<ReferenceImagePayload, 'pixelWidth' | 'pixelHeight'>,
) {
  const scale = DEFAULT_REFERENCE_IMAGE_EXTENT / Math.max(payload.pixelWidth, payload.pixelHeight)
  const width = payload.pixelWidth * scale
  const height = payload.pixelHeight * scale

  return {
    center: [0, 0] as SketchPoint2D,
    width,
    height,
    rotationRadians: 0,
  }
}

export function collectActiveReferenceImageOperations(
  definition: Pick<SketchDefinition, 'authoringOperations'>,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
): ActiveReferenceImageOperation[] {
  const operations = definition.authoringOperations ?? []
  const activeOperations = new Map<SketchAuthoringOperationId, ActiveReferenceImageOperation>()

  for (const operation of operations) {
    if (operation.kind === 'referenceImage' && operation.ownedState.kind === 'referenceImage') {
      const override = overrides?.get(operation.operationId)
      activeOperations.set(operation.operationId, {
        operation: override?.label
          ? {
              ...operation,
              label: override.label,
            }
          : operation,
        state: override?.state ?? {
            ...operation.ownedState,
            calibration: operation.ownedState.calibration
            ?? createDefaultReferenceImageCalibrationState(),
        },
      })
      continue
    }

    if (operation.kind === 'edit' && operation.ownedState?.kind === 'referenceImage') {
      for (const target of operation.targets.edited ?? []) {
        if (target.kind !== 'operation') {
          continue
        }

        const current = activeOperations.get(target.operationId)
        if (!current) {
          continue
        }

        const override = overrides?.get(target.operationId)
        activeOperations.set(target.operationId, {
          operation: {
            ...current.operation,
            kind: 'referenceImage',
            label: override?.label ?? operation.label,
            ownedState: override?.state ?? {
              ...operation.ownedState,
              calibration: operation.ownedState.calibration
                ?? createDefaultReferenceImageCalibrationState(),
            },
          },
          state: override?.state ?? {
            ...operation.ownedState,
            calibration: operation.ownedState.calibration
              ?? createDefaultReferenceImageCalibrationState(),
          },
        })
      }
      continue
    }

    if (operation.kind !== 'delete') {
      continue
    }

    for (const target of operation.targets.removed ?? []) {
      if (target.kind === 'operation') {
        activeOperations.delete(target.operationId)
      }
    }
  }

  return [...activeOperations.values()]
}

export function createReferenceImageDeleteOperation(input: {
  sequence: number
  removedOperationIds: readonly SketchAuthoringOperationId[]
}) {
  return {
    operationId: `sketch_operation_${input.sequence}_delete` as SketchAuthoringOperationId,
    label: `Delete ${input.sequence}`,
    kind: 'delete' as const,
    targets: {
      removed: input.removedOperationIds.map((operationId) => ({
        kind: 'operation' as const,
        operationId,
      })),
    },
  } satisfies SketchAuthoringOperation
}

export function createReferenceImageOperationTarget(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
) {
  return {
    kind: 'sketchOperation' as const,
    sketchId,
    operationId,
  }
}

export function materializeLegacyReferenceImageAnchorBindings(
  definition: SketchDefinition,
): SketchDefinition {
  if (!definition.authoringOperations || definition.authoringOperations.length === 0) {
    return definition
  }

  const sketchId = getDefinitionSketchId(definition)
  const existingPointIds = new Set(definition.pointIds)
  const existingEntityIds = new Set(definition.entityIds)
  const points = [...definition.points]
  const entities = [...definition.entities]
  let changed = false

  const authoringOperations = definition.authoringOperations.map((operation) => {
    const state = operation.ownedState
    if (!state || state.kind !== 'referenceImage' || !state.calibration) {
      return operation
    }

    const addedPoints: SketchPointDefinition[] = []
    const addedEntities: SketchEntityDefinition[] = []
    const nextAnchors = state.calibration.anchors.map((anchor, anchorIndex) => {
      if (anchor.legacyWorldPosition === undefined) {
        return anchor
      }

      changed = true
      const pointId = createLegacyAnchorPointId(operation.operationId, anchor.anchorId, anchorIndex)
      if (!existingPointIds.has(pointId)) {
        existingPointIds.add(pointId)
        addedPoints.push({
          pointId,
          label: anchor.label,
          target: { kind: 'sketchPoint', sketchId, pointId },
          position: anchor.legacyWorldPosition ?? state.placement.center,
          isConstruction: true,
        })
      }

      const entityId = createAnchorPointEntityId(operation.operationId, pointId)
      if (!existingEntityIds.has(entityId)) {
        existingEntityIds.add(entityId)
        addedEntities.push({
          kind: 'point',
          entityId,
          label: anchor.label,
          target: { kind: 'sketchEntity', sketchId, entityId },
          isConstruction: true,
          pointId,
        })
      }

      return {
        anchorId: anchor.anchorId,
        label: anchor.label,
        uv: anchor.uv,
        pointId,
      }
    })

    if (addedPoints.length === 0 && addedEntities.length === 0 && !state.calibration.legacyConstraints) {
      return operation
    }

    changed = true
    points.push(...addedPoints)
    entities.push(...addedEntities)

    return {
      ...operation,
      targets: {
        ...operation.targets,
        ...(addedPoints.length > 0
          ? {
              created: [
                ...(operation.targets.created ?? []),
                ...addedPoints.map((point) => ({ kind: 'point' as const, pointId: point.pointId })),
                ...addedEntities.map((entity) => ({ kind: 'entity' as const, entityId: entity.entityId })),
              ],
            }
          : {}),
      },
      ...(addedPoints.length > 0 || addedEntities.length > 0 || operation.createdGraph
        ? {
            createdGraph: {
              ...operation.createdGraph,
              points: [...(operation.createdGraph?.points ?? []), ...addedPoints],
              entities: [...(operation.createdGraph?.entities ?? []), ...addedEntities],
            },
          }
        : {}),
      ownedState: stripReferenceImageRuntimeState({
        ...state,
        calibration: {
          scaleMode: state.calibration.scaleMode,
          showExportedAnchorsInSketch: state.calibration.showExportedAnchorsInSketch,
          anchors: nextAnchors,
        },
      }),
    }
  })

  return changed
    ? {
        ...definition,
        pointIds: points.map((point) => point.pointId),
        points,
        entityIds: entities.map((entity) => entity.entityId),
        entities,
        authoringOperations,
      }
    : definition
}

function getDefinitionSketchId(definition: SketchDefinition) {
  return definition.entities[0]?.target.sketchId
    ?? definition.points[0]?.target.sketchId
    ?? ('sketch_draft' as SketchId)
}

function createLegacyAnchorPointId(
  operationId: SketchAuthoringOperationId,
  anchorId: string,
  anchorIndex: number,
) {
  const safeOperationId = operationId.replace(/[^a-zA-Z0-9]+/g, '_')
  const safeAnchorId = anchorId.replace(/[^a-zA-Z0-9]+/g, '_')
  return `sketch_point_${safeOperationId}_${safeAnchorId || anchorIndex}` as const
}

function createAnchorPointEntityId(
  operationId: SketchAuthoringOperationId,
  pointId: string,
) {
  const safeOperationId = operationId.replace(/[^a-zA-Z0-9]+/g, '_')
  const safePointId = pointId.replace(/[^a-zA-Z0-9]+/g, '_')
  return `sketch_entity_${safeOperationId}_${safePointId}_point` as const
}
