import type {
  ConstraintDefinition,
  DimensionDefinition,
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
  SketchReferenceDefinition,
  SketchStyleDefinition,
} from '@/contracts/sketch/schema'
import { SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import { evaluateSketchDerivations } from '@/contracts/sketch/derived-geometry'
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
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type {
  CommitSketchRequest,
  SketchPlaneKey,
  SketchPoint,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { primitiveRefEquals } from '@/domain/editor/schema'
import {
  buildSketchStyleControls,
  buildSketchStylePresentation,
  isSketchStyleTarget,
  parseSketchStylePatch,
  type SketchStyleFocus,
  type SketchStylePatch,
  type SketchStyleToolId,
} from '@/domain/sketch-styles/definition'
import type { OffsetCurveDescriptor, OffsetSide } from '@/domain/sketch-editing/operations'
import {
  createSketchChamferMutation,
  createSketchExtendMutation,
  createSketchFilletMutation,
  createSketchSlotContribution,
  createSketchSplitMutation,
  createSketchDerivedTransformContribution,
  createOffsetContribution,
  offsetCurveDescriptorFromProjectedGeometry,
  trimLineSegmentAtIntersections,
  type SketchEditOperationResult,
} from '@/domain/sketch-editing/operations'
import { mapSketchPointToWorkspaceWorld } from '@/domain/workspace/sketch-plane-mapping'
import {
  createStandardPlaneDefinition,
  deriveStandardPlaneKeyFromConstructionId,
} from '@/domain/modeling/opencascade-kernel-seed'
import type {
  SketchToolAnchorDescriptor,
  SketchToolControlValue,
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
import { sampleArcPoints } from '@/domain/sketch-tools/geometry'
import { getSketchToolDefinition } from '@/domain/sketch-tools/registry'
import type { SketchEditToolId } from '@/domain/sketch-edit-tools/definition'
import { getSketchEditToolDefinition, isRegisteredSketchEditToolId } from '@/domain/sketch-edit-tools/registry'
import type { SketchSnapCandidate, SketchSnapSourceRef } from '@/domain/sketch-snapping/snap-candidates'
import {
  collectSketchSnapGeometries,
  resolveSketchSnap,
} from '@/domain/sketch-snapping/snap-candidates'

export type { SketchDraftEntity, SketchToolId } from '@/domain/sketch-tools/definition'
export type { SketchConstraintToolId } from '@/domain/sketch-constraints/definition'

export type SketchConstructionToolId = 'construction'
export type SketchReferenceToolId = 'projectReference'
export type SketchAuthoringToolId =
  | SketchToolId
  | SketchEditToolId
  | SketchConstraintToolId
  | SketchConstructionToolId
  | SketchReferenceToolId
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
  affectedGeometryRefs: readonly PrimitiveRef[]
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
  | 'constraintTangent'
  | 'constraintConcentric'
  | 'constraintMidpoint'
  | 'constraintNormal'
  | 'constraintPierce'
  | 'constraintSymmetric'
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

export interface SketchEditToolState {
  toolId: SketchEditToolId
  hoverTarget: PrimitiveRef | null
  selectedTarget: PrimitiveRef | null
  selectedTargets: PrimitiveRef[]
  offsetDistance: number | null
  offsetSide: OffsetSide
  toolValue: number | null
}

export interface SketchSessionState {
  sketchId: SketchId | null
  sketchLabel: string
  plane: SketchPlaneDefinition
  planeTarget: SketchPlaneSupportRef
  planeKey: SketchPlaneKey | null
  toolStagedEntities: readonly SketchDraftEntity[]
  definition: SketchDefinition
  fullDefinition: SketchDefinition
  historyCursor: SketchHistoryCursor
  historyOperations: SketchHistoryOperation[]
  activeTool: SketchAuthoringToolId | null
  status: SketchSessionStatus
  constructionTargetPicking: boolean
  referenceTargetPicking: boolean
  constructionModifierActive: boolean
  pointerDownPoint: SketchPoint | null
  livePoint: SketchPoint | null
  toolPlacedPoints: readonly SketchPoint[]
  toolSettings: Record<string, SketchToolControlValue>
  toolPresentation: SketchToolPresentationSchema | null
  constraintAuthoring: SketchConstraintAuthoringState | null
  activeAnnotationEdit: SketchAnnotationEditState | null
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null
  activeEditTool: SketchEditToolState | null
  activeEditTarget: SketchPointRef | null
  activeStyleFocus: SketchStyleFocus | null
  activeDrag: SketchGeometryDragState | null
  activeSnap: SketchSnapCandidate | null
  drawStartSnap: SketchSnapCandidate | null
  sequence: number
  solvedRegions: RegionRecord[]
  projectedReferences: ProjectedSketchReferenceRecord[]
  projectionDiagnostics: ProjectedSketchReferenceRecord['diagnostics']
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
  role: 'local' | 'reference'
  paintStyle?: SketchDisplayPaintStyle
  strokeStyle?: SketchDisplayStrokeStyle
}

export interface SketchDisplayPaintStyle {
  color: number
  opacity: number
}

export interface SketchDisplayStrokeStyle {
  color: number
  opacity: number
  width?: number
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'miter' | 'round' | 'bevel'
  miterLimit?: number
  dashSize?: number
  gapSize?: number
}

export type SketchHistoryCursor =
  | { kind: 'empty' }
  | { kind: 'item'; itemId: string }

export interface SketchHistoryOperation {
  itemId: string
  beforeCursor: SketchHistoryCursor
  beforeDefinition: SketchDefinition
  afterDefinition: SketchDefinition
}

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
    derivedRelationships: [],
  }
}

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
    derivedRelationships: definition.derivedRelationships ? [...definition.derivedRelationships] : undefined,
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
    case 'spline':
      return entity.fitPointIds
    case 'ellipse':
      return [entity.centerPointId, entity.majorAxisPointId]
    case 'ellipticalArc':
      return [entity.startPointId, entity.endPointId, entity.centerPointId, entity.majorAxisPointId]
    case 'conic':
      return [entity.startPointId, entity.controlPointId, entity.endPointId]
    case 'bezierCurve':
      return entity.controlPointIds
    case 'profileText':
      return [entity.anchorPointId]
  }
}

function sketchHistoryCursorsEqual(left: SketchHistoryCursor, right: SketchHistoryCursor) {
  if (left.kind === 'empty' || right.kind === 'empty') {
    return left.kind === right.kind
  }

  return left.itemId === right.itemId
}

function getSketchHistoryOperationForCursor(
  session: SketchSessionState,
  cursor: SketchHistoryCursor,
) {
  return cursor.kind === 'item'
    ? session.historyOperations.find((entry) => entry.itemId === cursor.itemId) ?? null
    : null
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
  const derivedRelationships = (definition.derivedRelationships ?? []).filter((relationship) => {
    const outputEntityIds = new Set(relationship.outputs.map((output) => output.outputEntityId))
    const seedEntityIds = new Set(relationship.seedEntityIds)
    const mirrorAxisId = relationship.kind === 'mirror' ? relationship.mirrorReference.entityId : null

    return [...outputEntityIds].every((entityId) => visibleItemIds.has(entityId))
      && [...seedEntityIds].every((entityId) => visibleItemIds.has(entityId))
      && (mirrorAxisId === null || visibleItemIds.has(mirrorAxisId))
  })

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
    derivedRelationships,
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
  const planeKey = sketch.planeKey ?? sketch.plane.key ?? null

  return {
    sketchId: sketch.sketchId,
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
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: getNextDefinitionSequence(sketch.sketch.definition),
    solvedRegions: [...sketch.sketch.regions],
    projectedReferences: [],
    projectionDiagnostics: [],
    commitRequest: buildCommitRequest({
      sketchId: sketch.sketchId,
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

const ADVANCED_DISPLAY_SAMPLE_COUNT = 64
const PROFILE_TEXT_WIDTH_FACTOR = 0.6

function sampleEllipseSketchPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  minorRadius: number,
  sampleCount: number,
): SketchPoint[] {
  const majorVector = [majorAxisEndpoint[0] - center[0], majorAxisEndpoint[1] - center[1]] as const
  const majorRadius = Math.hypot(majorVector[0], majorVector[1])
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return []
  }

  const majorUnit = [majorVector[0] / majorRadius, majorVector[1] / majorRadius] as const
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const

  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sampleCount
    return [
      center[0] + Math.cos(angle) * majorRadius * majorUnit[0] + Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] + Math.cos(angle) * majorRadius * majorUnit[1] + Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const
  })
}

function normalizeSketchAngle(angle: number) {
  const fullTurn = Math.PI * 2
  return ((angle % fullTurn) + fullTurn) % fullTurn
}

function computeSketchArcSweep(
  startAngle: number,
  endAngle: number,
  sweepDirection: 'clockwise' | 'counterClockwise',
) {
  const start = normalizeSketchAngle(startAngle)
  const end = normalizeSketchAngle(endAngle)
  if (sweepDirection === 'counterClockwise') {
    return end >= start ? end - start : end + Math.PI * 2 - start
  }
  return end <= start ? start - end : start + Math.PI * 2 - end
}

function sampleEllipticalArcSketchPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
  minorRadius: number,
  sweepDirection: 'clockwise' | 'counterClockwise',
  sampleCount: number,
): SketchPoint[] {
  const majorVector = [majorAxisEndpoint[0] - center[0], majorAxisEndpoint[1] - center[1]] as const
  const majorRadius = Math.hypot(majorVector[0], majorVector[1])
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return []
  }

  const majorUnit = [majorVector[0] / majorRadius, majorVector[1] / majorRadius] as const
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const
  const ellipseAngle = (point: SketchPoint) => {
    const delta = [point[0] - center[0], point[1] - center[1]] as const
    return Math.atan2(
      (delta[0] * minorUnit[0] + delta[1] * minorUnit[1]) / minorRadius,
      (delta[0] * majorUnit[0] + delta[1] * majorUnit[1]) / majorRadius,
    )
  }
  const startAngle = ellipseAngle(start)
  const sweep = computeSketchArcSweep(startAngle, ellipseAngle(end), sweepDirection)

  return Array.from({ length: sampleCount }, (_, index) => {
    const alpha = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const angle = sweepDirection === 'counterClockwise'
      ? startAngle + sweep * alpha
      : startAngle - sweep * alpha
    return [
      center[0] + Math.cos(angle) * majorRadius * majorUnit[0] + Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] + Math.cos(angle) * majorRadius * majorUnit[1] + Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const
  })
}

function sampleConicSketchPoints(
  start: SketchPoint,
  control: SketchPoint,
  end: SketchPoint,
  rho: number,
  sampleCount: number,
): SketchPoint[] {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const oneMinusT = 1 - t
    const startWeight = oneMinusT * oneMinusT
    const controlWeight = 2 * rho * oneMinusT * t
    const endWeight = t * t
    const weight = startWeight + controlWeight + endWeight
    return [
      (startWeight * start[0] + controlWeight * control[0] + endWeight * end[0]) / weight,
      (startWeight * start[1] + controlWeight * control[1] + endWeight * end[1]) / weight,
    ] as const
  })
}

function sampleBezierSketchPoints(controlPoints: readonly SketchPoint[], sampleCount: number): SketchPoint[] {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const oneMinusT = 1 - t
    if (controlPoints.length === 3) {
      const [p0, p1, p2] = controlPoints
      return [
        oneMinusT * oneMinusT * p0![0] + 2 * oneMinusT * t * p1![0] + t * t * p2![0],
        oneMinusT * oneMinusT * p0![1] + 2 * oneMinusT * t * p1![1] + t * t * p2![1],
      ] as const
    }

    const [p0, p1, p2, p3] = controlPoints
    return [
      oneMinusT ** 3 * p0![0] + 3 * oneMinusT * oneMinusT * t * p1![0] + 3 * oneMinusT * t * t * p2![0] + t ** 3 * p3![0],
      oneMinusT ** 3 * p0![1] + 3 * oneMinusT * oneMinusT * t * p1![1] + 3 * oneMinusT * t * t * p2![1] + t ** 3 * p3![1],
    ] as const
  })
}

