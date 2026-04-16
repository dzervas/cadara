import type {
  ConstraintDefinition,
  DimensionDefinition,
  RegionRecord,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import { SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchPointRef,
} from '@/contracts/shared/references'
import type { SketchPlaneDefinition, SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import type {
  ConstraintId,
  DimensionId,
  RenderableId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  CommitSketchRequest,
  SketchPlaneKey,
  SketchPoint,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { mapSketchPointToWorld as mapSketchPointToWorldFromPlane } from '@/domain/modeling/occ/planes'
import {
  createStandardPlaneDefinition,
  deriveStandardPlaneKeyFromConstructionId,
} from '@/domain/modeling/opencascade-kernel-seed'
import type {
  SketchToolFloatingInputDescriptor,
  SketchToolPresentationSchema,
  SketchToolSelectionGuideDescriptor,
} from '@/domain/sketch-tools/editor-schema'
import type {
  SketchConstraintTargetRecord,
  SketchConstraintToolId,
} from '@/domain/sketch-constraints/definition'
import {
  getSketchConstraintDefinition,
  isRegisteredSketchConstraintToolId,
  resolveSketchConstraintTarget,
} from '@/domain/sketch-constraints/registry'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolId,
} from '@/domain/sketch-tools/definition'
import { getSketchToolDefinition } from '@/domain/sketch-tools/registry'

export type { SketchDraftEntity, SketchToolId } from '@/domain/sketch-tools/definition'
export type { SketchConstraintToolId } from '@/domain/sketch-constraints/definition'

export type SketchAuthoringToolId = SketchToolId | SketchConstraintToolId
export type SketchSessionStatus = 'idle' | 'drawing' | 'collectingTargets' | 'awaitingValue'

export interface SketchConstraintAuthoringState {
  toolId: SketchConstraintToolId
  selectedTargets: SketchConstraintTargetRecord[]
  hoverTarget: SketchConstraintTargetRecord | null
  pendingValue: number | null
}

export interface SketchAnnotationDescriptor {
  id: string
  target: SketchConstraintRef | SketchDimensionRef
  label: string
  detail: string
  status: 'constraint' | 'dimension'
}

export interface SketchSessionState {
  sketchId: SketchId | null
  sketchLabel: string
  plane: SketchPlaneDefinition
  planeTarget: SketchPlaneSupportRef
  planeKey: SketchPlaneKey | null
  entities: SketchDraftEntity[]
  definition: SketchDefinition
  fullDefinition: SketchDefinition
  historyCursor: SketchHistoryCursor
  activeTool: SketchAuthoringToolId | null
  status: SketchSessionStatus
  pointerDownPoint: SketchPoint | null
  livePoint: SketchPoint | null
  toolPresentation: SketchToolPresentationSchema | null
  constraintAuthoring: SketchConstraintAuthoringState | null
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null
  sequence: number
  solvedRegions: RegionRecord[]
  commitRequest: Omit<CommitSketchRequest, 'contractVersion' | 'documentId' | 'baseRevisionId'> | null
  validationMessage: string | null
}

export interface SketchSessionDisplayRenderable {
  id: RenderableId
  label: string
  geometry: RenderableEntityRecord['geometry']
  target: PrimitiveRef | null
}

export type SketchHistoryCursor =
  | { kind: 'empty' }
  | { kind: 'item'; itemId: string }

export type SketchHistoryItem =
  | {
      kind: 'entity'
      id: SketchEntityId
      label: string
      target: SketchEntityRef
    }
  | {
      kind: 'constraint'
      id: ConstraintId
      label: string
      target: SketchConstraintRef
    }
  | {
      kind: 'dimension'
      id: DimensionId
      label: string
      target: SketchDimensionRef
    }

export function derivePlaneKeyFromTarget(target: SketchPlaneSupportRef): SketchPlaneKey | null {
  if (target.kind !== 'construction') {
    return null
  }

  return deriveStandardPlaneKeyFromConstructionId(target.constructionId)
}

function createPointId(sequence: number, suffix: string): SketchPointId {
  return `sketch_point_${sequence}_${suffix}` as SketchPointId
}

function createEntityId(sequence: number, suffix: string): SketchEntityId {
  return `sketch_entity_${sequence}_${suffix}` as SketchEntityId
}

function createConstraintId(sequence: number, suffix: string): ConstraintId {
  return `constraint_${sequence}_${suffix}` as ConstraintId
}

function createDimensionId(sequence: number, suffix: string): DimensionId {
  return `dimension_${sequence}_${suffix}` as DimensionId
}

function createSketchEntityRef(sketchId: SketchId, entityId: SketchEntityId): SketchEntityRef {
  return {
    kind: 'sketchEntity',
    sketchId,
    entityId,
  }
}

function createSketchPointRef(sketchId: SketchId, pointId: SketchPointId): SketchPointRef {
  return {
    kind: 'sketchPoint',
    sketchId,
    pointId,
  }
}

function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: ConstraintId,
): SketchConstraintRef {
  return {
    kind: 'constraint',
    sketchId,
    constraintId,
  }
}

function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: DimensionId,
): SketchDimensionRef {
  return {
    kind: 'dimension',
    sketchId,
    dimensionId,
  }
}

