import type {
  ConstraintDefinition,
  DimensionDefinition,
  RegionRecord,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import { SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionCore,
  solveSketchDefinitionWithDraggedPointTarget,
} from '@/contracts/sketch/solver-core'
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
  SketchToolAnchorDescriptor,
  SketchToolFloatingInputDescriptor,
  SketchToolOverlayDescriptor,
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

export type SketchConstructionToolId = 'construction'
export type SketchAuthoringToolId = SketchToolId | SketchConstraintToolId | SketchConstructionToolId
export type SketchSessionStatus = 'idle' | 'drawing' | 'collectingTargets' | 'awaitingValue'

export interface SketchConstraintAuthoringState {
  toolId: SketchConstraintToolId
  selectedTargets: SketchConstraintTargetRecord[]
  hoverTarget: SketchConstraintTargetRecord | null
  pointer: SketchPoint | null
  isPreviewPinned: boolean
  pendingValue: number | null
}

export interface SketchAnnotationEditState {
  target: SketchConstraintRef | SketchDimensionRef
  pendingValue: number | null
}

export interface SketchAnnotationDescriptor {
  id: string
  target: SketchConstraintRef | SketchDimensionRef
  glyphKind: SketchAnnotationGlyphKind
  anchor: SketchToolAnchorDescriptor
  affectedGeometryRefs: readonly (SketchEntityRef | SketchPointRef)[]
  label: string
  detail: string
  status: 'constraint' | 'dimension'
}

export type SketchAnnotationGlyphKind =
  | 'constraintCoincident'
  | 'constraintParallel'
  | 'constraintEqual'
  | 'constraintHorizontal'
  | 'constraintVertical'
  | 'constraintFixed'
  | 'constraintAngle'
  | 'constraintPerpendicular'
  | 'dimensionDistance'
  | 'dimensionHorizontal'
  | 'dimensionVertical'
  | 'dimensionRadius'
  | 'dimensionCoincident'

export interface SketchGeometryDragState {
  target: SketchPointRef
  startPoint: SketchPoint
  currentPoint: SketchPoint
  status: 'dragging' | 'blocked'
  message: string | null
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
  constructionTargetPicking: boolean
  constructionModifierActive: boolean
  pointerDownPoint: SketchPoint | null
  livePoint: SketchPoint | null
  toolPresentation: SketchToolPresentationSchema | null
  constraintAuthoring: SketchConstraintAuthoringState | null
  activeAnnotationEdit: SketchAnnotationEditState | null
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null
  activeEditTarget: SketchPointRef | null
  activeDrag: SketchGeometryDragState | null
  sequence: number
  solvedRegions: RegionRecord[]
  commitRequest: Omit<CommitSketchRequest, 'contractVersion' | 'documentId' | 'baseRevisionId'> | null
  validationMessage: string | null
}

const SKETCH_DIRECT_EDIT_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const

const CONSTRAINED_DRAG_BLOCKED_MESSAGE = 'Geometry is constrained and cannot move to that position.'
const ANNOTATION_EDIT_SOLVE_BLOCKED_MESSAGE = 'Could not solve the edited constraint value.'

export interface SketchSessionDisplayRenderable {
  id: RenderableId
  label: string
  geometry: RenderableEntityRecord['geometry']
  target: PrimitiveRef | null
  linePattern: 'solid' | 'dashed'
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
    constructionTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
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
    constructionTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
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
        isConstruction: entity.isConstruction,
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
        isConstruction: entity.isConstruction,
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
        isConstruction: entity.isConstruction,
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
      isConstruction: entity.isConstruction,
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
  isConstruction = false,
): SketchPointDefinition {
  return {
    pointId,
    label,
    target: createSketchPointRef(sketchId, pointId),
    position,
    isConstruction,
  }
}

function createLineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'lineSegment',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
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
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'circle',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
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
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
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
  const overlays = definition.buildPreview({
    selectedTargets: authoring.selectedTargets,
    hoverTarget: authoring.hoverTarget,
    pointer: authoring.pointer,
    value: authoring.pendingValue,
  })
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
        anchor: getConstraintFloatingInputAnchor(authoring, overlays),
        placement: 'previewReference',
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
    overlays,
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

function getConstraintFloatingInputAnchor(
  authoring: SketchConstraintAuthoringState,
  overlays: readonly SketchToolOverlayDescriptor[],
): SketchToolAnchorDescriptor | undefined {
  const previewAnchor = overlays.find((overlay) =>
    overlay.kind === 'dimensionLine' || overlay.kind === 'angleArc',
  )

  if (previewAnchor?.kind === 'dimensionLine' || previewAnchor?.kind === 'angleArc') {
    return addAnchorOffset(previewAnchor.labelAnchor, { x: 18, y: -12 })
  }

  if (authoring.pointer) {
    return { kind: 'cursor', point: authoring.pointer, offset: { x: 18, y: -18 } }
  }

  const lastTarget = authoring.selectedTargets[authoring.selectedTargets.length - 1]

  return lastTarget
    ? { kind: 'sketchPoint', point: lastTarget.anchor, offset: { x: 18, y: -18 } }
    : undefined
}

function addAnchorOffset(
  anchor: SketchToolAnchorDescriptor,
  offset: { x: number; y: number },
): SketchToolAnchorDescriptor {
  const currentOffset = anchor.offset ?? { x: 0, y: 0 }

  return {
    ...anchor,
    offset: {
      x: currentOffset.x + offset.x,
      y: currentOffset.y + offset.y,
    },
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
    pointer: null,
    isPreviewPinned: false,
    pendingValue: definition.valueSpec?.defaultValue ?? null,
  }

  return {
    ...session,
    activeTool: toolId,
    status: 'collectingTargets',
    constructionTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: null,
    toolPresentation: buildConstraintToolPresentation(authoring),
    constraintAuthoring: authoring,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
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

function buildConstructionTargetPresentation(): SketchToolPresentationSchema {
  return {
    prompts: [
      {
        id: 'construction-prompt',
        text: 'Select sketch geometry to toggle construction',
      },
    ],
    steps: [{ id: 'construction-target', label: 'Sketch geometry' }],
    selectionGuide: {
      id: 'construction-selection-guide',
      label: 'Select sketch geometry',
      acceptedKinds: ['point', 'line', 'circle', 'arc'],
      selectedCount: 0,
      requiredCount: 1,
      hoverLabel: null,
    },
    completionHints: [
      {
        id: 'construction-completion',
        text: 'Select an edge or vertex to toggle construction',
        ready: false,
      },
    ],
  }
}

function withConstructionFlag(
  entities: readonly SketchDraftEntity[],
  isConstruction: boolean,
): readonly SketchDraftEntity[] {
  return isConstruction
    ? entities.map((entity) => ({ ...entity, isConstruction: true }))
    : entities
}

function isDrawingSketchTool(toolId: SketchAuthoringToolId | null): toolId is SketchToolId {
  return toolId !== null && !isRegisteredSketchConstraintToolId(toolId) && toolId !== 'construction'
}

export function isSketchConstructionSelected(session: SketchSessionState) {
  return session.constructionTargetPicking || session.constructionModifierActive
}

function beginSketchConstructionTool(session: SketchSessionState): SketchSessionState {
  if (isSketchConstructionSelected(session)) {
    return {
      ...session,
      activeTool: null,
      status: 'idle',
      constructionTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      entities: session.entities.filter((entity) => entity.status === 'accepted'),
      validationMessage: null,
      toolPresentation: null,
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      selectedAnnotation: null,
      activeEditTarget: null,
      activeDrag: null,
    }
  }

  return {
    ...session,
    activeTool: 'construction',
    status: 'collectingTargets',
    constructionTargetPicking: true,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: null,
    toolPresentation: buildConstructionTargetPresentation(),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
  }
}

export function beginSketchTool(session: SketchSessionState, toolId: SketchAuthoringToolId): SketchSessionState {
  if (toolId === 'construction') {
    return beginSketchConstructionTool(session)
  }

  if (isRegisteredSketchConstraintToolId(toolId)) {
    return {
      ...activateSketchConstraintTool(session, toolId),
      constructionTargetPicking: false,
    }
  }

  const toolDefinition = getSketchToolDefinition(toolId)
  const activation = toolDefinition.activate()
  const constructionModifierActive =
    session.constructionModifierActive || session.constructionTargetPicking

  return {
    ...session,
    activeTool: toolId,
    status: activation.state.status,
    constructionTargetPicking: false,
    constructionModifierActive,
    pointerDownPoint: activation.state.pointerDownPoint,
    livePoint: activation.state.livePoint,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: activation.state.validationMessage,
    toolPresentation: activation.presentation,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
  }
}

export function clearActiveSketchTool(session: SketchSessionState): SketchSessionState {
  if (session.activeTool === null && !isSketchConstructionSelected(session)) {
    return session
  }

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    entities: session.entities.filter((entity) => entity.status === 'accepted'),
    validationMessage: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
  }
}

export function updateSketchPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  if (session.activeTool !== null && isRegisteredSketchConstraintToolId(session.activeTool)) {
    if (!session.constraintAuthoring) {
      return session
    }

    if (session.constraintAuthoring.isPreviewPinned) {
      return session
    }

    const nextAuthoring: SketchConstraintAuthoringState = {
      ...session.constraintAuthoring,
      pointer: point,
    }

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
    }
  }

  if (!isDrawingSketchTool(session.activeTool)) {
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
      ...withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
    ],
    validationMessage: result.state.validationMessage,
    toolPresentation: result.presentation,
  }
}

