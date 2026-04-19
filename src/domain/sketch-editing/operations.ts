import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceGeometry } from '@/contracts/solver/schema'
import type { SketchPoint } from '@/contracts/modeling/schema'
import type { SketchEntityId, SketchPointId } from '@/contracts/shared/ids'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolCommitFactories,
} from '@/domain/sketch-tools/definition'

export type OffsetSide = 'left' | 'right'

export interface SketchMutationResult {
  changed: boolean
  message: string | null
  definition: SketchDefinition
}

export interface OffsetContributionResult {
  valid: boolean
  message: string | null
  contribution: SketchToolCommitContribution | null
  previewEntities: readonly SketchDraftEntity[]
}

type CurveSample = {
  point: SketchPoint
  t: number
}

type CurveSegment = {
  start: CurveSample
  end: CurveSample
}

type CurveDescriptor =
  | {
      kind: 'lineSegment'
      entity: Extract<SketchEntityDefinition, { kind: 'lineSegment' }>
      isConstruction: boolean
      style: SketchEntityDefinition['style']
      start: SketchPoint
      end: SketchPoint
    }
  | {
      kind: 'circle'
      entity: Extract<SketchEntityDefinition, { kind: 'circle' }>
      isConstruction: boolean
      style: SketchEntityDefinition['style']
      center: SketchPoint
      radius: number
    }
  | {
      kind: 'arc'
      entity: Extract<SketchEntityDefinition, { kind: 'arc' }>
      isConstruction: boolean
      style: SketchEntityDefinition['style']
      center: SketchPoint
      start: SketchPoint
      end: SketchPoint
      sweepDirection: 'clockwise' | 'counterClockwise'
    }
  | {
      kind: 'spline'
      entity: Extract<SketchEntityDefinition, { kind: 'spline' }>
      isConstruction: boolean
      style: SketchEntityDefinition['style']
      points: readonly SketchPoint[]
    }

export type OffsetCurveDescriptor =
  | Omit<Extract<CurveDescriptor, { kind: 'lineSegment' }>, 'entity'>
  | Omit<Extract<CurveDescriptor, { kind: 'circle' }>, 'entity'>
  | Omit<Extract<CurveDescriptor, { kind: 'arc' }>, 'entity'>
  | Omit<Extract<CurveDescriptor, { kind: 'spline' }>, 'entity'>

type TrimIntersection = {
  point: SketchPoint
  t: number
}

type TrimFactories = {
  nextPointId(suffix: string): SketchPointId
  nextEntityId(suffix: string): SketchEntityId
  createPoint(label: string, pointId: SketchPointId, position: SketchPoint): SketchPointDefinition
  createLine(label: string, entityId: SketchEntityId, startPointId: SketchPointId, endPointId: SketchPointId): SketchEntityDefinition
  createArc(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
    sweepDirection: 'clockwise' | 'counterClockwise',
  ): SketchEntityDefinition
  createSpline(label: string, entityId: SketchEntityId, fitPointIds: readonly SketchPointId[]): SketchEntityDefinition
}

const EPSILON = 1e-6
const CURVE_SAMPLE_COUNT = 96

