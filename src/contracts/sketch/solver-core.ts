import type {
  ConstraintStatusRecord,
  DimensionStatusRecord,
  ProjectedSketchGeometryRef,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchReferenceDefinition,
  SketchSolveDiagnostic,
  SolvedSketchEntityGeometryRecord,
  SolvedSketchSnapshot,
  SolvedSketchStatus,
} from '@/contracts/sketch/schema'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
} from '@/contracts/sketch/schema'
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
  SolverPartialSolvePolicy,
} from '@/contracts/solver/schema'
import type {
  ConstraintId,
  DimensionId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from '@/contracts/shared/ids'

export interface SketchSolveTolerancePolicy {
  coincidence: number
  angleRadians: number
  minimumSegmentLength: number
}

export interface SketchCoreSolveResult {
  status: SolvedSketchStatus
  solvedSnapshot: SolvedSketchSnapshot
  diagnostics: SketchSolveDiagnostic[]
}

export type SketchSolveStrategy =
  | 'bfgs'
  | 'gradientDescent'
  | 'gaussNewton'
  | 'levenbergMarquardt'

export interface SketchDraggedPointTarget {
  kind: 'sketchPoint'
  pointId: SketchPointId
  position: SketchPoint2D
}

export type SketchDraggedPointSolveResult =
  | {
      kind: 'solved'
      solvedSnapshot: SolvedSketchSnapshot
      diagnostics: SketchSolveDiagnostic[]
    }
  | {
      kind: 'blocked'
      reason: 'missingPoint' | 'unsatisfied' | 'nonConvergent'
      solvedSnapshot: SolvedSketchSnapshot | null
      diagnostics: SketchSolveDiagnostic[]
    }

export interface SketchCoreValidationResult {
  isValid: boolean
  diagnostics: SketchSolveDiagnostic[]
}

export interface SketchScalarConstraintEvaluationForTest {
  id: ConstraintId | DimensionId
  targetKind: 'constraint' | 'dimension'
  residual: number
  gradient: Float64Array
}

type PointState = {
  kind: 'point'
  pointId: SketchPointId
  label: string
  baseIndex: number
}

type ArcState = {
  kind: 'arc'
  entityId: SketchEntityId
  baseIndex: number
}

type SolverEntityState = PointState | ArcState

type ScalarConstraintEvaluation = {
  residual: number
  gradient: Float64Array
}

type ScalarConstraintRecord = {
  id: ConstraintId | DimensionId
  targetKind: 'constraint' | 'dimension'
  evaluate(values: Float64Array): ScalarConstraintEvaluation
}

type ConstraintEvaluationRecord = {
  id: ConstraintId | DimensionId
  targetKind: 'constraint' | 'dimension'
  residual: number
  gradient: Float64Array
}

type SolverPointRecord = {
  pointId: SketchPointId
  initial: SketchPoint2D
  baseIndex: number
}

type BuildSystemResult = {
  parameterCount: number
  initialValues: Float64Array
  pointRecords: Map<SketchPointId, SolverPointRecord>
  entityStates: Map<SketchEntityId, SolverEntityState>
  scalarConstraints: ScalarConstraintRecord[]
}

interface BuildSystemOptions {
  dragTarget?: SketchDraggedPointTarget | null
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
}

const WOLFE_C1 = 1e-4
const WOLFE_C2 = 0.9
const LINE_SEARCH_MAX_ITERATIONS = 15
const DEGENERATE_NORM_EPSILON = 1e-6

function cloneValues(values: Float64Array) {
  return new Float64Array(values)
}

function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic['severity'],
  message: string,
  target: SketchSolveDiagnostic['target'],
): SketchSolveDiagnostic {
  return { code, severity, message, target }
}

function zeroVector(length: number) {
  return new Float64Array(length)
}

function addScaled(target: Float64Array, scale: number, source: Float64Array) {
  for (let index = 0; index < target.length; index += 1) {
    target[index] += scale * source[index]!
  }
}

function dot(left: Float64Array, right: Float64Array) {
  let value = 0
  for (let index = 0; index < left.length; index += 1) {
    value += left[index]! * right[index]!
  }
  return value
}

function euclideanNorm(values: Float64Array) {
  return Math.sqrt(dot(values, values))
}

function uniformNorm(values: Float64Array) {
  let value = 0
  for (let index = 0; index < values.length; index += 1) {
    value = Math.max(value, Math.abs(values[index]!))
  }
  return value
}

function getPoint(values: Float64Array, point: SolverPointRecord): SketchPoint2D {
  return [values[point.baseIndex]!, values[point.baseIndex + 1]!] as const
}

function getArcParameters(values: Float64Array, arc: ArcState) {
  return {
    radius: values[arc.baseIndex]!,
    startAngle: values[arc.baseIndex + 1]!,
    endAngle: values[arc.baseIndex + 2]!,
  }
}

function subtract(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]]
}

function add(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]]
}

function length(point: SketchPoint2D) {
  return Math.hypot(point[0], point[1])
}

function dot2(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[0] + left[1] * right[1]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function addPointGradient(
  gradient: Float64Array,
  point: SolverPointRecord,
  x: number,
  y: number,
) {
  gradient[point.baseIndex] += x
  gradient[point.baseIndex + 1] += y
}

function projectedKindForConstraintRef(kind: NonNullable<ProjectedSketchGeometryRef['kind']>) {
  switch (kind) {
    case 'projectedPoint':
      return 'point'
    case 'projectedLineSegment':
      return 'lineSegment'
    case 'projectedCircle':
      return 'circle'
    case 'projectedArc':
      return 'arc'
    case 'projectedSpline':
      return 'spline'
  }
}

function findProjectedGeometry(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
): ProjectedSketchReferenceGeometry | null {
  const projectedReference = projectedReferences.find((entry) => entry.referenceId === reference.referenceId)

  if (!projectedReference || projectedReference.status !== 'projected') {
    return null
  }

  const expectedKind = projectedKindForConstraintRef(reference.kind)
  return projectedReference.geometry.find((geometry) =>
    geometry.geometryId === reference.geometryId && geometry.kind === expectedKind,
  ) ?? null
}

function projectedCircleLikeGeometry(
  geometry: ProjectedSketchReferenceGeometry,
): { center: SketchPoint2D; radius: number } | null {
  if (geometry.kind === 'circle') {
    return { center: geometry.centerPosition, radius: geometry.radius }
  }

  if (geometry.kind === 'arc') {
    return {
      center: geometry.centerPosition,
      radius: length(subtract(geometry.startPosition, geometry.centerPosition)),
    }
  }

  return null
}

function normalizeAngleRadians(angle: number) {
  const fullTurn = Math.PI * 2
  return ((angle % fullTurn) + fullTurn) % fullTurn
}

function arcSweepOffset(
  angle: number,
  startAngle: number,
  direction: Extract<ProjectedSketchReferenceGeometry, { kind: 'arc' }>['sweepDirection'],
) {
  return direction === 'counterClockwise'
    ? normalizeAngleRadians(angle - startAngle)
    : normalizeAngleRadians(startAngle - angle)
}

function projectedArcData(geometry: Extract<ProjectedSketchReferenceGeometry, { kind: 'arc' }>) {
  const startOffset = subtract(geometry.startPosition, geometry.centerPosition)
  const endOffset = subtract(geometry.endPosition, geometry.centerPosition)
  const radius = length(startOffset)
  const startAngle = Math.atan2(startOffset[1], startOffset[0])
  const endAngle = Math.atan2(endOffset[1], endOffset[0])
  const sweep = arcSweepOffset(endAngle, startAngle, geometry.sweepDirection)

  return {
    center: geometry.centerPosition,
    radius,
    startAngle,
    endAngle,
    sweep,
    sweepDirection: geometry.sweepDirection,
    startPosition: geometry.startPosition,
    endPosition: geometry.endPosition,
  }
}

function isAngleOnProjectedArc(
  angle: number,
  arc: ReturnType<typeof projectedArcData>,
) {
  return arcSweepOffset(angle, arc.startAngle, arc.sweepDirection) <= arc.sweep + 1e-9
}

function nearestPointOnProjectedArcSweep(
  point: SketchPoint2D,
  arc: ReturnType<typeof projectedArcData>,
): SketchPoint2D {
  const offset = subtract(point, arc.center)
  const offsetLength = length(offset)
  const angle = offsetLength > DEGENERATE_NORM_EPSILON
    ? Math.atan2(offset[1], offset[0])
    : arc.startAngle

  if (isAngleOnProjectedArc(angle, arc)) {
    return [
      arc.center[0] + Math.cos(angle) * arc.radius,
      arc.center[1] + Math.sin(angle) * arc.radius,
    ]
  }

  return length(subtract(point, arc.startPosition)) <= length(subtract(point, arc.endPosition))
    ? arc.startPosition
    : arc.endPosition
}

function pointProjectedArcDistance(point: SketchPoint2D, geometry: Extract<ProjectedSketchReferenceGeometry, { kind: 'arc' }>) {
  const arc = projectedArcData(geometry)
  return length(subtract(point, nearestPointOnProjectedArcSweep(point, arc)))
}

function projectedArcSweepViolation(point: SketchPoint2D, geometry: Extract<ProjectedSketchReferenceGeometry, { kind: 'arc' }>) {
  const arc = projectedArcData(geometry)
  const offset = subtract(point, arc.center)
  const offsetLength = length(offset)
  const angle = offsetLength > DEGENERATE_NORM_EPSILON
    ? Math.atan2(offset[1], offset[0])
    : arc.startAngle

  if (isAngleOnProjectedArc(angle, arc)) {
    return 0
  }

  const circlePoint: SketchPoint2D = [
    arc.center[0] + Math.cos(angle) * arc.radius,
    arc.center[1] + Math.sin(angle) * arc.radius,
  ]
  return Math.min(
    length(subtract(circlePoint, arc.startPosition)),
    length(subtract(circlePoint, arc.endPosition)),
  )
}

function unitVector(start: SketchPoint2D, end: SketchPoint2D): SketchPoint2D | null {
  const delta = subtract(end, start)
  const norm = length(delta)

  return norm < DEGENERATE_NORM_EPSILON
    ? null
    : [delta[0] / norm, delta[1] / norm]
}

function pointLineSignedDistance(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const unit = unitVector(start, end)

  if (!unit) {
    return 0
  }

  const delta = subtract(point, start)
  return delta[0] * unit[1] - delta[1] * unit[0]
}

function pointSegmentDistance(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const segment = subtract(end, start)
  const lengthSquared = dot2(segment, segment)

  if (lengthSquared <= DEGENERATE_NORM_EPSILON) {
    return length(subtract(point, start))
  }

  const t = clamp(dot2(subtract(point, start), segment) / lengthSquared, 0, 1)
  return length(subtract(point, [
    start[0] + segment[0] * t,
    start[1] + segment[1] * t,
  ]))
}

function pointSplineDistance(point: SketchPoint2D, geometry: Extract<ProjectedSketchReferenceGeometry, { kind: 'spline' }>) {
  const fitPoints = geometry.isClosed && geometry.fitPoints.length > 2
    ? [...geometry.fitPoints, geometry.fitPoints[0]!]
    : geometry.fitPoints

  if (fitPoints.length === 0) {
    return 0
  }

  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < fitPoints.length - 1; index += 1) {
    best = Math.min(best, pointSegmentDistance(point, fitPoints[index]!, fitPoints[index + 1]!))
  }
  return Number.isFinite(best) ? best : length(subtract(point, fitPoints[0]!))
}

function midpoint(start: SketchPoint2D, end: SketchPoint2D): SketchPoint2D {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
}

function isAdvancedSketchEntity(entity: SketchEntityDefinition) {
  return entity.kind === 'ellipse'
    || entity.kind === 'ellipticalArc'
    || entity.kind === 'conic'
    || entity.kind === 'bezierCurve'
    || entity.kind === 'profileText'
}

function localArcData(input: {
  center: SketchPoint2D
  radius: number
  startAngle: number
  endAngle: number
  sweepDirection: Extract<SketchEntityDefinition, { kind: 'arc' }>['sweepDirection']
}) {
  const sweep = arcSweepOffset(input.endAngle, input.startAngle, input.sweepDirection)
  const startPosition: SketchPoint2D = [
    input.center[0] + Math.cos(input.startAngle) * input.radius,
    input.center[1] + Math.sin(input.startAngle) * input.radius,
  ]
  const endPosition: SketchPoint2D = [
    input.center[0] + Math.cos(input.endAngle) * input.radius,
    input.center[1] + Math.sin(input.endAngle) * input.radius,
  ]

  return {
    center: input.center,
    radius: input.radius,
    startAngle: input.startAngle,
    endAngle: input.endAngle,
    sweep,
    sweepDirection: input.sweepDirection,
    startPosition,
    endPosition,
  }
}

function isAngleOnLocalArc(angle: number, arc: ReturnType<typeof localArcData>) {
  return arcSweepOffset(angle, arc.startAngle, arc.sweepDirection) <= arc.sweep + 1e-9
}

function nearestPointOnLocalArcSweep(
  point: SketchPoint2D,
  arc: ReturnType<typeof localArcData>,
): SketchPoint2D {
  const offset = subtract(point, arc.center)
  const offsetLength = length(offset)
  const angle = offsetLength > DEGENERATE_NORM_EPSILON
    ? Math.atan2(offset[1], offset[0])
    : arc.startAngle

  if (isAngleOnLocalArc(angle, arc)) {
    return [
      arc.center[0] + Math.cos(angle) * arc.radius,
      arc.center[1] + Math.sin(angle) * arc.radius,
    ]
  }

  return length(subtract(point, arc.startPosition)) <= length(subtract(point, arc.endPosition))
    ? arc.startPosition
    : arc.endPosition
}