export function selectSketchEditTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (target.kind !== 'sketchPoint') {
    return session
  }

  if (target.sketchId !== getSessionSketchId(session)) {
    return session
  }

  if (!session.definition.points.some((point) => point.pointId === target.pointId)) {
    return session
  }

  return {
    ...session,
    activeEditTarget: target,
    activeDrag: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    validationMessage: null,
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
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    entities: selected.entities.filter((entity) => entity.status === 'accepted'),
    activeDrag: {
      target,
      startPoint: point,
      currentPoint: point,
      status: 'dragging',
      message: null,
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

  const updated = applySketchGeometryDrag(session, point, true)

  return {
    ...updated,
    activeDrag: null,
  }
}

function applySketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  complete: boolean,
): SketchSessionState {
  const drag = session.activeDrag

  if (!drag) {
    return session
  }

  const edit = solveDraggedPointEdit(session.definition, drag.target.pointId, point)

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
  const sketchId = getSessionSketchId(session)

  return {
    ...session,
    definition,
    fullDefinition,
    entities: definition.entities.flatMap((entity) =>
      mapDefinitionEntityToDraftEntity(sketchId, definition.points, entity),
    ),
    activeDrag: complete
      ? null
      : {
          ...drag,
          currentPoint: point,
          status: 'dragging',
          message: null,
        },
    commitRequest: rebuildSessionCommitRequest(session, definition),
    validationMessage: null,
  }
}