function createEmptyDefinition(): SketchDefinition {
  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  }
}

function cloneDefinition(definition: SketchDefinition): SketchDefinition {
  return {
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

export function getSketchHistoryItems(definition: SketchDefinition): SketchHistoryItem[] {
  const sketchId = getDefinitionSketchId(definition)

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

function getEntityPointIds(entity: SketchEntityDefinition) {
  switch (entity.kind) {
    case 'lineSegment':
      return [entity.startPointId, entity.endPointId]
    case 'arc':
      return [entity.startPointId, entity.endPointId, entity.centerPointId]
    case 'circle':
      return [entity.centerPointId]
    case 'point':
      return [entity.pointId]
  }
}

export function filterSketchDefinitionThroughCursor(
  definition: SketchDefinition,
  cursor: SketchHistoryCursor,
): SketchDefinition {
  const items = getSketchHistoryItems(definition)
  const cursorIndex = getSketchHistoryCursorIndex(items, cursor)
  const visibleItemIds = new Set(
    cursor.kind === 'empty'
      ? []
      : items.slice(0, cursorIndex + 1).map((item) => item.id),
  )
  const entities = definition.entities.filter((entity) => visibleItemIds.has(entity.entityId))
  const visiblePointIds = new Set(entities.flatMap((entity) => getEntityPointIds(entity)))
  const points = definition.points.filter((point) => visiblePointIds.has(point.pointId))
  const constraints = definition.constraints.filter((constraint) => visibleItemIds.has(constraint.constraintId))
  const dimensions = definition.dimensions.filter((dimension) => visibleItemIds.has(dimension.dimensionId))

  return {
    ...definition,
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
  }
}

function getNextDefinitionSequence(definition: SketchDefinition) {
  const ids = [
    ...definition.referenceIds,
    ...definition.pointIds,
    ...definition.entityIds,
    ...definition.constraintIds,
    ...definition.dimensionIds,
  ]

  let highestSequence = 0

  for (const id of ids) {
    const match = id.match(/_(\d+)_/)
    const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN

    if (!Number.isNaN(parsed)) {
      highestSequence = Math.max(highestSequence, parsed)
    }
  }

  return highestSequence
}

export function createSketchSessionFromSnapshot(sketch: SketchSnapshotRecord): SketchSessionState {
  const fullDefinition = cloneDefinition(sketch.sketch.definition)
  const historyCursor = createTailSketchHistoryCursor(fullDefinition)
  const definition = filterSketchDefinitionThroughCursor(fullDefinition, historyCursor)
  const entities = definition.entities.flatMap((entity) =>
    mapDefinitionEntityToDraftEntity(sketch.sketchId, definition.points, entity),
  )

  return {
    sketchId: sketch.sketchId,
    sketchLabel: sketch.label,
    plane: sketch.plane,
    planeTarget: sketch.planeTarget,
    planeKey: sketch.planeKey ?? 'xy',
    entities,
    definition,
    fullDefinition,
    historyCursor,
    activeTool: null,
    status: 'idle',
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: null,
    constraintAuthoring: null,
    selectedAnnotation: null,
    sequence: getNextDefinitionSequence(sketch.sketch.definition),
    solvedRegions: [...sketch.sketch.regions],
    commitRequest: buildCommitRequest({
      sketchId: sketch.sketchId,
      sketchLabel: sketch.label,
      plane: sketch.plane,
      planeTarget: sketch.planeTarget,
      planeKey: sketch.planeKey ?? 'xy',
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
    entities: [],
    definition,
    fullDefinition: cloneDefinition(definition),
    historyCursor: { kind: 'empty' },
    activeTool: null,
    status: 'idle',
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: null,
    constraintAuthoring: null,
    selectedAnnotation: null,
    sequence: 0,
    solvedRegions: [],
    commitRequest: null,
    validationMessage: null,
  }
}

function mapDefinitionEntityToDraftEntity(
  sketchId: SketchId,
  points: SketchPointDefinition[],
  entity: SketchEntityDefinition,
): SketchDraftEntity[] {
  if (entity.kind === 'lineSegment') {
    const start = points.find((point) => point.pointId === entity.startPointId)
    const end = points.find((point) => point.pointId === entity.endPointId)

    if (!start || !end) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'line',
        start: start.position,
        end: end.position,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: 'accepted',
        label: entity.label,
      },
    ]
  }

  if (entity.kind === 'point') {
    const point = points.find((entry) => entry.pointId === entity.pointId)

    if (!point) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'circle',
        center: point.position,
        radius: 0.1,
        entityId: entity.entityId,
        status: 'accepted',
        label: entity.label,
      },
    ]
  }

  if (entity.kind === 'circle') {
    const center = points.find((point) => point.pointId === entity.centerPointId)

    if (!center) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'circle',
        center: center.position,
        radius: entity.radius,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: 'accepted',
        label: entity.label,
      },
    ]
  }

  const start = points.find((point) => point.pointId === entity.startPointId)
  const end = points.find((point) => point.pointId === entity.endPointId)

  if (!start || !end) {
    return []
  }

  return [
    {
      id: entity.entityId,
      kind: 'line',
      start: start.position,
      end: end.position,
      entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
      status: 'accepted',
      label: entity.label,
    },
  ]
}