function distanceBetween(left: SketchPoint, right: SketchPoint) {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

function pointsAlmostEqual(left: SketchPoint, right: SketchPoint) {
  return distanceBetween(left, right) <= EPSILON
}

function add(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [left[0] + right[0], left[1] + right[1]]
}

function subtract(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [left[0] - right[0], left[1] - right[1]]
}

function scale(vector: SketchPoint, scalar: number): SketchPoint {
  return [vector[0] * scalar, vector[1] * scalar]
}

function normalize(vector: SketchPoint): SketchPoint | null {
  const length = Math.hypot(vector[0], vector[1])
  return length <= EPSILON ? null : [vector[0] / length, vector[1] / length]
}

function leftNormal(vector: SketchPoint): SketchPoint | null {
  const unit = normalize(vector)
  return unit ? [-unit[1], unit[0]] : null
}

function getPoint(definition: SketchDefinition, pointId: SketchPointId) {
  return definition.points.find((point) => point.pointId === pointId) ?? null
}

function getCurveDescriptor(
  definition: SketchDefinition,
  entity: SketchEntityDefinition,
): CurveDescriptor | null {
  switch (entity.kind) {
    case 'point':
      return null
    case 'lineSegment': {
      const start = getPoint(definition, entity.startPointId)
      const end = getPoint(definition, entity.endPointId)
      return start && end
        ? {
            kind: 'lineSegment',
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            start: start.position,
            end: end.position,
          }
        : null
    }
    case 'circle': {
      const center = getPoint(definition, entity.centerPointId)
      return center
        ? {
            kind: 'circle',
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            center: center.position,
            radius: entity.radius,
          }
        : null
    }
    case 'arc': {
      const center = getPoint(definition, entity.centerPointId)
      const start = getPoint(definition, entity.startPointId)
      const end = getPoint(definition, entity.endPointId)
      return center && start && end
        ? {
            kind: 'arc',
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            center: center.position,
            start: start.position,
            end: end.position,
            sweepDirection: entity.sweepDirection,
          }
        : null
    }
    case 'spline': {
      const points = entity.fitPointIds.flatMap((pointId) => {
        const point = getPoint(definition, pointId)
        return point ? [point.position] : []
      })
      return points.length === entity.fitPointIds.length && points.length >= 3
        ? {
            kind: 'spline',
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            points,
          }
        : null
    }
  }
}

export function offsetCurveDescriptorFromProjectedGeometry(
  geometry: ProjectedSketchReferenceGeometry,
): OffsetCurveDescriptor | null {
  switch (geometry.kind) {
    case 'point':
      return null
    case 'lineSegment':
      return {
        kind: 'lineSegment',
        isConstruction: false,
        style: undefined,
        start: geometry.startPosition,
        end: geometry.endPosition,
      }
    case 'circle':
      return {
        kind: 'circle',
        isConstruction: false,
        style: undefined,
        center: geometry.centerPosition,
        radius: geometry.radius,
      }
    case 'arc':
      return {
        kind: 'arc',
        isConstruction: false,
        style: undefined,
        center: geometry.centerPosition,
        start: geometry.startPosition,
        end: geometry.endPosition,
        sweepDirection: geometry.sweepDirection,
      }
    case 'spline':
      return geometry.fitPoints.length >= 3
        ? {
            kind: 'spline',
            isConstruction: false,
            style: undefined,
            points: geometry.isClosed && geometry.fitPoints.length > 2
              ? [...geometry.fitPoints, geometry.fitPoints[0]!]
              : geometry.fitPoints,
          }
        : null
  }
}

function normalizeAngle(angle: number) {
  const fullTurn = Math.PI * 2
  return ((angle % fullTurn) + fullTurn) % fullTurn
}

function sweepOffset(
  angle: number,
  startAngle: number,
  sweepDirection: 'clockwise' | 'counterClockwise',
) {
  return sweepDirection === 'counterClockwise'
    ? normalizeAngle(angle - startAngle)
    : normalizeAngle(startAngle - angle)
}

function arcSweep(curve: Extract<OffsetCurveDescriptor, { kind: 'arc' }>) {
  const startAngle = Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0])
  const endAngle = Math.atan2(curve.end[1] - curve.center[1], curve.end[0] - curve.center[0])
  return sweepOffset(endAngle, startAngle, curve.sweepDirection)
}

function pointOnCircle(center: SketchPoint, radius: number, angle: number): SketchPoint {
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
  ]
}

function sampleQuadraticSpline(points: readonly SketchPoint[], t: number): SketchPoint {
  const [start, control, end] = points
  const oneMinusT = 1 - t
  return [
    oneMinusT * oneMinusT * start![0] + 2 * oneMinusT * t * control![0] + t * t * end![0],
    oneMinusT * oneMinusT * start![1] + 2 * oneMinusT * t * control![1] + t * t * end![1],
  ]
}

function splitQuadraticSpline(
  points: readonly SketchPoint[],
  from: number,
  to: number,
): readonly [SketchPoint, SketchPoint, SketchPoint] {
  const start = sampleQuadraticSpline(points, from)
  const end = sampleQuadraticSpline(points, to)
  const middleT = from + (to - from) / 2
  const middle = sampleQuadraticSpline(points, middleT)
  return [start, middle, end]
}

function sampleCurve(curve: CurveDescriptor): CurveSample[] {
  switch (curve.kind) {
    case 'lineSegment':
      return [
        { point: curve.start, t: 0 },
        { point: curve.end, t: 1 },
      ]
    case 'circle':
      return Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
        const t = index / CURVE_SAMPLE_COUNT
        return {
          point: pointOnCircle(curve.center, curve.radius, t * Math.PI * 2),
          t,
        }
      })
    case 'arc': {
      const startAngle = Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0])
      const sweep = arcSweep(curve)
      return Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
        const t = index / CURVE_SAMPLE_COUNT
        const offset = sweep * t * (curve.sweepDirection === 'counterClockwise' ? 1 : -1)
        return {
          point: pointOnCircle(curve.center, distanceBetween(curve.start, curve.center), startAngle + offset),
          t,
        }
      })
    }
    case 'spline':
      return Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
        const t = index / CURVE_SAMPLE_COUNT
        return {
          point: sampleQuadraticSpline(curve.points, t),
          t,
        }
      })
  }
}