function solveDraggedPointEdit(
  definition: SketchDefinition,
  pointId: SketchPointId,
  position: SketchPoint,
): { kind: 'accepted'; definition: SketchDefinition } | { kind: 'blocked'; message: string } {
  if (!definition.points.some((point) => point.pointId === pointId)) {
    return { kind: 'blocked', message: 'Sketch point is no longer editable.' }
  }

  if (definition.constraints.length === 0 && definition.dimensions.length === 0) {
    return {
      kind: 'accepted',
      definition: applyPointPositionsToDefinition(definition, [{ pointId, position }]),
    }
  }

  const solved = solveSketchDefinitionWithDraggedPointTarget({
    definition,
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
  }
}

function applyPointPositionsToDefinition(
  definition: SketchDefinition,
  positions: readonly Pick<SketchPointDefinition, 'pointId' | 'position'>[],
): SketchDefinition {
  const positionMap = new Map(positions.map((point) => [point.pointId, point.position]))

  if (positionMap.size === 0) {
    return definition
  }

  return {
    ...definition,
    points: definition.points.map((point) => {
      const position = positionMap.get(point.pointId)
      return position ? { ...point, position } : point
    }),
  }
}

export function toggleSketchConstructionTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    !session.constructionTargetPicking
    || (target.kind !== 'sketchEntity' && target.kind !== 'sketchPoint')
    || target.sketchId !== getSessionSketchId(session)
  ) {
    return session
  }

  const nextFullDefinition = toggleConstructionTargetInDefinition(session.fullDefinition, target)

  if (nextFullDefinition === session.fullDefinition) {
    return session
  }

  const definition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)
  const sketchId = getSessionSketchId(session)

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    fullDefinition: nextFullDefinition,
    definition,
    entities: definition.entities.flatMap((entity) =>
      mapDefinitionEntityToDraftEntity(sketchId, definition.points, entity),
    ),
    commitRequest: rebuildSessionCommitRequest(session, definition),
    validationMessage: null,
  }
}