function buildCommitRequest(input: {
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

function createPointDefinition(
  sketchId: SketchId,
  pointId: SketchPointId,
  label: string,
  position: SketchPoint,
): SketchPointDefinition {
  return {
    pointId,
    label,
    target: createSketchPointRef(sketchId, pointId),
    position,
    isConstruction: false,
  }
}

function createLineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
): SketchEntityDefinition {
  return {
    kind: 'lineSegment',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction: false,
    startPointId,
    endPointId,
  }
}

function createCircleEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  radius: number,
): SketchEntityDefinition {
  return {
    kind: 'circle',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction: false,
    centerPointId,
    radius,
  }
}

function appendDefinition(definition: SketchDefinition, patch: SketchToolCommitContribution): SketchDefinition {
  return {
    schemaVersion: definition.schemaVersion,
    referenceIds: [...definition.referenceIds],
    references: [...definition.references],
    pointIds: [...definition.pointIds, ...patch.points.map((point) => point.pointId)],
    points: [...definition.points, ...patch.points],
    entityIds: [...definition.entityIds, ...patch.entities.map((entity) => entity.entityId)],
    entities: [...definition.entities, ...patch.entities],
    constraintIds: [...definition.constraintIds, ...(patch.constraints ?? []).map((constraint) => constraint.constraintId)],
    constraints: [...definition.constraints, ...(patch.constraints ?? [])],
    dimensionIds: [...definition.dimensionIds, ...(patch.dimensions ?? []).map((dimension) => dimension.dimensionId)],
    dimensions: [...definition.dimensions, ...(patch.dimensions ?? [])],
  }
}

function truncateDefinitionAfterCursor(
  definition: SketchDefinition,
  cursor: SketchHistoryCursor,
) {
  return filterSketchDefinitionThroughCursor(definition, cursor)
}