function segmentsFromSamples(samples: readonly CurveSample[]): CurveSegment[] {
  const segments: CurveSegment[] = []
  for (let index = 0; index + 1 < samples.length; index += 1) {
    segments.push({
      start: samples[index]!,
      end: samples[index + 1]!,
    })
  }
  return segments
}

function lineLineIntersection(input: {
  start: SketchPoint
  end: SketchPoint
  otherStart: SketchPoint
  otherEnd: SketchPoint
}) {
  const dx = input.end[0] - input.start[0]
  const dy = input.end[1] - input.start[1]
  const otherDx = input.otherEnd[0] - input.otherStart[0]
  const otherDy = input.otherEnd[1] - input.otherStart[1]
  const denominator = dx * otherDy - dy * otherDx

  if (Math.abs(denominator) <= EPSILON) {
    return null
  }

  const offsetX = input.otherStart[0] - input.start[0]
  const offsetY = input.otherStart[1] - input.start[1]
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator
  const u = (offsetX * dy - offsetY * dx) / denominator

  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return null
  }

  const clampedT = Math.max(0, Math.min(1, t))
  return {
    point: [
      input.start[0] + dx * clampedT,
      input.start[1] + dy * clampedT,
    ] as const,
    t: clampedT,
  }
}

function infiniteLineIntersection(input: {
  start: SketchPoint
  end: SketchPoint
  otherStart: SketchPoint
  otherEnd: SketchPoint
}) {
  const dx = input.end[0] - input.start[0]
  const dy = input.end[1] - input.start[1]
  const otherDx = input.otherEnd[0] - input.otherStart[0]
  const otherDy = input.otherEnd[1] - input.otherStart[1]
  const denominator = dx * otherDy - dy * otherDx

  if (Math.abs(denominator) <= EPSILON) {
    return null
  }

  const offsetX = input.otherStart[0] - input.start[0]
  const offsetY = input.otherStart[1] - input.start[1]
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator

  return [
    input.start[0] + dx * t,
    input.start[1] + dy * t,
  ] as const
}

function segmentIntersection(target: CurveSegment, candidate: CurveSegment): TrimIntersection | null {
  const intersection = lineLineIntersection({
    start: target.start.point,
    end: target.end.point,
    otherStart: candidate.start.point,
    otherEnd: candidate.end.point,
  })

  if (!intersection) {
    return null
  }

  return {
    point: intersection.point,
    t: target.start.t + (target.end.t - target.start.t) * intersection.t,
  }
}

function uniqueIntersections(intersections: readonly TrimIntersection[]) {
  const sorted = [...intersections].sort((left, right) => left.t - right.t)
  const unique: TrimIntersection[] = []

  for (const intersection of sorted) {
    if (!unique.some((entry) =>
      Math.abs(entry.t - intersection.t) <= EPSILON
      || distanceBetween(entry.point, intersection.point) <= EPSILON,
    )) {
      unique.push(intersection)
    }
  }

  return unique
}

function collectTargetIntersections(
  definition: SketchDefinition,
  targetCurve: CurveDescriptor,
) {
  const targetSegments = segmentsFromSamples(sampleCurve(targetCurve))
  const intersections = definition.entities.flatMap((entity): TrimIntersection[] => {
    if (entity.entityId === targetCurve.entity.entityId) {
      return []
    }

    const candidateCurve = getCurveDescriptor(definition, entity)
    if (!candidateCurve) {
      return []
    }

    const candidateSegments = segmentsFromSamples(sampleCurve(candidateCurve))
    return targetSegments.flatMap((targetSegment) =>
      candidateSegments.flatMap((candidateSegment) => {
        const intersection = segmentIntersection(targetSegment, candidateSegment)
        return intersection ? [intersection] : []
      }),
    )
  })

  return uniqueIntersections(intersections.filter((intersection) =>
    intersection.t > EPSILON && intersection.t < 1 - EPSILON,
  ))
}

function fail(message: string, definition: SketchDefinition): SketchMutationResult {
  return { changed: false, message, definition }
}