function toggleConstructionTargetInDefinition(
  definition: SketchDefinition,
  target: PrimitiveRef,
): SketchDefinition {
  if (target.kind === 'sketchEntity') {
    const selectedEntity = definition.entities.find((entity) => entity.entityId === target.entityId)

    if (!selectedEntity) {
      return definition
    }

    const isConstruction = !selectedEntity.isConstruction
    const points =
      selectedEntity.kind === 'point'
        ? definition.points.map((point) =>
            point.pointId === selectedEntity.pointId ? { ...point, isConstruction } : point,
          )
        : definition.points

    return {
      ...definition,
      points,
      entities: definition.entities.map((entity) =>
        entity.entityId === target.entityId ? { ...entity, isConstruction } : entity,
      ),
    }
  }

  if (target.kind !== 'sketchPoint') {
    return definition
  }

  const selectedPoint = definition.points.find((point) => point.pointId === target.pointId)

  if (!selectedPoint) {
    return definition
  }

  const isConstruction = !selectedPoint.isConstruction

  return {
    ...definition,
    points: definition.points.map((point) =>
      point.pointId === target.pointId ? { ...point, isConstruction } : point,
    ),
    entities: definition.entities.map((entity) =>
      entity.kind === 'point' && entity.pointId === target.pointId
        ? { ...entity, isConstruction }
        : entity,
    ),
  }
}

function getSessionSketchId(session: SketchSessionState): SketchId {
  return session.sketchId ?? ('sketch_draft' as SketchId)
}

export function startSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
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
      ...withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
    ],
    validationMessage: result.state.validationMessage,
    toolPresentation: result.presentation,
  }
}

export function acceptSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool)
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
    isConstruction: session.constructionModifierActive,
    factories: {
      createPointId: (suffix) => createPointId(nextSequence, suffix),
      createEntityId: (suffix) => createEntityId(nextSequence, suffix),
      createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
      createDimensionId: (suffix) => createDimensionId(nextSequence, suffix),
      createPoint: (label, pointId, position) =>
        createPointDefinition(sketchId, pointId, label, position, session.constructionModifierActive),
      createLineEntity: (label, entityId, startPointId, endPointId) =>
        createLineEntityDefinition(sketchId, entityId, label, startPointId, endPointId, session.constructionModifierActive),
      createCircleEntity: (label, entityId, centerPointId, radius) =>
        createCircleEntityDefinition(sketchId, entityId, label, centerPointId, radius, session.constructionModifierActive),
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
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
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
  if (session.activeAnnotationEdit) {
    return session.toolPresentation?.prompts[0]?.text ?? 'Edit annotation value'
  }

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

  if (session.validationMessage) {
    return session.validationMessage
  }

  if (session.activeDrag?.status === 'dragging') {
    return 'Dragging sketch point'
  }

  if (session.activeEditTarget) {
    return 'Sketch point selected'
  }

  if (session.constructionTargetPicking) {
    return 'Select sketch geometry to toggle construction'
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
  if (session.activeAnnotationEdit) {
    return session.toolPresentation
  }

  if (session.activeTool === 'construction') {
    return session.toolPresentation
  }

  if (session.constraintAuthoring) {
    return session.toolPresentation
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    return null
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
      isPreviewPinned: false,
    }),
    constraintAuthoring: {
      ...authoring,
      selectedTargets: nextTargets,
      hoverTarget: null,
      isPreviewPinned: false,
    },
    activeAnnotationEdit: null,
    selectedAnnotation: null,
  }

  if (!definition.valueSpec && nextTargets.length >= definition.steps.length) {
    return commitSketchConstraintAuthoring(nextSession)
  }

  return nextSession
}