function sampleProfileTextSketchOutline(entity: Extract<SketchEntityDefinition, { kind: 'profileText' }>, anchor: SketchPoint): SketchPoint[] {
  const width = Math.max(entity.height * PROFILE_TEXT_WIDTH_FACTOR, entity.text.trim().length * entity.height * PROFILE_TEXT_WIDTH_FACTOR)
  const x = entity.horizontalAlign === 'center'
    ? -width / 2
    : entity.horizontalAlign === 'right'
      ? -width
      : 0
  const y = entity.verticalAlign === 'middle'
    ? -entity.height / 2
    : entity.verticalAlign === 'top'
      ? -entity.height
      : entity.verticalAlign === 'baseline'
        ? -entity.height * 0.2
        : 0
  const cos = Math.cos(entity.rotationRadians)
  const sin = Math.sin(entity.rotationRadians)

  return [
    [x, y],
    [x + width, y],
    [x + width, y + entity.height],
    [x, y + entity.height],
  ].map((point) => [
    anchor[0] + point[0]! * cos - point[1]! * sin,
    anchor[1] + point[0]! * sin + point[1]! * cos,
  ] as const)
}

function mapDefinitionEntityToDraftEntity(
  sketchId: SketchId,
  points: SketchPointDefinition[],
  entity: SketchEntityDefinition,
): SketchDraftEntity[] {
  const pointById = new Map(points.map((point) => [point.pointId, point.position] as const))

  if (entity.kind === 'lineSegment') {
    const start = pointById.get(entity.startPointId)
    const end = pointById.get(entity.endPointId)

    if (!start || !end) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'line',
        start,
        end,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: 'accepted',
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ]
  }

  if (entity.kind === 'point') {
    const point = pointById.get(entity.pointId)

    if (!point) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'circle',
        center: point,
        radius: 0.1,
        entityId: entity.entityId,
        status: 'accepted',
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ]
  }

  if (entity.kind === 'circle') {
    const center = pointById.get(entity.centerPointId)

    if (!center) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'circle',
        center,
        radius: entity.radius,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: 'accepted',
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ]
  }

  if (entity.kind === 'arc') {
    const center = pointById.get(entity.centerPointId)
    const start = pointById.get(entity.startPointId)
    const end = pointById.get(entity.endPointId)

    if (!center || !start || !end) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'polyline',
        points: sampleArcPoints(center, start, end, entity.sweepDirection),
        isClosed: false,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: 'accepted',
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ]
  }

  if (entity.kind === 'spline') {
    const splinePoints = entity.fitPointIds.flatMap((pointId) => {
      const point = pointById.get(pointId)
      return point ? [point] : []
    })

    if (splinePoints.length < 3) {
      return []
    }

    return [
      {
        id: entity.entityId,
        kind: 'spline',
        points: splinePoints,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: 'accepted',
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ]
  }

  if (entity.kind === 'ellipse') {
    const center = pointById.get(entity.centerPointId)
    const major = pointById.get(entity.majorAxisPointId)
    const sampled = center && major
      ? sampleEllipseSketchPoints(center, major, entity.minorRadius, ADVANCED_DISPLAY_SAMPLE_COUNT)
      : []
    return sampled.length > 0
      ? [{
          id: entity.entityId,
          kind: 'polyline',
          points: sampled,
          isClosed: true,
          entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
          status: 'accepted',
          label: entity.label,
          isConstruction: entity.isConstruction,
        }]
      : []
  }

  if (entity.kind === 'ellipticalArc') {
    const center = pointById.get(entity.centerPointId)
    const major = pointById.get(entity.majorAxisPointId)
    const start = pointById.get(entity.startPointId)
    const end = pointById.get(entity.endPointId)
    const sampled = center && major && start && end
      ? sampleEllipticalArcSketchPoints(center, major, start, end, entity.minorRadius, entity.sweepDirection, ADVANCED_DISPLAY_SAMPLE_COUNT)
      : []
    return sampled.length > 0
      ? [{
          id: entity.entityId,
          kind: 'polyline',
          points: sampled,
          isClosed: false,
          entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
          status: 'accepted',
          label: entity.label,
          isConstruction: entity.isConstruction,
        }]
      : []
  }

  if (entity.kind === 'conic') {
    const start = pointById.get(entity.startPointId)
    const control = pointById.get(entity.controlPointId)
    const end = pointById.get(entity.endPointId)
    const sampled = start && control && end
      ? sampleConicSketchPoints(start, control, end, entity.rho, ADVANCED_DISPLAY_SAMPLE_COUNT)
      : []
    return sampled.length > 0
      ? [{
          id: entity.entityId,
          kind: 'polyline',
          points: sampled,
          isClosed: false,
          entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
          status: 'accepted',
          label: entity.label,
          isConstruction: entity.isConstruction,
        }]
      : []
  }

  if (entity.kind === 'bezierCurve') {
    const controlPoints = entity.controlPointIds.flatMap((pointId) => {
      const point = pointById.get(pointId)
      return point ? [point] : []
    })
    const sampled = controlPoints.length === entity.controlPointIds.length
      ? sampleBezierSketchPoints(controlPoints, ADVANCED_DISPLAY_SAMPLE_COUNT)
      : []
    return sampled.length > 0
      ? [{
          id: entity.entityId,
          kind: 'polyline',
          points: sampled,
          isClosed: false,
          entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
          status: 'accepted',
          label: entity.label,
          isConstruction: entity.isConstruction,
        }]
      : []
  }

  if (entity.kind === 'profileText') {
    const anchor = pointById.get(entity.anchorPointId)
    return anchor
      ? [{
          id: entity.entityId,
          kind: 'polyline',
          points: sampleProfileTextSketchOutline(entity, anchor),
          isClosed: true,
          entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
          status: 'accepted',
          label: entity.label,
          isConstruction: entity.isConstruction,
        }]
      : []
  }

  return []
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

function createPointEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  pointId: SketchPointId,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'point',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    pointId,
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

function createArcEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  sweepDirection: 'clockwise' | 'counterClockwise',
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'arc',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    startPointId,
    endPointId,
    sweepDirection,
  }
}

function createSplineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  fitPointIds: readonly SketchPointId[],
  isConstruction = false,
  degree: 2 | 3 = 2,
): SketchEntityDefinition {
  return {
    kind: 'spline',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    fitPointIds,
    degree,
  }
}

function createEllipseEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  majorAxisPointId: SketchPointId,
  minorRadius: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'ellipse',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    majorAxisPointId,
    minorRadius,
  }
}

function createEllipticalArcEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  majorAxisPointId: SketchPointId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  minorRadius: number,
  sweepDirection: 'clockwise' | 'counterClockwise',
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'ellipticalArc',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    majorAxisPointId,
    startPointId,
    endPointId,
    minorRadius,
    sweepDirection,
  }
}

function createConicEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  controlPointId: SketchPointId,
  endPointId: SketchPointId,
  rho: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'conic',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    startPointId,
    controlPointId,
    endPointId,
    rho,
  }
}

function createBezierCurveEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  controlPointIds: readonly SketchPointId[],
  degree: 2 | 3,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'bezierCurve',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    controlPointIds,
    degree,
  }
}

function createProfileTextEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  anchorPointId: SketchPointId,
  text: string,
  height: number,
  rotationRadians: number,
  horizontalAlign: 'left' | 'center' | 'right',
  verticalAlign: 'baseline' | 'middle' | 'top' | 'bottom',
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: 'profileText',
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    anchorPointId,
    text,
    height,
    rotationRadians,
    horizontalAlign,
    verticalAlign,
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
    styleIds: definition.styleIds ? [...definition.styleIds] : undefined,
    styles: definition.styles ? [...definition.styles] : undefined,
    derivedRelationships: [
      ...(definition.derivedRelationships ?? []),
      ...(patch.derivedRelationships ?? []),
    ],
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
  const operation = getSketchHistoryOperationForCursor(session, session.historyCursor)
  const truncatedDefinition = operation
    ? cloneDefinition(operation.afterDefinition)
    : truncateDefinitionAfterCursor(session.fullDefinition, session.historyCursor)
  const fullDefinition = appendDefinition(truncatedDefinition, patch)
  const historyCursor = createTailSketchHistoryCursor(fullDefinition)
  const definition = filterSketchDefinitionThroughCursor(fullDefinition, historyCursor)

  return {
    fullDefinition,
    historyCursor,
    definition,
    historyOperations: session.historyOperations.filter((entry) =>
      !sketchHistoryCursorsEqual(entry.beforeCursor, session.historyCursor),
    ),
  }
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

function rebuildSessionForDefinition(
  session: SketchSessionState,
  input: {
    definition: SketchDefinition
    fullDefinition: SketchDefinition
    historyCursor: SketchHistoryCursor
    historyOperations: SketchHistoryOperation[]
  },
): SketchSessionState {
  const definition = cloneDefinition(input.definition)
  const fullDefinition = cloneDefinition(input.fullDefinition)
  return {
    ...session,
    historyCursor: input.historyCursor,
    definition,
    fullDefinition,
    historyOperations: [...input.historyOperations],
    toolStagedEntities: [],
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, definition),
  }
}

export function isEditableSketchGeometrySelection(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  return getSelectedSketchGeometryIds(session, targets) !== null
}

function getSelectedSketchGeometryIds(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  const sketchId = getSessionSketchId(session)
  const selectedPointIds = new Set<SketchPointId>()
  const selectedEntityIds = new Set<SketchEntityId>()

  for (const target of targets) {
    if (target.kind === 'sketchPoint' && target.sketchId === sketchId) {
      selectedPointIds.add(target.pointId)
    }

    if (target.kind === 'sketchEntity' && target.sketchId === sketchId) {
      selectedEntityIds.add(target.entityId)
    }
  }

  const existingPointIds = new Set(session.definition.pointIds)
  const existingEntityIds = new Set(session.definition.entityIds)
  const pointIds = new Set([...selectedPointIds].filter((pointId) => existingPointIds.has(pointId)))
  const entityIds = new Set([...selectedEntityIds].filter((entityId) => existingEntityIds.has(entityId)))

  if (pointIds.size === 0 && entityIds.size === 0) {
    return null
  }

  return { pointIds, entityIds }
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
  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      return dimension.pointIds.some((pointId) => deletedPointIds.has(pointId))
    case 'circleRadius':
      return deletedEntityIds.has(dimension.entityId)
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return deletedEntityIds.has(dimension.entityId) || deletedPointIds.has(dimension.pointId)
  }
}