function applySketchHistoryContribution(
  session: SketchSessionState,
  patch: SketchToolCommitContribution,
) {
  const truncatedDefinition = truncateDefinitionAfterCursor(session.fullDefinition, session.historyCursor)
  const fullDefinition = appendDefinition(truncatedDefinition, patch)
  const historyCursor = createTailSketchHistoryCursor(fullDefinition)
  const definition = filterSketchDefinitionThroughCursor(fullDefinition, historyCursor)

  return {
    fullDefinition,
    historyCursor,
    definition,
  }
}

export function moveSketchHistoryCursor(
  session: SketchSessionState,
  cursor: SketchHistoryCursor,
): SketchSessionState {
  const items = getSketchHistoryItems(session.fullDefinition)
  const normalizedCursor =
    cursor.kind === 'empty' || items.some((item) => item.id === cursor.itemId)
      ? cursor
      : createTailSketchHistoryCursor(session.fullDefinition)
  const definition = filterSketchDefinitionThroughCursor(session.fullDefinition, normalizedCursor)
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)

  return {
    ...session,
    historyCursor: normalizedCursor,
    definition,
    entities: definition.entities.flatMap((entity) =>
      mapDefinitionEntityToDraftEntity(sketchId, definition.points, entity),
    ),
    selectedAnnotation: null,
    commitRequest: rebuildSessionCommitRequest(session, definition),
  }
}

function buildConstraintSelectionGuide(
  toolId: SketchConstraintToolId,
  selectedTargets: readonly SketchConstraintTargetRecord[],
  hoverTarget: SketchConstraintTargetRecord | null,
): SketchToolSelectionGuideDescriptor {
  const definition = getSketchConstraintDefinition(toolId)
  const step = definition.steps[Math.min(selectedTargets.length, definition.steps.length - 1)]

  return {
    id: `${toolId}-selection-guide`,
    label: step?.label ?? definition.metadata.name,
    acceptedKinds: step?.acceptedKinds ?? ['annotation'],
    selectedCount: selectedTargets.length,
    requiredCount: definition.steps.length,
    hoverLabel: hoverTarget?.label ?? null,
  }
}

function buildConstraintToolPresentation(authoring: SketchConstraintAuthoringState): SketchToolPresentationSchema {
  const definition = getSketchConstraintDefinition(authoring.toolId)
  const selectionGuide = buildConstraintSelectionGuide(
    authoring.toolId,
    authoring.selectedTargets,
    authoring.hoverTarget,
  )
  const needsValue =
    Boolean(definition.valueSpec) && authoring.selectedTargets.length >= definition.steps.length
  const promptText = needsValue
    ? `Enter ${definition.valueSpec?.label.toLowerCase() ?? 'value'}`
    : selectionGuide.label

  const floatingInput: SketchToolFloatingInputDescriptor | null = needsValue && definition.valueSpec
    ? {
        id: `${authoring.toolId}-value-input`,
        label: definition.valueSpec.label,
        value: authoring.pendingValue,
        unit: definition.valueSpec.unit,
        min: definition.valueSpec.min,
        confirmLabel: 'Commit',
        cancelLabel: 'Cancel',
        anchor: authoring.selectedTargets[authoring.selectedTargets.length - 1]?.anchor,
        submitAction: { type: 'patch', patch: { intent: 'commitConstraintValue' } },
        cancelAction: { type: 'patch', patch: { intent: 'cancelConstraintValue' } },
      }
    : null

  return {
    prompts: [
      {
        id: `${authoring.toolId}-prompt`,
        text: promptText,
      },
    ],
    steps: definition.steps.map((step) => ({
      id: step.id,
      label: step.label,
    })),
    cursor: {
      id: `${authoring.toolId}-cursor`,
      label: definition.metadata.name,
      icon: definition.metadata.group === 'dimensions' ? 'dimension' : 'constraint',
    },
    selectionGuide,
    overlays: definition.buildPreview({
      selectedTargets: authoring.selectedTargets,
      hoverTarget: authoring.hoverTarget,
      value: authoring.pendingValue,
    }),
    floatingInput,
    completionHints: [
      {
        id: `${authoring.toolId}-completion`,
        text: needsValue
          ? 'Confirm the entered value to commit the annotation'
          : `Select ${definition.steps.length} target${definition.steps.length === 1 ? '' : 's'}`,
        ready: needsValue ? authoring.pendingValue !== null : false,
      },
    ],
  }
}