export function pinSketchConstraintPreview(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  const authoring = session.constraintAuthoring

  if (!authoring || session.status !== 'awaitingValue' || authoring.isPreviewPinned) {
    return session
  }

  const nextAuthoring: SketchConstraintAuthoringState = {
    ...authoring,
    pointer: point ?? authoring.pointer,
    isPreviewPinned: true,
  }

  return {
    ...session,
    toolPresentation: buildConstraintToolPresentation(nextAuthoring),
    constraintAuthoring: nextAuthoring,
  }
}

export function patchSketchConstraintValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const authoring = session.constraintAuthoring

  if (session.activeAnnotationEdit) {
    return patchSketchAnnotationEditValue(session, patch)
  }

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

export function beginSketchAnnotationEdit(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
): SketchSessionState {
  const editable = getEditableAnnotationValue(session, target)

  if (!editable) {
    return {
      ...session,
      status: 'idle',
      toolPresentation: null,
      activeAnnotationEdit: null,
      selectedAnnotation: target,
      activeEditTarget: null,
      activeDrag: null,
      validationMessage: null,
    }
  }

  const edit: SketchAnnotationEditState = {
    target,
    pendingValue: editable.value,
  }

  return {
    ...session,
    activeTool: null,
    status: 'awaitingValue',
    pointerDownPoint: null,
    livePoint: null,
    toolPresentation: buildAnnotationEditPresentation(session, edit),
    constraintAuthoring: null,
    activeAnnotationEdit: edit,
    selectedAnnotation: target,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
  }
}

function patchSketchAnnotationEditValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const edit = session.activeAnnotationEdit

  if (!edit) {
    return session
  }

  const intent = patch.intent

  if (intent === 'cancelAnnotationValue') {
    return clearSketchAnnotationEdit(session)
  }

  if ('value' in patch) {
    const nextEdit = {
      ...edit,
      pendingValue: normalizeConstraintValue(patch.value as number | null | undefined),
    }

    return {
      ...session,
      activeAnnotationEdit: nextEdit,
      toolPresentation: buildAnnotationEditPresentation(session, nextEdit),
    }
  }

  if (intent !== 'commitAnnotationValue') {
    return session
  }

  if (edit.pendingValue === null) {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(session, edit, 'Enter a value before saving.'),
    }
  }

  return commitSketchAnnotationEditValue(session, edit)
}

function clearSketchAnnotationEdit(session: SketchSessionState): SketchSessionState {
  return {
    ...session,
    status: 'idle',
    toolPresentation: null,
    activeAnnotationEdit: null,
    validationMessage: null,
  }
}

function commitSketchAnnotationEditValue(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
): SketchSessionState {
  const updatedFullDefinition = updateAnnotationValueInDefinition(
    session.fullDefinition,
    edit.target,
    edit.pendingValue,
  )

  if (updatedFullDefinition === session.fullDefinition) {
    return session
  }

  const solved = solveEditedAnnotationDefinition(updatedFullDefinition)

  if (solved.kind === 'blocked') {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(session, edit, solved.message),
      validationMessage: solved.message,
    }
  }

  const nextFullDefinition = solved.definition
  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    entities: nextDefinition.entities.flatMap((entity) =>
      mapDefinitionEntityToDraftEntity(sketchId, nextDefinition.points, entity),
    ),
    status: 'idle',
    toolPresentation: null,
    activeAnnotationEdit: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
  }
}