function localArcSweepViolation(point: SketchPoint2D, arc: ReturnType<typeof localArcData>) {
  const offset = subtract(point, arc.center)
  const offsetLength = length(offset)
  const angle = offsetLength > DEGENERATE_NORM_EPSILON
    ? Math.atan2(offset[1], offset[0])
    : arc.startAngle

  if (isAngleOnLocalArc(angle, arc)) {
    return 0
  }

  const circlePoint: SketchPoint2D = [
    arc.center[0] + Math.cos(angle) * arc.radius,
    arc.center[1] + Math.sin(angle) * arc.radius,
  ]
  return Math.min(
    length(subtract(circlePoint, arc.startPosition)),
    length(subtract(circlePoint, arc.endPosition)),
  )
}

function localCircleTangencyContacts(
  first: { center: SketchPoint2D; radius: number },
  second: { center: SketchPoint2D; radius: number },
  relation: 'external' | 'internal',
): [SketchPoint2D, SketchPoint2D] {
  const centerDelta = subtract(second.center, first.center)
  const centerDistance = length(centerDelta)
  const direction: SketchPoint2D = centerDistance > DEGENERATE_NORM_EPSILON
    ? [centerDelta[0] / centerDistance, centerDelta[1] / centerDistance]
    : [1, 0]

  if (relation === 'external') {
    return [
      [
        first.center[0] + direction[0] * first.radius,
        first.center[1] + direction[1] * first.radius,
      ],
      [
        second.center[0] - direction[0] * second.radius,
        second.center[1] - direction[1] * second.radius,
      ],
    ]
  }

  const contactSign = first.radius >= second.radius ? 1 : -1
  return [
    [
      first.center[0] + direction[0] * first.radius * contactSign,
      first.center[1] + direction[1] * first.radius * contactSign,
    ],
    [
      second.center[0] + direction[0] * second.radius * contactSign,
      second.center[1] + direction[1] * second.radius * contactSign,
    ],
  ]
}

function createNumericalScalarConstraint(input: {
  id: ConstraintId | DimensionId
  targetKind: 'constraint' | 'dimension'
  parameterCount: number
  evaluateResidual(values: Float64Array): number
}): ScalarConstraintRecord {
  return {
    id: input.id,
    targetKind: input.targetKind,
    evaluate(values) {
      const residualValue = input.evaluateResidual(values)
      const gradient = zeroVector(input.parameterCount)
      const step = 1e-6

      for (let index = 0; index < values.length; index += 1) {
        const next = cloneValues(values)
        const previous = cloneValues(values)
        next[index] += step
        previous[index] -= step
        const nextLoss = 0.5 * input.evaluateResidual(next) ** 2
        const previousLoss = 0.5 * input.evaluateResidual(previous) ** 2
        gradient[index] = (nextLoss - previousLoss) / (2 * step)
      }

      return { residual: 0.5 * residualValue * residualValue, gradient }
    },
  }
}