function activateSketchConstraintTool(
  session: SketchSessionState,
  toolId: SketchConstraintToolId,
): SketchSessionState {
  const definition = getSketchConstraintDefinition(toolId)
  const authoring: SketchConstraintAuthoringState = {
    toolId,
    selectedTargets: [],
    hoverTarget: null,
    pendingValue: definition.valueSpec?.defaultValue ?? null,
  }

  return {
    ...session,
    activeTool: toolId,
    status: 'collectingTargets',
    pointerDownPoint: null,
    livePoint: null,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: null,
    toolPresentation: buildConstraintToolPresentation(authoring),
    constraintAuthoring: authoring,
    selectedAnnotation: null,
  }
}

function rebuildSessionCommitRequest(session: SketchSessionState, definition: SketchDefinition) {
  return buildCommitRequest({
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: session.plane,
    planeTarget: session.planeTarget,
    planeKey: session.planeKey,
    definition,
  })
}

function normalizeConstraintValue(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return value
}

function getTargetKey(target: PrimitiveRef) {
  switch (target.kind) {
    case 'sketchPoint':
      return target.pointId
    case 'sketchEntity':
      return target.entityId
    case 'constraint':
      return target.constraintId
    case 'dimension':
      return target.dimensionId
    case 'sketch':
      return target.sketchId
    case 'body':
      return target.bodyId
    case 'face':
      return `${target.bodyId}:${target.faceId}`
    case 'edge':
      return `${target.bodyId}:${target.edgeId}`
    case 'vertex':
      return `${target.bodyId}:${target.vertexId}`
    case 'loop':
      return `${target.bodyId}:${target.loopId}`
    case 'feature':
      return target.featureId
    case 'construction':
      return target.constructionId
    case 'region':
      return `${target.sketchId}:${target.regionId}`
  }
}

export function beginSketchTool(session: SketchSessionState, toolId: SketchAuthoringToolId): SketchSessionState {
  if (isRegisteredSketchConstraintToolId(toolId)) {
    return activateSketchConstraintTool(session, toolId)
  }

  const toolDefinition = getSketchToolDefinition(toolId)
  const activation = toolDefinition.activate()

  return {
    ...session,
    activeTool: toolId,
    status: activation.state.status,
    pointerDownPoint: activation.state.pointerDownPoint,
    livePoint: activation.state.livePoint,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: activation.state.validationMessage,
    toolPresentation: activation.presentation,
    constraintAuthoring: null,
    selectedAnnotation: null,
  }
}

export function clearActiveSketchTool(session: SketchSessionState): SketchSessionState {
  if (session.activeTool === null) {
    return session
  }

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    pointerDownPoint: null,
    livePoint: null,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: null,
    toolPresentation: null,
    constraintAuthoring: null,
    selectedAnnotation: null,
  }
}

export function updateSketchPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  if (session.activeTool === null || isRegisteredSketchConstraintToolId(session.activeTool)) {
    return session
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const result = toolDefinition.pointerMove({
    state: getToolRuntimeState(session),
    point,
  })

  return {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    entities: [
      ...session.entities.filter((entity) => entity.status === 'accepted'),
      ...result.stagedEntities,
    ],
    validationMessage: result.state.validationMessage,
    toolPresentation: result.presentation,
  }
}

export function startSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (session.activeTool === null || isRegisteredSketchConstraintToolId(session.activeTool)) {
    return session
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const result = toolDefinition.pointerRelease({
    state: {
      status: 'idle',
      pointerDownPoint: null,
      livePoint: null,
      validationMessage: null,
    } satisfies import('@/domain/sketch-tools/definition').SketchToolRuntimeState,
    point,
  })

  return {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    entities: [
      ...session.entities.filter((entity) => entity.status === 'accepted'),
      ...result.stagedEntities,
    ],
    validationMessage: result.state.validationMessage,
    toolPresentation: result.presentation,
  }
}