function solveEditedAnnotationDefinition(definition: SketchDefinition) {
  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'failOnConflict',
  })
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied')
  const dimensionsSatisfied = solved.solvedSnapshot.dimensionStatuses.every((status) => status.status !== 'unsatisfied')

  if (
    solved.status.solveState !== 'solved'
    || !constraintsSatisfied
    || !dimensionsSatisfied
  ) {
    return {
      kind: 'blocked' as const,
      message: solved.diagnostics[0]?.message ?? ANNOTATION_EDIT_SOLVE_BLOCKED_MESSAGE,
    }
  }

  return {
    kind: 'accepted' as const,
    definition: applyPointPositionsToDefinition(
      definition,
      solved.solvedSnapshot.solvedPoints.map((point) => ({
        pointId: point.pointId,
        position: point.solvedPosition,
      })),
    ),
  }
}

function updateAnnotationValueInDefinition(
  definition: SketchDefinition,
  target: SketchConstraintRef | SketchDimensionRef,
  value: number,
): SketchDefinition {
  if (target.kind === 'constraint') {
    const constraints = definition.constraints.map((constraint) => {
      if (constraint.constraintId !== target.constraintId || constraint.kind !== 'angle') {
        return constraint
      }

      return {
        ...constraint,
        valueRadians: value * Math.PI / 180,
      }
    })
    const edited = constraints.some((constraint, index) => constraint !== definition.constraints[index])

    return edited
      ? {
          ...definition,
          constraints,
        }
      : definition
  }

  let editedCircleRadiusEntityId: SketchEntityId | null = null
  const dimensions = definition.dimensions.map((dimension) => {
    if (dimension.dimensionId !== target.dimensionId) {
      return dimension
    }

    switch (dimension.kind) {
      case 'distance':
      case 'horizontalDistance':
      case 'verticalDistance':
      case 'circleRadius':
        if (dimension.kind === 'circleRadius') {
          editedCircleRadiusEntityId = dimension.entityId
        }

        return {
          ...dimension,
          value,
        }
      case 'arcStartPointCoincident':
      case 'arcEndPointCoincident':
        return dimension
    }
  })
  const edited = dimensions.some((dimension, index) => dimension !== definition.dimensions[index])

  return edited
    ? {
        ...definition,
        entities: editedCircleRadiusEntityId
          ? definition.entities.map((entity) =>
              entity.entityId === editedCircleRadiusEntityId && entity.kind === 'circle'
                ? { ...entity, radius: value }
                : entity,
            )
          : definition.entities,
        dimensions,
      }
    : definition
}

function buildAnnotationEditPresentation(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
  validationMessage: string | null = null,
): SketchToolPresentationSchema {
  const editable = getEditableAnnotationValue(session, edit.target)
  const label = editable?.label ?? 'Value'

  return {
    prompts: [
      {
        id: 'annotation-edit-prompt',
        text: `Edit ${label.toLowerCase()}`,
      },
    ],
    floatingInput: {
      id: `annotation-edit-${getTargetKey(edit.target)}`,
      label,
      value: edit.pendingValue,
      unit: editable?.unit,
      min: editable?.min,
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
      anchor: editable?.anchor,
      placement: 'target',
      submitAction: { type: 'patch', patch: { intent: 'commitAnnotationValue' } },
      cancelAction: { type: 'patch', patch: { intent: 'cancelAnnotationValue' } },
    },
    validation: validationMessage
      ? [{
          id: 'annotation-edit-value-required',
          message: validationMessage,
          severity: 'error',
        }]
      : [],
  }
}