function buildSystem(definition: SketchDefinition, options: BuildSystemOptions = {}): BuildSystemResult {
  const pointRecords = new Map<SketchPointId, SolverPointRecord>()
  const entityStates = new Map<SketchEntityId, SolverEntityState>()
  const scalarConstraints: ScalarConstraintRecord[] = []

  let parameterCount = 0
  for (const point of definition.points) {
    pointRecords.set(point.pointId, {
      pointId: point.pointId,
      initial: point.position,
      baseIndex: parameterCount,
    })
    parameterCount += 2
  }

  for (const entity of definition.entities) {
    if (entity.kind === 'arc') {
      const center = pointRecords.get(entity.centerPointId)
      const start = pointRecords.get(entity.startPointId)
      const end = pointRecords.get(entity.endPointId)
      if (!center || !start || !end) {
        continue
      }

      const centerPos = center.initial
      const startVector = subtract(start.initial, centerPos)
      const endVector = subtract(end.initial, centerPos)
      entityStates.set(entity.entityId, {
        kind: 'arc',
        entityId: entity.entityId,
        baseIndex: parameterCount,
      })
      parameterCount += 3

      void startVector
      void endVector
    }
  }

  const initialValues = new Float64Array(parameterCount)
  for (const record of pointRecords.values()) {
    initialValues[record.baseIndex] = record.initial[0]
    initialValues[record.baseIndex + 1] = record.initial[1]
  }

  for (const entity of definition.entities) {
    if (entity.kind !== 'arc') {
      continue
    }
    const arcState = entityStates.get(entity.entityId)
    const center = pointRecords.get(entity.centerPointId)
    const start = pointRecords.get(entity.startPointId)
    const end = pointRecords.get(entity.endPointId)
    if (!arcState || arcState.kind !== 'arc' || !center || !start || !end) {
      continue
    }

    const centerPos = center.initial
    const startOffset = subtract(start.initial, centerPos)
    const endOffset = subtract(end.initial, centerPos)
    initialValues[arcState.baseIndex] = Math.max(length(startOffset), 1e-9)
    initialValues[arcState.baseIndex + 1] = Math.atan2(startOffset[1], startOffset[0])
    initialValues[arcState.baseIndex + 2] = Math.atan2(endOffset[1], endOffset[0])
  }

  const lineEntityMap = new Map(
    definition.entities
      .filter((entity): entity is Extract<SketchEntityDefinition, { kind: 'lineSegment' }> => entity.kind === 'lineSegment')
      .map((entity) => [entity.entityId, entity]),
  )
  const arcEntityMap = new Map(
    definition.entities
      .filter((entity): entity is Extract<SketchEntityDefinition, { kind: 'arc' }> => entity.kind === 'arc')
      .map((entity) => [entity.entityId, entity]),
  )

  const getLocalCircleLike = (
    values: Float64Array,
    entity: SketchEntityDefinition,
  ): { center: SketchPoint2D; radius: number; arc?: ReturnType<typeof localArcData> } | null => {
    if (entity.kind === 'circle') {
      const center = pointRecords.get(entity.centerPointId)
      return center ? { center: getPoint(values, center), radius: entity.radius } : null
    }

    if (entity.kind === 'arc') {
      const center = pointRecords.get(entity.centerPointId)
      const arcState = entityStates.get(entity.entityId)
      if (!center || !arcState || arcState.kind !== 'arc') {
        return null
      }

      const { radius, startAngle, endAngle } = getArcParameters(values, arcState)
      const arc = localArcData({
        center: getPoint(values, center),
        radius,
        startAngle,
        endAngle,
        sweepDirection: entity.sweepDirection,
      })
      return { center: arc.center, radius: arc.radius, arc }
    }

    return null
  }

  const pointOnLocalCurveResidual = (
    values: Float64Array,
    point: SolverPointRecord,
    entity: SketchEntityDefinition,
  ) => {
    const position = getPoint(values, point)

    if (entity.kind === 'lineSegment') {
      const start = pointRecords.get(entity.startPointId)
      const end = pointRecords.get(entity.endPointId)
      return start && end
        ? pointLineSignedDistance(position, getPoint(values, start), getPoint(values, end))
        : 0
    }

    if (entity.kind === 'spline') {
      const fitPoints = entity.fitPointIds.flatMap((pointId) => {
        const fitPoint = pointRecords.get(pointId)
        return fitPoint ? [getPoint(values, fitPoint)] : []
      })
      return pointSplineDistance(position, {
        geometryId: 'projected_geometry_local_spline' as import('@/contracts/shared/ids').ProjectedGeometryId,
        kind: 'spline',
        fitPoints,
        degree: entity.degree,
        isClosed: false,
      })
    }

    const circleLike = getLocalCircleLike(values, entity)
    if (!circleLike) {
      return 0
    }

    if (circleLike.arc) {
      return length(subtract(position, nearestPointOnLocalArcSweep(position, circleLike.arc)))
    }

    return length(subtract(position, circleLike.center)) - circleLike.radius
  }

  const pointOnProjectedCurveResidual = (
    position: SketchPoint2D,
    projected: ProjectedSketchReferenceGeometry,
  ) => {
    if (projected.kind === 'lineSegment') {
      return pointLineSignedDistance(position, projected.startPosition, projected.endPosition)
    }

    if (projected.kind === 'arc') {
      return pointProjectedArcDistance(position, projected)
    }

    if (projected.kind === 'spline') {
      return pointSplineDistance(position, projected)
    }

    const circleLike = projectedCircleLikeGeometry(projected)
    return circleLike
      ? length(subtract(position, circleLike.center)) - circleLike.radius
      : 0
  }

  const normalResidual = (
    values: Float64Array,
    line: Extract<SketchEntityDefinition, { kind: 'lineSegment' }>,
    contactPoint: SketchPoint2D,
    center: SketchPoint2D,
  ) => {
    const start = pointRecords.get(line.startPointId)
    const end = pointRecords.get(line.endPointId)
    if (!start || !end) {
      return 0
    }

    const lineUnit = unitVector(getPoint(values, start), getPoint(values, end))
    const radialUnit = unitVector(center, contactPoint)
    if (!lineUnit || !radialUnit) {
      return 0
    }

    return lineUnit[0] * radialUnit[1] - lineUnit[1] * radialUnit[0]
  }

  const lineContactResidual = (
    values: Float64Array,
    line: Extract<SketchEntityDefinition, { kind: 'lineSegment' }>,
    contactPoint: SketchPoint2D,
  ) => {
    const start = pointRecords.get(line.startPointId)
    const end = pointRecords.get(line.endPointId)
    return start && end
      ? pointLineSignedDistance(contactPoint, getPoint(values, start), getPoint(values, end))
      : 0
  }

  const symmetricResidual = (
    firstPoint: SketchPoint2D,
    secondPoint: SketchPoint2D,
    axisStart: SketchPoint2D,
    axisEnd: SketchPoint2D,
  ) => {
    const axisUnit = unitVector(axisStart, axisEnd)
    if (!axisUnit) {
      return 0
    }

    const center = midpoint(firstPoint, secondPoint)
    const axisDistance = pointLineSignedDistance(center, axisStart, axisEnd)
    const pairVector = subtract(secondPoint, firstPoint)
    const axisProjection = dot2(pairVector, axisUnit)
    return Math.sqrt(axisDistance * axisDistance + axisProjection * axisProjection)
  }

  for (const constraint of definition.constraints) {
    if (constraint.kind === 'coincident') {
      const left = pointRecords.get(constraint.pointIds[0])
      const right = pointRecords.get(constraint.pointIds[1])
      if (!left || !right) {
        continue
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: 'constraint',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const a = getPoint(values, left)
          const b = getPoint(values, right)
          const delta = subtract(a, b)
          addPointGradient(gradient, left, delta[0], delta[1])
          addPointGradient(gradient, right, -delta[0], -delta[1])
          return { residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]), gradient }
        },
      })
      continue
    }

    if (constraint.kind === 'horizontal' || constraint.kind === 'vertical') {
      const line = lineEntityMap.get(constraint.entityId)
      if (!line) {
        continue
      }
      const start = pointRecords.get(line.startPointId)
      const end = pointRecords.get(line.endPointId)
      if (!start || !end) {
        continue
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: 'constraint',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const a = getPoint(values, start)
          const b = getPoint(values, end)
          if (constraint.kind === 'horizontal') {
            const dy = b[1] - a[1]
            addPointGradient(gradient, start, 0, -dy)
            addPointGradient(gradient, end, 0, dy)
            return { residual: 0.5 * dy * dy, gradient }
          }

          const dx = b[0] - a[0]
          addPointGradient(gradient, start, -dx, 0)
          addPointGradient(gradient, end, dx, 0)
          return { residual: 0.5 * dx * dx, gradient }
        },
      })
      continue
    }

    if (constraint.kind === 'fixPoint') {
      const point = pointRecords.get(constraint.pointId)
      if (!point) {
        continue
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: 'constraint',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const actual = getPoint(values, point)
          const delta = subtract(actual, constraint.position)
          addPointGradient(gradient, point, delta[0], delta[1])
          return { residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]), gradient }
        },
      })
      continue
    }

    if (constraint.kind === 'angle') {
      const point1 = pointRecords.get(constraint.pointIds[0])
      const point2 = pointRecords.get(constraint.pointIds[1])
      const middle = pointRecords.get(constraint.pointIds[2])
      if (!point1 || !point2 || !middle) {
        continue
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: 'constraint',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const p1 = getPoint(values, point1)
          const p2 = getPoint(values, point2)
          const pm = getPoint(values, middle)
          const d1 = subtract(p1, pm)
          const d2 = subtract(p2, pm)
          const norm1 = length(d1)
          const norm2 = length(d2)
          if (norm1 < DEGENERATE_NORM_EPSILON || norm2 < DEGENERATE_NORM_EPSILON) {
            return { residual: 0.5 * constraint.valueRadians * constraint.valueRadians, gradient }
          }

          const dotValue = d1[0] * d2[0] + d1[1] * d2[1]
          const cosTheta = Math.max(-1, Math.min(1, dotValue / (norm1 * norm2)))
          const theta = Math.acos(cosTheta)
          const lossGradient = theta - constraint.valueRadians
          const denom = Math.sqrt(Math.max(1e-12, 1 - cosTheta * cosTheta))
          const gradThetaFromCos = -1 / denom

          const gradCosFromD1X =
            d2[0] / (norm1 * norm2) - (dotValue * d1[0]) / (norm1 * norm1 * norm1 * norm2)
          const gradCosFromD1Y =
            d2[1] / (norm1 * norm2) - (dotValue * d1[1]) / (norm1 * norm1 * norm1 * norm2)
          const gradCosFromD2X =
            d1[0] / (norm1 * norm2) - (dotValue * d2[0]) / (norm1 * norm2 * norm2 * norm2)
          const gradCosFromD2Y =
            d1[1] / (norm1 * norm2) - (dotValue * d2[1]) / (norm1 * norm2 * norm2 * norm2)

          const scaleFactor = lossGradient * gradThetaFromCos
          addPointGradient(gradient, point1, scaleFactor * gradCosFromD1X, scaleFactor * gradCosFromD1Y)
          addPointGradient(gradient, point2, scaleFactor * gradCosFromD2X, scaleFactor * gradCosFromD2Y)
          addPointGradient(
            gradient,
            middle,
            -scaleFactor * (gradCosFromD1X + gradCosFromD2X),
            -scaleFactor * (gradCosFromD1Y + gradCosFromD2Y),
          )
          const residual = 0.5 * lossGradient * lossGradient
          return { residual, gradient }
        },
      })
      continue
    }

    if (
      constraint.kind === 'parallel'
      || constraint.kind === 'perpendicular'
      || constraint.kind === 'equalLength'
    ) {
      const lineA = lineEntityMap.get(constraint.entityIds[0])
      const lineB = lineEntityMap.get(constraint.entityIds[1])
      if (!lineA || !lineB) {
        continue
      }
      const a0 = pointRecords.get(lineA.startPointId)
      const a1 = pointRecords.get(lineA.endPointId)
      const b0 = pointRecords.get(lineB.startPointId)
      const b1 = pointRecords.get(lineB.endPointId)
      if (!a0 || !a1 || !b0 || !b1) {
        continue
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: 'constraint',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const pa0 = getPoint(values, a0)
          const pa1 = getPoint(values, a1)
          const pb0 = getPoint(values, b0)
          const pb1 = getPoint(values, b1)
          const da = subtract(pa1, pa0)
          const db = subtract(pb1, pb0)
          const na = length(da)
          const nb = length(db)
          if (na < DEGENERATE_NORM_EPSILON || nb < DEGENERATE_NORM_EPSILON) {
            return { residual: 0, gradient }
          }

          if (constraint.kind === 'equalLength') {
            const diff = na - nb
            const dNa = [da[0] / na, da[1] / na] as const
            const dNb = [db[0] / nb, db[1] / nb] as const
            addPointGradient(gradient, a0, -diff * dNa[0], -diff * dNa[1])
            addPointGradient(gradient, a1, diff * dNa[0], diff * dNa[1])
            addPointGradient(gradient, b0, diff * dNb[0], diff * dNb[1])
            addPointGradient(gradient, b1, -diff * dNb[0], -diff * dNb[1])
            return { residual: 0.5 * diff * diff, gradient }
          }

          const ua = [da[0] / na, da[1] / na] as const
          const ub = [db[0] / nb, db[1] / nb] as const
          const residualValue =
            constraint.kind === 'parallel'
              ? ua[0] * ub[1] - ua[1] * ub[0]
              : ua[0] * ub[0] + ua[1] * ub[1]

          const hA = [
            [1 / na - (da[0] * da[0]) / (na * na * na), -(da[0] * da[1]) / (na * na * na)],
            [-(da[0] * da[1]) / (na * na * na), 1 / na - (da[1] * da[1]) / (na * na * na)],
          ] as const
          const hB = [
            [1 / nb - (db[0] * db[0]) / (nb * nb * nb), -(db[0] * db[1]) / (nb * nb * nb)],
            [-(db[0] * db[1]) / (nb * nb * nb), 1 / nb - (db[1] * db[1]) / (nb * nb * nb)],
          ] as const

          const gradResidualUa =
            constraint.kind === 'parallel'
              ? [ub[1], -ub[0]] as const
              : [ub[0], ub[1]] as const
          const gradResidualUb =
            constraint.kind === 'parallel'
              ? [-ua[1], ua[0]] as const
              : [ua[0], ua[1]] as const

          const gradResidualDa = [
            gradResidualUa[0] * hA[0][0] + gradResidualUa[1] * hA[1][0],
            gradResidualUa[0] * hA[0][1] + gradResidualUa[1] * hA[1][1],
          ] as const
          const gradResidualDb = [
            gradResidualUb[0] * hB[0][0] + gradResidualUb[1] * hB[1][0],
            gradResidualUb[0] * hB[0][1] + gradResidualUb[1] * hB[1][1],
          ] as const

          addPointGradient(gradient, a0, -residualValue * gradResidualDa[0], -residualValue * gradResidualDa[1])
          addPointGradient(gradient, a1, residualValue * gradResidualDa[0], residualValue * gradResidualDa[1])
          addPointGradient(gradient, b0, -residualValue * gradResidualDb[0], -residualValue * gradResidualDb[1])
          addPointGradient(gradient, b1, residualValue * gradResidualDb[0], residualValue * gradResidualDb[1])
          return { residual: 0.5 * residualValue * residualValue, gradient }
        },
      })
    }

    if (constraint.kind === 'coincidentProjectedPoint') {
      const point = pointRecords.get(constraint.point.pointId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedPoint.reference,
      )

      if (!point || !projected || projected.kind !== 'point') {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          return length(subtract(getPoint(values, point), projected.position))
        },
      }))
      continue
    }

    if (constraint.kind === 'pointOnProjectedCurve') {
      const point = pointRecords.get(constraint.point.pointId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      )

      if (!point || !projected) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          return pointOnProjectedCurveResidual(getPoint(values, point), projected)
        },
      }))
      continue
    }

    if (constraint.kind === 'midpoint') {
      const point = pointRecords.get(constraint.point.pointId)
      const line = lineEntityMap.get(constraint.line.entityId)
      const start = line ? pointRecords.get(line.startPointId) : null
      const end = line ? pointRecords.get(line.endPointId) : null

      if (!point || !line || !start || !end) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          const target = midpoint(getPoint(values, start), getPoint(values, end))
          return length(subtract(getPoint(values, point), target))
        },
      }))
      continue
    }

    if (constraint.kind === 'midpointProjectedLine') {
      const point = pointRecords.get(constraint.point.pointId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedLine.reference,
      )

      if (!point || !projected || projected.kind !== 'lineSegment') {
        continue
      }

      const target = midpoint(projected.startPosition, projected.endPosition)
      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          return length(subtract(getPoint(values, point), target))
        },
      }))
      continue
    }

    if (constraint.kind === 'pointOnCurve') {
      const point = pointRecords.get(constraint.point.pointId)
      const curve = definition.entities.find((entity) => entity.entityId === constraint.curve.entityId)

      if (!point || !curve || (curve.kind !== 'lineSegment' && curve.kind !== 'circle' && curve.kind !== 'arc' && curve.kind !== 'spline')) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          return pointOnLocalCurveResidual(values, point, curve)
        },
      }))
      continue
    }

    if (
      constraint.kind === 'parallelProjectedLine'
      || constraint.kind === 'perpendicularProjectedLine'
    ) {
      const line = lineEntityMap.get(constraint.line.entityId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedLine.reference,
      )
      if (!line || !projected || projected.kind !== 'lineSegment') {
        continue
      }

      const start = pointRecords.get(line.startPointId)
      const end = pointRecords.get(line.endPointId)
      const projectedUnit = unitVector(projected.startPosition, projected.endPosition)
      if (!start || !end || !projectedUnit) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          const startPoint = getPoint(values, start)
          const endPoint = getPoint(values, end)
          const localUnit = unitVector(startPoint, endPoint)

          if (!localUnit) {
            return 0
          }

          return constraint.kind === 'parallelProjectedLine'
            ? localUnit[0] * projectedUnit[1] - localUnit[1] * projectedUnit[0]
            : localUnit[0] * projectedUnit[0] + localUnit[1] * projectedUnit[1]
        },
      }))
      continue
    }

    if (constraint.kind === 'tangentProjectedCurve') {
      const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      )
      const projectedCircle = projected ? projectedCircleLikeGeometry(projected) : null
      if (!entity || !projectedCircle) {
        continue
      }

      const createTangentResidual = (
        tangentResidual: number,
        projectedContactPoint: SketchPoint2D,
      ) => {
        if (projected?.kind !== 'arc') {
          return tangentResidual
        }

        const arcViolation = projectedArcSweepViolation(projectedContactPoint, projected)
        return Math.sqrt(tangentResidual * tangentResidual + arcViolation * arcViolation)
      }

      if (entity.kind === 'lineSegment') {
        const start = pointRecords.get(entity.startPointId)
        const end = pointRecords.get(entity.endPointId)
        if (!start || !end) {
          continue
        }

        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: 'constraint',
          parameterCount,
          evaluateResidual(values) {
            const startPoint = getPoint(values, start)
            const endPoint = getPoint(values, end)
            const unit = unitVector(startPoint, endPoint)
            if (!unit) {
              return 0
            }

            const signedDistance = pointLineSignedDistance(projectedCircle.center, startPoint, endPoint)
            const lineNormal: SketchPoint2D = [unit[1], -unit[0]]
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] - signedDistance * lineNormal[0],
              projectedCircle.center[1] - signedDistance * lineNormal[1],
            ]
            return createTangentResidual(Math.abs(signedDistance) - projectedCircle.radius, contactPoint)
          },
        }))
        continue
      }

      if (entity.kind === 'circle') {
        const center = pointRecords.get(entity.centerPointId)
        if (!center) {
          continue
        }

        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: 'constraint',
          parameterCount,
          evaluateResidual(values) {
            const localCenter = getPoint(values, center)
            const centerOffset = subtract(localCenter, projectedCircle.center)
            const centerDistance = length(centerOffset)
            const direction: SketchPoint2D = centerDistance > DEGENERATE_NORM_EPSILON
              ? [centerOffset[0] / centerDistance, centerOffset[1] / centerDistance]
              : [1, 0]
            const targetDistance = constraint.relation === 'external'
              ? entity.radius + projectedCircle.radius
              : Math.abs(entity.radius - projectedCircle.radius)
            const contactDirection = constraint.relation === 'external'
              ? direction
              : [-direction[0], -direction[1]] as const
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] + contactDirection[0] * projectedCircle.radius,
              projectedCircle.center[1] + contactDirection[1] * projectedCircle.radius,
            ]
            return createTangentResidual(centerDistance - targetDistance, contactPoint)
          },
        }))
        continue
      }

      if (entity.kind === 'arc') {
        const center = pointRecords.get(entity.centerPointId)
        const arcState = entityStates.get(entity.entityId)
        if (!center || !arcState || arcState.kind !== 'arc') {
          continue
        }

        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: 'constraint',
          parameterCount,
          evaluateResidual(values) {
            const { radius } = getArcParameters(values, arcState)
            const localCenter = getPoint(values, center)
            const centerOffset = subtract(localCenter, projectedCircle.center)
            const centerDistance = length(centerOffset)
            const direction: SketchPoint2D = centerDistance > DEGENERATE_NORM_EPSILON
              ? [centerOffset[0] / centerDistance, centerOffset[1] / centerDistance]
              : [1, 0]
            const targetDistance = constraint.relation === 'external'
              ? radius + projectedCircle.radius
              : Math.abs(radius - projectedCircle.radius)
            const contactDirection = constraint.relation === 'external'
              ? direction
              : [-direction[0], -direction[1]] as const
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] + contactDirection[0] * projectedCircle.radius,
              projectedCircle.center[1] + contactDirection[1] * projectedCircle.radius,
            ]
            return createTangentResidual(centerDistance - targetDistance, contactPoint)
          },
        }))
      }
    }

    if (constraint.kind === 'tangent') {
      const first = definition.entities.find((entity) => entity.entityId === constraint.entityIds[0])
      const second = definition.entities.find((entity) => entity.entityId === constraint.entityIds[1])
      if (!first || !second) {
        continue
      }

      const line = first.kind === 'lineSegment'
        ? first
        : second.kind === 'lineSegment'
          ? second
          : null
      const curve = first === line ? second : first

      if (line && (curve.kind === 'circle' || curve.kind === 'arc')) {
        const start = pointRecords.get(line.startPointId)
        const end = pointRecords.get(line.endPointId)
        if (!start || !end) {
          continue
        }

        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: 'constraint',
          parameterCount,
          evaluateResidual(values) {
            const circleLike = getLocalCircleLike(values, curve)
            if (!circleLike) {
              return 0
            }

            const startPoint = getPoint(values, start)
            const endPoint = getPoint(values, end)
            const unit = unitVector(startPoint, endPoint)
            if (!unit) {
              return 0
            }

            const signedDistance = pointLineSignedDistance(circleLike.center, startPoint, endPoint)
            const lineNormal: SketchPoint2D = [unit[1], -unit[0]]
            const contactPoint: SketchPoint2D = [
              circleLike.center[0] - signedDistance * lineNormal[0],
              circleLike.center[1] - signedDistance * lineNormal[1],
            ]
            const tangentResidual = Math.abs(signedDistance) - circleLike.radius
            const arcViolation = circleLike.arc ? localArcSweepViolation(contactPoint, circleLike.arc) : 0
            return Math.sqrt(tangentResidual * tangentResidual + arcViolation * arcViolation)
          },
        }))
        continue
      }

      if (
        (first.kind === 'circle' || first.kind === 'arc')
        && (second.kind === 'circle' || second.kind === 'arc')
      ) {
        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: 'constraint',
          parameterCount,
          evaluateResidual(values) {
            const firstCircle = getLocalCircleLike(values, first)
            const secondCircle = getLocalCircleLike(values, second)
            if (!firstCircle || !secondCircle) {
              return 0
            }

            const centerDistance = length(subtract(firstCircle.center, secondCircle.center))
            const targetDistance = constraint.relation === 'external'
              ? firstCircle.radius + secondCircle.radius
              : Math.abs(firstCircle.radius - secondCircle.radius)
            const tangentResidual = centerDistance - targetDistance
            const [firstContact, secondContact] = localCircleTangencyContacts(
              firstCircle,
              secondCircle,
              constraint.relation,
            )
            const firstArcViolation = firstCircle.arc ? localArcSweepViolation(firstContact, firstCircle.arc) : 0
            const secondArcViolation = secondCircle.arc ? localArcSweepViolation(secondContact, secondCircle.arc) : 0
            return Math.sqrt(
              tangentResidual * tangentResidual
              + firstArcViolation * firstArcViolation
              + secondArcViolation * secondArcViolation,
            )
          },
        }))
        continue
      }
    }

    if (constraint.kind === 'concentric') {
      const first = definition.entities.find((entity) => entity.entityId === constraint.entityIds[0])
      const second = definition.entities.find((entity) => entity.entityId === constraint.entityIds[1])
      if (
        !first ||
        !second ||
        (first.kind !== 'circle' && first.kind !== 'arc') ||
        (second.kind !== 'circle' && second.kind !== 'arc')
      ) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          const firstCircle = getLocalCircleLike(values, first)
          const secondCircle = getLocalCircleLike(values, second)
          return firstCircle && secondCircle
            ? length(subtract(firstCircle.center, secondCircle.center))
            : 0
        },
      }))
      continue
    }

    if (constraint.kind === 'concentricProjectedCurve') {
      const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      )
      const projectedCircle = projected ? projectedCircleLikeGeometry(projected) : null
      if (!entity || !projectedCircle || (entity.kind !== 'circle' && entity.kind !== 'arc')) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          const localCircle = getLocalCircleLike(values, entity)
          return localCircle
            ? length(subtract(localCircle.center, projectedCircle.center))
            : 0
        },
      }))
      continue
    }

    if (constraint.kind === 'normal') {
      const line = lineEntityMap.get(constraint.line.entityId)
      const curve = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      const point = pointRecords.get(constraint.point.pointId)
      if (!line || !curve || !point || (curve.kind !== 'circle' && curve.kind !== 'arc')) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          const circleLike = getLocalCircleLike(values, curve)
          if (!circleLike) {
            return 0
          }

          const contactPoint = getPoint(values, point)
          const curveResidual = pointOnLocalCurveResidual(values, point, curve)
          const directionResidual = normalResidual(values, line, contactPoint, circleLike.center)
          const contactResidual = lineContactResidual(values, line, contactPoint)
          return Math.sqrt(
            curveResidual * curveResidual
            + directionResidual * directionResidual
            + contactResidual * contactResidual,
          )
        },
      }))
      continue
    }

    if (constraint.kind === 'normalProjectedCurve') {
      const line = lineEntityMap.get(constraint.line.entityId)
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      )
      const projectedCircle = projected ? projectedCircleLikeGeometry(projected) : null
      const point = pointRecords.get(constraint.point.pointId)
      if (!line || !projected || !projectedCircle || !point) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          const contactPoint = getPoint(values, point)
          const curveResidual = pointOnProjectedCurveResidual(contactPoint, projected)
          const directionResidual = normalResidual(values, line, contactPoint, projectedCircle.center)
          const contactResidual = lineContactResidual(values, line, contactPoint)
          return Math.sqrt(
            curveResidual * curveResidual
            + directionResidual * directionResidual
            + contactResidual * contactResidual,
          )
        },
      }))
      continue
    }

    if (constraint.kind === 'symmetric') {
      const first = pointRecords.get(constraint.pointIds[0])
      const second = pointRecords.get(constraint.pointIds[1])
      const axis = lineEntityMap.get(constraint.axis.entityId)
      const axisStart = axis ? pointRecords.get(axis.startPointId) : null
      const axisEnd = axis ? pointRecords.get(axis.endPointId) : null
      if (!first || !second || !axis || !axisStart || !axisEnd) {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          return symmetricResidual(
            getPoint(values, first),
            getPoint(values, second),
            getPoint(values, axisStart),
            getPoint(values, axisEnd),
          )
        },
      }))
      continue
    }

    if (constraint.kind === 'symmetricProjectedLine') {
      const first = pointRecords.get(constraint.pointIds[0])
      const second = pointRecords.get(constraint.pointIds[1])
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedLine.reference,
      )
      if (!first || !second || projected?.kind !== 'lineSegment') {
        continue
      }

      scalarConstraints.push(createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: 'constraint',
        parameterCount,
        evaluateResidual(values) {
          return symmetricResidual(
            getPoint(values, first),
            getPoint(values, second),
            projected.startPosition,
            projected.endPosition,
          )
        },
      }))
      continue
    }
  }

  for (const dimension of definition.dimensions) {
    if (dimension.kind === 'distance') {
      const left = pointRecords.get(dimension.pointIds[0])
      const right = pointRecords.get(dimension.pointIds[1])
      if (!left || !right) {
        continue
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: 'dimension',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const a = getPoint(values, left)
          const b = getPoint(values, right)
          const delta =
            dimension.axis === 'aligned'
              ? subtract(a, b)
              : subtract(b, a)

          if (dimension.axis === 'aligned') {
            const current = length(delta)
            if (current < DEGENERATE_NORM_EPSILON) {
              return { residual: 0.5 * dimension.value * dimension.value, gradient }
            }
            const err = current - dimension.value
            const coeffX = (err * delta[0]) / current
            const coeffY = (err * delta[1]) / current
            addPointGradient(gradient, left, coeffX, coeffY)
            addPointGradient(gradient, right, -coeffX, -coeffY)
            return { residual: 0.5 * err * err, gradient }
          }

          const index = dimension.axis === 'horizontal' ? 0 : 1
          const err = delta[index] - dimension.value
          if (index === 0) {
            addPointGradient(gradient, left, -err, 0)
            addPointGradient(gradient, right, err, 0)
          } else {
            addPointGradient(gradient, left, 0, -err)
            addPointGradient(gradient, right, 0, err)
          }
          return { residual: 0.5 * err * err, gradient }
        },
      })
      continue
    }

    if (dimension.kind === 'horizontalDistance' || dimension.kind === 'verticalDistance') {
      const left = pointRecords.get(dimension.pointIds[0])
      const right = pointRecords.get(dimension.pointIds[1])
      if (!left || !right) {
        continue
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: 'dimension',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const a = getPoint(values, left)
          const b = getPoint(values, right)
          const delta = subtract(b, a)
          const err =
            (dimension.kind === 'horizontalDistance' ? delta[0] : delta[1]) - dimension.value
          if (dimension.kind === 'horizontalDistance') {
            addPointGradient(gradient, left, -err, 0)
            addPointGradient(gradient, right, err, 0)
          } else {
            addPointGradient(gradient, left, 0, -err)
            addPointGradient(gradient, right, 0, err)
          }
          return { residual: 0.5 * err * err, gradient }
        },
      })
      continue
    }

    if (dimension.kind === 'circleRadius') {
      const entity = definition.entities.find((candidate) => candidate.entityId === dimension.entityId)
      if (!entity || entity.kind !== 'circle') {
        continue
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: 'dimension',
        evaluate() {
          const err = entity.radius - dimension.value
          return { residual: 0.5 * err * err, gradient: zeroVector(parameterCount) }
        },
      })
      continue
    }

    if (dimension.kind === 'arcStartPointCoincident' || dimension.kind === 'arcEndPointCoincident') {
      const arc = arcEntityMap.get(dimension.entityId)
      const arcState = entityStates.get(dimension.entityId)
      const point = pointRecords.get(dimension.pointId)
      const center = arc ? pointRecords.get(arc.centerPointId) : null
      if (!arc || !arcState || arcState.kind !== 'arc' || !point || !center) {
        continue
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: 'dimension',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const centerPos = getPoint(values, center)
          const pointPos = getPoint(values, point)
          const { radius, startAngle, endAngle } = getArcParameters(values, arcState)
          const angle = dimension.kind === 'arcStartPointCoincident' ? startAngle : endAngle
          const arcPoint = add(centerPos, [radius * Math.cos(angle), radius * Math.sin(angle)])
          const delta = subtract(arcPoint, pointPos)
          const gx = delta[0]
          const gy = delta[1]
          addPointGradient(gradient, center, gx, gy)
          addPointGradient(gradient, point, -gx, -gy)
          gradient[arcState.baseIndex] += gx * Math.cos(angle) + gy * Math.sin(angle)
          const angleGradient =
            gx * (-radius * Math.sin(angle)) + gy * (radius * Math.cos(angle))
          gradient[arcState.baseIndex + (dimension.kind === 'arcStartPointCoincident' ? 1 : 2)] += angleGradient
          return { residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]), gradient }
        },
      })
    }
  }

  if (options.dragTarget) {
    const point = pointRecords.get(options.dragTarget.pointId)

    if (point) {
      scalarConstraints.push({
        id: `constraint_drag_target_${options.dragTarget.pointId}` as ConstraintId,
        targetKind: 'constraint',
        evaluate(values) {
          const gradient = zeroVector(parameterCount)
          const actual = getPoint(values, point)
          const delta = subtract(actual, options.dragTarget!.position)
          addPointGradient(gradient, point, delta[0], delta[1])
          return { residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]), gradient }
        },
      })
    }
  }

  return {
    parameterCount,
    initialValues,
    pointRecords,
    entityStates,
    scalarConstraints,
  }
}