export function acceptSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (
    session.activeTool === null
    || isRegisteredSketchConstraintToolId(session.activeTool)
    || session.pointerDownPoint === null
  ) {
    return session
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const result = toolDefinition.pointerRelease({
    state: getToolRuntimeState(session),
    point,
  })

  if (result.state.validationMessage) {
    return {
      ...session,
      entities: session.entities.filter((entity) => entity.status === 'accepted'),
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      validationMessage: result.state.validationMessage,
      toolPresentation: result.presentation,
    }
  }

  const nextSequence = session.sequence + 1
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const definitionPatch = toolDefinition.createCommitContribution({
    sequence: nextSequence,
    start: session.pointerDownPoint,
    end: point,
    factories: {
      createPointId: (suffix) => createPointId(nextSequence, suffix),
      createEntityId: (suffix) => createEntityId(nextSequence, suffix),
      createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
      createDimensionId: (suffix) => createDimensionId(nextSequence, suffix),
      createPoint: (label, pointId, position) =>
        createPointDefinition(sketchId, pointId, label, position),
      createLineEntity: (label, entityId, startPointId, endPointId) =>
        createLineEntityDefinition(sketchId, entityId, label, startPointId, endPointId),
      createCircleEntity: (label, entityId, centerPointId, radius) =>
        createCircleEntityDefinition(sketchId, entityId, label, centerPointId, radius),
    },
  })
  const history = applySketchHistoryContribution(session, definitionPatch)
  const acceptedEntities = history.definition.entities.flatMap((entity) =>
    mapDefinitionEntityToDraftEntity(sketchId, history.definition.points, entity),
  )

  return {
    ...session,
    entities: acceptedEntities,
    definition: history.definition,
    fullDefinition: history.fullDefinition,
    historyCursor: history.historyCursor,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    sequence: nextSequence,
    commitRequest: buildCommitRequest({
      sketchId: session.sketchId,
      sketchLabel: session.sketchLabel,
      plane: session.plane,
      planeTarget: session.planeTarget,
      planeKey: session.planeKey,
      definition: history.definition,
    }),
    validationMessage: null,
    toolPresentation: result.presentation,
    selectedAnnotation: null,
  }
}

function getToolRuntimeState(session: SketchSessionState): import('@/domain/sketch-tools/definition').SketchToolRuntimeState {
  return {
    status: session.status === 'drawing' ? 'drawing' : 'idle',
    pointerDownPoint: session.pointerDownPoint,
    livePoint: session.livePoint,
    validationMessage: session.validationMessage,
  }
}

export function getSketchSessionPreviewLabel(session: SketchSessionState): string {
  if (session.constraintAuthoring) {
    const definition = getSketchConstraintDefinition(session.constraintAuthoring.toolId)

    if (session.status === 'awaitingValue') {
      return `Enter ${definition.valueSpec?.label.toLowerCase() ?? 'value'}`
    }

    const step =
      definition.steps[
        Math.min(
          session.constraintAuthoring.selectedTargets.length,
          definition.steps.length - 1,
        )
      ]

    return step?.label ?? definition.metadata.name
  }

  const primaryPrompt = session.toolPresentation?.validation?.[0]?.message
    ?? session.toolPresentation?.prompts[0]?.text

  if (primaryPrompt) {
    return primaryPrompt
  }

  if (session.activeTool === null) {
    return session.definition.entityIds.length > 0
      ? `Sketch has ${session.definition.entityIds.length} authored entities`
      : 'Sketch session ready'
  }

  if (session.status === 'drawing') {
    return `${session.activeTool} preview active, click again to accept`
  }

  return `Ready to place ${session.activeTool}, click to set first point`
}

export function getSketchToolPresentation(session: SketchSessionState): SketchToolPresentationSchema | null {
  if (session.activeTool === null) {
    return null
  }

  if (isRegisteredSketchConstraintToolId(session.activeTool)) {
    return session.toolPresentation
  }

  return session.toolPresentation
    ?? getSketchToolDefinition(session.activeTool).getPresentation(getToolRuntimeState(session))
}

export function updateSketchConstraintHover(
  session: SketchSessionState,
  target: PrimitiveRef | null,
): SketchSessionState {
  const authoring = session.constraintAuthoring

  if (!authoring) {
    return session
  }

  const hoverTarget =
    target === null
      ? null
      : resolveSketchConstraintTarget(authoring.toolId, session.definition, target)

  return {
    ...session,
    toolPresentation: buildConstraintToolPresentation({
      ...authoring,
      hoverTarget,
    }),
    constraintAuthoring: {
      ...authoring,
      hoverTarget,
    },
  }
}