function getEditableAnnotationValue(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
): {
  label: string
  value: number
  unit?: string
  min?: number
  anchor?: SketchToolAnchorDescriptor
} | null {
  const annotation = getSketchAnnotationDescriptors(session).find(
    (entry) => getTargetKey(entry.target) === getTargetKey(target),
  )

  if (target.kind === 'constraint') {
    const constraint = session.definition.constraints.find((entry) => entry.constraintId === target.constraintId)

    if (constraint?.kind !== 'angle') {
      return null
    }

    return {
      label: 'Angle',
      value: constraint.valueRadians * 180 / Math.PI,
      unit: 'deg',
      anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
    }
  }

  const dimension = session.definition.dimensions.find((entry) => entry.dimensionId === target.dimensionId)

  if (!dimension) {
    return null
  }

  switch (dimension.kind) {
    case 'distance':
      return {
        label: dimension.axis === 'horizontal'
          ? 'Horizontal distance'
          : dimension.axis === 'vertical'
            ? 'Vertical distance'
            : 'Distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'horizontalDistance':
      return {
        label: 'Horizontal distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'verticalDistance':
      return {
        label: 'Vertical distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'circleRadius':
      return {
        label: 'Radius',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return null
  }
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
    pointer: authoring.pointer,
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
    activeAnnotationEdit: null,
    commitRequest: rebuildSessionCommitRequest(session, history.definition),
    selectedAnnotation: null,
    toolPresentation: null,
    activeTool: null,
    activeEditTarget: null,
    activeDrag: null,
  }
}

export function selectSketchAnnotation(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef | null,
): SketchSessionState {
  return {
    ...session,
    selectedAnnotation: target,
    activeAnnotationEdit: null,
    activeEditTarget: null,
    activeDrag: null,
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
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
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
      glyphKind: getConstraintGlyphKind(constraint),
      anchor: createConstraintAnnotationAnchor(session.definition, constraint),
      affectedGeometryRefs: getConstraintAffectedGeometryRefs(sketchId, constraint),
      label: constraint.label,
      detail: describeConstraint(constraint),
      status: 'constraint' as const,
    })),
    ...session.definition.dimensions.map((dimension) => ({
      id: dimension.dimensionId,
      target: createSketchDimensionRef(sketchId, dimension.dimensionId),
      glyphKind: getDimensionGlyphKind(dimension),
      anchor: createDimensionAnnotationAnchor(session.definition, dimension),
      affectedGeometryRefs: getDimensionAffectedGeometryRefs(sketchId, dimension),
      label: dimension.label,
      detail: describeDimension(dimension),
      status: 'dimension' as const,
    })),
  ]
}

function getConstraintGlyphKind(constraint: ConstraintDefinition): SketchAnnotationGlyphKind {
  switch (constraint.kind) {
    case 'coincident':
      return 'constraintCoincident'
    case 'parallel':
      return 'constraintParallel'
    case 'equalLength':
      return 'constraintEqual'
    case 'horizontal':
      return 'constraintHorizontal'
    case 'vertical':
      return 'constraintVertical'
    case 'fixPoint':
      return 'constraintFixed'
    case 'angle':
      return 'constraintAngle'
    case 'perpendicular':
      return 'constraintPerpendicular'
  }
}

function getDimensionGlyphKind(dimension: DimensionDefinition): SketchAnnotationGlyphKind {
  switch (dimension.kind) {
    case 'distance':
      if (dimension.axis === 'horizontal') {
        return 'dimensionHorizontal'
      }

      if (dimension.axis === 'vertical') {
        return 'dimensionVertical'
      }

      return 'dimensionDistance'
    case 'horizontalDistance':
      return 'dimensionHorizontal'
    case 'verticalDistance':
      return 'dimensionVertical'
    case 'circleRadius':
      return 'dimensionRadius'
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return 'dimensionCoincident'
  }
}

function getConstraintAffectedGeometryRefs(
  sketchId: SketchId,
  constraint: ConstraintDefinition,
): readonly (SketchEntityRef | SketchPointRef)[] {
  switch (constraint.kind) {
    case 'coincident':
    case 'angle':
      return constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId))
    case 'fixPoint':
      return [createSketchPointRef(sketchId, constraint.pointId)]
    case 'horizontal':
    case 'vertical':
      return [createSketchEntityRef(sketchId, constraint.entityId)]
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
      return constraint.entityIds.map((entityId) => createSketchEntityRef(sketchId, entityId))
  }
}

