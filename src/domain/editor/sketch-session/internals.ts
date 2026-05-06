import type { SketchPoint } from '@/contracts/modeling/schema'
import type { ReferenceImageOperationState } from '@/contracts/reference-image/schema'
import type {
  ConstraintId,
  DimensionId,
  DocumentId,
  RevisionId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
} from '@/contracts/shared/ids'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchOperationRef,
  SketchPointRef,
} from '@/contracts/shared/references'
import {
  evaluateSketchDerivations,
} from '@/contracts/sketch/derived-geometry'
import {
  deriveSketchRegionsCore,
} from '@/contracts/sketch/region-extraction'
import {
  type ConstraintDefinition,
  type DimensionDefinition,
  type RegionRecord,
  type SketchAuthoringOperation,
  type SketchAuthoringOperationGraphSnapshot,
  type SketchAuthoringOperationKind,
  type SketchAuthoringOperationMemberRef,
  type SketchDefinition,
  type SketchEntityDefinition,
  type SketchPointDefinition,
  type SketchStyleRecord,
  type SolvedSketchSnapshot,
  SKETCH_SCHEMA_VERSION,
} from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionCore,
} from '@/contracts/sketch/solver-core'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { PrimitiveRef } from '@/core/editor/schema'
import {
  buildReferenceImageAnchorProjectedReferences,
  mergeReferenceImageAnchorReferences,
} from '@/domain/reference-image-calibration/export/references'
import {
  type ReferenceImageOperationStateOverride,
  collectActiveReferenceImageOperations,
} from '@/domain/reference-image/operations'
import {
  REFERENCE_IMAGE_CALIBRATION_MODE_ID,
  type ReferenceImageCalibrationModeState,
} from '@/domain/reference-image-calibration/mode/shared'
import {
  isRegisteredSketchConstraintToolId,
} from '@/core/sketch-constraints/registry'
import {
  isRegisteredSketchEditToolId,
} from '@/core/sketch-edit-tools/registry'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolId,
} from '@/core/sketch-tools/definition'
import {
  sampleArcPoints,
} from '@/core/sketch-tools/geometry'
import type {
  SketchAuthoringToolId,
  SketchHistoryCursor,
  SketchHistoryOperation,
  SketchSessionState,
} from './types'
import {
  buildCommitRequest,
  createTailSketchHistoryCursor,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
} from './history'

export const SKETCH_DIRECT_EDIT_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const

export const CONSTRAINED_DRAG_BLOCKED_MESSAGE = 'Geometry is constrained and cannot move to that position.'
export const ANNOTATION_EDIT_SOLVE_BLOCKED_MESSAGE = 'Could not solve the edited constraint value.'
export const LIVE_REGION_DOCUMENT_ID = 'doc_live_sketch' as DocumentId
export const LIVE_REGION_REVISION_ID = 'rev_live_sketch' as RevisionId
export const REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS = 0.28
export const REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS = 0.4
export const REFERENCE_IMAGE_ANCHOR_MARKER_COLOR = 0xf6c453
export const liveRegionDiagnosticsByRegions = new WeakMap<RegionRecord[], ReturnType<typeof deriveSketchRegionsCore>['diagnostics']>()

export function createPointId(sequence: number, suffix: string): SketchPointId {
  return `sketch_point_${sequence}_${suffix}` as SketchPointId
}

export function createEntityId(sequence: number, suffix: string): SketchEntityId {
  return `sketch_entity_${sequence}_${suffix}` as SketchEntityId
}

export function createConstraintId(sequence: number, suffix: string): ConstraintId {
  return `constraint_${sequence}_${suffix}` as ConstraintId
}

export function createDimensionId(sequence: number, suffix: string): DimensionId {
  return `dimension_${sequence}_${suffix}` as DimensionId
}

export function createAuthoringOperationId(sequence: number, suffix: string): SketchAuthoringOperationId {
  return `sketch_operation_${sequence}_${suffix}` as SketchAuthoringOperationId
}