export function selectSketchConstraintTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  const authoring = session.constraintAuthoring

  if (!authoring) {
    return session
  }

  const resolved = resolveSketchConstraintTarget(authoring.toolId, session.definition, target)

  if (!resolved) {
    return session
  }

  if (authoring.selectedTargets.some((entry) => getTargetKey(entry.target) === getTargetKey(resolved.target))) {
    return session
  }

  const nextTargets = [...authoring.selectedTargets, resolved].slice(
    0,
    getSketchConstraintDefinition(authoring.toolId).steps.length,
  )
  const definition = getSketchConstraintDefinition(authoring.toolId)
  const readyForValue = Boolean(definition.valueSpec) && nextTargets.length >= definition.steps.length
  const nextSession: SketchSessionState = {
    ...session,
    status: readyForValue ? 'awaitingValue' : 'collectingTargets',
    toolPresentation: buildConstraintToolPresentation({
      ...authoring,
      selectedTargets: nextTargets,
      hoverTarget: null,
    }),
    constraintAuthoring: {
      ...authoring,
      selectedTargets: nextTargets,
      hoverTarget: null,
    },
    selectedAnnotation: null,
  }

  if (!definition.valueSpec && nextTargets.length >= definition.steps.length) {
    return commitSketchConstraintAuthoring(nextSession)
  }

  return nextSession
}

export function patchSketchConstraintValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const authoring = session.constraintAuthoring

  if (!authoring) {
    return session
  }

  const intent = patch.intent

  if (intent === 'cancelConstraintValue') {
    return activateSketchConstraintTool(session, authoring.toolId)
  }

  if ('value' in patch) {
    const nextAuthoring = {
      ...authoring,
      pendingValue: normalizeConstraintValue(patch.value as number | null | undefined),
    }

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
    }
  }

  if (intent !== 'commitConstraintValue') {
    return session
  }

  return commitSketchConstraintAuthoring(session)
}

function commitSketchConstraintAuthoring(session: SketchSessionState): SketchSessionState {
  const authoring = session.constraintAuthoring

  if (!authoring) {
    return session
  }

  const definition = getSketchConstraintDefinition(authoring.toolId)
  const contribution = definition.createCommitContribution({
    sequence: session.sequence + 1,
    selectedTargets: authoring.selectedTargets,
    value: authoring.pendingValue,
    createConstraintId: (suffix) => createConstraintId(session.sequence + 1, suffix),
    createDimensionId: (suffix) => createDimensionId(session.sequence + 1, suffix),
  })
  const history = applySketchHistoryContribution(session, {
    points: [],
    entities: [],
    ...contribution,
  })

  return {
    ...session,
    definition: history.definition,
    fullDefinition: history.fullDefinition,
    historyCursor: history.historyCursor,
    sequence: session.sequence + 1,
    status: 'idle',
    constraintAuthoring: null,
    commitRequest: rebuildSessionCommitRequest(session, history.definition),
    selectedAnnotation: null,
    toolPresentation: null,
    activeTool: null,
  }
}

export function selectSketchAnnotation(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef | null,
): SketchSessionState {
  return {
    ...session,
    selectedAnnotation: target,
  }
}

export function deleteSelectedSketchAnnotation(session: SketchSessionState): SketchSessionState {
  const selectedAnnotation = session.selectedAnnotation

  if (!selectedAnnotation) {
    return session
  }

  const nextFullDefinition =
    selectedAnnotation.kind === 'constraint'
      ? {
          ...session.fullDefinition,
          constraintIds: session.fullDefinition.constraintIds.filter(
            (constraintId) => constraintId !== selectedAnnotation.constraintId,
          ),
          constraints: session.fullDefinition.constraints.filter(
            (constraint) => constraint.constraintId !== selectedAnnotation.constraintId,
          ),
        }
      : {
          ...session.fullDefinition,
          dimensionIds: session.fullDefinition.dimensionIds.filter(
            (dimensionId) => dimensionId !== selectedAnnotation.dimensionId,
          ),
          dimensions: session.fullDefinition.dimensions.filter(
            (dimension) => dimension.dimensionId !== selectedAnnotation.dimensionId,
          ),
        }
  const historyCursor = createTailSketchHistoryCursor(nextFullDefinition)
  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, historyCursor)
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    historyCursor,
    entities: nextDefinition.entities.flatMap((entity) =>
      mapDefinitionEntityToDraftEntity(sketchId, nextDefinition.points, entity),
    ),
    selectedAnnotation: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
  }
}