export function deleteSelectedSketchGeometry(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
): SketchSessionState {
  const selected = getSelectedSketchGeometryIds(session, targets)

  if (!selected) {
    return session
  }

  const beforeDefinition = cloneDefinition(session.definition)
  const deletedEntityIds = new Set(selected.entityIds)
  for (const entity of beforeDefinition.entities) {
    if (getEntityPointIds(entity).some((pointId) => selected.pointIds.has(pointId))) {
      deletedEntityIds.add(entity.entityId)
    }
  }

  const remainingEntities = beforeDefinition.entities.filter((entity) => !deletedEntityIds.has(entity.entityId))
  const remainingEntityPointIds = new Set(remainingEntities.flatMap((entity) => getEntityPointIds(entity)))
  const deletedPointIds = new Set(
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
  }
  const operation: SketchHistoryOperation = {
    itemId: `sketch_history_delete_${session.sequence + 1}`,
    beforeCursor: session.historyCursor,
    beforeDefinition,
    afterDefinition,
  }

  return {
    ...rebuildSessionForDefinition(session, {
      definition: afterDefinition,
      fullDefinition: afterDefinition,
      historyCursor: { kind: 'item', itemId: operation.itemId },
      historyOperations: [
        ...session.historyOperations.filter((entry) =>
          !sketchHistoryCursorsEqual(entry.beforeCursor, session.historyCursor),
        ),
        operation,
      ],
    }),
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
    sequence: session.sequence + 1,
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

function buildConstraintToolPresentation(
  authoring: SketchConstraintAuthoringState,
  validationMessage: string | null = null,
): SketchToolPresentationSchema {
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
    validation: validationMessage
      ? [{
          id: `${authoring.toolId}-validation`,
          message: validationMessage,
          severity: 'warning',
        }]
      : [],
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
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildConstraintToolPresentation(authoring),
    constraintAuthoring: authoring,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

function rebuildSessionCommitRequest(session: SketchSessionState, definition: SketchDefinition) {
  const evaluatedDefinition = evaluateSketchDerivations(definition).definition
  return buildCommitRequest({
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: session.plane,
    planeTarget: session.planeTarget,
    planeKey: session.planeKey,
    definition: evaluatedDefinition,
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
    case 'projectedReferenceGeometry':
      return `${target.referenceId}:${target.geometryId}`
    case 'sketchExternalReference':
      return target.referenceId
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

function buildReferenceTargetPresentation(validationMessage: string | null = null): SketchToolPresentationSchema {
  return {
    prompts: [
      {
        id: 'reference-prompt',
        text: 'Select model or existing sketch geometry to reference',
      },
    ],
    steps: [{ id: 'reference-target', label: 'Reference geometry' }],
    selectionGuide: {
      id: 'reference-selection-guide',
      label: 'Select reference geometry',
      acceptedKinds: ['point', 'line', 'circle', 'arc'],
      selectedCount: 0,
      requiredCount: 1,
      hoverLabel: null,
    },
    validation: validationMessage
      ? [{
          id: 'reference-validation',
          message: validationMessage,
          severity: 'warning',
        }]
      : [],
    completionHints: [
      {
        id: 'reference-completion',
        text: 'Accepted references stay derived and read-only',
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
  return toolId !== null
    && !isRegisteredSketchConstraintToolId(toolId)
    && !isRegisteredSketchEditToolId(toolId)
    && toolId !== 'construction'
    && toolId !== 'projectReference'
}

export function isSketchConstructionSelected(session: SketchSessionState) {
  return session.constructionTargetPicking || session.constructionModifierActive
}

export function isSketchReferenceToolSelected(session: SketchSessionState) {
  return session.referenceTargetPicking
}

function beginSketchConstructionTool(session: SketchSessionState): SketchSessionState {
  if (isSketchConstructionSelected(session)) {
    return {
      ...session,
      activeTool: null,
      status: 'idle',
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolStagedEntities: [],
      validationMessage: null,
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
    }
  }

  return {
    ...session,
    activeTool: 'construction',
    status: 'collectingTargets',
    constructionTargetPicking: true,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildConstructionTargetPresentation(),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

function beginSketchReferenceTool(session: SketchSessionState): SketchSessionState {
  if (session.referenceTargetPicking) {
    return clearActiveSketchTool(session)
  }

  return {
    ...session,
    activeTool: 'projectReference',
    status: 'collectingTargets',
    constructionTargetPicking: false,
    referenceTargetPicking: true,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildReferenceTargetPresentation(),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

function buildSketchEditToolPresentation(
  state: SketchEditToolState,
  validationMessage: string | null = null,
  previewEntities: readonly SketchDraftEntity[] = [],
): SketchToolPresentationSchema {
  const isOffset = state.toolId === 'offset'
  const isTrim = state.toolId === 'trim'
  const definition = getSketchEditToolDefinition(state.toolId)
  const metadata = definition.metadata
  const selectedCount = state.selectedTargets.length
  const hasSelection = selectedCount > 0
  const hoverLabel = state.hoverTarget?.kind === 'sketchEntity' ? 'Sketch entity' : null
  const needsNumericValue =
    state.toolId === 'sketchFillet'
    || state.toolId === 'sketchChamfer'
    || state.toolId === 'sketchSlot'
    || state.toolId === 'sketchLinearPattern'
    || state.toolId === 'sketchCircularPattern'
    || state.toolId === 'sketchTransform'
  const numericLabel = state.toolId === 'sketchFillet'
    ? 'Radius'
    : state.toolId === 'sketchChamfer'
      ? 'Distance'
      : state.toolId === 'sketchSlot'
        ? 'Width'
        : state.toolId === 'sketchCircularPattern'
          ? 'Angle'
          : 'Distance'
  const numericUnit = state.toolId === 'sketchCircularPattern' ? 'rad' : 'mm'
  const isReady = hasSelection && previewEntities.length > 0 && validationMessage === null
  const promptText = isOffset
    ? hasSelection ? 'Set offset distance' : metadata.validationMessages.emptySelection
    : isTrim
      ? metadata.validationMessages.emptySelection
      : hasSelection
        ? needsNumericValue ? `Set ${numericLabel.toLowerCase()}` : `Accept ${metadata.name.toLowerCase()}`
        : metadata.validationMessages.emptySelection
  const validation = validationMessage
    ? [{ id: `${state.toolId}-validation`, message: validationMessage, severity: 'error' as const }]
    : []

  return {
    prompts: [{
      id: `${state.toolId}-prompt`,
      text: promptText,
      tone: validation.length > 0 ? 'warning' : 'neutral',
    }],
    selectionGuide: {
      id: `${state.toolId}-selection`,
      label: metadata.selection.label,
      acceptedKinds: metadata.selection.acceptedKinds,
      selectedCount,
      requiredCount: metadata.selection.requiredCount,
      hoverLabel,
    },
    controls: [
      ...(isOffset
        ? [
            {
              id: 'offset-distance',
              kind: 'numeric' as const,
              label: 'Distance',
              value: state.offsetDistance,
              unit: 'mm',
              disabled: !hasSelection,
              action: { type: 'patch' as const, patch: { intent: 'setOffsetDistance' } },
            },
            {
              id: 'offset-side',
              kind: 'option' as const,
              label: 'Side',
              value: state.offsetSide,
              options: [
                { value: 'left', label: 'Left / outward' },
                { value: 'right', label: 'Right / inward' },
              ],
              disabled: !hasSelection,
              action: { type: 'patch' as const, patch: { intent: 'setOffsetSide' } },
            },
          ]
        : []),
      ...(needsNumericValue
        ? [{
            id: `${state.toolId}-value`,
            kind: 'numeric' as const,
            label: numericLabel,
            value: state.toolValue,
            unit: numericUnit,
            disabled: !hasSelection,
            action: { type: 'patch' as const, patch: { intent: 'setSketchEditValue' } },
          }]
        : []),
    ],
    completionHints: [{
      id: `${state.toolId}-completion`,
      text: isOffset
        ? hasSelection ? 'Confirm to create offset geometry' : 'Select connected lines or one curve'
        : hasSelection ? `Confirm ${metadata.previewLabel.toLowerCase()}` : metadata.validationMessages.emptySelection,
      ready: Boolean(isReady),
    }],
    floatingInput: isOffset && hasSelection
      ? {
          id: 'offset-distance-input',
          label: 'Offset distance',
          value: state.offsetDistance,
          unit: 'mm',
          min: 0,
          confirmLabel: 'Create',
          cancelLabel: 'Cancel',
          placement: 'target',
          anchor: previewEntities[0]?.kind === 'line'
            ? {
                kind: 'sketchPoint' as const,
                point: [
                  (previewEntities[0].start[0] + previewEntities[0].end[0]) / 2,
                  (previewEntities[0].start[1] + previewEntities[0].end[1]) / 2,
                ],
                offset: { x: 18, y: -18 },
              }
            : previewEntities[0]?.kind === 'circle'
              ? { kind: 'sketchPoint' as const, point: previewEntities[0].center, offset: { x: 18, y: -18 } }
              : undefined,
          submitAction: { type: 'patch', patch: { intent: 'commitOffset' } },
          cancelAction: { type: 'patch', patch: { intent: 'cancelOffset' } },
        }
      : needsNumericValue && hasSelection
        ? {
            id: `${state.toolId}-value-input`,
            label: numericLabel,
            value: state.toolValue,
            unit: numericUnit,
            min: 0,
            confirmLabel: 'Create',
            cancelLabel: 'Cancel',
            placement: 'target',
            anchor: getPreviewAnchor(previewEntities),
            submitAction: { type: 'patch', patch: { intent: 'commitSketchEditOperator' } },
            cancelAction: { type: 'patch', patch: { intent: 'cancelSketchEditOperator' } },
          }
      : null,
    overlays: state.hoverTarget
      ? [{
          id: `${state.toolId}-target-feedback`,
          kind: 'referenceLabel',
          label: hoverLabel ?? 'Unsupported target',
          anchor: { kind: 'sketchPoint', point: [0, 0], offset: { x: 18, y: -18 } },
        }]
      : [],
    validation,
    extension: {
      id: `${state.toolId}-workflow`,
      payload: {
        toolId: state.toolId,
        hasSelection,
        selectedCount,
        mutationContract: metadata.mutationContract,
        previewEntityCount: previewEntities.length,
      },
    },
  }
}

function getPreviewAnchor(previewEntities: readonly SketchDraftEntity[]): SketchToolAnchorDescriptor | undefined {
  const preview = previewEntities[0]
  if (!preview) {
    return undefined
  }

  if (preview.kind === 'line') {
    return {
      kind: 'sketchPoint',
      point: midpointSketchPoints(preview.start, preview.end),
      offset: { x: 18, y: -18 },
    }
  }

  if (preview.kind === 'circle') {
    return { kind: 'sketchPoint', point: preview.center, offset: { x: 18, y: -18 } }
  }

  const points = preview.kind === 'spline' || preview.kind === 'polyline' ? preview.points : []
  const point = points[Math.floor(points.length / 2)]
  return point ? { kind: 'sketchPoint', point, offset: { x: 18, y: -18 } } : undefined
}

function midpointSketchPoints(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
}

function beginSketchEditTool(session: SketchSessionState, toolId: SketchEditToolId): SketchSessionState {
  const activeEditTool: SketchEditToolState = {
    toolId,
    hoverTarget: null,
    selectedTarget: null,
    selectedTargets: [],
    offsetDistance: 1,
    offsetSide: 'left',
    toolValue: toolId === 'sketchSlot' ? 2 : 1,
  }

  return {
    ...session,
    activeTool: toolId,
    activeEditTool,
    status: 'collectingTargets',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildSketchEditToolPresentation(activeEditTool),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function beginSketchTool(session: SketchSessionState, toolId: SketchAuthoringToolId): SketchSessionState {
  if (toolId === 'construction') {
    return beginSketchConstructionTool(session)
  }

  if (toolId === 'projectReference') {
    return beginSketchReferenceTool(session)
  }

  if (isRegisteredSketchConstraintToolId(toolId)) {
    return {
      ...activateSketchConstraintTool(session, toolId),
      constructionTargetPicking: false,
      referenceTargetPicking: false,
    }
  }

  if (isRegisteredSketchEditToolId(toolId)) {
    return beginSketchEditTool(session, toolId)
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
    referenceTargetPicking: false,
    constructionModifierActive,
    pointerDownPoint: activation.state.pointerDownPoint,
    livePoint: activation.state.livePoint,
    toolPlacedPoints: activation.state.placedPoints ?? [],
    toolSettings: activation.state.settings ?? {},
    toolStagedEntities: [],
    validationMessage: activation.state.validationMessage,
    toolPresentation: activation.presentation,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function clearActiveSketchTool(session: SketchSessionState): SketchSessionState {
  if (
    session.activeTool === null
    && !isSketchConstructionSelected(session)
    && !session.referenceTargetPicking
    && !session.activeStyleFocus
  ) {
    return session
  }

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolStagedEntities: [],
    validationMessage: null,
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
      activeSnap: null,
    }
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    return session.activeSnap || session.drawStartSnap
      ? { ...session, activeSnap: null, drawStartSnap: null }
      : session
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const snap = resolveSessionSnap(session, point)
  const result = toolDefinition.pointerMove({
    state: getToolRuntimeState(session),
    point: snap.point,
  })

  return {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
    validationMessage: result.state.validationMessage,
    toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
    activeSnap: snap.candidate,
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

export function focusSketchStyleTool(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
  toolId: SketchStyleToolId,
): SketchSessionState {
  const target = getFirstSketchStyleTarget(session, selectedTargets)

  return {
    ...session,
    activeStyleFocus: { toolId, target },
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: target?.kind === 'sketchPoint' ? target : null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function updateSketchStyleFocusTarget(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
): SketchSessionState {
  if (!session.activeStyleFocus) {
    return session
  }

  const target = getFirstSketchStyleTarget(session, selectedTargets)

  if (
    (target === null && session.activeStyleFocus.target === null)
    || (target !== null && session.activeStyleFocus.target !== null && primitiveRefEquals(target, session.activeStyleFocus.target))
  ) {
    return session
  }

  return {
    ...session,
    activeStyleFocus: {
      ...session.activeStyleFocus,
      target,
    },
    activeEditTarget: target?.kind === 'sketchPoint' ? target : null,
    validationMessage: null,
  }
}

export function getActiveSketchStyleToolId(session: SketchSessionState): SketchStyleToolId | null {
  return session.activeStyleFocus?.toolId ?? null
}

export function hasSketchStyleTarget(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
): boolean {
  return getFirstSketchStyleTarget(session, selectedTargets) !== null
}

function getFirstSketchStyleTarget(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
): Extract<PrimitiveRef, { kind: 'sketchEntity' | 'sketchPoint' }> | null {
  const sketchId = getSessionSketchId(session)
  return selectedTargets.find((target) => isSketchStyleTarget(target, sketchId)) ?? null
}

function getSketchStyleTargetDefinition(
  session: SketchSessionState,
  target: Extract<PrimitiveRef, { kind: 'sketchEntity' | 'sketchPoint' }> | null,
): { style?: SketchStyleDefinition } | null {
  if (!target) {
    return null
  }

  if (target.kind === 'sketchPoint') {
    return session.definition.points.find((point) => point.pointId === target.pointId) ?? null
  }

  return session.definition.entities.find((entity) => entity.entityId === target.entityId) ?? null
}

function createSessionCommitFactories(
  sequence: number,
  sketchId: SketchId,
) {
  return {
    createPointId: (suffix: string) => createPointId(sequence, suffix),
    createEntityId: (suffix: string) => createEntityId(sequence, suffix),
    createConstraintId: (suffix: string) => createConstraintId(sequence, suffix),
    createDimensionId: (suffix: string) => createDimensionId(sequence, suffix),
    createPoint: (label: string, pointId: SketchPointId, position: SketchPoint) =>
      createPointDefinition(sketchId, pointId, label, position, false),
    createLineEntity: (label: string, entityId: SketchEntityId, startPointId: SketchPointId, endPointId: SketchPointId) =>
      createLineEntityDefinition(sketchId, entityId, label, startPointId, endPointId, false),
    createPointEntity: (label: string, entityId: SketchEntityId, pointId: SketchPointId) =>
      createPointEntityDefinition(sketchId, entityId, label, pointId, false),
    createCircleEntity: (label: string, entityId: SketchEntityId, centerPointId: SketchPointId, radius: number) =>
      createCircleEntityDefinition(sketchId, entityId, label, centerPointId, radius, false),
    createArcEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
      sweepDirection: 'clockwise' | 'counterClockwise',
    ) =>
      createArcEntityDefinition(sketchId, entityId, label, centerPointId, startPointId, endPointId, sweepDirection, false),
    createSplineEntity: (label: string, entityId: SketchEntityId, fitPointIds: readonly SketchPointId[], degree?: 2 | 3) =>
      createSplineEntityDefinition(sketchId, entityId, label, fitPointIds, false, degree),
    createEllipseEntity: (label: string, entityId: SketchEntityId, centerPointId: SketchPointId, majorAxisPointId: SketchPointId, minorRadius: number) =>
      createEllipseEntityDefinition(sketchId, entityId, label, centerPointId, majorAxisPointId, minorRadius, false),
    createEllipticalArcEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      majorAxisPointId: SketchPointId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
      minorRadius: number,
      sweepDirection: 'clockwise' | 'counterClockwise',
    ) =>
      createEllipticalArcEntityDefinition(sketchId, entityId, label, centerPointId, majorAxisPointId, startPointId, endPointId, minorRadius, sweepDirection, false),
    createConicEntity: (label: string, entityId: SketchEntityId, startPointId: SketchPointId, controlPointId: SketchPointId, endPointId: SketchPointId, rho: number) =>
      createConicEntityDefinition(sketchId, entityId, label, startPointId, controlPointId, endPointId, rho, false),
    createBezierCurveEntity: (label: string, entityId: SketchEntityId, controlPointIds: readonly SketchPointId[], degree: 2 | 3) =>
      createBezierCurveEntityDefinition(sketchId, entityId, label, controlPointIds, degree, false),
    createProfileTextEntity: (
      label: string,
      entityId: SketchEntityId,
      anchorPointId: SketchPointId,
      text: string,
      height: number,
      rotationRadians: number,
      horizontalAlign: 'left' | 'center' | 'right',
      verticalAlign: 'baseline' | 'middle' | 'top' | 'bottom',
    ) =>
      createProfileTextEntityDefinition(sketchId, entityId, label, anchorPointId, text, height, rotationRadians, horizontalAlign, verticalAlign, false),
  }
}

function getOffsetPreview(
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

function getOffsetCurveForProjectedTarget(
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

function getSelectedSketchEntityIds(activeEditTool: SketchEditToolState): SketchEntityId[] {
  return activeEditTool.selectedTargets
    .filter((target): target is Extract<PrimitiveRef, { kind: 'sketchEntity' }> => target.kind === 'sketchEntity')
    .map((target) => target.entityId)
}

function getSketchEditOperatorResult(
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

function applySketchEditOperationResult(
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
    validationMessage: null,
    toolPresentation: buildSketchEditToolPresentation(nextEditTool),
  }
}

function patchSketchEditOperatorValue(
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

  const edit = solveDraggedPointEdit(session.definition, session.projectedReferences, drag.target.pointId, point)

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
        },
    commitRequest: rebuildSessionCommitRequest(session, definition),
    validationMessage: null,
  }
}

function solveDraggedPointEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
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

  const nextDefinition = {
    ...definition,
    points: definition.points.map((point) => {
      const position = positionMap.get(point.pointId)
      return position ? { ...point, position } : point
    }),
  }

  return evaluateSketchDerivations(nextDefinition).definition
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

  return {
    ...session,
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
    activeEditTarget: null,
    activeDrag: null,
    fullDefinition: nextFullDefinition,
    definition,
    toolStagedEntities: [],
    commitRequest: rebuildSessionCommitRequest(session, definition),
    validationMessage: null,
  }
}

function createReferenceId(sequence: number, target: PrimitiveRef): ReferenceId {
  return `ref_${sequence}_${getTargetKey(target).replaceAll(/[^a-zA-Z0-9_-]/g, '-')}` as ReferenceId
}

function sourceMatchesTarget(reference: SketchReferenceDefinition, target: PrimitiveRef) {
  if (reference.kind === 'modelReference') {
    return getTargetKey(reference.source) === getTargetKey(target)
  }

  if (reference.kind === 'sketchReference') {
    return getTargetKey(reference.source) === getTargetKey(target)
  }

  if (reference.kind === 'constructionPlane') {
    return getTargetKey(reference.source) === getTargetKey(target)
  }

  return false
}

function createReferenceDefinition(
  sequence: number,
  target: PrimitiveRef,
): SketchReferenceDefinition | { kind: 'unsupported'; message: string } {
  switch (target.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return {
        referenceId: createReferenceId(sequence, target),
        kind: 'modelReference',
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode: target.kind === 'face' ? 'useExistingCoplanarGeometry' : 'projectAlongPlaneNormal',
      }
    case 'sketch':
    case 'sketchEntity':
    case 'sketchPoint':
      return {
        referenceId: createReferenceId(sequence, target),
        kind: 'sketchReference',
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode: 'useExistingCoplanarGeometry',
      }
    case 'construction':
      return {
        referenceId: createReferenceId(sequence, target),
        kind: 'constructionPlane',
        label: 'Reference construction plane',
        source: target,
        projectionMode: 'coplanar',
      }
    default:
      return {
        kind: 'unsupported',
        message: `${target.kind} cannot be referenced from a sketch.`,
      }
  }
}

function appendReferenceDefinition(
  definition: SketchDefinition,
  reference: SketchReferenceDefinition,
): SketchDefinition {
  return {
    ...definition,
    referenceIds: [...definition.referenceIds, reference.referenceId],
    references: [...definition.references, reference],
  }
}

export function selectSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (!session.referenceTargetPicking) {
    return session
  }

  if (
    (target.kind === 'sketch' || target.kind === 'sketchEntity' || target.kind === 'sketchPoint')
    && target.sketchId === getSessionSketchId(session)
  ) {
    const message = 'Reference geometry must come from model topology or another existing sketch.'
    return {
      ...session,
      validationMessage: message,
      toolPresentation: buildReferenceTargetPresentation(message),
    }
  }

  if (session.fullDefinition.references.some((reference) => sourceMatchesTarget(reference, target))) {
    const message = 'That reference is already authored in this sketch.'
    return {
      ...session,
      validationMessage: message,
      toolPresentation: buildReferenceTargetPresentation(message),
    }
  }

  const nextSequence = session.sequence + 1
  const reference = createReferenceDefinition(nextSequence, target)

  if (reference.kind === 'unsupported') {
    return {
      ...session,
      validationMessage: reference.message,
      toolPresentation: buildReferenceTargetPresentation(reference.message),
    }
  }

  const fullDefinition = appendReferenceDefinition(session.fullDefinition, reference)
  const definition = appendReferenceDefinition(session.definition, reference)

  return {
    ...session,
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
    activeEditTarget: null,
    activeDrag: null,
    sequence: nextSequence,
    definition,
    fullDefinition,
    commitRequest: rebuildSessionCommitRequest(session, definition),
    validationMessage: null,
  }
}

export function deleteSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (target.kind !== 'projectedReferenceGeometry' && target.kind !== 'sketchExternalReference') {
    return session
  }

  const removeFromDefinition = (definition: SketchDefinition): SketchDefinition => ({
    ...definition,
    referenceIds: definition.referenceIds.filter((referenceId) => referenceId !== target.referenceId),
    references: definition.references.filter((reference) => reference.referenceId !== target.referenceId),
  })
  const fullDefinition = removeFromDefinition(session.fullDefinition)

  if (fullDefinition === session.fullDefinition) {
    return session
  }

  const definition = removeFromDefinition(session.definition)

  return {
    ...session,
    fullDefinition,
    definition,
    projectedReferences: session.projectedReferences.filter((reference) => reference.referenceId !== target.referenceId),
    projectionDiagnostics: session.projectionDiagnostics,
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

const SNAP_INFERENCE_EPSILON = 1e-6

function pointsAlmostEqual(left: SketchPoint, right: SketchPoint) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= SNAP_INFERENCE_EPSILON
}

function projectedKindForSource(source: Extract<SketchSnapSourceRef, { kind: 'projectedGeometry' }>): NonNullable<ProjectedSketchGeometryRef['kind']> {
  switch (source.geometryKind) {
    case 'point':
      return 'projectedPoint'
    case 'lineSegment':
      return 'projectedLineSegment'
    case 'circle':
      return 'projectedCircle'
    case 'arc':
      return 'projectedArc'
    case 'spline':
      return 'projectedSpline'
  }
}

function projectedOperandFromSource(
  source: Extract<SketchSnapSourceRef, { kind: 'projectedGeometry' }>,
): Extract<ConstraintDefinition, { kind: 'pointOnProjectedCurve' }>['projectedCurve'] {
  return {
    kind: 'projectedGeometry',
    reference: {
      kind: projectedKindForSource(source),
      referenceId: source.referenceId,
      geometryId: source.geometryId,
    },
  }
}

function localPointOperand(pointId: SketchPointId): Extract<ConstraintDefinition, { kind: 'midpoint' }>['point'] {
  return { kind: 'localPoint', pointId }
}

function localEntityOperand(entityId: SketchEntityId): Extract<ConstraintDefinition, { kind: 'midpoint' }>['line'] {
  return { kind: 'localEntity', entityId }
}

function getEntityEndpointAtPoint(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  point: SketchPoint,
): SketchPointId | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  const candidatePointIds =
    entity.kind === 'lineSegment'
      ? [entity.startPointId, entity.endPointId]
      : entity.kind === 'arc'
        ? [entity.startPointId, entity.endPointId]
        : entity.kind === 'point'
          ? [entity.pointId]
          : []

  for (const pointId of candidatePointIds) {
    const candidate = definition.points.find((entry) => entry.pointId === pointId)
    if (candidate && pointsAlmostEqual(candidate.position, point)) {
      return pointId
    }
  }

  return null
}

function getEntityCenterPointId(definition: SketchDefinition, entityId: SketchEntityId): SketchPointId | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  return entity?.kind === 'circle' || entity?.kind === 'arc'
    ? entity.centerPointId
    : null
}

function getPatchPointIdsAtPosition(
  patch: SketchToolCommitContribution,
  point: SketchPoint,
): SketchPointId[] {
  return patch.points
    .filter((candidate) => pointsAlmostEqual(candidate.position, point))
    .map((candidate) => candidate.pointId)
}

function getPatchLineEntityId(patch: SketchToolCommitContribution): SketchEntityId | null {
  return patch.entities.find((entity) => entity.kind === 'lineSegment')?.entityId ?? null
}

function getPatchCircleLikeEntityAtCenter(
  patch: SketchToolCommitContribution,
  pointId: SketchPointId,
): SketchEntityId | null {
  return patch.entities.find((entity) =>
    (entity.kind === 'circle' || entity.kind === 'arc') && entity.centerPointId === pointId,
  )?.entityId ?? null
}

function addConstraint(
  constraints: ConstraintDefinition[],
  constraint: ConstraintDefinition | null,
) {
  if (constraint) {
    constraints.push(constraint)
  }
}

function inferPointSnapConstraints(input: {
  previousDefinition: SketchDefinition
  patch: SketchToolCommitContribution
  candidate: SketchSnapCandidate
  snapRole: 'start' | 'end'
  pointId: SketchPointId
  sequence: number
  createConstraintId: (suffix: string) => ConstraintId
}): ConstraintDefinition[] {
  const constraints: ConstraintDefinition[] = []
  const localPoint = localPointOperand(input.pointId)
  const createId = (suffix: string) =>
    input.createConstraintId(`${input.snapRole}-${input.pointId}-${suffix}`)
  const localCircleLikeEntityId = getPatchCircleLikeEntityAtCenter(input.patch, input.pointId)

  const addPointOnSource = (source: SketchSnapSourceRef, index: number) => {
    if (source.kind === 'localEntity') {
      addConstraint(constraints, {
        constraintId: createId(`inferred-point-on-${index}`),
        kind: 'pointOnCurve',
        label: `Inferred point on curve ${input.sequence}`,
        point: localPoint,
        curve: localEntityOperand(source.entityId),
      })
      return
    }

    if (source.kind === 'projectedGeometry') {
      addConstraint(constraints, {
        constraintId: createId(`inferred-point-on-projected-${index}`),
        kind: 'pointOnProjectedCurve',
        label: `Inferred point on projected curve ${input.sequence}`,
        point: localPoint,
        projectedCurve: projectedOperandFromSource(source),
      })
    }
  }

  input.candidate.sources.forEach((source, index) => {
    if (source.kind === 'transientAnchor') {
      return
    }

    if (input.candidate.kind === 'endpoint') {
      if (source.kind === 'localPoint') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-coincident-${index}`),
          kind: 'coincident',
          label: `Inferred coincident ${input.sequence}`,
          pointIds: [input.pointId, source.pointId],
        })
        return
      }

      if (source.kind === 'localEntity') {
        const endpointId = getEntityEndpointAtPoint(input.previousDefinition, source.entityId, input.candidate.point)
        if (endpointId) {
          addConstraint(constraints, {
            constraintId: createId(`inferred-coincident-endpoint-${index}`),
            kind: 'coincident',
            label: `Inferred coincident ${input.sequence}`,
            pointIds: [input.pointId, endpointId],
          })
        }
        return
      }

      if (source.kind === 'projectedGeometry' && source.geometryKind === 'point') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-coincident-projected-${index}`),
          kind: 'coincidentProjectedPoint',
          label: `Inferred coincident projected point ${input.sequence}`,
          point: localPoint,
          projectedPoint: projectedOperandFromSource(source),
        })
      }
      return
    }

    if (input.candidate.kind === 'center') {
      if (source.kind === 'localEntity') {
        if (localCircleLikeEntityId && (source.geometryKind === 'circle' || source.geometryKind === 'arc')) {
          addConstraint(constraints, {
            constraintId: createId(`inferred-concentric-${index}`),
            kind: 'concentric',
            label: `Inferred concentric ${input.sequence}`,
            entityIds: [localCircleLikeEntityId, source.entityId],
          })
          return
        }

        const centerPointId = getEntityCenterPointId(input.previousDefinition, source.entityId)
        if (centerPointId) {
          addConstraint(constraints, {
            constraintId: createId(`inferred-coincident-center-${index}`),
            kind: 'coincident',
            label: `Inferred center coincident ${input.sequence}`,
            pointIds: [input.pointId, centerPointId],
          })
        }
        return
      }

      if (
        source.kind === 'projectedGeometry'
        && localCircleLikeEntityId
        && (source.geometryKind === 'circle' || source.geometryKind === 'arc')
      ) {
        addConstraint(constraints, {
          constraintId: createId(`inferred-concentric-projected-${index}`),
          kind: 'concentricProjectedCurve',
          label: `Inferred concentric projected curve ${input.sequence}`,
          curve: localEntityOperand(localCircleLikeEntityId),
          projectedCurve: projectedOperandFromSource(source),
        })
        return
      }

      if (source.kind === 'projectedGeometry' && source.geometryKind === 'point') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-coincident-projected-center-${index}`),
          kind: 'coincidentProjectedPoint',
          label: `Inferred projected center coincident ${input.sequence}`,
          point: localPoint,
          projectedPoint: projectedOperandFromSource(source),
        })
      }
      return
    }

    if (input.candidate.kind === 'midpoint') {
      if (source.kind === 'localEntity' && source.geometryKind === 'lineSegment') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-midpoint-${index}`),
          kind: 'midpoint',
          label: `Inferred midpoint ${input.sequence}`,
          point: localPoint,
          line: localEntityOperand(source.entityId),
        })
        return
      }

      if (source.kind === 'projectedGeometry' && source.geometryKind === 'lineSegment') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-midpoint-projected-${index}`),
          kind: 'midpointProjectedLine',
          label: `Inferred projected midpoint ${input.sequence}`,
          point: localPoint,
          projectedLine: projectedOperandFromSource(source),
        })
      }
      return
    }

    if (
      input.candidate.kind === 'nearestOnLine'
      || input.candidate.kind === 'nearestOnCircle'
      || input.candidate.kind === 'nearestOnArc'
      || input.candidate.kind === 'intersection'
    ) {
      addPointOnSource(source, index)
    }
  })

  return constraints
}

function inferLineSnapConstraints(input: {
  patch: SketchToolCommitContribution
  candidate: SketchSnapCandidate | null
  endPointId: SketchPointId | null
  sequence: number
  createConstraintId: (suffix: string) => ConstraintId
}): ConstraintDefinition[] {
  const candidate = input.candidate
  const lineEntityId = getPatchLineEntityId(input.patch)
  if (!candidate || !lineEntityId || !input.endPointId) {
    return []
  }

  const constraints: ConstraintDefinition[] = []
  const localLine = localEntityOperand(lineEntityId)
  const localEndPoint = localPointOperand(input.endPointId)

  if (candidate.kind === 'horizontalAlignment') {
    addConstraint(constraints, {
      constraintId: input.createConstraintId('inferred-horizontal'),
      kind: 'horizontal',
      label: `Inferred horizontal ${input.sequence}`,
      entityId: lineEntityId,
    })
  }

  if (candidate.kind === 'verticalAlignment') {
    addConstraint(constraints, {
      constraintId: input.createConstraintId('inferred-vertical'),
      kind: 'vertical',
      label: `Inferred vertical ${input.sequence}`,
      entityId: lineEntityId,
    })
  }

  candidate.sources.forEach((source, index) => {
    if (source.kind === 'transientAnchor') {
      return
    }

    if (
      candidate.kind === 'perpendicularFoot'
      && (source.kind === 'localEntity' || source.kind === 'projectedGeometry')
      && source.geometryKind === 'lineSegment'
    ) {
      if (source.kind === 'localEntity') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-perpendicular-${index}`),
          kind: 'perpendicular',
          label: `Inferred perpendicular ${input.sequence}`,
          entityIds: [lineEntityId, source.entityId],
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-foot-on-line-${index}`),
          kind: 'pointOnCurve',
          label: `Inferred perpendicular foot ${input.sequence}`,
          point: localEndPoint,
          curve: localEntityOperand(source.entityId),
        })
        return
      }

      if (source.kind === 'projectedGeometry') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-perpendicular-projected-${index}`),
          kind: 'perpendicularProjectedLine',
          label: `Inferred perpendicular projected line ${input.sequence}`,
          line: localLine,
          projectedLine: projectedOperandFromSource(source),
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-foot-on-projected-${index}`),
          kind: 'pointOnProjectedCurve',
          label: `Inferred perpendicular foot projected ${input.sequence}`,
          point: localEndPoint,
          projectedCurve: projectedOperandFromSource(source),
        })
      }
      return
    }

    if (
      candidate.kind === 'tangent'
      && (source.kind === 'localEntity' || source.kind === 'projectedGeometry')
      && (source.geometryKind === 'circle' || source.geometryKind === 'arc')
    ) {
      if (source.kind === 'localEntity') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-${index}`),
          kind: 'tangent',
          label: `Inferred tangent ${input.sequence}`,
          entityIds: [lineEntityId, source.entityId],
          relation: 'external',
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-point-on-${index}`),
          kind: 'pointOnCurve',
          label: `Inferred tangent point ${input.sequence}`,
          point: localEndPoint,
          curve: localEntityOperand(source.entityId),
        })
        return
      }

      if (source.kind === 'projectedGeometry') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-projected-${index}`),
          kind: 'tangentProjectedCurve',
          label: `Inferred tangent projected curve ${input.sequence}`,
          curve: localLine,
          projectedCurve: projectedOperandFromSource(source),
          relation: 'external',
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-point-projected-${index}`),
          kind: 'pointOnProjectedCurve',
          label: `Inferred tangent point projected ${input.sequence}`,
          point: localEndPoint,
          projectedCurve: projectedOperandFromSource(source),
        })
      }
    }
  })

  return constraints
}

function appendInferredSnapConstraints(input: {
  previousDefinition: SketchDefinition
  patch: SketchToolCommitContribution
  activeTool: SketchToolId
  startSnap: SketchSnapCandidate | null
  endSnap: SketchSnapCandidate | null
  sequence: number
  createConstraintId: (suffix: string) => ConstraintId
}): SketchToolCommitContribution {
  const constraints = [...(input.patch.constraints ?? [])]

  for (const [snapRole, snap] of [
    ['start', input.startSnap],
    ['end', input.endSnap],
  ] as const) {
    if (!snap) {
      continue
    }

    for (const pointId of getPatchPointIdsAtPosition(input.patch, snap.point)) {
      constraints.push(...inferPointSnapConstraints({
        previousDefinition: input.previousDefinition,
        patch: input.patch,
        candidate: snap,
        snapRole,
        pointId,
        sequence: input.sequence,
        createConstraintId: input.createConstraintId,
      }))
    }
  }

  if (input.activeTool === 'line') {
    const endPointId = input.patch.entities.find((entity) => entity.kind === 'lineSegment')?.endPointId ?? null
    constraints.push(...inferLineSnapConstraints({
      patch: input.patch,
      candidate: input.endSnap,
      endPointId,
      sequence: input.sequence,
      createConstraintId: input.createConstraintId,
    }))
  }

  const uniqueConstraints = dedupeConstraints(constraints)

  return uniqueConstraints.length === (input.patch.constraints ?? []).length
    ? input.patch
    : {
        ...input.patch,
        constraints: uniqueConstraints,
      }
}

function dedupeConstraints(constraints: ConstraintDefinition[]) {
  const seen = new Set<string>()
  const uniqueConstraints: ConstraintDefinition[] = []

  for (const constraint of constraints) {
    const key = getConstraintDedupeKey(constraint)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    uniqueConstraints.push(constraint)
  }

  return uniqueConstraints
}

function getConstraintDedupeKey(constraint: ConstraintDefinition): string {
  switch (constraint.kind) {
    case 'coincident':
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(':')}`
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
    case 'tangent':
    case 'concentric':
      return `${constraint.kind}:${[...constraint.entityIds].sort().join(':')}`
    case 'horizontal':
    case 'vertical':
      return `${constraint.kind}:${constraint.entityId}`
    case 'midpoint':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.line.entityId}`
    case 'pointOnCurve':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.curve.entityId}`
    case 'fixPoint':
      return `${constraint.kind}:${constraint.pointId}:${constraint.position.join(':')}`
    case 'angle':
      return `${constraint.kind}:${constraint.pointIds.join(':')}:${constraint.valueRadians}`
    case 'coincidentProjectedPoint':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.projectedPoint.reference.referenceId}:${constraint.projectedPoint.reference.geometryId}`
    case 'pointOnProjectedCurve':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}`
    case 'midpointProjectedLine':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.projectedLine.reference.referenceId}:${constraint.projectedLine.reference.geometryId}`
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.projectedLine.reference.referenceId}:${constraint.projectedLine.reference.geometryId}`
    case 'tangentProjectedCurve':
    case 'concentricProjectedCurve':
      return `${constraint.kind}:${constraint.curve.entityId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}`
    case 'normal':
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.curve.entityId}:${constraint.point.pointId}`
    case 'normalProjectedCurve':
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}:${constraint.point.pointId}`
    case 'symmetric':
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(':')}:${constraint.axis.entityId}`
    case 'symmetricProjectedLine':
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(':')}:${constraint.projectedLine.reference.referenceId}:${constraint.projectedLine.reference.geometryId}`
  }
}