export function createSketchEntityRef(sketchId: SketchId, entityId: SketchEntityId): SketchEntityRef {
  return {
    kind: 'sketchEntity',
    sketchId,
    entityId,
  }
}

export function createSketchPointRef(sketchId: SketchId, pointId: SketchPointId): SketchPointRef {
  return {
    kind: 'sketchPoint',
    sketchId,
    pointId,
  }
}

export function createSketchOperationRef(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
): SketchOperationRef {
  return {
    kind: 'sketchOperation',
    sketchId,
    operationId,
  }
}

export function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: ConstraintId,
): SketchConstraintRef {
  return {
    kind: 'constraint',
    sketchId,
    constraintId,
  }
}

export function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: DimensionId,
): SketchDimensionRef {
  return {
    kind: 'dimension',
    sketchId,
    dimensionId,
  }
}

export function createEmptyDefinition(): SketchDefinition {
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
    svgRenderingEnabled: false,
    derivedRelationships: [],
    authoringOperations: [],
  }
}

export function getReferenceImageOperationOverrides(
  session: SketchSessionState,
) {
  const activeMode = session.activeSpecialMode
  if (!activeMode || activeMode.modeId !== REFERENCE_IMAGE_CALIBRATION_MODE_ID) {
    return undefined
  }

  const modeState = activeMode.state as ReferenceImageCalibrationModeState
  if (modeState.draftState.kind !== 'referenceImage') {
    return undefined
  }

  return new Map([
    [modeState.operationId, {
      state: modeState.draftState as ReferenceImageOperationState,
      label: modeState.draftState.image.fileName,
    }],
  ])
}

export function collectVisibleReferenceImageAnchorPointIds(
  definition: Pick<SketchDefinition, 'authoringOperations'>,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
) {
  const pointIds = new Set<SketchPointId>()

  for (const { state } of collectActiveReferenceImageOperations(definition, overrides)) {
    if (!state.calibration?.showExportedAnchorsInSketch) {
      continue
    }

    for (const anchor of state.calibration.anchors) {
      pointIds.add(anchor.pointId as SketchPointId)
    }
  }

  return pointIds
}

export function collectVisibleReferenceImageAnchorLabels(
  definition: Pick<SketchDefinition, 'authoringOperations'>,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
) {
  const labels = new Map<SketchPointId, string>()

  for (const { state } of collectActiveReferenceImageOperations(definition, overrides)) {
    if (!state.calibration?.showExportedAnchorsInSketch) {
      continue
    }

    for (const anchor of state.calibration.anchors) {
      labels.set(anchor.pointId as SketchPointId, anchor.label)
    }
  }

  return labels
}

export function cloneDefinition(definition: SketchDefinition): SketchDefinition {
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
    svgRenderingEnabled: definition.svgRenderingEnabled ?? false,
    derivedRelationships: definition.derivedRelationships ? [...definition.derivedRelationships] : undefined,
    authoringOperations: definition.authoringOperations ? [...definition.authoringOperations] : undefined,
  }
}

export function mergeDerivedProjectedReferences(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  overrides?: ReturnType<typeof getReferenceImageOperationOverrides>,
): ProjectedSketchReferenceRecord[] {
  const derivedReferences = buildReferenceImageAnchorProjectedReferences(definition, overrides)
  const derivedReferenceIds = new Set(derivedReferences.map((reference) => reference.referenceId))
  return [
    ...projectedReferences.filter((reference) => !derivedReferenceIds.has(reference.referenceId)),
    ...derivedReferences,
  ]
}

export function getSketchSessionDisplayDefinition(session: SketchSessionState) {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const evaluatedDefinition = evaluateSketchDerivations(session.definition).definition
  return mergeReferenceImageAnchorReferences(
    evaluatedDefinition,
    sketchId,
    getReferenceImageOperationOverrides(session),
  )
}

