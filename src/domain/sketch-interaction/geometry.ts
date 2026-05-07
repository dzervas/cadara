import type { ProjectedSketchReferenceGeometry, ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { SketchDefinition, SketchEntityDefinition, SketchPoint2D } from '@/contracts/sketch/schema'
import type { SketchId, SketchPointId } from '@/contracts/shared/ids'
import type { PrimitiveRef } from '@/core/editor/schema'
import {
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
} from '@/domain/editor/sketch-session/internals'
import { getSketchDatumGuideExtent } from '@/domain/editor/sketch-session/definition-patches'
import type { SketchSessionState } from '@/domain/editor/sketch-session'

const TURN = Math.PI * 2
const EPSILON = 1e-9
const CIRCLE_SAMPLE_COUNT = 64
const ARC_SAMPLE_COUNT = 40
const ADVANCED_SAMPLE_COUNT = 64
const SPLINE_SEGMENTS_PER_SPAN = 16

export type SketchInteractionGeometrySource = 'local' | 'projected' | 'datum'

export type SketchInteractionGeometry =
  | {
      kind: 'point'
      source: SketchInteractionGeometrySource
      id: string
      label: string
      target: PrimitiveRef
      position: SketchPoint2D
    }
  | {
      kind: 'lineSegment'
      source: SketchInteractionGeometrySource
      id: string
      label: string
      target: PrimitiveRef
      start: SketchPoint2D
      end: SketchPoint2D
    }
  | {
      kind: 'circle'
      source: SketchInteractionGeometrySource
      id: string
      label: string
      target: PrimitiveRef
      center: SketchPoint2D
      radius: number
    }
  | {
      kind: 'arc'
      source: SketchInteractionGeometrySource
      id: string
      label: string
      target: PrimitiveRef
      center: SketchPoint2D
      start: SketchPoint2D
      end: SketchPoint2D
      sweepDirection: 'clockwise' | 'counterClockwise'
    }
  | {
      kind: 'spline'
      source: SketchInteractionGeometrySource
      id: string
      label: string
      target: PrimitiveRef
      points: readonly SketchPoint2D[]
      degree: 2 | 3
      isClosed: boolean
    }
  | {
      kind: 'sampledCurve'
      source: SketchInteractionGeometrySource
      id: string
      label: string
      target: PrimitiveRef
      points: readonly SketchPoint2D[]
      isClosed: boolean
    }

export type SketchInteractionCurveGeometry = Exclude<SketchInteractionGeometry, { kind: 'point' }>

export function collectSketchInteractionGeometry(session: SketchSessionState): SketchInteractionGeometry[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const definition = getSketchSessionDisplayDefinition(session)
  const projectedReferences = getSketchSessionDisplayProjectedReferences(session, definition)

  return [
    ...collectDatumInteractionGeometry(sketchId, definition, projectedReferences),
    ...collectLocalInteractionGeometry(definition),
    ...collectProjectedInteractionGeometry(projectedReferences),
  ]
}

export function flattenSketchInteractionCurve(geometry: SketchInteractionCurveGeometry): readonly SketchPoint2D[] {
  switch (geometry.kind) {
    case 'lineSegment':
      return [geometry.start, geometry.end]
    case 'circle':
      return sampleCirclePoints(geometry.center, geometry.radius)
    case 'arc':
      return sampleArcPoints(geometry.center, geometry.start, geometry.end, geometry.sweepDirection)
    case 'spline':
      return closeSampledPoints(sampleSplinePoints(geometry.points, geometry.degree), geometry.isClosed)
    case 'sampledCurve':
      return closeSampledPoints(geometry.points, geometry.isClosed)
  }
}

export function isSketchInteractionCurveGeometry(geometry: SketchInteractionGeometry): geometry is SketchInteractionCurveGeometry {
  return geometry.kind !== 'point'
}

function collectDatumInteractionGeometry(
  sketchId: SketchId,
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchInteractionGeometry[] {
  const extent = getSketchDatumGuideExtent(definition, projectedReferences)

  return [
    {
      kind: 'point',
      source: 'datum',
      id: `sketch-datum:${sketchId}:origin`,
      label: 'Sketch origin',
      target: {
        kind: 'sketchDatumReference',
        sketchId,
        datumId: 'origin',
        geometryKind: 'point',
      },
      position: [0, 0],
    },
    {
      kind: 'lineSegment',
      source: 'datum',
      id: `sketch-datum:${sketchId}:xAxis`,
      label: 'Sketch X axis',
      target: {
        kind: 'sketchDatumReference',
        sketchId,
        datumId: 'xAxis',
        geometryKind: 'lineSegment',
      },
      start: [-extent, 0],
      end: [extent, 0],
    },
    {
      kind: 'lineSegment',
      source: 'datum',
      id: `sketch-datum:${sketchId}:yAxis`,
      label: 'Sketch Y axis',
      target: {
        kind: 'sketchDatumReference',
        sketchId,
        datumId: 'yAxis',
        geometryKind: 'lineSegment',
      },
      start: [0, -extent],
      end: [0, extent],
    },
  ]
}

function collectLocalInteractionGeometry(definition: SketchDefinition): SketchInteractionGeometry[] {
  const pointMap = new Map(definition.points.map((point) => [point.pointId, point] as const))
  const entries: SketchInteractionGeometry[] = definition.points.map((point) => ({
    kind: 'point',
    source: 'local',
    id: `sketch-point:${point.pointId}`,
    label: point.label,
    target: point.target,
    position: point.position,
  }))

  for (const entity of definition.entities) {
    const geometry = createLocalEntityInteractionGeometry(entity, pointMap)
    if (geometry) {
      entries.push(geometry)
    }
  }

  return entries
}

function createLocalEntityInteractionGeometry(
  entity: SketchEntityDefinition,
  pointMap: ReadonlyMap<SketchPointId, { position: SketchPoint2D }>,
): SketchInteractionGeometry | null {
  const point = (pointId: SketchPointId) => pointMap.get(pointId)?.position ?? null

  switch (entity.kind) {
    case 'point': {
      const position = point(entity.pointId)
      return position
        ? createLocalPointEntityGeometry(entity, position)
        : null
    }
    case 'lineSegment': {
      const start = point(entity.startPointId)
      const end = point(entity.endPointId)
      return start && end
        ? {
            kind: 'lineSegment',
            source: 'local',
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            start,
            end,
          }
        : null
    }
    case 'circle': {
      const center = point(entity.centerPointId)
      return center && entity.radius > EPSILON
        ? {
            kind: 'circle',
            source: 'local',
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            center,
            radius: entity.radius,
          }
        : null
    }
    case 'arc': {
      const center = point(entity.centerPointId)
      const start = point(entity.startPointId)
      const end = point(entity.endPointId)
      return center && start && end
        ? {
            kind: 'arc',
            source: 'local',
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            center,
            start,
            end,
            sweepDirection: entity.sweepDirection,
          }
        : null
    }
    case 'spline': {
      const points = collectDefiningPoints(entity.fitPointIds, point)
      return points
        ? {
            kind: 'spline',
            source: 'local',
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            points,
            degree: entity.degree,
            isClosed: false,
          }
        : null
    }
    case 'ellipse': {
      const center = point(entity.centerPointId)
      const majorAxis = point(entity.majorAxisPointId)
      if (!center || !majorAxis) {
        return null
      }
      return createSampledLocalCurve(entity, sampleEllipsePoints(center, majorAxis, entity.minorRadius), true)
    }
    case 'ellipticalArc': {
      const center = point(entity.centerPointId)
      const majorAxis = point(entity.majorAxisPointId)
      const start = point(entity.startPointId)
      const end = point(entity.endPointId)
      if (!center || !majorAxis || !start || !end) {
        return null
      }
      return createSampledLocalCurve(
        entity,
        sampleEllipticalArcPoints(center, majorAxis, entity.minorRadius, start, end, entity.sweepDirection),
        false,
      )
    }
    case 'conic': {
      const start = point(entity.startPointId)
      const control = point(entity.controlPointId)
      const end = point(entity.endPointId)
      return start && control && end
        ? createSampledLocalCurve(entity, sampleConicPoints(start, control, end, entity.rho), false)
        : null
    }
    case 'bezierCurve': {
      const points = collectDefiningPoints(entity.controlPointIds, point)
      return points
        ? createSampledLocalCurve(entity, sampleBezierPoints(points, entity.degree), false)
        : null
    }
    case 'profileText': {
      const anchor = point(entity.anchorPointId)
      return anchor
        ? createSampledLocalCurve(entity, sampleProfileTextOutline(entity, anchor), true)
        : null
    }
  }
}

function createLocalPointEntityGeometry(
  entity: Extract<SketchEntityDefinition, { kind: 'point' }>,
  position: SketchPoint2D,
): SketchInteractionGeometry {
  return {
    kind: 'point',
    source: 'local',
    id: `sketch-entity:${entity.entityId}`,
    label: entity.label,
    target: entity.target,
    position,
  }
}

function createSampledLocalCurve(
  entity: SketchEntityDefinition,
  points: readonly SketchPoint2D[],
  isClosed: boolean,
): SketchInteractionGeometry | null {
  if (points.length < 2) {
    return null
  }

  return {
    kind: 'sampledCurve',
    source: 'local',
    id: `sketch-entity:${entity.entityId}`,
    label: entity.label,
    target: entity.target,
    points,
    isClosed,
  }
}

function collectProjectedInteractionGeometry(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchInteractionGeometry[] {
  return projectedReferences.flatMap((reference) =>
    reference.geometry.flatMap((geometry) => {
      const entry = createProjectedGeometry(reference.referenceId, geometry)
      return entry ? [entry] : []
    }),
  )
}

function createProjectedGeometry(
  referenceId: ProjectedSketchReferenceRecord['referenceId'],
  geometry: ProjectedSketchReferenceGeometry,
): SketchInteractionGeometry | null {
  const target = {
    kind: 'projectedReferenceGeometry',
    referenceId,
    geometryId: geometry.geometryId,
    geometryKind: geometry.kind,
  } satisfies PrimitiveRef
  const base = {
    source: 'projected' as const,
    id: `projected:${referenceId}:${geometry.geometryId}`,
    label: `Projected ${geometry.geometryId}`,
    target,
  }

  switch (geometry.kind) {
    case 'point':
      return { ...base, kind: 'point', position: geometry.position }
    case 'lineSegment':
      return { ...base, kind: 'lineSegment', start: geometry.startPosition, end: geometry.endPosition }
    case 'circle':
      return geometry.radius > EPSILON
        ? { ...base, kind: 'circle', center: geometry.centerPosition, radius: geometry.radius }
        : null
    case 'arc':
      return {
        ...base,
        kind: 'arc',
        center: geometry.centerPosition,
        start: geometry.startPosition,
        end: geometry.endPosition,
        sweepDirection: geometry.sweepDirection,
      }
    case 'spline':
      return geometry.fitPoints.length >= 2
        ? {
            ...base,
            kind: 'spline',
            points: geometry.fitPoints,
            degree: geometry.degree,
            isClosed: geometry.isClosed,
          }
        : null
  }
}

function sampleCirclePoints(center: SketchPoint2D, radius: number): readonly SketchPoint2D[] {
  if (radius <= EPSILON) {
    return []
  }

  return closeSampledPoints(
    Array.from({ length: CIRCLE_SAMPLE_COUNT }, (_, index) => {
      const angle = (TURN * index) / CIRCLE_SAMPLE_COUNT
      return [
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
      ] satisfies SketchPoint2D
    }),
    true,
  )
}

function sampleArcPoints(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: 'clockwise' | 'counterClockwise',
): readonly SketchPoint2D[] {
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  if (radius <= EPSILON) {
    return []
  }

  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const sweep = getSweepRadians(startAngle, Math.atan2(end[1] - center[1], end[0] - center[0]), sweepDirection)

  return Array.from({ length: ARC_SAMPLE_COUNT + 1 }, (_, index) => {
    const t = index / ARC_SAMPLE_COUNT
    const angle = sweepDirection === 'counterClockwise'
      ? startAngle + sweep * t
      : startAngle - sweep * t
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ] satisfies SketchPoint2D
  })
}

function sampleSplinePoints(points: readonly SketchPoint2D[], degree: 2 | 3): readonly SketchPoint2D[] {
  if (points.length < 3) {
    return points
  }

  if (points.length <= degree + 1) {
    return sampleBezierPoints(points, degree)
  }

  const sampled: SketchPoint2D[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!
    const p1 = points[index]!
    const p2 = points[index + 1]!
    const p3 = points[Math.min(points.length - 1, index + 2)]!
    const segment = sampleCatmullRomSegment(p0, p1, p2, p3, SPLINE_SEGMENTS_PER_SPAN)
    sampled.push(...(index === 0 ? segment : segment.slice(1)))
  }

  return sampled
}

function sampleCatmullRomSegment(
  p0: SketchPoint2D,
  p1: SketchPoint2D,
  p2: SketchPoint2D,
  p3: SketchPoint2D,
  segments: number,
): readonly SketchPoint2D[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments
    const t2 = t * t
    const t3 = t2 * t
    return [
      0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ] satisfies SketchPoint2D
  })
}