function withAppendedTrimPoints(
  definition: SketchDefinition,
  points: readonly SketchPointDefinition[],
) {
  return {
    pointIds: [...definition.pointIds, ...points.map((point) => point.pointId)],
    points: [...definition.points, ...points],
  }
}

export function trimLineSegmentAtIntersections(input: {
  definition: SketchDefinition
  entityId: SketchEntityId
} & TrimFactories): SketchMutationResult {
  const entity = input.definition.entities.find((candidate) => candidate.entityId === input.entityId)
  if (!entity) {
    return fail('Trim target was not found.', input.definition)
  }

  const targetCurve = getCurveDescriptor(input.definition, entity)
  if (!targetCurve) {
    return fail('Trim supports line, circle, arc, and spline entities.', input.definition)
  }

  const intersections = collectTargetIntersections(input.definition, targetCurve)
  if (intersections.length < 2) {
    return fail('Trim needs two unambiguous intersections on the target curve.', input.definition)
  }

  const trimStart = intersections[0]!
  const trimEnd = intersections.at(-1)!

  if (targetCurve.kind === 'lineSegment') {
    const trimStartPointId = input.nextPointId('trim-start')
    const trimEndPointId = input.nextPointId('trim-end')
    const splitEntityId = input.nextEntityId('trim-split')
    const trimStartPoint = input.createPoint(`${entity.label} trim start`, trimStartPointId, trimStart.point)
    const trimEndPoint = input.createPoint(`${entity.label} trim end`, trimEndPointId, trimEnd.point)
    const updatedEntity = {
      ...targetCurve.entity,
      endPointId: trimStartPointId,
    }
    const splitEntity = {
      ...input.createLine(`${entity.label} trimmed`, splitEntityId, trimEndPointId, targetCurve.entity.endPointId),
      isConstruction: entity.isConstruction,
      style: entity.style,
    }
    const appended = withAppendedTrimPoints(input.definition, [trimStartPoint, trimEndPoint])

    return {
      changed: true,
      message: null,
      definition: {
        ...input.definition,
        ...appended,
        entityIds: [...input.definition.entityIds, splitEntityId],
        entities: [
          ...input.definition.entities.map((candidate) =>
            candidate.entityId === entity.entityId ? updatedEntity : candidate,
          ),
          splitEntity,
        ],
      },
    }
  }

  if (targetCurve.kind === 'circle') {
    const trimStartPointId = input.nextPointId('trim-start')
    const trimEndPointId = input.nextPointId('trim-end')
    const trimStartPoint = input.createPoint(`${entity.label} trim start`, trimStartPointId, trimStart.point)
    const trimEndPoint = input.createPoint(`${entity.label} trim end`, trimEndPointId, trimEnd.point)
    const updatedEntity = {
      ...input.createArc(
        entity.label,
        entity.entityId,
        targetCurve.entity.centerPointId,
        trimStartPointId,
        trimEndPointId,
        'counterClockwise',
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    }
    const appended = withAppendedTrimPoints(input.definition, [trimStartPoint, trimEndPoint])

    return {
      changed: true,
      message: null,
      definition: {
        ...input.definition,
        ...appended,
        entities: input.definition.entities.map((candidate) =>
          candidate.entityId === entity.entityId ? updatedEntity : candidate,
        ),
      },
    }
  }

  if (targetCurve.kind === 'arc') {
    const trimStartPointId = input.nextPointId('trim-start')
    const trimEndPointId = input.nextPointId('trim-end')
    const splitEntityId = input.nextEntityId('trim-split')
    const trimStartPoint = input.createPoint(`${entity.label} trim start`, trimStartPointId, trimStart.point)
    const trimEndPoint = input.createPoint(`${entity.label} trim end`, trimEndPointId, trimEnd.point)
    const updatedEntity = {
      ...targetCurve.entity,
      endPointId: trimStartPointId,
    }
    const splitEntity = {
      ...input.createArc(
        `${entity.label} trimmed`,
        splitEntityId,
        targetCurve.entity.centerPointId,
        trimEndPointId,
        targetCurve.entity.endPointId,
        targetCurve.entity.sweepDirection,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    }
    const appended = withAppendedTrimPoints(input.definition, [trimStartPoint, trimEndPoint])

    return {
      changed: true,
      message: null,
      definition: {
        ...input.definition,
        ...appended,
        entityIds: [...input.definition.entityIds, splitEntityId],
        entities: [
          ...input.definition.entities.map((candidate) =>
            candidate.entityId === entity.entityId ? updatedEntity : candidate,
          ),
          splitEntity,
        ],
      },
    }
  }

  const leftPoints = splitQuadraticSpline(targetCurve.points, 0, trimStart.t)
  const rightPoints = splitQuadraticSpline(targetCurve.points, trimEnd.t, 1)
  const leftPointIds = leftPoints.map((_, index) => input.nextPointId(`trim-spline-left-${index + 1}`))
  const rightPointIds = rightPoints.map((_, index) => input.nextPointId(`trim-spline-right-${index + 1}`))
  const leftPointDefinitions = leftPoints.map((point, index) =>
    input.createPoint(`${entity.label} trim left ${index + 1}`, leftPointIds[index]!, point),
  )
  const rightPointDefinitions = rightPoints.map((point, index) =>
    input.createPoint(`${entity.label} trim right ${index + 1}`, rightPointIds[index]!, point),
  )
  const splitEntityId = input.nextEntityId('trim-spline-split')
  const updatedEntity = {
    ...targetCurve.entity,
    fitPointIds: leftPointIds,
  }
  const splitEntity = {
    ...input.createSpline(`${entity.label} trimmed`, splitEntityId, rightPointIds),
    isConstruction: entity.isConstruction,
    style: entity.style,
  }
  const appended = withAppendedTrimPoints(input.definition, [...leftPointDefinitions, ...rightPointDefinitions])

  return {
    changed: true,
    message: null,
    definition: {
      ...input.definition,
      ...appended,
      entityIds: [...input.definition.entityIds, splitEntityId],
      entities: [
        ...input.definition.entities.map((candidate) =>
          candidate.entityId === entity.entityId ? updatedEntity : candidate,
        ),
        splitEntity,
      ],
    },
  }
}

function makePreviewSpline(id: string, points: readonly SketchPoint[], isConstruction: boolean): SketchDraftEntity {
  return {
    id,
    kind: 'spline',
    points,
    entityId: null,
    status: 'preview',
    label: 'Offset preview',
    isConstruction,
  }
}

function createArcPreview(curve: Extract<OffsetCurveDescriptor, { kind: 'arc' }>, radius: number) {
  const startVector = normalize(subtract(curve.start, curve.center)) ?? [1, 0] as const
  const endVector = normalize(subtract(curve.end, curve.center)) ?? [1, 0] as const
  const midAngle = Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0])
    + (curve.sweepDirection === 'counterClockwise' ? 1 : -1) * arcSweep(curve) / 2
  return [
    add(curve.center, scale(startVector, radius)),
    pointOnCircle(curve.center, radius, midAngle),
    add(curve.center, scale(endVector, radius)),
  ]
}