export function getSketchSessionDisplayProjectedReferences(
  session: SketchSessionState,
  definition: SketchDefinition,
) {
  return mergeDerivedProjectedReferences(
    definition,
    session.projectedReferences,
    getReferenceImageOperationOverrides(session),
  )
}

export function deriveSolvedRegionsForSession(
  session: Pick<SketchSessionState, 'projectedReferences' | 'sketchId'>,
  definition: SketchDefinition,
  solvedSnapshot?: SolvedSketchSnapshot,
): RegionRecord[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const evaluatedDefinition = evaluateSketchDerivations(definition).definition
  const usableSolvedSnapshot = solvedSnapshot ?? solveSketchDefinitionCore({
    definition: evaluatedDefinition,
    projectedReferences: session.projectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  }).solvedSnapshot

  const derived = deriveSketchRegionsCore({
    documentId: LIVE_REGION_DOCUMENT_ID,
    revisionId: LIVE_REGION_REVISION_ID,
    sketchId,
    definition: evaluatedDefinition,
    solvedSnapshot: usableSolvedSnapshot,
    projectedReferences: session.projectedReferences,
  })
  liveRegionDiagnosticsByRegions.set(derived.regions, derived.diagnostics)
  return derived.regions
}

export function getSketchSessionRegionDiagnostics(session: SketchSessionState) {
  return liveRegionDiagnosticsByRegions.get(session.solvedRegions) ?? []
}

export function withLiveSolvedRegions(session: SketchSessionState): SketchSessionState {
  return {
    ...session,
    solvedRegions: deriveSolvedRegionsForSession(session, session.definition),
    liveRegionState: {
      freshness: 'current',
      pendingSinceSequence: null,
      debounceMs: session.liveRegionState?.debounceMs ?? 100,
    },
  }
}

export function refreshLiveRegionsAfterDebounce(
  session: SketchSessionState,
  elapsedMs: number,
): SketchSessionState {
  const state = session.liveRegionState
  if (!state || state.freshness === 'current' || elapsedMs < state.debounceMs) {
    return session
  }
  return withLiveSolvedRegions(session)
}