function sampleEllipsePoints(center: SketchPoint2D, majorAxisEndpoint: SketchPoint2D, minorRadius: number) {
  const frame = getEllipseFrame(center, majorAxisEndpoint, minorRadius)
  if (!frame) {
    return []
  }

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const angle = (TURN * index) / ADVANCED_SAMPLE_COUNT
    return evaluateEllipsePoint(frame, angle)
  })
}

function sampleEllipticalArcPoints(
  center: SketchPoint2D,
  majorAxisEndpoint: SketchPoint2D,
  minorRadius: number,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: 'clockwise' | 'counterClockwise',
) {
  const frame = getEllipseFrame(center, majorAxisEndpoint, minorRadius)
  if (!frame) {
    return []
  }

  const startAngle = getEllipseParameterAngle(frame, start)
  const sweep = getSweepRadians(startAngle, getEllipseParameterAngle(frame, end), sweepDirection)

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1)
    const angle = sweepDirection === 'counterClockwise'
      ? startAngle + sweep * t
      : startAngle - sweep * t
    return evaluateEllipsePoint(frame, angle)
  })
}

function sampleConicPoints(start: SketchPoint2D, control: SketchPoint2D, end: SketchPoint2D, rho: number) {
  if (rho <= EPSILON) {
    return []
  }

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1)
    const oneMinusT = 1 - t
    const startWeight = oneMinusT * oneMinusT
    const controlWeight = 2 * rho * oneMinusT * t
    const endWeight = t * t
    const weight = startWeight + controlWeight + endWeight
    return [
      (startWeight * start[0] + controlWeight * control[0] + endWeight * end[0]) / weight,
      (startWeight * start[1] + controlWeight * control[1] + endWeight * end[1]) / weight,
    ] satisfies SketchPoint2D
  })
}