export function startSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
    return session
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const snap = resolveSessionSnap(session, point)
  const result = toolDefinition.pointerRelease({
    state: {
      status: 'idle',
      pointerDownPoint: null,
      livePoint: null,
      placedPoints: [],
      settings: session.toolSettings,
      validationMessage: null,
    } satisfies import('@/domain/sketch-tools/definition').SketchToolRuntimeState,
    point: snap.point,
  })

  return {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
    validationMessage: result.state.validationMessage,
    toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
    activeSnap: snap.candidate,
    drawStartSnap: snap.candidate,
  }
}

export function acceptSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool)
    || session.pointerDownPoint === null
  ) {
    return session
  }

  const startPoint = session.pointerDownPoint
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const snap = resolveSessionSnap(session, point)
  const endPoint = snap.point ?? point
  const result = toolDefinition.pointerRelease({
    state: getToolRuntimeState(session),
    point: endPoint,
  })

  if (result.state.validationMessage) {
    return {
      ...session,
      toolStagedEntities: [],
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
      toolSettings: result.state.settings ?? session.toolSettings,
      validationMessage: result.state.validationMessage,
      toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
      activeSnap: snap.candidate,
    }
  }

  if (result.state.status !== 'idle') {
    return {
      ...session,
      toolStagedEntities: withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
      toolSettings: result.state.settings ?? session.toolSettings,
      validationMessage: null,
      toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
      activeSnap: snap.candidate,
    }
  }

  const nextSequence = session.sequence + 1
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const baseDefinitionPatch = toolDefinition.createCommitContribution({
    sequence: nextSequence,
    start: startPoint,
    end: endPoint,
    points: result.state.placedPoints ?? [startPoint, endPoint],
    settings: result.state.settings ?? session.toolSettings,
    isConstruction: session.constructionModifierActive,
    acceptedSnaps: {
      start: session.drawStartSnap,
      end: snap.candidate,
    },
    factories: {
      createPointId: (suffix) => createPointId(nextSequence, suffix),
      createEntityId: (suffix) => createEntityId(nextSequence, suffix),
      createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
      createDimensionId: (suffix) => createDimensionId(nextSequence, suffix),
      createPoint: (label, pointId, position) =>
        createPointDefinition(sketchId, pointId, label, position, session.constructionModifierActive),
      createLineEntity: (label, entityId, startPointId, endPointId) =>
        createLineEntityDefinition(sketchId, entityId, label, startPointId, endPointId, session.constructionModifierActive),
      createPointEntity: (label, entityId, pointId) =>
        createPointEntityDefinition(sketchId, entityId, label, pointId, session.constructionModifierActive),
      createCircleEntity: (label, entityId, centerPointId, radius) =>
        createCircleEntityDefinition(sketchId, entityId, label, centerPointId, radius, session.constructionModifierActive),
      createArcEntity: (label, entityId, centerPointId, startPointId, endPointId, sweepDirection) =>
        createArcEntityDefinition(sketchId, entityId, label, centerPointId, startPointId, endPointId, sweepDirection, session.constructionModifierActive),
      createSplineEntity: (label, entityId, fitPointIds, degree) =>
        createSplineEntityDefinition(sketchId, entityId, label, fitPointIds, session.constructionModifierActive, degree),
      createEllipseEntity: (label, entityId, centerPointId, majorAxisPointId, minorRadius) =>
        createEllipseEntityDefinition(sketchId, entityId, label, centerPointId, majorAxisPointId, minorRadius, session.constructionModifierActive),
      createEllipticalArcEntity: (label, entityId, centerPointId, majorAxisPointId, startPointId, endPointId, minorRadius, sweepDirection) =>
        createEllipticalArcEntityDefinition(sketchId, entityId, label, centerPointId, majorAxisPointId, startPointId, endPointId, minorRadius, sweepDirection, session.constructionModifierActive),
      createConicEntity: (label, entityId, startPointId, controlPointId, endPointId, rho) =>
        createConicEntityDefinition(sketchId, entityId, label, startPointId, controlPointId, endPointId, rho, session.constructionModifierActive),
      createBezierCurveEntity: (label, entityId, controlPointIds, degree) =>
        createBezierCurveEntityDefinition(sketchId, entityId, label, controlPointIds, degree, session.constructionModifierActive),
      createProfileTextEntity: (label, entityId, anchorPointId, text, height, rotationRadians, horizontalAlign, verticalAlign) =>
        createProfileTextEntityDefinition(sketchId, entityId, label, anchorPointId, text, height, rotationRadians, horizontalAlign, verticalAlign, session.constructionModifierActive),
    },
  })
  const definitionPatch = appendInferredSnapConstraints({
    previousDefinition: session.definition,
    patch: baseDefinitionPatch,
    activeTool: session.activeTool,
    startSnap: session.drawStartSnap,
    endSnap: snap.candidate,
    sequence: nextSequence,
    createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
  })
  const history = applySketchHistoryContribution(session, definitionPatch)

  return {
    ...session,
    toolStagedEntities: [],
    definition: history.definition,
    fullDefinition: history.fullDefinition,
    historyCursor: history.historyCursor,
    historyOperations: history.historyOperations,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.status === 'idle' ? [] : result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.status === 'idle' ? {} : result.state.settings ?? session.toolSettings,
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
    activeEditTool: null,
    activeEditTarget: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

function resolveSessionSnap(
  session: SketchSessionState,
  point: SketchPoint | null,
): { point: SketchPoint | null; candidate: SketchSnapCandidate | null } {
  if (!point || !isDrawingSketchTool(session.activeTool)) {
    return { point, candidate: null }
  }

  const snap = resolveSketchSnap({
    pointer: point,
    geometries: collectSketchSnapGeometries({
      definition: session.definition,
      projectedReferences: session.projectedReferences,
    }),
    activeTool: session.activeTool,
    activeAnchor: session.status === 'drawing' ? session.pointerDownPoint : null,
    activeCandidateKey: session.activeSnap?.key ?? null,
  })

  return {
    point: snap.snappedPoint,
    candidate: snap.activeCandidate,
  }
}

function withSnapPresentation(
  presentation: SketchToolPresentationSchema,
  candidate: SketchSnapCandidate | null,
): SketchToolPresentationSchema {
  if (!candidate) {
    return presentation
  }

  return {
    ...presentation,
    overlays: [
      ...(presentation.overlays ?? []),
      ...getSnapConstraintPreviewOverlays(candidate),
      {
        id: 'active-snap',
        kind: 'snapIndicator',
        label: candidate.preview.label,
        point: candidate.point,
        candidateKind: candidate.kind,
        glyphKind: candidate.preview.glyph,
      },
    ],
  }
}

function getSnapConstraintPreviewOverlays(candidate: SketchSnapCandidate): SketchToolOverlayDescriptor[] {
  const detail = getSnapConstraintPreviewDetail(candidate)

  return detail
    ? [{
        id: 'active-snap-inferred-constraint',
        kind: 'constraintPreview',
        label: 'Inferred constraint',
        detail,
        anchor: { kind: 'sketchPoint', point: candidate.point, offset: { x: 18, y: 18 } },
      }]
    : []
}

function getSnapConstraintPreviewDetail(candidate: SketchSnapCandidate) {
  switch (candidate.kind) {
    case 'endpoint':
      return 'Coincident'
    case 'center':
      return 'Concentric or coincident center'
    case 'midpoint':
      return 'Midpoint'
    case 'nearestOnLine':
      return 'Point on line'
    case 'nearestOnCircle':
      return 'Point on circle'
    case 'nearestOnArc':
      return 'Point on arc'
    case 'intersection':
      return 'Point on intersecting curves'
    case 'horizontalAlignment':
      return 'Horizontal'
    case 'verticalAlignment':
      return 'Vertical'
    case 'perpendicularFoot':
      return 'Perpendicular'
    case 'tangent':
      return 'Tangent'
  }
}

function getToolRuntimeState(session: SketchSessionState): import('@/domain/sketch-tools/definition').SketchToolRuntimeState {
  return {
    status: session.status === 'drawing' ? 'drawing' : 'idle',
    pointerDownPoint: session.pointerDownPoint,
    livePoint: session.livePoint,
    placedPoints: session.toolPlacedPoints,
    settings: session.toolSettings,
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

  if (session.projectionDiagnostics.length > 0) {
    return session.projectionDiagnostics[0]?.message ?? 'Sketch reference projection has diagnostics'
  }

  if (session.activeDrag?.status === 'dragging') {
    return 'Dragging sketch point'
  }

  if (session.activeEditTarget) {
    return 'Sketch point selected'
  }

  if (session.activeStyleFocus) {
    return session.activeStyleFocus.target
      ? 'Sketch style controls active'
      : 'Select sketch geometry to edit style'
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

  if (session.activeEditTool) {
    return session.toolPresentation
  }

  if (session.activeStyleFocus) {
    return buildSketchStylePresentation(
      session.activeStyleFocus,
      getSketchStyleTargetDefinition(session, session.activeStyleFocus.target)?.style,
    )
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    if (!session.activeEditTarget) {
      return null
    }

    const styledPoint = session.definition.points.find((point) => point.pointId === session.activeEditTarget?.pointId)
    const controls = buildSketchStyleControls(styledPoint?.style)

    return {
      prompts: [{ id: 'sketch-style-prompt', text: 'Edit local sketch style' }],
      controls,
      controlGroups: [{ id: 'sketch-style-controls', label: 'Style', controls }],
    }
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
      : resolveSketchConstraintTarget(authoring.toolId, session.definition, target, session.projectedReferences)

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

  const resolved = resolveSketchConstraintTarget(authoring.toolId, session.definition, target, session.projectedReferences)

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

export function patchSketchDrawingToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool) || patch.intent !== 'setToolSetting') {
    return session
  }

  const key = typeof patch.key === 'string' ? patch.key : null
  if (!key) {
    return session
  }

  const nextSettings = {
    ...session.toolSettings,
    [key]: (patch.value ?? null) as SketchToolControlValue,
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const runtimeState = {
    ...getToolRuntimeState(session),
    settings: nextSettings,
  }

  return {
    ...session,
    toolSettings: nextSettings,
    toolStagedEntities: withConstructionFlag(toolDefinition.getStagedEntities(runtimeState), session.constructionModifierActive),
    toolPresentation: toolDefinition.getPresentation(runtimeState),
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

export function patchSketchStyleValue(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
  patch: Record<string, unknown>,
): SketchSessionState {
  const parsedPatch = parseSketchStylePatch(patch)

  if (!parsedPatch) {
    return session
  }

  const sketchId = getSessionSketchId(session)
  const localTargets = selectedTargets.filter((target) => isSketchStyleTarget(target, sketchId))

  if (localTargets.length === 0) {
    return session
  }

  const nextFullDefinition = applyStylePatchToDefinition(session.fullDefinition, localTargets, parsedPatch)

  if (nextFullDefinition === session.fullDefinition) {
    return session
  }

  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
  }
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
    toolPlacedPoints: [],
    toolSettings: {},
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

  return commitSketchAnnotationEditValue(session, {
    ...edit,
    pendingValue: edit.pendingValue,
  })
}

function applyStylePatchToDefinition(
  definition: SketchDefinition,
  targets: readonly Extract<PrimitiveRef, { kind: 'sketchEntity' | 'sketchPoint' }>[],
  patch: SketchStylePatch,
): SketchDefinition {
  const pointIds = new Set(
    targets
      .filter((target): target is Extract<PrimitiveRef, { kind: 'sketchPoint' }> => target.kind === 'sketchPoint')
      .map((target) => target.pointId),
  )
  const entityIds = new Set(
    targets
      .filter((target): target is Extract<PrimitiveRef, { kind: 'sketchEntity' }> => target.kind === 'sketchEntity')
      .map((target) => target.entityId),
  )

  let didChange = false

  const points = definition.points.map((point) => {
    if (!pointIds.has(point.pointId)) {
      return point
    }

    const nextStyle = applySketchStyleDefinitionPatch(point.style, patch)
    if (nextStyle === point.style) {
      return point
    }

    didChange = true
    return { ...point, style: nextStyle }
  })

  const entities = definition.entities.map((entity) => {
    if (!entityIds.has(entity.entityId)) {
      return entity
    }

    const nextStyle = applySketchStyleDefinitionPatch(entity.style, patch)
    if (nextStyle === entity.style) {
      return entity
    }

    didChange = true
    return { ...entity, style: nextStyle }
  })

  if (!didChange) {
    return definition
  }

  return {
    ...definition,
    points,
    entities,
  }
}

function applySketchStyleDefinitionPatch(
  style: SketchStyleDefinition | undefined,
  patch: SketchStylePatch,
): SketchStyleDefinition {
  const next = { ...(style ?? {}) }

  switch (patch.field) {
    case 'fillMode':
      if (next.fillMode === patch.value) {
        return style ?? next
      }
      next.fillMode = patch.value
      break
    case 'fillColor':
      if (next.fillColor === patch.value) {
        return style ?? next
      }
      next.fillColor = patch.value
      break
    case 'gradientStartColor':
      if (next.gradientStartColor === patch.value) {
        return style ?? next
      }
      next.gradientStartColor = patch.value
      break
    case 'gradientEndColor':
      if (next.gradientEndColor === patch.value) {
        return style ?? next
      }
      next.gradientEndColor = patch.value
      break
    case 'strokeEnabled':
      if (next.strokeEnabled === patch.value) {
        return style ?? next
      }
      next.strokeEnabled = patch.value
      break
    case 'strokeColor':
      if (next.strokeColor === patch.value) {
        return style ?? next
      }
      next.strokeColor = patch.value
      break
    case 'strokeWidth':
      if (next.strokeWidth === patch.value) {
        return style ?? next
      }
      next.strokeWidth = patch.value
      break
    case 'strokeCap':
      if (next.strokeCap === patch.value) {
        return style ?? next
      }
      next.strokeCap = patch.value
      break
    case 'strokeJoin':
      if (next.strokeJoin === patch.value) {
        return style ?? next
      }
      next.strokeJoin = patch.value
      break
    case 'strokeMiterLimit':
      if (next.strokeMiterLimit === patch.value) {
        return style ?? next
      }
      next.strokeMiterLimit = patch.value
      break
    case 'strokeDashSize':
      if (next.strokeDashSize === patch.value) {
        return style ?? next
      }
      next.strokeDashSize = patch.value
      break
    case 'strokeGapSize':
      if (next.strokeGapSize === patch.value) {
        return style ?? next
      }
      next.strokeGapSize = patch.value
      break
  }

  return next
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
  edit: SketchAnnotationEditState & { pendingValue: number },
): SketchSessionState {
  const updatedFullDefinition = updateAnnotationValueInDefinition(
    session.fullDefinition,
    edit.target,
    edit.pendingValue,
  )

  if (updatedFullDefinition === session.fullDefinition) {
    return session
  }

  const solved = solveEditedAnnotationDefinition(updatedFullDefinition, session.projectedReferences)

  if (solved.kind === 'blocked') {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(session, edit, solved.message),
      validationMessage: solved.message,
    }
  }

  const nextFullDefinition = solved.definition
  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    toolStagedEntities: [],
    status: 'idle',
    toolPresentation: null,
    activeAnnotationEdit: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
  }
}

function solveEditedAnnotationDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences,
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

function solveCommittedConstraintDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchDefinition {
  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  })
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied')

  if (solved.status.solveState !== 'solved' || !constraintsSatisfied) {
    return definition
  }

  return applyPointPositionsToDefinition(
    definition,
    solved.solvedSnapshot.solvedPoints.map((point) => ({
      pointId: point.pointId,
      position: point.solvedPosition,
    })),
  )
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
  if (
    (contribution.constraints?.length ?? 0) === 0
    && (contribution.dimensions?.length ?? 0) === 0
  ) {
    const validationMessage = `${definition.metadata.name} needs the supported target combination.`

    return {
      ...session,
      validationMessage,
      toolPresentation: buildConstraintToolPresentation(authoring, validationMessage),
    }
  }

  const history = applySketchHistoryContribution(session, {
    points: [],
    entities: [],
    ...contribution,
  })
  const solvedDefinition = solveCommittedConstraintDefinition(history.definition, session.projectedReferences)
  const solvedFullDefinition = solveCommittedConstraintDefinition(history.fullDefinition, session.projectedReferences)

  return {
    ...session,
    toolStagedEntities: [],
    definition: solvedDefinition,
    fullDefinition: solvedFullDefinition,
    historyCursor: history.historyCursor,
    historyOperations: history.historyOperations,
    sequence: session.sequence + 1,
    status: 'idle',
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    commitRequest: rebuildSessionCommitRequest(session, solvedDefinition),
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

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    historyCursor,
    toolStagedEntities: [],
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
      anchor: createConstraintAnnotationAnchor(session, constraint),
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
    case 'perpendicularProjectedLine':
      return 'constraintPerpendicular'
    case 'tangentProjectedCurve':
    case 'tangent':
      return 'constraintTangent'
    case 'midpoint':
    case 'midpointProjectedLine':
      return 'constraintMidpoint'
    case 'normal':
    case 'normalProjectedCurve':
      return 'constraintNormal'
    case 'symmetric':
    case 'symmetricProjectedLine':
      return 'constraintSymmetric'
    case 'pointOnProjectedCurve':
    case 'pointOnCurve':
      return 'constraintPierce'
    case 'coincidentProjectedPoint':
      return 'constraintCoincident'
    case 'parallelProjectedLine':
      return 'constraintParallel'
    case 'concentric':
    case 'concentricProjectedCurve':
      return 'constraintConcentric'
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
): readonly PrimitiveRef[] {
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
    case 'tangent':
    case 'concentric':
      return constraint.entityIds.map((entityId) => createSketchEntityRef(sketchId, entityId))
    case 'midpoint':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ]
    case 'midpointProjectedLine':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createProjectedPrimitiveRef(constraint.projectedLine.reference),
      ]
    case 'pointOnCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ]
    case 'normal':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ]
    case 'normalProjectedCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createProjectedPrimitiveRef(constraint.projectedCurve.reference),
      ]
    case 'symmetric':
      return [
        ...constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId)),
        createSketchEntityRef(sketchId, constraint.axis.entityId),
      ]
    case 'symmetricProjectedLine':
      return [
        ...constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId)),
        createProjectedPrimitiveRef(constraint.projectedLine.reference),
      ]
    case 'coincidentProjectedPoint':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createProjectedPrimitiveRef(constraint.projectedPoint.reference),
      ]
    case 'pointOnProjectedCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createProjectedPrimitiveRef(constraint.projectedCurve.reference),
      ]
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return [
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createProjectedPrimitiveRef(constraint.projectedLine.reference),
      ]
    case 'tangentProjectedCurve':
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createProjectedPrimitiveRef(constraint.projectedCurve.reference),
      ]
    case 'concentricProjectedCurve':
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createProjectedPrimitiveRef(constraint.projectedCurve.reference),
      ]
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
  session: SketchSessionState,
  constraint: ConstraintDefinition,
): SketchToolAnchorDescriptor {
  const definition = session.definition
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
    case 'tangent':
    case 'concentric':
      return createOffsetAnnotationAnchor(getAverageEntityAnchor(definition, constraint.entityIds))
    case 'midpoint':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.line.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'midpointProjectedLine':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getProjectedGeometryAnchor(session, constraint.projectedLine.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'pointOnCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.curve.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'normal':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.line.entityId),
        getEntityAnchor(definition, constraint.curve.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'normalProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.line.entityId),
        getProjectedGeometryAnchor(session, constraint.projectedCurve.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'symmetric':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getAveragePointPosition(definition, constraint.pointIds),
        getEntityAnchor(definition, constraint.axis.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'symmetricProjectedLine':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getAveragePointPosition(definition, constraint.pointIds),
        getProjectedGeometryAnchor(session, constraint.projectedLine.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'coincidentProjectedPoint':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getProjectedGeometryAnchor(session, constraint.projectedPoint.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'pointOnProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getProjectedGeometryAnchor(session, constraint.projectedCurve.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getEntityAnchor(definition, constraint.line.entityId),
        getProjectedGeometryAnchor(session, constraint.projectedLine.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'tangentProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getEntityAnchor(definition, constraint.curve.entityId),
        getProjectedGeometryAnchor(session, constraint.projectedCurve.reference),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'concentricProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getEntityAnchor(definition, constraint.curve.entityId),
        getProjectedGeometryAnchor(session, constraint.projectedCurve.reference),
      ].filter((point): point is SketchPoint => point !== null)))
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

function createProjectedPrimitiveRef(
  reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
): PrimitiveRef {
  return {
    kind: 'projectedReferenceGeometry',
    referenceId: reference.referenceId,
    geometryId: reference.geometryId,
    geometryKind: reference.kind === 'projectedPoint'
      ? 'point'
      : reference.kind === 'projectedLineSegment'
        ? 'lineSegment'
        : reference.kind === 'projectedCircle'
          ? 'circle'
          : reference.kind === 'projectedArc'
            ? 'arc'
            : 'spline',
  }
}

function getProjectedGeometryAnchor(
  session: SketchSessionState,
  reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
): SketchPoint | null {
  const projectedReference = session.projectedReferences.find((entry) => entry.referenceId === reference.referenceId)

  if (!projectedReference || projectedReference.status !== 'projected') {
    return null
  }

  const geometry = projectedReference.geometry.find((entry) => entry.geometryId === reference.geometryId)

  if (!geometry) {
    return null
  }

  switch (geometry.kind) {
    case 'point':
      return geometry.position
    case 'lineSegment':
      return [
        (geometry.startPosition[0] + geometry.endPosition[0]) / 2,
        (geometry.startPosition[1] + geometry.endPosition[1]) / 2,
      ]
    case 'circle':
    case 'arc':
      return geometry.centerPosition
    case 'spline':
      return geometry.fitPoints[0] ?? null
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
    case 'spline':
      return getAveragePointPosition(definition, entity.fitPointIds)
    case 'ellipse':
      return getPointPosition(definition, entity.centerPointId)
    case 'ellipticalArc':
      return getPointPosition(definition, entity.centerPointId)
    case 'conic':
      return getAveragePointPosition(definition, [entity.startPointId, entity.controlPointId, entity.endPointId])
    case 'bezierCurve':
      return getAveragePointPosition(definition, entity.controlPointIds)
    case 'profileText':
      return getPointPosition(definition, entity.anchorPointId)
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
    case 'spline':
      return entity.fitPointIds[0] ?? null
    case 'ellipse':
    case 'ellipticalArc':
      return entity.centerPointId
    case 'conic':
      return entity.startPointId
    case 'bezierCurve':
      return entity.controlPointIds[0] ?? null
    case 'profileText':
      return entity.anchorPointId
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

function sampleSplinePoints(points: readonly SketchPoint[]): SketchPoint[] {
  if (points.length < 3) {
    return [...points]
  }

  const [start, control, end] = points
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24
    const oneMinusT = 1 - t
    return [
      oneMinusT * oneMinusT * start![0] + 2 * oneMinusT * t * control![0] + t * t * end![0],
      oneMinusT * oneMinusT * start![1] + 2 * oneMinusT * t * control![1] + t * t * end![1],
    ] as const
  })
}

export function getSketchSessionDisplayRenderables(session: SketchSessionState): SketchSessionDisplayRenderable[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const localStyleLookup = createSketchEntityStyleLookup(session)
  const pointStyleLookup = createSketchPointStyleLookup(session)
  const displayDefinition = evaluateSketchDerivations(session.definition).definition

  return [
    ...displayDefinition.points.map((point) => {
      const style = pointStyleLookup.get(point.pointId)

      return {
        id: `renderable_sketch_point_${point.pointId}` as RenderableId,
        label: point.label,
        target: createSketchPointRef(sketchId, point.pointId),
        geometry: {
          kind: 'marker' as const,
          position: mapSketchPointToWorld(session.plane, point.position),
          displayRadius: 0.16,
        },
        linePattern: 'solid' as const,
        role: 'local' as const,
        paintStyle: style?.paintStyle,
        strokeStyle: style?.strokeStyle,
      }
    }),
    ...deriveSketchDisplayEntities(session).map((entity, index) =>
      createDisplayRenderableForEntity(
        session,
        entity,
        index,
        entity.entityId ? localStyleLookup.get(entity.entityId) : undefined,
      ),
    ),
    ...displayDefinition.references.flatMap((reference, index) => {
      const projectedReference = session.projectedReferences.find((entry) => entry.referenceId === reference.referenceId)
      if (projectedReference && projectedReference.status === 'projected' && projectedReference.geometry.length > 0) {
        return []
      }

      return [createDisplayRenderableForReferenceRecord(session, reference.referenceId, index)]
    }),
    ...session.projectedReferences.flatMap((reference) =>
      reference.geometry.map((geometry, index) =>
        createDisplayRenderableForProjectedGeometry(session, reference.referenceId, geometry, index),
      ),
    ),
  ]
}

function createDisplayRenderableForEntity(
  session: SketchSessionState,
  entity: SketchDraftEntity,
  index: number,
  style: SketchEntityDisplayStyle | undefined,
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
      role: 'local',
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    }
  }

  if (entity.kind === 'spline') {
    return {
      id: `renderable_sketch_spline_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
        : null,
      geometry: {
        kind: 'polyline',
        points: sampleSplinePoints(entity.points).map((point) => mapSketchPointToWorld(session.plane, point)),
        isClosed: false,
      },
      linePattern: entity.isConstruction ? 'dashed' : 'solid',
      role: 'local',
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    }
  }

  if (entity.kind === 'polyline') {
    return {
      id: `renderable_sketch_polyline_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
        : null,
      geometry: {
        kind: 'polyline',
        points: entity.points.map((point) => mapSketchPointToWorld(session.plane, point)),
        isClosed: entity.isClosed,
      },
      linePattern: entity.isConstruction ? 'dashed' : 'solid',
      role: 'local',
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
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
    role: 'local',
    paintStyle: style?.paintStyle,
    strokeStyle: style?.strokeStyle,
  }
}

interface SketchEntityDisplayStyle {
  paintStyle?: SketchDisplayPaintStyle
  strokeStyle?: SketchDisplayStrokeStyle
}

function createSketchEntityStyleLookup(session: SketchSessionState): Map<SketchEntityId, SketchEntityDisplayStyle> {
  const styleRecords = getPersistedSketchStyleRecords(session.fullDefinition)
  const entityStyleById = new Map<SketchEntityId, SketchEntityDisplayStyle>()
  for (const entity of session.fullDefinition.entities) {
    const localStyle = parseSketchStyleDefinition(entity.style)
    const styleId = getEntityStyleId(entity)
    const persistedStyle = styleId ? styleRecords.get(styleId) : undefined
    const style = mergeSketchEntityDisplayStyle(persistedStyle, localStyle)
    if (!style) {
      continue
    }

    entityStyleById.set(entity.entityId, style)
  }

  return entityStyleById
}

function createSketchPointStyleLookup(session: SketchSessionState): Map<SketchPointId, SketchEntityDisplayStyle> {
  const pointStyleById = new Map<SketchPointId, SketchEntityDisplayStyle>()

  for (const point of session.fullDefinition.points) {
    const style = parseSketchStyleDefinition(point.style)
    if (!style) {
      continue
    }

    pointStyleById.set(point.pointId, style)
  }

  return pointStyleById
}

function mergeSketchEntityDisplayStyle(
  base: SketchEntityDisplayStyle | undefined,
  override: SketchEntityDisplayStyle | undefined,
): SketchEntityDisplayStyle | undefined {
  if (!base) {
    return override
  }

  if (!override) {
    return base
  }

  return {
    paintStyle: override.paintStyle ?? base.paintStyle,
    strokeStyle: override.strokeStyle ?? base.strokeStyle,
  }
}

function parseSketchStyleDefinition(style: SketchStyleDefinition | undefined): SketchEntityDisplayStyle | undefined {
  if (!style) {
    return undefined
  }

  const paintStyle = parseLocalPaintStyle(style)
  const strokeStyle = parseLocalStrokeStyle(style)

  if (!paintStyle && !strokeStyle) {
    return undefined
  }

  return { paintStyle, strokeStyle }
}

function parseLocalPaintStyle(style: SketchStyleDefinition): SketchDisplayPaintStyle | undefined {
  if (style.fillMode === undefined || style.fillMode === 'none') {
    return undefined
  }

  const color =
    parseColorValue(style.fillColor)
    ?? (style.fillMode === 'gradient' ? parseColorValue(style.gradientStartColor) : null)
    ?? 0x48b6ff

  return {
    color,
    opacity: style.fillMode === 'gradient' ? 0.32 : 0.42,
  }
}

function parseLocalStrokeStyle(style: SketchStyleDefinition): SketchDisplayStrokeStyle | undefined {
  if (style.strokeEnabled !== true) {
    return undefined
  }

  return {
    color: parseColorValue(style.strokeColor) ?? 0xdde7f0,
    opacity: 0.95,
    width: style.strokeWidth,
    lineCap: style.strokeCap,
    lineJoin: style.strokeJoin,
    miterLimit: style.strokeMiterLimit,
    dashSize: style.strokeDashSize,
    gapSize: style.strokeGapSize,
  }
}

function getPersistedSketchStyleRecords(definition: SketchDefinition): Map<string, SketchEntityDisplayStyle> {
  const rawDefinition = definition as SketchDefinition & {
    styles?: unknown
    styleDefinitions?: unknown
  }
  const styleEntries = Array.isArray(rawDefinition.styles)
    ? rawDefinition.styles
    : Array.isArray(rawDefinition.styleDefinitions)
      ? rawDefinition.styleDefinitions
      : []
  const records = new Map<string, SketchEntityDisplayStyle>()

  for (const entry of styleEntries) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const styleId = getRecordStringValue(entry, 'styleId')
    if (!styleId) {
      continue
    }

    const paintStyle = parsePaintStyle(getRecordObjectValue(entry, 'paint') ?? getRecordObjectValue(entry, 'fill'))
    const strokeStyle = parseStrokeStyle(getRecordObjectValue(entry, 'stroke'))
    if (!paintStyle && !strokeStyle) {
      continue
    }

    records.set(styleId, { paintStyle, strokeStyle })
  }

  return records
}

function getEntityStyleId(entity: SketchEntityDefinition): string | null {
  const rawEntity = entity as SketchEntityDefinition & {
    styleId?: unknown
    style?: unknown
    displayStyleId?: unknown
  }
  const styleId = getOptionalString(rawEntity.styleId) ?? getOptionalString(rawEntity.displayStyleId)
  if (styleId) {
    return styleId
  }

  const styleRecord = getRecordObjectValue(rawEntity, 'style')
  if (!styleRecord) {
    return null
  }

  return getRecordStringValue(styleRecord, 'styleId')
}

function parsePaintStyle(value: Record<string, unknown> | null): SketchDisplayPaintStyle | undefined {
  if (!value) {
    return undefined
  }

  const color = parseColorValue(value.color)
  if (color === null) {
    return undefined
  }

  return {
    color,
    opacity: getOptionalNumber(value.opacity) ?? 1,
  }
}

function parseStrokeStyle(value: Record<string, unknown> | null): SketchDisplayStrokeStyle | undefined {
  if (!value) {
    return undefined
  }

  const color = parseColorValue(value.color)
  if (color === null) {
    return undefined
  }

  return {
    color,
    opacity: getOptionalNumber(value.opacity) ?? 1,
    width: getOptionalNumber(value.width) ?? getOptionalNumber(value.thickness),
    lineCap: getOptionalStrokeCap(value.lineCap),
    lineJoin: getOptionalStrokeJoin(value.lineJoin),
    miterLimit: getOptionalNumber(value.miterLimit),
    dashSize: getOptionalNumber(value.dashSize),
    gapSize: getOptionalNumber(value.gapSize),
  }
}

function getOptionalStrokeCap(value: unknown): SketchDisplayStrokeStyle['lineCap'] | undefined {
  return value === 'butt' || value === 'round' || value === 'square' ? value : undefined
}

function getOptionalStrokeJoin(value: unknown): SketchDisplayStrokeStyle['lineJoin'] | undefined {
  return value === 'miter' || value === 'round' || value === 'bevel' ? value : undefined
}

function parseColorValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }

  return Number.parseInt(hex, 16)
}

function getRecordObjectValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key]
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function getRecordStringValue(record: Record<string, unknown>, key: string): string | null {
  return getOptionalString(record[key])
}