function getDimensionAffectedGeometryRefs(
  sketchId: SketchId,
  dimension: DimensionDefinition,
): readonly (SketchEntityRef | SketchPointRef)[] {
  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      return dimension.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId))
    case 'circleRadius':
      return [createSketchEntityRef(sketchId, dimension.entityId)]
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return [
        createSketchEntityRef(sketchId, dimension.entityId),
        createSketchPointRef(sketchId, dimension.pointId),
      ]
  }
}

function createConstraintAnnotationAnchor(
  definition: SketchDefinition,
  constraint: ConstraintDefinition,
): SketchToolAnchorDescriptor {
  switch (constraint.kind) {
    case 'coincident':
    case 'angle':
      return createOffsetAnnotationAnchor(getAveragePointPosition(definition, constraint.pointIds))
    case 'fixPoint':
      return createOffsetAnnotationAnchor(getPointPosition(definition, constraint.pointId))
    case 'horizontal':
    case 'vertical':
      return createOffsetAnnotationAnchor(getEntityAnchor(definition, constraint.entityId))
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
      return createOffsetAnnotationAnchor(getAverageEntityAnchor(definition, constraint.entityIds))
  }
}

function createDimensionAnnotationAnchor(
  definition: SketchDefinition,
  dimension: DimensionDefinition,
): SketchToolAnchorDescriptor {
  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      return createOffsetAnnotationAnchor(getAveragePointPosition(definition, dimension.pointIds), { x: 0, y: -28 })
    case 'circleRadius':
      return createOffsetAnnotationAnchor(getEntityAnchor(definition, dimension.entityId), { x: 22, y: -22 })
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return createOffsetAnnotationAnchor(
        getAveragePointPosition(definition, [
          getEntityAnchorPointId(definition, dimension.entityId),
          dimension.pointId,
        ].filter((pointId): pointId is SketchPointId => Boolean(pointId))),
      )
  }
}

function createOffsetAnnotationAnchor(
  point: SketchPoint | null,
  offset = { x: 18, y: -18 },
): SketchToolAnchorDescriptor {
  return {
    kind: 'sketchPoint',
    point: point ?? [0, 0],
    offset,
  }
}

function getPointPosition(definition: SketchDefinition, pointId: SketchPointId): SketchPoint | null {
  return definition.points.find((point) => point.pointId === pointId)?.position ?? null
}

function getAveragePointPosition(
  definition: SketchDefinition,
  pointIds: readonly SketchPointId[],
): SketchPoint | null {
  const points = pointIds.flatMap((pointId) => {
    const position = getPointPosition(definition, pointId)
    return position ? [position] : []
  })

  return getAverageSketchPoint(points)
}

function getAverageEntityAnchor(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
): SketchPoint | null {
  const points = entityIds.flatMap((entityId) => {
    const position = getEntityAnchor(definition, entityId)
    return position ? [position] : []
  })

  return getAverageSketchPoint(points)
}

function getEntityAnchor(definition: SketchDefinition, entityId: SketchEntityId): SketchPoint | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  switch (entity.kind) {
    case 'lineSegment':
      return getAveragePointPosition(definition, [entity.startPointId, entity.endPointId])
    case 'point':
      return getPointPosition(definition, entity.pointId)
    case 'circle':
      return getPointPosition(definition, entity.centerPointId)
    case 'arc':
      return getPointPosition(definition, entity.centerPointId)
  }
}

function getEntityAnchorPointId(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchPointId | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  switch (entity.kind) {
    case 'lineSegment':
      return entity.startPointId
    case 'point':
      return entity.pointId
    case 'circle':
    case 'arc':
      return entity.centerPointId
  }
}

function getAverageSketchPoint(points: readonly SketchPoint[]): SketchPoint | null {
  if (points.length === 0) {
    return null
  }

  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
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
      linePattern: 'solid' as const,
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
      linePattern: entity.isConstruction ? 'dashed' : 'solid',
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
    linePattern: entity.isConstruction ? 'dashed' : 'solid',
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