function sampleBezierPoints(controlPoints: readonly SketchPoint2D[], degree: 2 | 3) {
  const usablePoints = controlPoints.slice(0, degree + 1)
  if (usablePoints.length < degree + 1) {
    return usablePoints
  }

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) =>
    evaluateBezier(usablePoints, index / (ADVANCED_SAMPLE_COUNT - 1)),
  )
}

function sampleProfileTextOutline(
  entity: Extract<SketchEntityDefinition, { kind: 'profileText' }>,
  anchor: SketchPoint2D,
) {
  const text = entity.text.trim()
  const height = entity.height
  if (text.length === 0 || height <= EPSILON) {
    return []
  }

  const width = Math.max(height * 0.6, text.length * height * 0.6)
  const x = entity.horizontalAlign === 'center' ? -width / 2 : entity.horizontalAlign === 'right' ? -width : 0
  const y = entity.verticalAlign === 'middle'
    ? -height / 2
    : entity.verticalAlign === 'top'
      ? -height
      : entity.verticalAlign === 'baseline'
        ? -height * 0.2
        : 0
  const cos = Math.cos(entity.rotationRadians)
  const sin = Math.sin(entity.rotationRadians)

  return closeSampledPoints([
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map((point) => [
    anchor[0] + point[0]! * cos - point[1]! * sin,
    anchor[1] + point[0]! * sin + point[1]! * cos,
  ] satisfies SketchPoint2D), true)
}

function getEllipseFrame(center: SketchPoint2D, majorAxisEndpoint: SketchPoint2D, minorRadius: number) {
  const major = subtractPoints(majorAxisEndpoint, center)
  const majorRadius = Math.hypot(major[0], major[1])
  if (majorRadius <= EPSILON || minorRadius <= EPSILON) {
    return null
  }

  const majorUnit = [major[0] / majorRadius, major[1] / majorRadius] satisfies SketchPoint2D
  const minorUnit = [-majorUnit[1], majorUnit[0]] satisfies SketchPoint2D
  return {
    center,
    majorUnit,
    minorUnit,
    majorRadius,
    minorRadius,
  }
}

function getEllipseParameterAngle(frame: NonNullable<ReturnType<typeof getEllipseFrame>>, point: SketchPoint2D) {
  const delta = subtractPoints(point, frame.center)
  return Math.atan2(
    dotPoints(delta, frame.minorUnit) / frame.minorRadius,
    dotPoints(delta, frame.majorUnit) / frame.majorRadius,
  )
}

function evaluateEllipsePoint(frame: NonNullable<ReturnType<typeof getEllipseFrame>>, angle: number): SketchPoint2D {
  return addPoints(
    frame.center,
    addPoints(
      scalePoint(frame.majorUnit, Math.cos(angle) * frame.majorRadius),
      scalePoint(frame.minorUnit, Math.sin(angle) * frame.minorRadius),
    ),
  )
}

function evaluateBezier(points: readonly SketchPoint2D[], t: number): SketchPoint2D {
  if (points.length === 1) {
    return points[0]!
  }

  return evaluateBezier(
    points.slice(0, -1).map((point, index) => [
      point[0] + (points[index + 1]![0] - point[0]) * t,
      point[1] + (points[index + 1]![1] - point[1]) * t,
    ] satisfies SketchPoint2D),
    t,
  )
}

function getSweepRadians(startAngle: number, endAngle: number, direction: 'clockwise' | 'counterClockwise') {
  const start = normalizeAngle(startAngle)
  const end = normalizeAngle(endAngle)
  if (direction === 'counterClockwise') {
    return end >= start ? end - start : end + TURN - start
  }

  return end <= start ? start - end : start + TURN - end
}

function normalizeAngle(angle: number) {
  return ((angle % TURN) + TURN) % TURN
}

function closeSampledPoints(points: readonly SketchPoint2D[], isClosed: boolean): readonly SketchPoint2D[] {
  if (!isClosed || points.length < 2) {
    return points
  }

  const first = points[0]!
  const last = points[points.length - 1]!
  return areSamePoint(first, last) ? points : [...points, first]
}

function collectDefiningPoints(
  pointIds: readonly SketchPointId[],
  resolvePoint: (pointId: SketchPointId) => SketchPoint2D | null,
) {
  const points = pointIds.map(resolvePoint)
  return points.every((point): point is SketchPoint2D => point !== null)
    ? points
    : null
}

function areSamePoint(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= EPSILON
}

function subtractPoints(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]]
}

function addPoints(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]]
}

function scalePoint(point: SketchPoint2D, scale: number): SketchPoint2D {
  return [point[0] * scale, point[1] * scale]
}

function dotPoints(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[0] + left[1] * right[1]
}