function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function createReferenceRecordTarget(referenceId: ReferenceId): PrimitiveRef {
  return {
    kind: 'sketchExternalReference',
    referenceId,
  }
}

function createDisplayRenderableForReferenceRecord(
  session: SketchSessionState,
  referenceId: ReferenceId,
  index: number,
): SketchSessionDisplayRenderable {
  const column = index % 6
  const row = Math.floor(index / 6)

  return {
    id: `renderable_reference_marker_${referenceId}` as RenderableId,
    label: `Reference ${referenceId}`,
    target: createReferenceRecordTarget(referenceId),
    geometry: {
      kind: 'marker',
      position: mapSketchPointToWorld(session.plane, [
        -0.72 + column * 0.24,
        -0.72 - row * 0.24,
      ]),
      displayRadius: 0.12,
    },
    linePattern: 'solid',
    role: 'reference',
  }
}

function createProjectedGeometryTarget(
  referenceId: ReferenceId,
  geometry: ProjectedSketchReferenceRecord['geometry'][number],
): PrimitiveRef {
  return {
    kind: 'projectedReferenceGeometry',
    referenceId,
    geometryId: geometry.geometryId,
    geometryKind: geometry.kind,
  }
}

function createDisplayRenderableForProjectedGeometry(
  session: SketchSessionState,
  referenceId: ReferenceId,
  geometry: ProjectedSketchReferenceRecord['geometry'][number],
  index: number,
): SketchSessionDisplayRenderable {
  const target = createProjectedGeometryTarget(referenceId, geometry)

  if (geometry.kind === 'point') {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'marker',
        position: mapSketchPointToWorld(session.plane, geometry.position),
        displayRadius: 0.14,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  if (geometry.kind === 'lineSegment') {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'polyline',
        points: [
          mapSketchPointToWorld(session.plane, geometry.startPosition),
          mapSketchPointToWorld(session.plane, geometry.endPosition),
        ],
        isClosed: false,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  if (geometry.kind === 'circle') {
    const pointCount = 48
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'polyline',
        points: Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
          const angle = (Math.PI * 2 * pointIndex) / pointCount
          return mapSketchPointToWorld(session.plane, [
            geometry.centerPosition[0] + Math.cos(angle) * geometry.radius,
            geometry.centerPosition[1] + Math.sin(angle) * geometry.radius,
          ])
        }),
        isClosed: true,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  if (geometry.kind === 'spline') {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'polyline',
        points: geometry.fitPoints.map((point) => mapSketchPointToWorld(session.plane, point)),
        isClosed: geometry.isClosed,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  const startAngle = Math.atan2(
    geometry.startPosition[1] - geometry.centerPosition[1],
    geometry.startPosition[0] - geometry.centerPosition[0],
  )
  const endAngle = Math.atan2(
    geometry.endPosition[1] - geometry.centerPosition[1],
    geometry.endPosition[0] - geometry.centerPosition[0],
  )
  const radius = Math.hypot(
    geometry.startPosition[0] - geometry.centerPosition[0],
    geometry.startPosition[1] - geometry.centerPosition[1],
  )
  const normalizedEnd = geometry.sweepDirection === 'counterClockwise' && endAngle < startAngle
    ? endAngle + Math.PI * 2
    : geometry.sweepDirection === 'clockwise' && endAngle > startAngle
      ? endAngle - Math.PI * 2
      : endAngle
  const pointCount = 32

  return {
    id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
    label: `Projected ${geometry.geometryId}`,
    target,
    geometry: {
      kind: 'polyline',
      points: Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
        const angle = startAngle + (normalizedEnd - startAngle) * pointIndex / pointCount
        return mapSketchPointToWorld(session.plane, [
          geometry.centerPosition[0] + Math.cos(angle) * radius,
          geometry.centerPosition[1] + Math.sin(angle) * radius,
        ])
      }),
      isClosed: false,
    },
    linePattern: 'dashed',
    role: 'reference',
  }
}