export function getHistorySequence(id: string) {
  const match = id.match(/_(\d+)_/)
  const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

export function getContributionSequence(patch: SketchToolCommitContribution) {
  const ids = [
    ...patch.points.map((point) => point.pointId),
    ...patch.entities.map((entity) => entity.entityId),
    ...(patch.constraints ?? []).map((constraint) => constraint.constraintId),
    ...(patch.dimensions ?? []).map((dimension) => dimension.dimensionId),
    ...(patch.derivedRelationships ?? []).map((relationship) => relationship.derivationId),
  ]
  const sequences = ids
    .map((id) => getHistorySequence(id))
    .filter((sequence) => sequence !== Number.MAX_SAFE_INTEGER)

  return sequences[0] ?? 0
}

export function getAuthoringMemberRefsFromGraph(graph: SketchAuthoringOperationGraphSnapshot): SketchAuthoringOperationMemberRef[] {
  return [
    ...(graph.points ?? []).map((point) => ({ kind: 'point' as const, pointId: point.pointId })),
    ...(graph.entities ?? []).map((entity) => ({ kind: 'entity' as const, entityId: entity.entityId })),
    ...(graph.constraints ?? []).map((constraint) => ({ kind: 'constraint' as const, constraintId: constraint.constraintId })),
    ...(graph.dimensions ?? []).map((dimension) => ({ kind: 'dimension' as const, dimensionId: dimension.dimensionId })),
    ...(graph.styles ?? []).map((style) => ({ kind: 'style' as const, styleId: style.styleId })),
    ...(graph.derivedRelationships ?? []).map((relationship) => ({ kind: 'derivation' as const, derivationId: relationship.derivationId })),
  ]
}

export function createAuthoringOperationFromContribution(
  patch: SketchToolCommitContribution,
  input?: {
    sequence?: number
    kind?: Exclude<SketchAuthoringOperationKind, 'referenceImage' | 'edit'>
    label?: string
    suffix?: string
  },
): SketchAuthoringOperation {
  const sequence = input?.sequence ?? getContributionSequence(patch)
  const createdGraph: SketchAuthoringOperationGraphSnapshot = {
    points: patch.points,
    entities: patch.entities,
    constraints: patch.constraints ?? [],
    dimensions: patch.dimensions ?? [],
    derivedRelationships: patch.derivedRelationships ?? [],
  }
  const label = input?.label
    ?? patch.entities[0]?.label
    ?? patch.constraints?.[0]?.label
    ?? patch.dimensions?.[0]?.label
    ?? patch.derivedRelationships?.[0]?.label
    ?? `Sketch operation ${sequence}`

  return {
    operationId: createAuthoringOperationId(sequence, input?.suffix ?? 'operation'),
    label,
    kind: input?.kind ?? 'operation',
    targets: {
      created: getAuthoringMemberRefsFromGraph(createdGraph),
    },
    createdGraph,
  }
}

export function createDeleteAuthoringOperation(input: {
  sequence: number
  removedGraph: SketchAuthoringOperationGraphSnapshot
}): SketchAuthoringOperation {
  return {
    operationId: createAuthoringOperationId(input.sequence, 'delete'),
    label: `Delete ${input.sequence}`,
    kind: 'delete',
    targets: {
      removed: getAuthoringMemberRefsFromGraph(input.removedGraph),
    },
    removedGraph: input.removedGraph,
  }
}

export function createLegacyAuthoringOperation(definition: SketchDefinition): SketchAuthoringOperation | null {
  const graph: SketchAuthoringOperationGraphSnapshot = {
    points: definition.points,
    entities: definition.entities,
    constraints: definition.constraints,
    dimensions: definition.dimensions,
    styles: definition.styles ?? [],
    derivedRelationships: definition.derivedRelationships ?? [],
  }
  const targets = getAuthoringMemberRefsFromGraph(graph)
  if (targets.length === 0) {
    return null
  }

  return {
    operationId: createAuthoringOperationId(Math.max(0, getNextDefinitionSequence(definition)), 'legacy'),
    label: 'Legacy sketch graph',
    kind: 'operation',
    targets: {
      created: targets,
    },
    createdGraph: graph,
  }
}

export function getAppendBaseAuthoringOperations(definition: SketchDefinition): SketchAuthoringOperation[] {
  const operations = definition.authoringOperations ?? []
  if (operations.length > 0) {
    return [...operations]
  }

  const legacyOperation = createLegacyAuthoringOperation(definition)
  return legacyOperation ? [legacyOperation] : []
}

export function getDefinitionSketchId(definition: SketchDefinition) {
  return definition.entities[0]?.target.sketchId
    ?? definition.points[0]?.target.sketchId
    ?? ('sketch_draft' as SketchId)
}

export function getEntityPointIds(entity: SketchEntityDefinition) {
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

export function sketchHistoryCursorsEqual(left: SketchHistoryCursor, right: SketchHistoryCursor) {
  if (left.kind === 'empty' || right.kind === 'empty') {
    return left.kind === right.kind
  }

  return left.itemId === right.itemId
}

export function getSketchHistoryOperationForCursor(
  session: SketchSessionState,
  cursor: SketchHistoryCursor,
) {
  return cursor.kind === 'item'
    ? session.historyOperations.find((entry) => entry.itemId === cursor.itemId) ?? null
    : null
}

export function replayAuthoringOperationsThroughCursor(
  definition: SketchDefinition,
  cursor: SketchHistoryCursor,
): SketchDefinition {
  const operations = definition.authoringOperations ?? []
  const items = getSketchHistoryItems(definition)
  const cursorIndex = getSketchHistoryCursorIndex(items, cursor)
  const visibleOperations = cursor.kind === 'empty'
    ? []
    : cursorIndex < 0 ? operations : operations.slice(0, cursorIndex + 1)

  const pointById = new Map<SketchPointId, SketchPointDefinition>()
  const entityById = new Map<SketchEntityId, SketchEntityDefinition>()
  const constraintById = new Map<ConstraintId, ConstraintDefinition>()
  const dimensionById = new Map<DimensionId, DimensionDefinition>()
  const styleById = new Map<SketchStyleId, SketchStyleRecord>()
  const derivationById = new Map<string, NonNullable<SketchDefinition['derivedRelationships']>[number]>()
  const livePointById = new Map(definition.points.map((point) => [point.pointId, point]))
  const liveEntityById = new Map(definition.entities.map((entity) => [entity.entityId, entity]))
  const liveConstraintById = new Map(definition.constraints.map((constraint) => [constraint.constraintId, constraint]))
  const liveDimensionById = new Map(definition.dimensions.map((dimension) => [dimension.dimensionId, dimension]))
  const liveStyleById = new Map((definition.styles ?? []).map((style) => [style.styleId, style]))
  const liveDerivationById = new Map((definition.derivedRelationships ?? []).map((relationship) => [relationship.derivationId, relationship]))

  const addGraph = (graph?: SketchAuthoringOperationGraphSnapshot) => {
    for (const point of graph?.points ?? []) {
      pointById.set(point.pointId, livePointById.get(point.pointId) ?? point)
    }
    for (const entity of graph?.entities ?? []) {
      entityById.set(entity.entityId, liveEntityById.get(entity.entityId) ?? entity)
    }
    for (const constraint of graph?.constraints ?? []) {
      constraintById.set(constraint.constraintId, liveConstraintById.get(constraint.constraintId) ?? constraint)
    }
    for (const dimension of graph?.dimensions ?? []) {
      dimensionById.set(dimension.dimensionId, liveDimensionById.get(dimension.dimensionId) ?? dimension)
    }
    for (const style of graph?.styles ?? []) {
      styleById.set(style.styleId, liveStyleById.get(style.styleId) ?? style)
    }
    for (const relationship of graph?.derivedRelationships ?? []) {
      derivationById.set(relationship.derivationId, liveDerivationById.get(relationship.derivationId) ?? relationship)
    }
  }
  const removeGraph = (graph?: SketchAuthoringOperationGraphSnapshot) => {
    for (const point of graph?.points ?? []) {
      pointById.delete(point.pointId)
    }
    for (const entity of graph?.entities ?? []) {
      entityById.delete(entity.entityId)
    }
    for (const constraint of graph?.constraints ?? []) {
      constraintById.delete(constraint.constraintId)
    }
    for (const dimension of graph?.dimensions ?? []) {
      dimensionById.delete(dimension.dimensionId)
    }
    for (const style of graph?.styles ?? []) {
      styleById.delete(style.styleId)
    }
    for (const relationship of graph?.derivedRelationships ?? []) {
      derivationById.delete(relationship.derivationId)
    }
  }

  for (const operation of visibleOperations) {
    addGraph(operation.createdGraph)
    removeGraph(operation.removedGraph)
  }

  const points = [...pointById.values()]
  const entities = [...entityById.values()]
  const constraints = [...constraintById.values()]
  const dimensions = [...dimensionById.values()]
  const styles = [...styleById.values()]
  const derivedRelationships = [...derivationById.values()]

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
    styleIds: styles.map((style) => style.styleId),
    styles,
    derivedRelationships,
    authoringOperations: visibleOperations,
  }
}

export function filterSketchDefinitionThroughCursor(
  definition: SketchDefinition,
  cursor: SketchHistoryCursor,
): SketchDefinition {
  if ((definition.authoringOperations ?? []).length > 0) {
    return replayAuthoringOperationsThroughCursor(definition, cursor)
  }

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

export function getNextDefinitionSequence(definition: SketchDefinition) {
  const ids = [
    ...definition.referenceIds,
    ...definition.pointIds,
    ...definition.entityIds,
    ...definition.constraintIds,
    ...definition.dimensionIds,
    ...(definition.authoringOperations ?? []).map((operation) => operation.operationId),
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


export const ADVANCED_DISPLAY_SAMPLE_COUNT = 64
export const PROFILE_TEXT_WIDTH_FACTOR = 0.6

export function sampleEllipseSketchPoints(
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

export function normalizeSketchAngle(angle: number) {
  const fullTurn = Math.PI * 2
  return ((angle % fullTurn) + fullTurn) % fullTurn
}

export function computeSketchArcSweep(
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

export function sampleEllipticalArcSketchPoints(
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

export function sampleConicSketchPoints(
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

export function sampleBezierSketchPoints(controlPoints: readonly SketchPoint[], sampleCount: number): SketchPoint[] {
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

export function sampleProfileTextSketchOutline(entity: Extract<SketchEntityDefinition, { kind: 'profileText' }>, anchor: SketchPoint): SketchPoint[] {
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

export function mapDefinitionEntityToDraftEntity(
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

export function createPointDefinition(
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

export function createLineEntityDefinition(
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

export function createPointEntityDefinition(
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

export function createCircleEntityDefinition(
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

export function createArcEntityDefinition(
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

export function createSplineEntityDefinition(
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

export function createEllipseEntityDefinition(
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

export function createEllipticalArcEntityDefinition(
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

export function createConicEntityDefinition(
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

export function createBezierCurveEntityDefinition(
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

export function createProfileTextEntityDefinition(
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

export function appendDefinition(definition: SketchDefinition, patch: SketchToolCommitContribution): SketchDefinition {
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
    svgRenderingEnabled: definition.svgRenderingEnabled ?? false,
    derivedRelationships: [
      ...(definition.derivedRelationships ?? []),
      ...(patch.derivedRelationships ?? []),
    ],
    authoringOperations: [
      ...getAppendBaseAuthoringOperations(definition),
      patch.authoringOperation ?? createAuthoringOperationFromContribution(patch),
    ],
  }
}

export function truncateDefinitionAfterCursor(
  definition: SketchDefinition,
  cursor: SketchHistoryCursor,
) {
  return filterSketchDefinitionThroughCursor(definition, cursor)
}

export function applySketchHistoryContribution(
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

export function rebuildSessionForDefinition(
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
  const projectedReferences = mergeDerivedProjectedReferences(definition, session.projectedReferences)
  return {
    ...session,
    historyCursor: input.historyCursor,
    definition,
    fullDefinition,
    historyOperations: [...input.historyOperations],
    projectedReferences,
    toolStagedEntities: [],
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, definition),
    solvedRegions: deriveSolvedRegionsForSession(session, definition),
  }
}

export function rebuildSessionCommitRequest(session: SketchSessionState, definition: SketchDefinition) {
  const evaluatedDefinition = evaluateSketchDerivations(definition).definition
  return buildCommitRequest({
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: session.plane,
    definition: evaluatedDefinition,
  })
}

export function normalizeConstraintValue(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return value
}

export function getTargetKey(target: PrimitiveRef) {
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
    case 'sketchOperation':
      return target.operationId
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
    case 'sketchDatumReference':
      return `${target.sketchId}:${target.datumId}`
    case 'sketchExternalReference':
      return target.referenceId
  }
}

export function withConstructionFlag(
  entities: readonly SketchDraftEntity[],
  isConstruction: boolean,
): readonly SketchDraftEntity[] {
  return isConstruction
    ? entities.map((entity) => ({ ...entity, isConstruction: true }))
    : entities
}

export function isDrawingSketchTool(toolId: SketchAuthoringToolId | null): toolId is SketchToolId {
  return toolId !== null
    && !isRegisteredSketchConstraintToolId(toolId)
    && !isRegisteredSketchEditToolId(toolId)
    && toolId !== 'construction'
    && toolId !== 'projectReference'
}

export function createSessionCommitFactories(
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

export function getSessionSketchId(session: SketchSessionState): SketchId {
  return session.sketchId ?? ('sketch_draft' as SketchId)
}