function offsetSplinePoints(points: readonly SketchPoint[], distance: number, side: OffsetSide) {
  const sideFactor = side === 'left' ? 1 : -1
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!
    const next = points[Math.min(points.length - 1, index + 1)]!
    const normal = leftNormal(subtract(next, previous))
    return normal ? add(point, scale(normal, distance * sideFactor)) : point
  })
}

type LineChainRecord = {
  entity: Extract<SketchEntityDefinition, { kind: 'lineSegment' }>
  start: SketchPoint
  end: SketchPoint
  startNode: number
  endNode: number
}

type OrderedLineChainRecord = {
  entity: Extract<SketchEntityDefinition, { kind: 'lineSegment' }>
  start: SketchPoint
  end: SketchPoint
}

type LineChainNode = {
  position: SketchPoint
  incident: number[]
}

function createLineChainFailure(
  message: string,
): { valid: false, message: string } {
  return { valid: false, message }
}

function findOrCreateLineChainNode(nodes: LineChainNode[], point: SketchPoint) {
  const existingIndex = nodes.findIndex((node) => pointsAlmostEqual(node.position, point))
  if (existingIndex >= 0) {
    return existingIndex
  }

  nodes.push({ position: point, incident: [] })
  return nodes.length - 1
}

function buildOrderedLineChain(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
): { valid: true, ordered: OrderedLineChainRecord[], closed: boolean } | { valid: false, message: string } {
  const nodes: LineChainNode[] = []
  const records: LineChainRecord[] = []

  for (const entityId of entityIds) {
    const entity = definition.entities.find((candidate) => candidate.entityId === entityId)
    if (!entity || entity.kind !== 'lineSegment') {
      return createLineChainFailure('Multi-target offset currently supports connected line segments.')
    }

    const start = getPoint(definition, entity.startPointId)
    const end = getPoint(definition, entity.endPointId)
    if (!start || !end || pointsAlmostEqual(start.position, end.position)) {
      return createLineChainFailure('Offset target is too short.')
    }

    const startNode = findOrCreateLineChainNode(nodes, start.position)
    const endNode = findOrCreateLineChainNode(nodes, end.position)
    const recordIndex = records.length
    records.push({
      entity,
      start: start.position,
      end: end.position,
      startNode,
      endNode,
    })
    nodes[startNode]!.incident.push(recordIndex)
    nodes[endNode]!.incident.push(recordIndex)
  }

  if (records.length < 2) {
    return createLineChainFailure('Continuous offset needs at least two selected line segments.')
  }

  if (nodes.some((node) => node.incident.length > 2)) {
    return createLineChainFailure('Continuous offset supports simple chains and loops.')
  }

  const endpointNodeIndexes = nodes
    .map((node, index) => node.incident.length === 1 ? index : null)
    .filter((index): index is number => index !== null)
  const closed = endpointNodeIndexes.length === 0

  if (!closed && endpointNodeIndexes.length !== 2) {
    return createLineChainFailure('Multi-target offset needs a connected line chain.')
  }

  let currentNode = closed ? records[0]!.startNode : endpointNodeIndexes[0]!
  const startNode = currentNode
  const unused = new Set(records.map((_, index) => index))
  const ordered: OrderedLineChainRecord[] = []

  while (unused.size > 0) {
    const nextRecordIndex = nodes[currentNode]!.incident.find((recordIndex) => unused.has(recordIndex))
    if (nextRecordIndex === undefined) {
      return createLineChainFailure('Multi-target offset needs a connected line chain.')
    }

    const record = records[nextRecordIndex]!
    const nextNode = record.startNode === currentNode ? record.endNode : record.startNode
    ordered.push({
      entity: record.entity,
      start: nodes[currentNode]!.position,
      end: nodes[nextNode]!.position,
    })
    unused.delete(nextRecordIndex)
    currentNode = nextNode

    if (closed && currentNode === startNode && unused.size > 0) {
      return createLineChainFailure('Multi-target offset needs one connected loop.')
    }
  }

  if (closed && currentNode !== startNode) {
    return createLineChainFailure('Multi-target offset needs one connected loop.')
  }

  return { valid: true, ordered, closed }
}