export function updateSketchReferenceProjection(
  session: SketchSessionState,
  projectedReferences: ProjectedSketchReferenceRecord[],
  diagnostics: ProjectedSketchReferenceRecord['diagnostics'],
): SketchSessionState {
  const referenceDiagnostics = projectedReferences.flatMap((reference) => [
    ...reference.diagnostics,
    ...(reference.status === 'projected'
      ? []
      : [{
          code: `external-reference-${reference.status}`,
          severity: 'warning' as const,
          message: `Reference ${reference.referenceId} projection status: ${reference.status}.`,
          target: null,
        }]),
  ])
  const projectionDiagnostics = [...diagnostics, ...referenceDiagnostics]
  const validationMessage = projectionDiagnostics.find((diagnostic) => diagnostic.severity !== 'info')?.message ?? null

  return {
    ...session,
    projectedReferences,
    projectionDiagnostics,
    validationMessage,
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
    case 'midpoint':
      return 'Point at midpoint'
    case 'midpointProjectedLine':
      return 'Point at projected midpoint'
    case 'pointOnCurve':
      return 'Point on curve'
    case 'coincidentProjectedPoint':
      return 'Coincident projected point'
    case 'pointOnProjectedCurve':
      return 'Point on projected curve'
    case 'parallelProjectedLine':
      return 'Parallel to projected line'
    case 'perpendicularProjectedLine':
      return 'Perpendicular to projected line'
    case 'tangentProjectedCurve':
      return 'Tangent to projected curve'
    case 'tangent':
      return 'Tangent curves'
    case 'concentric':
      return 'Concentric curves'
    case 'concentricProjectedCurve':
      return 'Concentric with projected curve'
    case 'normal':
      return 'Line normal to curve'
    case 'normalProjectedCurve':
      return 'Line normal to projected curve'
    case 'symmetric':
      return 'Symmetric points'
    case 'symmetricProjectedLine':
      return 'Symmetric points about projected line'
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
  return mapSketchPointToWorkspaceWorld(plane, point)
}