export function getSketchAnnotationDescriptors(
  session: SketchSessionState,
): SketchAnnotationDescriptor[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)

  return [
    ...session.definition.constraints.map((constraint) => ({
      id: constraint.constraintId,
      target: createSketchConstraintRef(sketchId, constraint.constraintId),
      label: constraint.label,
      detail: describeConstraint(constraint),
      status: 'constraint' as const,
    })),
    ...session.definition.dimensions.map((dimension) => ({
      id: dimension.dimensionId,
      target: createSketchDimensionRef(sketchId, dimension.dimensionId),
      label: dimension.label,
      detail: describeDimension(dimension),
      status: 'dimension' as const,
    })),
  ]
}

export function getSketchSessionDisplayRenderables(session: SketchSessionState): SketchSessionDisplayRenderable[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)

  return [
    ...session.definition.points.map((point) => ({
      id: `renderable_sketch_point_${point.pointId}` as RenderableId,
      label: point.label,
      target: createSketchPointRef(sketchId, point.pointId),
      geometry: {
        kind: 'marker' as const,
        position: mapSketchPointToWorld(session.plane, point.position),
        displayRadius: 0.16,
      },
    })),
    ...session.entities.map((entity, index) => createDisplayRenderableForEntity(session, entity, index)),
  ]
}

function createDisplayRenderableForEntity(
  session: SketchSessionState,
  entity: SketchDraftEntity,
  index: number,
): SketchSessionDisplayRenderable {
  if (entity.kind === 'line') {
    return {
      id: `renderable_sketch_line_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
        : null,
      geometry: {
        kind: 'polyline',
        points: [
          mapSketchPointToWorld(session.plane, entity.start),
          mapSketchPointToWorld(session.plane, entity.end),
        ],
        isClosed: false,
      },
    }
  }

  const pointCount = 48
  const points = Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
    const angle = (Math.PI * 2 * pointIndex) / pointCount
    return mapSketchPointToWorld(session.plane, [
      entity.center[0] + Math.cos(angle) * entity.radius,
      entity.center[1] + Math.sin(angle) * entity.radius,
    ])
  })

  return {
    id: `renderable_sketch_circle_${index}` as RenderableId,
    label: entity.label,
    target: entity.entityId
      ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
      : null,
    geometry: {
      kind: 'polyline',
      points,
      isClosed: true,
    },
  }
}

function describeConstraint(constraint: ConstraintDefinition) {
  switch (constraint.kind) {
    case 'coincident':
      return 'Coincident points'
    case 'parallel':
      return 'Parallel lines'
    case 'equalLength':
      return 'Equal-length lines'
    case 'horizontal':
      return 'Horizontal line'
    case 'vertical':
      return 'Vertical line'
    case 'fixPoint':
      return 'Fixed point'
    case 'angle':
      return `${(constraint.valueRadians * 180 / Math.PI).toFixed(1)} deg`
    case 'perpendicular':
      return 'Perpendicular lines'
  }
}

function describeDimension(dimension: DimensionDefinition) {
  switch (dimension.kind) {
    case 'distance':
      return `${dimension.value.toFixed(2)} ${dimension.axis}`
    case 'horizontalDistance':
    case 'verticalDistance':
      return `${dimension.value.toFixed(2)} mm`
    case 'circleRadius':
      return `${dimension.value.toFixed(2)} mm`
    case 'arcStartPointCoincident':
      return 'Arc start coincident'
    case 'arcEndPointCoincident':
      return 'Arc end coincident'
  }
}

export function mapSketchPointToWorld(
  plane: SketchPlaneDefinition,
  point: SketchPoint,
): readonly [number, number, number] {
  return mapSketchPointToWorldFromPlane(plane, point)
}