function validateDefinition(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchCoreValidationResult {
  const diagnostics: SketchSolveDiagnostic[] = []
  const pointIds = new Set<SketchPointId>()
  const entityIds = new Set<SketchEntityId>()
  const constraintIds = new Set<ConstraintId>()
  const dimensionIds = new Set<DimensionId>()
  const referenceIds = new Set<ReferenceId>()
  const pointMap = new Map(definition.points.map((point) => [point.pointId, point]))
  const entityMap = new Map(definition.entities.map((entity) => [entity.entityId, entity]))
  const projectedTargetExists = (
    reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
  ) => findProjectedGeometry(projectedReferences, reference) !== null
  const validateProjectedTarget = (
    constraintId: ConstraintId,
    reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
    expectedKinds: readonly NonNullable<ProjectedSketchGeometryRef['kind']>[],
  ) => {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(makeDiagnostic(
        'missing-projected-constraint-reference',
        'error',
        `Constraint ${constraintId} targets missing reference ${reference.referenceId}.`,
        { kind: 'constraint', constraintId },
      ))
      return
    }

    if (!expectedKinds.includes(reference.kind)) {
      diagnostics.push(makeDiagnostic(
        'invalid-projected-constraint-target-kind',
        'error',
        `Constraint ${constraintId} targets ${reference.kind}, which is not valid for this relationship.`,
        { kind: 'constraint', constraintId },
      ))
      return
    }

    if (!projectedTargetExists(reference)) {
      diagnostics.push(makeDiagnostic(
        'missing-projected-constraint-target',
        'error',
        `Constraint ${constraintId} targets projected geometry ${reference.referenceId}.${reference.geometryId}, but no valid projected geometry was provided.`,
        { kind: 'constraint', constraintId },
      ))
    }
  }

  for (const pointId of definition.pointIds) {
    if (pointIds.has(pointId)) {
      diagnostics.push(makeDiagnostic('duplicate-point-id', 'error', `Point ${pointId} appears more than once.`, { kind: 'point', pointId }))
    }
    pointIds.add(pointId)
  }

  for (const entityId of definition.entityIds) {
    if (entityIds.has(entityId)) {
      diagnostics.push(makeDiagnostic('duplicate-entity-id', 'error', `Entity ${entityId} appears more than once.`, { kind: 'entity', entityId }))
    }
    entityIds.add(entityId)
  }

  for (const constraintId of definition.constraintIds) {
    if (constraintIds.has(constraintId)) {
      diagnostics.push(makeDiagnostic('duplicate-constraint-id', 'error', `Constraint ${constraintId} appears more than once.`, { kind: 'constraint', constraintId }))
    }
    constraintIds.add(constraintId)
  }

  for (const dimensionId of definition.dimensionIds) {
    if (dimensionIds.has(dimensionId)) {
      diagnostics.push(makeDiagnostic('duplicate-dimension-id', 'error', `Dimension ${dimensionId} appears more than once.`, { kind: 'dimension', dimensionId }))
    }
    dimensionIds.add(dimensionId)
  }

  for (const referenceId of definition.referenceIds) {
    if (referenceIds.has(referenceId)) {
      diagnostics.push(makeDiagnostic('duplicate-reference-id', 'error', `Reference ${referenceId} appears more than once.`, null))
    }
    referenceIds.add(referenceId)
  }

  for (const entity of definition.entities) {
    if (!entityIds.has(entity.entityId)) {
      diagnostics.push(makeDiagnostic('entity-missing-from-order', 'error', `Entity ${entity.entityId} is not listed in entityIds.`, { kind: 'entity', entityId: entity.entityId }))
    }

    if (entity.kind === 'lineSegment') {
      const start = pointMap.get(entity.startPointId)
      const end = pointMap.get(entity.endPointId)
      if (!start || !end) {
        diagnostics.push(makeDiagnostic('missing-line-endpoint', 'error', `Line ${entity.entityId} references a missing endpoint.`, { kind: 'entity', entityId: entity.entityId }))
      } else if (length(subtract(start.position, end.position)) < tolerances.minimumSegmentLength) {
        diagnostics.push(makeDiagnostic('degenerate-line-segment', 'error', `Line ${entity.entityId} is shorter than the minimum segment length tolerance.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }

    if (entity.kind === 'circle' && entity.radius <= 0) {
      diagnostics.push(makeDiagnostic('invalid-circle-radius', 'error', `Circle ${entity.entityId} must have a radius greater than zero.`, { kind: 'entity', entityId: entity.entityId }))
    }

    if (entity.kind === 'spline') {
      const uniqueFitPointIds = new Set(entity.fitPointIds)
      if (entity.fitPointIds.length < 3 || uniqueFitPointIds.size !== entity.fitPointIds.length) {
        diagnostics.push(makeDiagnostic('invalid-spline-fit-points', 'error', `Spline ${entity.entityId} requires at least three distinct fit points.`, { kind: 'entity', entityId: entity.entityId }))
      } else if (entity.fitPointIds.some((pointId) => !pointMap.has(pointId))) {
        diagnostics.push(makeDiagnostic('missing-spline-fit-point', 'error', `Spline ${entity.entityId} references a missing fit point.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }

    if (entity.kind === 'ellipse') {
      const center = pointMap.get(entity.centerPointId)
      const major = pointMap.get(entity.majorAxisPointId)
      if (!center || !major) {
        diagnostics.push(makeDiagnostic('missing-ellipse-defining-point', 'error', `Ellipse ${entity.entityId} references a missing defining point.`, { kind: 'entity', entityId: entity.entityId }))
      } else if (length(subtract(center.position, major.position)) < tolerances.minimumSegmentLength) {
        diagnostics.push(makeDiagnostic('degenerate-ellipse-major-axis', 'error', `Ellipse ${entity.entityId} major radius is shorter than the minimum segment length tolerance.`, { kind: 'entity', entityId: entity.entityId }))
      }
      if (entity.minorRadius <= 0) {
        diagnostics.push(makeDiagnostic('invalid-ellipse-minor-radius', 'error', `Ellipse ${entity.entityId} minor radius must be greater than zero.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }

    if (entity.kind === 'ellipticalArc') {
      const center = pointMap.get(entity.centerPointId)
      const major = pointMap.get(entity.majorAxisPointId)
      const start = pointMap.get(entity.startPointId)
      const end = pointMap.get(entity.endPointId)
      if (!center || !major || !start || !end) {
        diagnostics.push(makeDiagnostic('missing-elliptical-arc-defining-point', 'error', `Elliptical arc ${entity.entityId} references a missing defining point.`, { kind: 'entity', entityId: entity.entityId }))
      } else {
        if (length(subtract(center.position, major.position)) < tolerances.minimumSegmentLength) {
          diagnostics.push(makeDiagnostic('degenerate-elliptical-arc-major-axis', 'error', `Elliptical arc ${entity.entityId} major radius is shorter than the minimum segment length tolerance.`, { kind: 'entity', entityId: entity.entityId }))
        }
        if (length(subtract(start.position, end.position)) < tolerances.minimumSegmentLength) {
          diagnostics.push(makeDiagnostic('degenerate-elliptical-arc-endpoints', 'error', `Elliptical arc ${entity.entityId} start and end points are coincident.`, { kind: 'entity', entityId: entity.entityId }))
        }
      }
      if (entity.minorRadius <= 0) {
        diagnostics.push(makeDiagnostic('invalid-elliptical-arc-minor-radius', 'error', `Elliptical arc ${entity.entityId} minor radius must be greater than zero.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }

    if (entity.kind === 'conic') {
      const pointIds = [entity.startPointId, entity.controlPointId, entity.endPointId]
      const uniquePointIds = new Set(pointIds)
      if (uniquePointIds.size !== pointIds.length) {
        diagnostics.push(makeDiagnostic('invalid-conic-defining-points', 'error', `Conic ${entity.entityId} requires three distinct defining points.`, { kind: 'entity', entityId: entity.entityId }))
      } else if (pointIds.some((pointId) => !pointMap.has(pointId))) {
        diagnostics.push(makeDiagnostic('missing-conic-defining-point', 'error', `Conic ${entity.entityId} references a missing defining point.`, { kind: 'entity', entityId: entity.entityId }))
      }
      if (entity.rho <= 0) {
        diagnostics.push(makeDiagnostic('invalid-conic-rho', 'error', `Conic ${entity.entityId} rho must be greater than zero.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }

    if (entity.kind === 'bezierCurve') {
      const expectedPointCount = entity.degree + 1
      const uniquePointIds = new Set(entity.controlPointIds)
      if (entity.controlPointIds.length !== expectedPointCount || uniquePointIds.size !== entity.controlPointIds.length) {
        diagnostics.push(makeDiagnostic('invalid-bezier-control-points', 'error', `Bezier curve ${entity.entityId} requires ${expectedPointCount} distinct control points.`, { kind: 'entity', entityId: entity.entityId }))
      } else if (entity.controlPointIds.some((pointId) => !pointMap.has(pointId))) {
        diagnostics.push(makeDiagnostic('missing-bezier-control-point', 'error', `Bezier curve ${entity.entityId} references a missing control point.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }

    if (entity.kind === 'profileText') {
      if (!pointMap.has(entity.anchorPointId)) {
        diagnostics.push(makeDiagnostic('missing-profile-text-anchor', 'error', `Profile text ${entity.entityId} references a missing anchor point.`, { kind: 'entity', entityId: entity.entityId }))
      }
      if (entity.text.trim().length === 0) {
        diagnostics.push(makeDiagnostic('invalid-profile-text-content', 'error', `Profile text ${entity.entityId} must contain text.`, { kind: 'entity', entityId: entity.entityId }))
      }
      if (entity.height <= 0) {
        diagnostics.push(makeDiagnostic('invalid-profile-text-height', 'error', `Profile text ${entity.entityId} height must be greater than zero.`, { kind: 'entity', entityId: entity.entityId }))
      }
    }
  }

  for (const point of definition.points) {
    if (!pointIds.has(point.pointId)) {
      diagnostics.push(makeDiagnostic('point-missing-from-order', 'error', `Point ${point.pointId} is not listed in pointIds.`, { kind: 'point', pointId: point.pointId }))
    }
  }

  for (const pointId of definition.pointIds) {
    if (!pointMap.has(pointId)) {
      diagnostics.push(makeDiagnostic('point-missing-from-records', 'error', `pointIds references missing point ${pointId}.`, { kind: 'point', pointId }))
    }
  }

  for (const entityId of definition.entityIds) {
    if (!entityMap.has(entityId)) {
      diagnostics.push(makeDiagnostic('entity-missing-from-records', 'error', `entityIds references missing entity ${entityId}.`, { kind: 'entity', entityId }))
    }
  }

  const constraintMap = new Map(definition.constraints.map((constraint) => [constraint.constraintId, constraint]))
  for (const constraint of definition.constraints) {
    if (!constraintIds.has(constraint.constraintId)) {
      diagnostics.push(makeDiagnostic('constraint-missing-from-order', 'error', `Constraint ${constraint.constraintId} is not listed in constraintIds.`, { kind: 'constraint', constraintId: constraint.constraintId }))
    }

    switch (constraint.kind) {
      case 'coincident':
        if (!pointMap.has(constraint.pointIds[0]) || !pointMap.has(constraint.pointIds[1])) {
          diagnostics.push(makeDiagnostic('missing-coincident-point', 'error', `Constraint ${constraint.constraintId} references a missing point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      case 'horizontal':
      case 'vertical':
        if (!entityMap.has(constraint.entityId)) {
          diagnostics.push(makeDiagnostic('missing-constrained-entity', 'error', `Constraint ${constraint.constraintId} references a missing entity.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      case 'fixPoint':
        if (!pointMap.has(constraint.pointId)) {
          diagnostics.push(makeDiagnostic('missing-fix-point', 'error', `Constraint ${constraint.constraintId} references a missing point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      case 'angle':
        if (!constraint.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(makeDiagnostic('missing-angle-point', 'error', `Constraint ${constraint.constraintId} references a missing point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      case 'parallel':
      case 'perpendicular':
      case 'equalLength':
        if (!constraint.entityIds.every((entityId) => entityMap.has(entityId))) {
          diagnostics.push(makeDiagnostic('missing-two-line-entity', 'error', `Constraint ${constraint.constraintId} references a missing entity.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      case 'coincidentProjectedPoint':
        if (!pointMap.has(constraint.point.pointId)) {
          diagnostics.push(makeDiagnostic('missing-coincident-point', 'error', `Constraint ${constraint.constraintId} references a missing point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedPoint.reference, ['projectedPoint'])
        break
      case 'midpoint': {
        const entity = entityMap.get(constraint.line.entityId)
        if (!pointMap.has(constraint.point.pointId) || !entity || entity.kind !== 'lineSegment') {
          diagnostics.push(makeDiagnostic('missing-midpoint-target', 'error', `Constraint ${constraint.constraintId} references a missing point or line.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      }
      case 'midpointProjectedLine':
        if (!pointMap.has(constraint.point.pointId)) {
          diagnostics.push(makeDiagnostic('missing-projected-midpoint-point', 'error', `Constraint ${constraint.constraintId} references a missing point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedLine.reference, ['projectedLineSegment'])
        break
      case 'pointOnCurve': {
        const entity = entityMap.get(constraint.curve.entityId)
        if (!pointMap.has(constraint.point.pointId) || !entity) {
          diagnostics.push(makeDiagnostic('missing-point-on-curve-target', 'error', `Constraint ${constraint.constraintId} references a missing point or curve.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(makeDiagnostic('unsupported-solver-entity-constraint', 'error', `Constraint ${constraint.constraintId} targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (entity.kind !== 'lineSegment' && entity.kind !== 'circle' && entity.kind !== 'arc' && entity.kind !== 'spline') {
          diagnostics.push(makeDiagnostic('missing-point-on-curve-target', 'error', `Constraint ${constraint.constraintId} references a missing point or curve.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      }
      case 'pointOnProjectedCurve':
        if (!pointMap.has(constraint.point.pointId)) {
          diagnostics.push(makeDiagnostic('missing-point-on-projected-curve-point', 'error', `Constraint ${constraint.constraintId} references a missing point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedCurve.reference, [
          'projectedLineSegment',
          'projectedCircle',
          'projectedArc',
          'projectedSpline',
        ])
        break
      case 'parallelProjectedLine':
      case 'perpendicularProjectedLine': {
        const entity = entityMap.get(constraint.line.entityId)
        if (!entity || entity.kind !== 'lineSegment') {
          diagnostics.push(makeDiagnostic('missing-projected-line-local-entity', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported line entity.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedLine.reference, ['projectedLineSegment'])
        break
      }
      case 'tangentProjectedCurve': {
        const entity = entityMap.get(constraint.curve.entityId)
        if (!entity) {
          diagnostics.push(makeDiagnostic('missing-projected-tangent-local-curve', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported local curve.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(makeDiagnostic('unsupported-solver-entity-constraint', 'error', `Constraint ${constraint.constraintId} targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (entity.kind !== 'lineSegment' && entity.kind !== 'circle' && entity.kind !== 'arc') {
          diagnostics.push(makeDiagnostic('missing-projected-tangent-local-curve', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported local curve.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedCurve.reference, [
          'projectedCircle',
          'projectedArc',
        ])
        break
      }
      case 'tangent': {
        const entities = constraint.entityIds.map((entityId) => entityMap.get(entityId))
        if (entities.some((entity) => entity && isAdvancedSketchEntity(entity))) {
          diagnostics.push(makeDiagnostic('unsupported-solver-entity-constraint', 'error', `Constraint ${constraint.constraintId} targets an advanced sketch entity that is not supported by the current solver constraint set.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (!entities.every((entity) => entity && (entity.kind === 'lineSegment' || entity.kind === 'circle' || entity.kind === 'arc'))) {
          diagnostics.push(makeDiagnostic('missing-tangent-entity', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported curve.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      }
      case 'concentric': {
        const entities = constraint.entityIds.map((entityId) => entityMap.get(entityId))
        if (entities.some((entity) => entity && isAdvancedSketchEntity(entity))) {
          diagnostics.push(makeDiagnostic('unsupported-solver-entity-constraint', 'error', `Constraint ${constraint.constraintId} targets an advanced sketch entity that is not supported by the current solver constraint set.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (!entities.every((entity) => entity && (entity.kind === 'circle' || entity.kind === 'arc'))) {
          diagnostics.push(makeDiagnostic('missing-concentric-entity', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported circle/arc.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      }
      case 'concentricProjectedCurve': {
        const entity = entityMap.get(constraint.curve.entityId)
        if (!entity) {
          diagnostics.push(makeDiagnostic('missing-projected-concentric-local-curve', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported local circle/arc.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(makeDiagnostic('unsupported-solver-entity-constraint', 'error', `Constraint ${constraint.constraintId} targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        } else if (entity.kind !== 'circle' && entity.kind !== 'arc') {
          diagnostics.push(makeDiagnostic('missing-projected-concentric-local-curve', 'error', `Constraint ${constraint.constraintId} references a missing or unsupported local circle/arc.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedCurve.reference, [
          'projectedCircle',
          'projectedArc',
        ])
        break
      }
      case 'normal': {
        const line = entityMap.get(constraint.line.entityId)
        const curve = entityMap.get(constraint.curve.entityId)
        if (
          !pointMap.has(constraint.point.pointId) ||
          !line ||
          line.kind !== 'lineSegment' ||
          !curve ||
          (isAdvancedSketchEntity(curve) || (curve.kind !== 'circle' && curve.kind !== 'arc'))
        ) {
          diagnostics.push(makeDiagnostic(
            curve && isAdvancedSketchEntity(curve) ? 'unsupported-solver-entity-constraint' : 'missing-normal-target',
            'error',
            curve && isAdvancedSketchEntity(curve)
              ? `Constraint ${constraint.constraintId} targets ${curve.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`
              : `Constraint ${constraint.constraintId} references a missing or unsupported normal target.`,
            { kind: 'constraint', constraintId: constraint.constraintId },
          ))
        }
        break
      }
      case 'normalProjectedCurve': {
        const line = entityMap.get(constraint.line.entityId)
        if (!pointMap.has(constraint.point.pointId) || !line || line.kind !== 'lineSegment') {
          diagnostics.push(makeDiagnostic('missing-projected-normal-local-target', 'error', `Constraint ${constraint.constraintId} references a missing normal line or point.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedCurve.reference, [
          'projectedCircle',
          'projectedArc',
        ])
        break
      }
      case 'symmetric': {
        const axis = entityMap.get(constraint.axis.entityId)
        if (!constraint.pointIds.every((pointId) => pointMap.has(pointId)) || !axis || axis.kind !== 'lineSegment') {
          diagnostics.push(makeDiagnostic('missing-symmetric-target', 'error', `Constraint ${constraint.constraintId} references missing points or symmetry axis.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        break
      }
      case 'symmetricProjectedLine':
        if (!constraint.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(makeDiagnostic('missing-projected-symmetric-point', 'error', `Constraint ${constraint.constraintId} references missing symmetric points.`, { kind: 'constraint', constraintId: constraint.constraintId }))
        }
        validateProjectedTarget(constraint.constraintId, constraint.projectedLine.reference, ['projectedLineSegment'])
        break
    }
  }

  for (const constraintId of definition.constraintIds) {
    if (!constraintMap.has(constraintId)) {
      diagnostics.push(makeDiagnostic('constraint-missing-from-records', 'error', `constraintIds references missing constraint ${constraintId}.`, { kind: 'constraint', constraintId }))
    }
  }

  const dimensionMap = new Map(definition.dimensions.map((dimension) => [dimension.dimensionId, dimension]))
  for (const dimension of definition.dimensions) {
    if (!dimensionIds.has(dimension.dimensionId)) {
      diagnostics.push(makeDiagnostic('dimension-missing-from-order', 'error', `Dimension ${dimension.dimensionId} is not listed in dimensionIds.`, { kind: 'dimension', dimensionId: dimension.dimensionId }))
    }

    switch (dimension.kind) {
      case 'distance':
      case 'horizontalDistance':
      case 'verticalDistance':
        if (!dimension.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(makeDiagnostic('missing-dimension-point', 'error', `Dimension ${dimension.dimensionId} references a missing point.`, { kind: 'dimension', dimensionId: dimension.dimensionId }))
        }
        break
      case 'circleRadius':
        if (!entityMap.has(dimension.entityId)) {
          diagnostics.push(makeDiagnostic('missing-dimension-entity', 'error', `Dimension ${dimension.dimensionId} references a missing entity.`, { kind: 'dimension', dimensionId: dimension.dimensionId }))
        }
        break
      case 'arcStartPointCoincident':
      case 'arcEndPointCoincident':
        if (!entityMap.has(dimension.entityId) || !pointMap.has(dimension.pointId)) {
          diagnostics.push(makeDiagnostic('missing-arc-endpoint-reference', 'error', `Dimension ${dimension.dimensionId} references missing arc or point data.`, { kind: 'dimension', dimensionId: dimension.dimensionId }))
        }
        break
    }
  }

  for (const dimensionId of definition.dimensionIds) {
    if (!dimensionMap.has(dimensionId)) {
      diagnostics.push(makeDiagnostic('dimension-missing-from-records', 'error', `dimensionIds references missing dimension ${dimensionId}.`, { kind: 'dimension', dimensionId }))
    }
  }

  const referenceMap = new Map<ReferenceId, SketchReferenceDefinition>()
  for (const reference of definition.references) {
    if (referenceMap.has(reference.referenceId)) {
      diagnostics.push(makeDiagnostic('duplicate-reference-record', 'error', `Reference record ${reference.referenceId} appears more than once.`, null))
      continue
    }

    referenceMap.set(reference.referenceId, reference)

    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(makeDiagnostic('reference-missing-from-order', 'error', `Reference ${reference.referenceId} is not listed in referenceIds.`, null))
    }
  }

  for (const referenceId of definition.referenceIds) {
    if (!referenceMap.has(referenceId)) {
      diagnostics.push(makeDiagnostic('reference-missing-from-records', 'error', `referenceIds references missing reference ${referenceId}.`, null))
    }
  }

  return {
    isValid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics,
  }
}

function evaluateLoss(
  values: Float64Array,
  constraints: ScalarConstraintRecord[],
): {
  loss: number
  gradient: Float64Array
  perConstraint: Map<string, number>
  evaluations: ConstraintEvaluationRecord[]
} {
  const perConstraint = new Map<string, number>()
  const gradient = zeroVector(values.length)
  const evaluations: ConstraintEvaluationRecord[] = []
  let loss = 0

  for (const constraint of constraints) {
    const evaluation = constraint.evaluate(values)
    loss += evaluation.residual
    addScaled(gradient, 1, evaluation.gradient)
    perConstraint.set(constraint.id, evaluation.residual)
    evaluations.push({
      id: constraint.id,
      targetKind: constraint.targetKind,
      residual: evaluation.residual,
      gradient: evaluation.gradient,
    })
  }

  return { loss, gradient, perConstraint, evaluations }
}

function identityMatrix(size: number) {
  const matrix = Array.from({ length: size }, (_, rowIndex) => {
    const row = new Float64Array(size)
    row[rowIndex] = 1
    return row
  })
  return matrix
}

function multiplyMatrixVector(matrix: Float64Array[], vector: Float64Array) {
  const result = zeroVector(matrix.length)
  for (let row = 0; row < matrix.length; row += 1) {
    result[row] = dot(matrix[row]!, vector)
  }
  return result
}

function outer(left: Float64Array, right: Float64Array) {
  const matrix = Array.from({ length: left.length }, () => zeroVector(right.length))
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < right.length; column += 1) {
      matrix[row]![column] = left[row]! * right[column]!
    }
  }
  return matrix
}

function addScaledMatrix(target: Float64Array[], scale: number, source: Float64Array[]) {
  for (let row = 0; row < target.length; row += 1) {
    for (let column = 0; column < target[row]!.length; column += 1) {
      target[row]![column] += scale * source[row]![column]!
    }
  }
}

function lineSearchWolfe(
  values: Float64Array,
  direction: Float64Array,
  gradient: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  const slope = dot(gradient, direction)
  if (slope >= 0) {
    return null
  }
  let alpha = 1
  const initial = evaluateLoss(values, constraints)
  for (let iteration = 0; iteration < LINE_SEARCH_MAX_ITERATIONS; iteration += 1) {
    const candidate = cloneValues(values)
    addScaled(candidate, alpha, direction)
    const next = evaluateLoss(candidate, constraints)
    if (next.loss <= initial.loss + WOLFE_C1 * alpha * slope) {
      const curvature = dot(next.gradient, direction)
      if (curvature >= WOLFE_C2 * slope) {
        return { alpha, nextValues: candidate, next }
      }
      alpha *= 1.5
    } else {
      alpha *= 0.5
    }
  }
  return null
}

function solveBfgs(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  let values = cloneValues(initialValues)
  let state = evaluateLoss(values, constraints)
  const dimension = values.length
  let inverseHessian = identityMatrix(dimension)
  let recentlyReset = false

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    if (state.loss < 1e-16 || uniformNorm(state.gradient) < 1e-8) {
      break
    }

    const searchDirection = multiplyMatrixVector(inverseHessian, state.gradient)
    for (let index = 0; index < searchDirection.length; index += 1) {
      searchDirection[index] = -searchDirection[index]!
    }

    const step = lineSearchWolfe(values, searchDirection, state.gradient, constraints)
    if (!step) {
      if (recentlyReset) {
        break
      }
      inverseHessian = identityMatrix(dimension)
      recentlyReset = true
      continue
    }
    recentlyReset = false

    const s = cloneValues(searchDirection)
    for (let index = 0; index < s.length; index += 1) {
      s[index] *= step.alpha
    }

    const y = cloneValues(step.next.gradient)
    addScaled(y, -1, state.gradient)
    let sDotY = dot(s, y)
    if (Math.abs(sDotY) < 1e-16) {
      sDotY += 1e-6
    }

    const hy = multiplyMatrixVector(inverseHessian, y)
    const factor = (sDotY + dot(y, hy)) / (sDotY * sDotY)
    addScaledMatrix(inverseHessian, factor, outer(s, s))
    addScaledMatrix(inverseHessian, -1 / sDotY, outer(hy, s))
    addScaledMatrix(inverseHessian, -1 / sDotY, outer(s, hy))

    values = step.nextValues
    state = step.next
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint }
}

function solveGradientDescent(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  let values = cloneValues(initialValues)
  let state = evaluateLoss(values, constraints)

  for (let iteration = 0; iteration < 10000; iteration += 1) {
    if (state.loss < 1e-14 || euclideanNorm(state.gradient) < 1e-10) {
      break
    }

    const direction = cloneValues(state.gradient)
    for (let index = 0; index < direction.length; index += 1) {
      direction[index] = -direction[index]!
    }

    const step = lineSearchWolfe(values, direction, state.gradient, constraints)
    if (!step) {
      break
    }

    values = step.nextValues
    state = step.next
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint }
}

function transpose(matrix: Float64Array[]) {
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const result = Array.from({ length: columns }, () => zeroVector(rows))
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result[column]![row] = matrix[row]![column]!
    }
  }
  return result
}

function multiplyMatrices(left: Float64Array[], right: Float64Array[]) {
  const result = Array.from({ length: left.length }, () => zeroVector(right[0]?.length ?? 0))
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < (right[0]?.length ?? 0); column += 1) {
      let value = 0
      for (let inner = 0; inner < right.length; inner += 1) {
        value += left[row]![inner]! * right[inner]![column]!
      }
      result[row]![column] = value
    }
  }
  return result
}

function addDiagonal(matrix: Float64Array[], value: number) {
  const result = matrix.map((row) => cloneValues(row))
  for (let index = 0; index < result.length; index += 1) {
    result[index]![index] += value
  }
  return result
}

function symmetricPseudoInverse(matrix: Float64Array[], epsilon: number) {
  const size = matrix.length
  const eigenvectors = identityMatrix(size)
  const diagonalized = matrix.map((row) => cloneValues(row))
  const maxIterations = Math.max(1, size * size * 25)

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let maxOffDiagonal = 0
    let pivotRow = 0
    let pivotColumn = 0

    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const value = Math.abs(diagonalized[row]![column]!)
        if (value > maxOffDiagonal) {
          maxOffDiagonal = value
          pivotRow = row
          pivotColumn = column
        }
      }
    }

    if (maxOffDiagonal < 1e-12) {
      break
    }

    const app = diagonalized[pivotRow]![pivotRow]!
    const aqq = diagonalized[pivotColumn]![pivotColumn]!
    const apq = diagonalized[pivotRow]![pivotColumn]!
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)

    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) {
        continue
      }

      const aip = diagonalized[index]![pivotRow]!
      const aiq = diagonalized[index]![pivotColumn]!
      const nextAip = cosine * aip - sine * aiq
      const nextAiq = sine * aip + cosine * aiq
      diagonalized[index]![pivotRow] = nextAip
      diagonalized[pivotRow]![index] = nextAip
      diagonalized[index]![pivotColumn] = nextAiq
      diagonalized[pivotColumn]![index] = nextAiq
    }

    diagonalized[pivotRow]![pivotRow] =
      cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq
    diagonalized[pivotColumn]![pivotColumn] =
      sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq
    diagonalized[pivotRow]![pivotColumn] = 0
    diagonalized[pivotColumn]![pivotRow] = 0

    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index]![pivotRow]!
      const viq = eigenvectors[index]![pivotColumn]!
      eigenvectors[index]![pivotRow] = cosine * vip - sine * viq
      eigenvectors[index]![pivotColumn] = sine * vip + cosine * viq
    }
  }

  const result = Array.from({ length: size }, () => zeroVector(size))
  for (let index = 0; index < size; index += 1) {
    const eigenvalue = diagonalized[index]![index]!
    if (Math.abs(eigenvalue) <= epsilon) {
      continue
    }
    const scale = 1 / eigenvalue
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        result[row]![column] +=
          scale * eigenvectors[row]![index]! * eigenvectors[column]![index]!
      }
    }
  }

  return result
}

function solveGaussNewtonLike(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    maxIterations: number
    minLoss: number
    stepSize: number
    damping: number
    pseudoInverseEpsilon: number
  },
) {
  let values = cloneValues(initialValues)
  let state = evaluateLoss(values, constraints)

  for (let iteration = 0; iteration < options.maxIterations && state.loss > options.minLoss; iteration += 1) {
    const jacobian = state.evaluations.map((evaluation) => cloneValues(evaluation.gradient))
    const losses = new Float64Array(state.evaluations.map((evaluation) => evaluation.residual))
    const jT = transpose(jacobian)
    const normal = multiplyMatrices(jT, jacobian)
    const normalWithDamping = addDiagonal(normal, options.damping + options.pseudoInverseEpsilon)
    const rhs = multiplyMatrixVector(jT, losses)
    const delta = multiplyMatrixVector(
      symmetricPseudoInverse(normalWithDamping, options.pseudoInverseEpsilon),
      rhs,
    )

    if (!Array.from(delta).every(Number.isFinite)) {
      break
    }

    let accepted = false
    let stepScale = options.stepSize
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const nextValues = cloneValues(values)
      addScaled(nextValues, -stepScale, delta)
      if (!Array.from(nextValues).every(Number.isFinite)) {
        stepScale *= 0.5
        continue
      }

      const nextState = evaluateLoss(nextValues, constraints)
      if (Number.isFinite(nextState.loss) && nextState.loss <= state.loss) {
        values = nextValues
        state = nextState
        accepted = true
        break
      }
      stepScale *= 0.5
    }

    if (!accepted) {
      break
    }
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint }
}

function buildSolvedEntities(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
): SolvedSketchEntityGeometryRecord[] {
  const solved: SolvedSketchEntityGeometryRecord[] = []
  for (const entity of definition.entities) {
    if (entity.kind === 'point') {
      const point = pointRecords.get(entity.pointId)
      if (point) {
        solved.push({ entityId: entity.entityId, kind: 'point', solvedPosition: getPoint(values, point) })
      }
      continue
    }

    if (entity.kind === 'lineSegment') {
      const start = pointRecords.get(entity.startPointId)
      const end = pointRecords.get(entity.endPointId)
      if (start && end) {
        solved.push({
            entityId: entity.entityId,
            kind: 'lineSegment',
            startPosition: getPoint(values, start),
            endPosition: getPoint(values, end),
          })
      }
      continue
    }

    if (entity.kind === 'circle') {
      const center = pointRecords.get(entity.centerPointId)
      if (center) {
        solved.push({
            entityId: entity.entityId,
            kind: 'circle',
            centerPosition: getPoint(values, center),
            solvedRadius: entity.radius,
          })
      }
      continue
    }

    if (entity.kind === 'spline') {
      const fitPoints = entity.fitPointIds.flatMap((pointId) => {
        const point = pointRecords.get(pointId)
        return point ? [getPoint(values, point)] : []
      })
      if (fitPoints.length === entity.fitPointIds.length && fitPoints.length >= 3) {
        solved.push({
          entityId: entity.entityId,
          kind: 'spline',
          fitPoints,
          degree: entity.degree,
        })
      }
      continue
    }

    if (entity.kind === 'ellipse') {
      const center = pointRecords.get(entity.centerPointId)
      const major = pointRecords.get(entity.majorAxisPointId)
      if (center && major) {
        solved.push({
          entityId: entity.entityId,
          kind: 'ellipse',
          centerPosition: getPoint(values, center),
          majorAxisEndpointPosition: getPoint(values, major),
          minorRadius: entity.minorRadius,
        })
      }
      continue
    }

    if (entity.kind === 'ellipticalArc') {
      const center = pointRecords.get(entity.centerPointId)
      const major = pointRecords.get(entity.majorAxisPointId)
      const start = pointRecords.get(entity.startPointId)
      const end = pointRecords.get(entity.endPointId)
      if (center && major && start && end) {
        solved.push({
          entityId: entity.entityId,
          kind: 'ellipticalArc',
          centerPosition: getPoint(values, center),
          majorAxisEndpointPosition: getPoint(values, major),
          startPosition: getPoint(values, start),
          endPosition: getPoint(values, end),
          minorRadius: entity.minorRadius,
          sweepDirection: entity.sweepDirection,
        })
      }
      continue
    }

    if (entity.kind === 'conic') {
      const start = pointRecords.get(entity.startPointId)
      const control = pointRecords.get(entity.controlPointId)
      const end = pointRecords.get(entity.endPointId)
      if (start && control && end) {
        solved.push({
          entityId: entity.entityId,
          kind: 'conic',
          startPosition: getPoint(values, start),
          controlPosition: getPoint(values, control),
          endPosition: getPoint(values, end),
          rho: entity.rho,
        })
      }
      continue
    }

    if (entity.kind === 'bezierCurve') {
      const controlPoints = entity.controlPointIds.flatMap((pointId) => {
        const point = pointRecords.get(pointId)
        return point ? [getPoint(values, point)] : []
      })
      if (controlPoints.length === entity.controlPointIds.length) {
        solved.push({
          entityId: entity.entityId,
          kind: 'bezierCurve',
          controlPoints,
          degree: entity.degree,
        })
      }
      continue
    }

    if (entity.kind === 'profileText') {
      const anchor = pointRecords.get(entity.anchorPointId)
      if (anchor) {
        solved.push({
          entityId: entity.entityId,
          kind: 'profileText',
          anchorPosition: getPoint(values, anchor),
          text: entity.text,
          height: entity.height,
          rotationRadians: entity.rotationRadians,
          horizontalAlign: entity.horizontalAlign,
          verticalAlign: entity.verticalAlign,
        })
      }
      continue
    }

    const center = pointRecords.get(entity.centerPointId)
    const arcState = entityStates.get(entity.entityId)
    if (!center || !arcState || arcState.kind !== 'arc') {
      continue
    }
    const centerPos = getPoint(values, center)
    const { radius, startAngle, endAngle } = getArcParameters(values, arcState)
    const startPosition = add(centerPos, [radius * Math.cos(startAngle), radius * Math.sin(startAngle)])
    const endPosition = add(centerPos, [radius * Math.cos(endAngle), radius * Math.sin(endAngle)])
    solved.push({
      entityId: entity.entityId,
      kind: 'arc',
      centerPosition: centerPos,
      startPosition,
      endPosition,
      sweepDirection: entity.sweepDirection,
    })
  }
  return solved
}

function buildConstraintStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  values: Float64Array,
  tolerance: SketchSolveTolerancePolicy,
  perConstraint: Map<string, number>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): ConstraintStatusRecord[] {
  const lineEntityMap = new Map(
    definition.entities
      .filter((entity): entity is Extract<SketchEntityDefinition, { kind: 'lineSegment' }> => entity.kind === 'lineSegment')
      .map((entity) => [entity.entityId, entity]),
  )

  return definition.constraints.map((constraint) => {
    let status: ConstraintStatusRecord['status'] = 'satisfied'
    const residual = perConstraint.get(constraint.constraintId) ?? 0

    if (constraint.kind === 'horizontal' || constraint.kind === 'vertical') {
      const entity = lineEntityMap.get(constraint.entityId)
      if (!entity) {
        status = 'conflicting'
      } else {
        const start = pointRecords.get(entity.startPointId)
        const end = pointRecords.get(entity.endPointId)
        if (!start || !end) {
          status = 'conflicting'
        } else {
          const delta = subtract(getPoint(values, end), getPoint(values, start))
          const axisError = constraint.kind === 'horizontal' ? Math.abs(delta[1]) : Math.abs(delta[0])
          status = axisError <= tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        }
      }
    } else if (constraint.kind === 'midpoint') {
      const point = pointRecords.get(constraint.point.pointId)
      const line = lineEntityMap.get(constraint.line.entityId)
      status = point && line ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied' : 'conflicting'
    } else if (constraint.kind === 'midpointProjectedLine') {
      const point = pointRecords.get(constraint.point.pointId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedLine.reference)
      status = point && projected?.kind === 'lineSegment'
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'pointOnCurve') {
      const point = pointRecords.get(constraint.point.pointId)
      const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      status = point && entity && (entity.kind === 'lineSegment' || entity.kind === 'circle' || entity.kind === 'arc' || entity.kind === 'spline')
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'coincidentProjectedPoint') {
      const point = pointRecords.get(constraint.point.pointId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedPoint.reference)
      status = point && projected?.kind === 'point'
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'pointOnProjectedCurve') {
      const point = pointRecords.get(constraint.point.pointId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedCurve.reference)
      status = point && projected !== null
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'parallelProjectedLine' || constraint.kind === 'perpendicularProjectedLine') {
      const line = lineEntityMap.get(constraint.line.entityId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedLine.reference)
      status = line && projected?.kind === 'lineSegment'
        ? residual <= tolerance.angleRadians * tolerance.angleRadians ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'tangentProjectedCurve') {
      const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedCurve.reference)
      status = entity
        && (entity.kind === 'lineSegment' || entity.kind === 'circle' || entity.kind === 'arc')
        && projected
        && projectedCircleLikeGeometry(projected) !== null
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'tangent') {
      const entities = constraint.entityIds.map((entityId) =>
        definition.entities.find((candidate) => candidate.entityId === entityId),
      )
      status = entities.every((entity) => entity && (entity.kind === 'lineSegment' || entity.kind === 'circle' || entity.kind === 'arc'))
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'concentric') {
      const entities = constraint.entityIds.map((entityId) =>
        definition.entities.find((candidate) => candidate.entityId === entityId),
      )
      status = entities.every((entity) => entity && (entity.kind === 'circle' || entity.kind === 'arc'))
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'concentricProjectedCurve') {
      const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedCurve.reference)
      status = entity
        && (entity.kind === 'circle' || entity.kind === 'arc')
        && projected
        && projectedCircleLikeGeometry(projected) !== null
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'normal') {
      const line = lineEntityMap.get(constraint.line.entityId)
      const curve = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
      const point = pointRecords.get(constraint.point.pointId)
      status = line && point && curve && (curve.kind === 'circle' || curve.kind === 'arc')
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'normalProjectedCurve') {
      const line = lineEntityMap.get(constraint.line.entityId)
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedCurve.reference)
      const point = pointRecords.get(constraint.point.pointId)
      status = line && point && projected && projectedCircleLikeGeometry(projected) !== null
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'symmetric') {
      const first = pointRecords.get(constraint.pointIds[0])
      const second = pointRecords.get(constraint.pointIds[1])
      const axis = lineEntityMap.get(constraint.axis.entityId)
      status = first && second && axis
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (constraint.kind === 'symmetricProjectedLine') {
      const first = pointRecords.get(constraint.pointIds[0])
      const second = pointRecords.get(constraint.pointIds[1])
      const projected = findProjectedGeometry(projectedReferences, constraint.projectedLine.reference)
      status = first && second && projected?.kind === 'lineSegment'
        ? residual <= tolerance.coincidence * tolerance.coincidence ? 'satisfied' : 'unsatisfied'
        : 'conflicting'
    } else if (residual > tolerance.coincidence * tolerance.coincidence) {
      status = 'unsatisfied'
    }

    return {
      constraintId: constraint.constraintId,
      status,
    }
  })
}

function buildDimensionStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  perConstraint: Map<string, number>,
): DimensionStatusRecord[] {
  const entityMap = new Map(definition.entities.map((entity) => [entity.entityId, entity]))

  return definition.dimensions.map((dimension) => {
    let solvedValue: number | null = null
    if (dimension.kind === 'distance') {
      const left = pointRecords.get(dimension.pointIds[0])
      const right = pointRecords.get(dimension.pointIds[1])
      if (left && right) {
        const delta =
          dimension.axis === 'aligned'
            ? subtract(getPoint(values, left), getPoint(values, right))
            : subtract(getPoint(values, right), getPoint(values, left))
        solvedValue =
          dimension.axis === 'aligned'
            ? length(delta)
            : dimension.axis === 'horizontal'
              ? delta[0]
              : delta[1]
      }
    } else if (dimension.kind === 'horizontalDistance' || dimension.kind === 'verticalDistance') {
      const left = pointRecords.get(dimension.pointIds[0])
      const right = pointRecords.get(dimension.pointIds[1])
      if (left && right) {
        const delta = subtract(getPoint(values, right), getPoint(values, left))
        solvedValue = dimension.kind === 'horizontalDistance' ? delta[0] : delta[1]
      }
    } else if (dimension.kind === 'circleRadius') {
      const entity = entityMap.get(dimension.entityId)
      solvedValue = entity?.kind === 'circle' ? entity.radius : null
    } else {
      const state = entityStates.get(dimension.entityId)
      solvedValue = state?.kind === 'arc' ? 0 : null
    }

    return {
      dimensionId: dimension.dimensionId,
      status: solvedValue === null || (perConstraint.get(dimension.dimensionId) ?? 0) > 1e-6 ? 'unsatisfied' : 'driving',
      solvedValue,
    }
  })
}

function getLineEntityPoints(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): readonly SketchPointId[] {
  const entity = definition.entities.find((candidate) => candidate.entityId === entityId)

  return entity?.kind === 'lineSegment'
    ? [entity.startPointId, entity.endPointId]
    : []
}

function getEntityPoints(entity: SketchEntityDefinition): readonly SketchPointId[] {
  switch (entity.kind) {
    case 'point':
      return [entity.pointId]
    case 'lineSegment':
      return [entity.startPointId, entity.endPointId]
    case 'circle':
      return [entity.centerPointId]
    case 'arc':
      return [entity.centerPointId, entity.startPointId, entity.endPointId]
    case 'spline':
      return entity.fitPointIds
    case 'ellipse':
      return [entity.centerPointId, entity.majorAxisPointId]
    case 'ellipticalArc':
      return [entity.centerPointId, entity.majorAxisPointId, entity.startPointId, entity.endPointId]
    case 'conic':
      return [entity.startPointId, entity.controlPointId, entity.endPointId]
    case 'bezierCurve':
      return entity.controlPointIds
    case 'profileText':
      return [entity.anchorPointId]
  }
}

function connectPoints(
  graph: Map<SketchPointId, Set<SketchPointId>>,
  pointIds: readonly SketchPointId[],
) {
  for (const pointId of pointIds) {
    if (!graph.has(pointId)) {
      graph.set(pointId, new Set())
    }
  }

  for (const left of pointIds) {
    const leftNeighbors = graph.get(left)!
    for (const right of pointIds) {
      if (left !== right) {
        leftNeighbors.add(right)
      }
    }
  }
}

function collectTranslationComponent(
  definition: SketchDefinition,
  pointId: SketchPointId,
) {
  const graph = new Map<SketchPointId, Set<SketchPointId>>()

  for (const point of definition.points) {
    graph.set(point.pointId, new Set())
  }

  for (const entity of definition.entities) {
    connectPoints(graph, getEntityPoints(entity))
  }

  for (const constraint of definition.constraints) {
    switch (constraint.kind) {
      case 'coincident':
      case 'angle':
        connectPoints(graph, constraint.pointIds)
        break
      case 'horizontal':
      case 'vertical':
        connectPoints(graph, getLineEntityPoints(definition, constraint.entityId))
        break
      case 'parallel':
      case 'perpendicular':
      case 'equalLength':
        connectPoints(
          graph,
          constraint.entityIds.flatMap((entityId) => getLineEntityPoints(definition, entityId)),
        )
        break
      case 'coincidentProjectedPoint':
      case 'pointOnProjectedCurve':
      case 'midpointProjectedLine':
        connectPoints(graph, [constraint.point.pointId])
        break
      case 'midpoint':
        connectPoints(graph, [
          constraint.point.pointId,
          ...getLineEntityPoints(definition, constraint.line.entityId),
        ])
        break
      case 'pointOnCurve':
        {
          const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
          connectPoints(graph, [
            constraint.point.pointId,
            ...(entity ? getEntityPoints(entity) : []),
          ])
        }
        break
      case 'parallelProjectedLine':
      case 'perpendicularProjectedLine':
        connectPoints(graph, getLineEntityPoints(definition, constraint.line.entityId))
        break
      case 'tangentProjectedCurve':
        {
          const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
          connectPoints(graph, entity ? getEntityPoints(entity) : [])
        }
        break
      case 'tangent':
      case 'concentric':
        connectPoints(
          graph,
          constraint.entityIds.flatMap((entityId) => {
            const entity = definition.entities.find((candidate) => candidate.entityId === entityId)
            return entity ? getEntityPoints(entity) : []
          }),
        )
        break
      case 'concentricProjectedCurve':
        {
          const entity = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
          connectPoints(graph, entity ? getEntityPoints(entity) : [])
        }
        break
      case 'normal':
        {
          const line = definition.entities.find((candidate) => candidate.entityId === constraint.line.entityId)
          const curve = definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
          connectPoints(graph, [
            constraint.point.pointId,
            ...(line ? getEntityPoints(line) : []),
            ...(curve ? getEntityPoints(curve) : []),
          ])
        }
        break
      case 'normalProjectedCurve':
        {
          const line = definition.entities.find((candidate) => candidate.entityId === constraint.line.entityId)
          connectPoints(graph, [
            constraint.point.pointId,
            ...(line ? getEntityPoints(line) : []),
          ])
        }
        break
      case 'symmetric':
        {
          const axis = definition.entities.find((candidate) => candidate.entityId === constraint.axis.entityId)
          connectPoints(graph, [
            ...constraint.pointIds,
            ...(axis ? getEntityPoints(axis) : []),
          ])
        }
        break
      case 'symmetricProjectedLine':
        connectPoints(graph, constraint.pointIds)
        break
      case 'fixPoint':
        break
    }
  }

  for (const dimension of definition.dimensions) {
    switch (dimension.kind) {
      case 'distance':
      case 'horizontalDistance':
      case 'verticalDistance':
        connectPoints(graph, dimension.pointIds)
        break
      case 'arcStartPointCoincident':
      case 'arcEndPointCoincident': {
        const arc = definition.entities.find((entity) => entity.entityId === dimension.entityId)
        connectPoints(graph, [
          dimension.pointId,
          ...(arc ? getEntityPoints(arc) : []),
        ])
        break
      }
      case 'circleRadius':
        break
    }
  }

  const visited = new Set<SketchPointId>()
  const stack = [pointId]

  while (stack.length > 0) {
    const current = stack.pop()!

    if (visited.has(current)) {
      continue
    }

    visited.add(current)
    for (const next of graph.get(current) ?? []) {
      stack.push(next)
    }
  }

  return visited
}

function trySolveDraggedPointAsComponentTranslation(input: {
  definition: SketchDefinition
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
  dragTarget: SketchDraggedPointTarget
  tolerances: SketchSolveTolerancePolicy
  partialSolvePolicy: SolverPartialSolvePolicy
  strategy?: SketchSolveStrategy
  targetTolerance: number
}): SketchDraggedPointSolveResult | null {
  const draggedPoint = input.definition.points.find((point) => point.pointId === input.dragTarget.pointId)

  if (!draggedPoint) {
    return null
  }

  const component = collectTranslationComponent(input.definition, input.dragTarget.pointId)

  if (
    input.definition.constraints.some((constraint) =>
      constraint.kind === 'fixPoint' && component.has(constraint.pointId),
    )
  ) {
    return null
  }

  if (
    input.definition.constraints.some((constraint) => {
      if (
        constraint.kind === 'coincidentProjectedPoint'
        || constraint.kind === 'pointOnProjectedCurve'
        || constraint.kind === 'midpointProjectedLine'
        || constraint.kind === 'symmetricProjectedLine'
      ) {
        return constraint.kind === 'symmetricProjectedLine'
          ? constraint.pointIds.some((pointId) => component.has(pointId))
          : component.has(constraint.point.pointId)
      }

      if (constraint.kind === 'parallelProjectedLine' || constraint.kind === 'perpendicularProjectedLine') {
        return getLineEntityPoints(input.definition, constraint.line.entityId).some((pointId) => component.has(pointId))
      }

      if (constraint.kind === 'tangentProjectedCurve' || constraint.kind === 'concentricProjectedCurve') {
        const entity = input.definition.entities.find((candidate) => candidate.entityId === constraint.curve.entityId)
        return entity ? getEntityPoints(entity).some((pointId) => component.has(pointId)) : false
      }

      if (constraint.kind === 'normalProjectedCurve') {
        const line = input.definition.entities.find((candidate) => candidate.entityId === constraint.line.entityId)
        return component.has(constraint.point.pointId) || (line ? getEntityPoints(line).some((pointId) => component.has(pointId)) : false)
      }

      return false
    })
  ) {
    return null
  }

  const delta = subtract(input.dragTarget.position, draggedPoint.position)
  const translatedDefinition: SketchDefinition = {
    ...input.definition,
    points: input.definition.points.map((point) =>
      component.has(point.pointId)
        ? { ...point, position: add(point.position, delta) }
        : point,
    ),
  }
  const solved = solveSketchDefinitionCore({
    definition: translatedDefinition,
    projectedReferences: input.projectedReferences,
    tolerances: input.tolerances,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy: input.strategy,
  })
  const solvedPoint = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === input.dragTarget.pointId)
  const targetDistance = solvedPoint
    ? length(subtract(solvedPoint.solvedPosition, input.dragTarget.position))
    : Number.POSITIVE_INFINITY
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied')
  const dimensionsSatisfied = solved.solvedSnapshot.dimensionStatuses.every((status) => status.status !== 'unsatisfied')

  if (
    solved.status.solveState === 'solved'
    && targetDistance <= input.targetTolerance
    && constraintsSatisfied
    && dimensionsSatisfied
  ) {
    return {
      kind: 'solved',
      solvedSnapshot: solved.solvedSnapshot,
      diagnostics: solved.diagnostics,
    }
  }

  return null
}

export function solveSketchDefinitionCore(input: {
  definition: SketchDefinition
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
  tolerances: SketchSolveTolerancePolicy
  partialSolvePolicy: SolverPartialSolvePolicy
  strategy?: SketchSolveStrategy
}): SketchCoreSolveResult {
  const projectedReferences = input.projectedReferences ?? []
  const validation = validateDefinition(input.definition, input.tolerances, projectedReferences)
  const system = buildSystem(input.definition, { dragTarget: null, projectedReferences })
  const strategy = input.strategy ?? 'bfgs'
  const solved =
    strategy === 'gradientDescent'
      ? solveGradientDescent(system.initialValues, system.scalarConstraints)
      : strategy === 'gaussNewton'
        ? solveGaussNewtonLike(system.initialValues, system.scalarConstraints, {
            maxIterations: 500,
            minLoss: 1e-8,
            stepSize: 1,
            damping: 0,
            pseudoInverseEpsilon: 1e-6,
          })
        : strategy === 'levenbergMarquardt'
          ? solveGaussNewtonLike(system.initialValues, system.scalarConstraints, {
              maxIterations: 1000,
              minLoss: 1e-10,
              stepSize: 0.1,
              damping: 1e-5,
              pseudoInverseEpsilon: 1e-6,
            })
          : solveBfgs(system.initialValues, system.scalarConstraints)

  const diagnostics = [...validation.diagnostics]
  const solvedEntities = buildSolvedEntities(
    input.definition,
    system.pointRecords,
    system.entityStates,
    solved.values,
  )
  const solvedPoints = input.definition.points.flatMap((point) => {
    const record = system.pointRecords.get(point.pointId)
    return record
      ? [{
          pointId: point.pointId,
          target: point.target,
          solvedPosition: getPoint(solved.values, record),
        }]
      : []
  })

  let status: SolvedSketchStatus
  if (!validation.isValid) {
    status = {
      solveState: input.partialSolvePolicy === 'bestEffort' ? 'partiallySolved' : 'failed',
      constraintState: 'inconsistent',
    }
  } else if (system.scalarConstraints.length === 0) {
    status = {
      solveState: input.definition.entities.length === 0 ? 'notEvaluated' : 'solved',
      constraintState: input.definition.entities.length === 0 ? 'unknown' : 'underConstrained',
    }
  } else if (solved.loss < 1e-8) {
    status = {
      solveState: 'solved',
      constraintState: 'wellConstrained',
    }
  } else {
    diagnostics.push(
      makeDiagnostic(
        'solver-residual-too-large',
        'warning',
        `Sketch solve ended with residual ${solved.loss}.`,
        null,
      ),
    )
    status = {
      solveState: input.partialSolvePolicy === 'bestEffort' ? 'partiallySolved' : 'failed',
      constraintState: 'underConstrained',
    }
  }

  const solvedSnapshot: SolvedSketchSnapshot = {
    schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
    status,
    solvedEntities,
    solvedPoints,
    constraintStatuses: buildConstraintStatuses(
      input.definition,
      system.pointRecords,
      solved.values,
      input.tolerances,
      solved.perConstraint,
      projectedReferences,
    ),
    dimensionStatuses: buildDimensionStatuses(
      input.definition,
      system.pointRecords,
      system.entityStates,
      solved.values,
      solved.perConstraint,
    ),
    diagnostics,
  }

  return {
    status,
    solvedSnapshot,
    diagnostics,
  }
}

export function solveSketchDefinitionWithDraggedPointTarget(input: {
  definition: SketchDefinition
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
  dragTarget: SketchDraggedPointTarget
  tolerances: SketchSolveTolerancePolicy
  partialSolvePolicy: SolverPartialSolvePolicy
  strategy?: SketchSolveStrategy
  targetTolerance?: number
}): SketchDraggedPointSolveResult {
  if (!input.definition.points.some((point) => point.pointId === input.dragTarget.pointId)) {
    return {
      kind: 'blocked',
      reason: 'missingPoint',
      solvedSnapshot: null,
      diagnostics: [
        makeDiagnostic(
          'drag-target-missing-point',
          'error',
          `Dragged point ${input.dragTarget.pointId} does not exist in the sketch definition.`,
          { kind: 'point', pointId: input.dragTarget.pointId },
        ),
      ],
    }
  }

  const projectedReferences = input.projectedReferences ?? []
  const validation = validateDefinition(input.definition, input.tolerances, projectedReferences)
  const system = buildSystem(input.definition, { dragTarget: input.dragTarget, projectedReferences })
  const strategy = input.strategy ?? 'bfgs'
  const solved =
    strategy === 'gradientDescent'
      ? solveGradientDescent(system.initialValues, system.scalarConstraints)
      : strategy === 'gaussNewton'
        ? solveGaussNewtonLike(system.initialValues, system.scalarConstraints, {
            maxIterations: 500,
            minLoss: 1e-8,
            stepSize: 1,
            damping: 0,
            pseudoInverseEpsilon: 1e-6,
          })
        : strategy === 'levenbergMarquardt'
          ? solveGaussNewtonLike(system.initialValues, system.scalarConstraints, {
              maxIterations: 1000,
              minLoss: 1e-10,
              stepSize: 0.1,
              damping: 1e-5,
              pseudoInverseEpsilon: 1e-6,
            })
          : solveBfgs(system.initialValues, system.scalarConstraints)

  const diagnostics = [...validation.diagnostics]
  const solvedSnapshot: SolvedSketchSnapshot = {
    schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
    status:
      validation.isValid && solved.loss < 1e-8
        ? {
            solveState: 'solved',
            constraintState: 'wellConstrained',
          }
        : {
            solveState: input.partialSolvePolicy === 'bestEffort' ? 'partiallySolved' : 'failed',
            constraintState: validation.isValid ? 'underConstrained' : 'inconsistent',
          },
    solvedEntities: buildSolvedEntities(
      input.definition,
      system.pointRecords,
      system.entityStates,
      solved.values,
    ),
    solvedPoints: input.definition.points.flatMap((point) => {
      const record = system.pointRecords.get(point.pointId)
      return record
        ? [{
            pointId: point.pointId,
            target: point.target,
            solvedPosition: getPoint(solved.values, record),
          }]
        : []
    }),
    constraintStatuses: buildConstraintStatuses(
      input.definition,
      system.pointRecords,
      solved.values,
      input.tolerances,
      solved.perConstraint,
      projectedReferences,
    ),
    dimensionStatuses: buildDimensionStatuses(
      input.definition,
      system.pointRecords,
      system.entityStates,
      solved.values,
      solved.perConstraint,
    ),
    diagnostics,
  }
  const solvedPoint = solvedSnapshot.solvedPoints.find((point) => point.pointId === input.dragTarget.pointId)
  const targetDistance = solvedPoint
    ? length(subtract(solvedPoint.solvedPosition, input.dragTarget.position))
    : Number.POSITIVE_INFINITY
  const targetTolerance = input.targetTolerance ?? input.tolerances.coincidence
  const constraintsSatisfied = solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied')
  const dimensionsSatisfied = solvedSnapshot.dimensionStatuses.every((status) => status.status !== 'unsatisfied')

  if (
    validation.isValid
    && solved.loss < 1e-8
    && targetDistance <= targetTolerance
    && constraintsSatisfied
    && dimensionsSatisfied
  ) {
    return {
      kind: 'solved',
      solvedSnapshot,
      diagnostics,
    }
  }

  const translated = trySolveDraggedPointAsComponentTranslation({
    definition: input.definition,
    projectedReferences,
    dragTarget: input.dragTarget,
    tolerances: input.tolerances,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy: input.strategy,
    targetTolerance,
  })

  if (translated) {
    return translated
  }

  const reason = solved.loss < 1e-8 ? 'unsatisfied' : 'nonConvergent'
  return {
    kind: 'blocked',
    reason,
    solvedSnapshot,
    diagnostics: [
      ...diagnostics,
      makeDiagnostic(
        'drag-target-unsatisfied',
        'warning',
        'Dragged point target could not be satisfied without violating sketch constraints.',
        { kind: 'point', pointId: input.dragTarget.pointId },
      ),
    ],
  }
}

export function validateSketchDefinitionCore(input: {
  definition: SketchDefinition
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
  tolerances: SketchSolveTolerancePolicy
}): SketchCoreValidationResult {
  return validateDefinition(input.definition, input.tolerances, input.projectedReferences ?? [])
}

export function getSketchSolveInitialValuesForTest(definition: SketchDefinition) {
  return buildSystem(definition).initialValues
}

export function evaluateSketchScalarConstraintForTest(input: {
  definition: SketchDefinition
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
  constraintId: ConstraintId | DimensionId
  values: Float64Array
}): SketchScalarConstraintEvaluationForTest {
  const system = buildSystem(input.definition, { projectedReferences: input.projectedReferences ?? [] })
  const constraint = system.scalarConstraints.find((candidate) => candidate.id === input.constraintId)
  if (!constraint) {
    throw new Error(`Unknown scalar constraint ${input.constraintId}.`)
  }
  const evaluation = constraint.evaluate(input.values)
  return {
    id: constraint.id,
    targetKind: constraint.targetKind,
    residual: evaluation.residual,
    gradient: evaluation.gradient,
  }
}