function signedPolygonArea(vertices: readonly SketchPoint[]) {
  let area = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function offsetSideFactorForChain(
  ordered: readonly OrderedLineChainRecord[],
  closed: boolean,
  side: OffsetSide,
) {
  if (!closed) {
    return side === 'left' ? 1 : -1
  }

  const area = signedPolygonArea(ordered.map((line) => line.start))
  if (Math.abs(area) <= EPSILON) {
    return null
  }

  const outwardFactor = area > 0 ? -1 : 1
  return side === 'left' ? outwardFactor : -outwardFactor
}

function averagePoint(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
}

function createContinuousLineOffsetContribution(input: {
  definition: SketchDefinition
  entityIds: readonly SketchEntityId[]
  distance: number
  side: OffsetSide
  sequence: number
  factories: Pick<SketchToolCommitFactories, 'createPointId' | 'createEntityId' | 'createPoint' | 'createLineEntity'>
}): OffsetContributionResult {
  const chain = buildOrderedLineChain(input.definition, input.entityIds)
  if (!chain.valid) {
    return {
      valid: false,
      message: chain.message,
      contribution: null,
      previewEntities: [],
    }
  }

  const sideFactor = offsetSideFactorForChain(chain.ordered, chain.closed, input.side)
  if (sideFactor === null) {
    return {
      valid: false,
      message: 'Continuous offset needs a non-degenerate loop.',
      contribution: null,
      previewEntities: [],
    }
  }

  const offsetLines = chain.ordered.map((line) => {
    const normal = leftNormal(subtract(line.end, line.start))
    if (!normal) {
      return null
    }

    const offset = scale(normal, input.distance * sideFactor)
    return {
      ...line,
      offsetStart: add(line.start, offset),
      offsetEnd: add(line.end, offset),
    }
  })

  if (offsetLines.some((line) => line === null)) {
    return {
      valid: false,
      message: 'Offset target is too short.',
      contribution: null,
      previewEntities: [],
    }
  }

  const lines = offsetLines as NonNullable<(typeof offsetLines)[number]>[]
  const joinedPoints: SketchPoint[] = []

  if (chain.closed) {
    for (let index = 0; index < lines.length; index += 1) {
      const previous = lines[(index + lines.length - 1) % lines.length]!
      const current = lines[index]!
      joinedPoints.push(
        infiniteLineIntersection({
          start: previous.offsetStart,
          end: previous.offsetEnd,
          otherStart: current.offsetStart,
          otherEnd: current.offsetEnd,
        }) ?? averagePoint(previous.offsetEnd, current.offsetStart),
      )
    }
  } else {
    joinedPoints.push(lines[0]!.offsetStart)
    for (let index = 1; index < lines.length; index += 1) {
      const previous = lines[index - 1]!
      const current = lines[index]!
      joinedPoints.push(
        infiniteLineIntersection({
          start: previous.offsetStart,
          end: previous.offsetEnd,
          otherStart: current.offsetStart,
          otherEnd: current.offsetEnd,
        }) ?? averagePoint(previous.offsetEnd, current.offsetStart),
      )
    }
    joinedPoints.push(lines.at(-1)!.offsetEnd)
  }

  const pointIds = joinedPoints.map((_, index) => input.factories.createPointId(`offset-chain-point-${index + 1}`))
  const lineCount = chain.closed ? joinedPoints.length : joinedPoints.length - 1
  const entityIds = Array.from({ length: lineCount }, (_, index) =>
    input.factories.createEntityId(`offset-chain-line-${index + 1}`),
  )

  return {
    valid: true,
    message: null,
    previewEntities: Array.from({ length: lineCount }, (_, index) => ({
      id: `preview-offset-chain-line-${index + 1}`,
      kind: 'line' as const,
      start: joinedPoints[index]!,
      end: joinedPoints[(index + 1) % joinedPoints.length]!,
      entityId: null,
      status: 'preview' as const,
      label: 'Offset preview',
      isConstruction: lines[index % lines.length]!.entity.isConstruction,
    })),
    contribution: {
      points: joinedPoints.map((point, index) =>
        input.factories.createPoint(`Offset ${input.sequence} point ${index + 1}`, pointIds[index]!, point),
      ),
      entities: Array.from({ length: lineCount }, (_, index) => {
        const source = lines[index % lines.length]!.entity
        return {
          ...input.factories.createLineEntity(
            `Offset ${input.sequence}.${index + 1}`,
            entityIds[index]!,
            pointIds[index]!,
            pointIds[(index + 1) % pointIds.length]!,
          ),
          isConstruction: source.isConstruction,
          style: source.style,
        }
      }),
    },
  }
}

export function createOffsetContribution(input: {
  definition: SketchDefinition
  entityId?: SketchEntityId
  entityIds?: readonly SketchEntityId[]
  curve?: OffsetCurveDescriptor
  distance: number | null
  side: OffsetSide
  sequence: number
  factories: Pick<SketchToolCommitFactories, 'createPointId' | 'createEntityId' | 'createPoint' | 'createLineEntity' | 'createCircleEntity' | 'createArcEntity' | 'createSplineEntity'>
}): OffsetContributionResult {
  if (input.distance === null || input.distance <= EPSILON) {
    return {
      valid: false,
      message: 'Offset distance must be greater than zero.',
      contribution: null,
      previewEntities: [],
    }
  }

  const entityIds = input.entityIds ?? (input.entityId ? [input.entityId] : [])
  if (entityIds.length > 1) {
    return createContinuousLineOffsetContribution({
      definition: input.definition,
      entityIds,
      distance: input.distance,
      side: input.side,
      sequence: input.sequence,
      factories: input.factories,
    })
  }

  const targetEntityId = entityIds[0]
  const entity = targetEntityId
    ? input.definition.entities.find((candidate) => candidate.entityId === targetEntityId)
    : null
  const curve = input.curve ?? (entity ? getCurveDescriptor(input.definition, entity) : null)
  if (!curve) {
    return {
      valid: false,
      message: 'Offset supports line, circle, arc, and spline entities.',
      contribution: null,
      previewEntities: [],
    }
  }
  const isConstruction = curve.isConstruction
  const style = curve.style

  if (curve.kind === 'lineSegment') {
    const length = distanceBetween(curve.start, curve.end)
    if (length <= EPSILON) {
      return {
        valid: false,
        message: 'Offset target is too short.',
        contribution: null,
        previewEntities: [],
      }
    }

    const normal = leftNormal(subtract(curve.end, curve.start))
    if (!normal) {
      return {
        valid: false,
        message: 'Offset target is too short.',
        contribution: null,
        previewEntities: [],
      }
    }

    const sideFactor = input.side === 'left' ? 1 : -1
    const offset = scale(normal, input.distance * sideFactor)
    const offsetStart = add(curve.start, offset)
    const offsetEnd = add(curve.end, offset)
    const startPointId = input.factories.createPointId('offset-start')
    const endPointId = input.factories.createPointId('offset-end')
    const entityId = input.factories.createEntityId('offset-line')

    return {
      valid: true,
      message: null,
      previewEntities: [{
        id: 'preview-offset-line',
        kind: 'line',
        start: offsetStart,
        end: offsetEnd,
        entityId: null,
        status: 'preview',
        label: 'Offset preview',
        isConstruction,
      }],
      contribution: {
        points: [
          input.factories.createPoint(`Offset ${input.sequence} start`, startPointId, offsetStart),
          input.factories.createPoint(`Offset ${input.sequence} end`, endPointId, offsetEnd),
        ],
        entities: [
          {
            ...input.factories.createLineEntity(`Offset ${input.sequence}`, entityId, startPointId, endPointId),
            isConstruction,
            style,
          },
        ],
      },
    }
  }

  if (curve.kind === 'circle') {
    const sideFactor = input.side === 'left' ? 1 : -1
    const radius = curve.radius + input.distance * sideFactor
    if (radius <= EPSILON) {
      return {
        valid: false,
        message: 'Offset distance would create an invalid circle radius.',
        contribution: null,
        previewEntities: [],
      }
    }

    const centerPointId = input.factories.createPointId('offset-center')
    const entityId = input.factories.createEntityId('offset-circle')

    return {
      valid: true,
      message: null,
      previewEntities: [{
        id: 'preview-offset-circle',
        kind: 'circle',
        center: curve.center,
        radius,
        entityId: null,
        status: 'preview',
        label: 'Offset preview',
        isConstruction,
      }],
      contribution: {
        points: [
          input.factories.createPoint(`Offset ${input.sequence} center`, centerPointId, curve.center),
        ],
        entities: [
          {
            ...input.factories.createCircleEntity(`Offset ${input.sequence}`, entityId, centerPointId, radius),
            isConstruction,
            style,
          },
        ],
      },
    }
  }

  if (curve.kind === 'arc') {
    const sideFactor = input.side === 'left' ? 1 : -1
    const radius = distanceBetween(curve.center, curve.start) + input.distance * sideFactor
    if (radius <= EPSILON) {
      return {
        valid: false,
        message: 'Offset distance would create an invalid arc radius.',
        contribution: null,
        previewEntities: [],
      }
    }

    const startVector = normalize(subtract(curve.start, curve.center))
    const endVector = normalize(subtract(curve.end, curve.center))
    if (!startVector || !endVector) {
      return {
        valid: false,
        message: 'Offset target has invalid arc geometry.',
        contribution: null,
        previewEntities: [],
      }
    }

    const centerPointId = input.factories.createPointId('offset-arc-center')
    const startPointId = input.factories.createPointId('offset-arc-start')
    const endPointId = input.factories.createPointId('offset-arc-end')
    const entityId = input.factories.createEntityId('offset-arc')
    const offsetStart = add(curve.center, scale(startVector, radius))
    const offsetEnd = add(curve.center, scale(endVector, radius))

    return {
      valid: true,
      message: null,
      previewEntities: [makePreviewSpline('preview-offset-arc', createArcPreview(curve, radius), isConstruction)],
      contribution: {
        points: [
          input.factories.createPoint(`Offset ${input.sequence} center`, centerPointId, curve.center),
          input.factories.createPoint(`Offset ${input.sequence} start`, startPointId, offsetStart),
          input.factories.createPoint(`Offset ${input.sequence} end`, endPointId, offsetEnd),
        ],
        entities: [
          {
            ...input.factories.createArcEntity(
              `Offset ${input.sequence}`,
              entityId,
              centerPointId,
              startPointId,
              endPointId,
              curve.sweepDirection,
            ),
            isConstruction,
            style,
          },
        ],
      },
    }
  }

  const offsetPoints = offsetSplinePoints(curve.points, input.distance, input.side)
  const pointIds = offsetPoints.map((_, index) => input.factories.createPointId(`offset-spline-${index + 1}`))
  const entityId = input.factories.createEntityId('offset-spline')

  return {
    valid: true,
    message: null,
    previewEntities: [makePreviewSpline('preview-offset-spline', offsetPoints, isConstruction)],
    contribution: {
      points: offsetPoints.map((point, index) =>
        input.factories.createPoint(`Offset ${input.sequence} point ${index + 1}`, pointIds[index]!, point),
      ),
      entities: [
        {
          ...input.factories.createSplineEntity(`Offset ${input.sequence}`, entityId, pointIds),
          isConstruction,
          style,
        },
      ],
    },
  }
}
