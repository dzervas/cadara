import type { PrimitiveRef } from '@/domain/editor/schema'
import type {
  ConstraintDefinition,
  DimensionAnnotationPlacement,
  DimensionLineAnnotationPlacement,
  ProjectedSketchGeometryRef,
  SketchDatumConstraintOperand,
  SketchCurveConstraintOperand,
  SketchPointConstraintOperand,
} from '@/contracts/sketch/schema'
import { distanceBetween, midpoint } from '@/domain/sketch/point-math'
import { createRegistry } from '@/domain/tools/registry-factory'
import type {
  SketchToolDimensionReferenceKind,
  SketchToolOverlayDescriptor,
} from '@/domain/sketch-tools/editor-schema'
import type {
  SketchConstraintDefinition,
  SketchConstraintPreviewInput,
  SketchConstraintTargetRecord,
  SketchConstraintToolId,
} from '@/domain/sketch-constraints/definition'
import {
  resolveCircleTarget,
  resolveCurveTarget,
  resolveLineTarget,
  resolvePointTarget,
} from '@/domain/sketch-constraints/definition'

function formatSelectedLabels(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.map((target) => target.label).join(' / ')
}

function normalize(vector: readonly [number, number]): readonly [number, number] {
  const length = Math.hypot(vector[0], vector[1])

  if (length <= 1e-6) {
    return [1, 0]
  }

  return [vector[0] / length, vector[1] / length]
}

function projectedGeometryKind(kind: NonNullable<SketchConstraintTargetRecord['projected']>['geometry']['kind']): NonNullable<ProjectedSketchGeometryRef['kind']> {
  switch (kind) {
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

function projectedOperand(projected: NonNullable<SketchConstraintTargetRecord['projected']>) {
  return {
    kind: 'projectedGeometry' as const,
    reference: {
      kind: projectedGeometryKind(projected.geometry.kind),
      referenceId: projected.reference.referenceId,
      geometryId: projected.reference.geometryId,
    },
  }
}

function datumOperand(datum: NonNullable<SketchConstraintTargetRecord['datum']>): SketchDatumConstraintOperand {
  return {
    kind: 'sketchDatum',
    datum: datum.reference.datumId,
  }
}

function localPointOperand(target: SketchConstraintTargetRecord) {
  return target.point
    ? {
        kind: 'localPoint' as const,
        pointId: target.point.pointId,
      }
    : null
}

function localCoincidentPointOperand(target: SketchConstraintTargetRecord) {
  if (target.point) {
    return localPointOperand(target)
  }

  if (target.entity?.kind === 'circle' || target.entity?.kind === 'arc') {
    return {
      kind: 'localPoint' as const,
      pointId: target.entity.centerPointId,
    }
  }

  return null
}

function localEntityOperand(target: SketchConstraintTargetRecord) {
  return target.entity
    ? {
        kind: 'localEntity' as const,
        entityId: target.entity.entityId,
      }
    : null
}

type ConstraintTargetResolver = SketchConstraintDefinition['resolveTarget']

function createCompositeResolver(resolvers: readonly ConstraintTargetResolver[]): ConstraintTargetResolver {
  return (definition, target, projectedReferences) => {
    for (const resolver of resolvers) {
      const resolved = resolver(definition, target, projectedReferences)

      if (resolved) {
        return resolved
      }
    }

    return null
  }
}

const resolveCoincidentTarget: ConstraintTargetResolver = (definition, target, projectedReferences) =>
  target.kind === 'projectedReferenceGeometry' || target.kind === 'sketchDatumReference'
    ? createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget, resolveCurveTarget])(
        definition,
        target,
        projectedReferences,
      )
    : createCompositeResolver([resolvePointTarget, resolveCircleTarget])(definition, target, projectedReferences)

const resolvePointOrLineTarget = createCompositeResolver([resolvePointTarget, resolveLineTarget])
const resolvePierceTarget = createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget, resolveCurveTarget])
const resolveNormalTarget = createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget])
const resolveLocalLineTarget: ConstraintTargetResolver = (definition, target) =>
  target.kind === 'projectedReferenceGeometry' || target.kind === 'sketchDatumReference' ? null : resolveLineTarget(definition, target)

const resolveFixTarget: ConstraintTargetResolver = (definition, target) =>
  target.kind === 'projectedReferenceGeometry' || target.kind === 'sketchDatumReference'
    ? null
    : createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget, resolveCurveTarget])(definition, target)

function selectedLocalPoint(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) => target.point) ?? null
}

function selectedLocalLine(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) => target.entity?.kind === 'lineSegment') ?? null
}

function selectedLocalCircleLike(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) => target.entity?.kind === 'circle' || target.entity?.kind === 'arc') ?? null
}

function selectedDatumPoint(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) => target.datum?.reference.datumId === 'origin') ?? null
}

function selectedReferenceLineTarget(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) =>
    target.projected?.geometry.kind === 'lineSegment'
    || target.datum?.reference.datumId === 'xAxis'
    || target.datum?.reference.datumId === 'yAxis',
  ) ?? null
}

function selectedProjectedLine(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) => target.projected?.geometry.kind === 'lineSegment')?.projected ?? null
}

function selectedProjectedCircleLike(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) =>
    target.projected?.geometry.kind === 'circle' || target.projected?.geometry.kind === 'arc',
  )?.projected ?? null
}

function selectedProjectedCurve(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) =>
    target.projected
    && (
      target.projected.geometry.kind === 'lineSegment'
      || target.projected.geometry.kind === 'circle'
      || target.projected.geometry.kind === 'arc'
      || target.projected.geometry.kind === 'spline'
    ),
  )?.projected ?? null
}

function selectedLocalCurve(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.find((target) =>
    target.entity
    && (
      target.entity.kind === 'lineSegment'
      || target.entity.kind === 'circle'
      || target.entity.kind === 'arc'
      || target.entity.kind === 'spline'
    ),
  ) ?? null
}

function singleConstraint(constraint: ConstraintDefinition | null | undefined) {
  return constraint ? { constraints: [constraint] } : {}
}

function createLocalOrProjectedConstraint(input: {
  localBuilder(): ConstraintDefinition | null
  projectedBuilder(): ConstraintDefinition | null
}) {
  return singleConstraint(input.localBuilder() ?? input.projectedBuilder())
}

function buildRelationshipPreview(
  input: SketchConstraintPreviewInput,
  id: string,
  label: string,
  emptyDetail: string,
) {
  return buildSinglePreview(
    id,
    label,
    input.selectedTargets.length > 0 ? formatSelectedLabels(input.selectedTargets) : emptyDetail,
    input,
  )
}

function pointLineDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
) {
  const lengthSquared = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2

  if (lengthSquared <= 1e-6) {
    return distanceBetween(point, start)
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1]))
        / lengthSquared,
    ),
  )

  return distanceBetween(point, [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ])
}

function pointLineSignedDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
) {
  const axis = normalize([end[0] - start[0], end[1] - start[1]])
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  return (point[0] - start[0]) * normal[0] + (point[1] - start[1]) * normal[1]
}

export function selectPointToPointDimensionReference(input: {
  first: readonly [number, number]
  second: readonly [number, number]
  pointer: readonly [number, number] | null
}): Extract<SketchToolDimensionReferenceKind, 'aligned' | 'horizontal' | 'vertical'> {
  if (!input.pointer) {
    return 'aligned'
  }

  const segmentLength = distanceBetween(input.first, input.second)

  if (segmentLength <= 1e-6) {
    return 'aligned'
  }

  const alignedDistance = pointLineDistance(input.pointer, input.first, input.second)

  if (alignedDistance <= Math.max(segmentLength * 0.18, 0.5)) {
    return 'aligned'
  }

  const center = midpoint(input.first, input.second)
  const horizontalIntent = Math.abs(input.pointer[1] - center[1])
  const verticalIntent = Math.abs(input.pointer[0] - center[0])

  if (horizontalIntent >= verticalIntent && Math.abs(input.second[0] - input.first[0]) > 1e-6) {
    return 'horizontal'
  }

  if (Math.abs(input.second[1] - input.first[1]) > 1e-6) {
    return 'vertical'
  }

  return 'aligned'
}

function getPointDimensionReferenceKind(
  input: SketchConstraintPreviewInput,
  fixedReferenceKind?: Extract<SketchToolDimensionReferenceKind, 'horizontal' | 'vertical'>,
) {
  const [first, second] = input.selectedTargets

  if (!first || !second) {
    return fixedReferenceKind ?? 'aligned'
  }

  return fixedReferenceKind ?? selectPointToPointDimensionReference({
    first: first.anchor,
    second: second.anchor,
    pointer: input.pointer,
  })
}

function getDimensionLabel(
  referenceKind: SketchToolDimensionReferenceKind,
  value: number | null,
  unit: string,
) {
  const prefix = {
    aligned: 'Aligned',
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    radius: 'Radius',
    diameter: 'Diameter',
    lineLength: 'Line length',
    lineDistance: 'Line distance',
    pointLineDistance: 'Point-line distance',
  }[referenceKind]

  return value === null ? prefix : `${prefix} ${value.toFixed(2)} ${unit}`
}

function crossProduct(
  first: readonly [number, number],
  second: readonly [number, number],
) {
  return first[0] * second[1] - first[1] * second[0]
}

function lineVector(line: NonNullable<SketchConstraintTargetRecord['line']>) {
  return [line.end[0] - line.start[0], line.end[1] - line.start[1]] as const
}

function areLinesParallel(
  first: NonNullable<SketchConstraintTargetRecord['line']>,
  second: NonNullable<SketchConstraintTargetRecord['line']>,
) {
  const firstVector = lineVector(first)
  const secondVector = lineVector(second)
  return Math.abs(crossProduct(normalize(firstVector), normalize(secondVector))) <= 1e-4
}

function lineIntersection(
  first: NonNullable<SketchConstraintTargetRecord['line']>,
  second: NonNullable<SketchConstraintTargetRecord['line']>,
): readonly [number, number] | null {
  const firstVector = lineVector(first)
  const secondVector = lineVector(second)
  const denominator = crossProduct(firstVector, secondVector)

  if (Math.abs(denominator) <= 1e-9) {
    return null
  }

  const delta: readonly [number, number] = [
    second.start[0] - first.start[0],
    second.start[1] - first.start[1],
  ]
  const t = crossProduct(delta, secondVector) / denominator

  return [
    first.start[0] + firstVector[0] * t,
    first.start[1] + firstVector[1] * t,
  ]
}

function lineDirectionFromCenter(
  line: NonNullable<SketchConstraintTargetRecord['line']>,
  center: readonly [number, number],
  preferredPoint: readonly [number, number],
) {
  const towardPreferred = normalize([
    preferredPoint[0] - center[0],
    preferredPoint[1] - center[1],
  ])
  const lineUnit = normalize(lineVector(line))
  const dot = towardPreferred[0] * lineUnit[0] + towardPreferred[1] * lineUnit[1]

  return dot >= 0 ? lineUnit : [-lineUnit[0], -lineUnit[1]] as const
}

function projectPointOntoLineSegment(
  line: NonNullable<SketchConstraintTargetRecord['line']>,
  point: readonly [number, number],
): readonly [number, number] {
  const vector = lineVector(line)
  const lengthSquared = vector[0] * vector[0] + vector[1] * vector[1]

  if (lengthSquared <= 1e-9) {
    return line.start
  }

  const offset: readonly [number, number] = [point[0] - line.start[0], point[1] - line.start[1]]
  const ratio = Math.max(
    0,
    Math.min(1, (offset[0] * vector[0] + offset[1] * vector[1]) / lengthSquared),
  )

  return [
    line.start[0] + vector[0] * ratio,
    line.start[1] + vector[1] * ratio,
  ]
}

function createAngleWitnessLines(
  id: string,
  first: NonNullable<SketchConstraintTargetRecord['line']>,
  second: NonNullable<SketchConstraintTargetRecord['line']>,
  start: readonly [number, number],
  end: readonly [number, number],
) {
  return [
    createAngleWitnessLine(`${id}-witness-a`, first, start),
    createAngleWitnessLine(`${id}-witness-b`, second, end),
  ].filter((line): line is NonNullable<typeof line> => line !== null)
}

function createAngleWitnessLine(
  id: string,
  line: NonNullable<SketchConstraintTargetRecord['line']>,
  point: readonly [number, number],
) {
  const anchor = projectPointOntoLineSegment(line, point)

  return distanceBetween(anchor, point) <= 1e-6
    ? null
    : {
        id,
        label: 'Witness',
        start: anchor,
        end: point,
      }
}

function normalizeSignedAngleDelta(delta: number) {
  if (delta > Math.PI) {
    return delta - Math.PI * 2
  }

  if (delta < -Math.PI) {
    return delta + Math.PI * 2
  }

  return delta
}

function normalizePositiveAngleDelta(delta: number) {
  const normalized = delta % (Math.PI * 2)
  return normalized < 0 ? normalized + Math.PI * 2 : normalized
}

function getAngleArcSide(input: {
  center: readonly [number, number]
  startVector: readonly [number, number]
  endVector: readonly [number, number]
  point: readonly [number, number] | null
}): 'minor' | 'major' {
  if (!input.point) {
    return 'minor'
  }

  const startAngle = Math.atan2(input.startVector[1], input.startVector[0])
  const endAngle = Math.atan2(input.endVector[1], input.endVector[0])
  const pointAngle = Math.atan2(input.point[1] - input.center[1], input.point[0] - input.center[0])
  const minorDelta = normalizeSignedAngleDelta(endAngle - startAngle)
  const minorSweep = Math.abs(minorDelta)

  if (minorSweep <= 1e-9) {
    return 'minor'
  }

  const pointSweep = minorDelta >= 0
    ? normalizePositiveAngleDelta(pointAngle - startAngle)
    : normalizePositiveAngleDelta(startAngle - pointAngle)

  return pointSweep <= minorSweep ? 'minor' : 'major'
}

function lineDimensionOperand(target: SketchConstraintTargetRecord): SketchCurveConstraintOperand | null {
  if (target.entity?.kind === 'lineSegment') {
    return {
      kind: 'localEntity',
      entityId: target.entity.entityId,
    }
  }

  if (target.projected?.geometry.kind === 'lineSegment') {
    return projectedOperand(target.projected)
  }

  if (target.datum && target.datum.reference.geometryKind === 'lineSegment') {
    return datumOperand(target.datum)
  }

  return null
}

function pointDimensionOperand(target: SketchConstraintTargetRecord): SketchPointConstraintOperand | null {
  if (target.point) {
    return {
      kind: 'localPoint',
      pointId: target.point.pointId,
    }
  }

  if (target.projected?.geometry.kind === 'point') {
    return projectedOperand(target.projected)
  }

  if (target.datum?.reference.datumId === 'origin') {
    return datumOperand(target.datum)
  }

  return null
}

function getLineDimensionPlacement(
  line: NonNullable<SketchConstraintTargetRecord['line']>,
  point: readonly [number, number] | null,
): DimensionLineAnnotationPlacement | undefined {
  if (!point) {
    return undefined
  }

  const axis = normalize(lineVector(line))
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  return {
    kind: 'dimensionLine',
    offset: (point[0] - line.start[0]) * normal[0] + (point[1] - line.start[1]) * normal[1],
  }
}

type DimensionDistanceIntent =
  | { kind: 'diameter'; valueSpec: { label: 'Diameter'; unit: 'mm'; min: 0.01; defaultValue: 10 } }
  | { kind: 'lineLength'; valueSpec: { label: 'Length'; unit: 'mm'; min: 0.01; defaultValue: 10 } }
  | { kind: 'lineDistance'; valueSpec: { label: 'Distance'; unit: 'mm'; min: 0.01; defaultValue: 10 } }
  | { kind: 'linePointDistance'; valueSpec: { label: 'Distance'; unit: 'mm'; min: 0.01; defaultValue: 10 } }
  | { kind: 'lineAngle'; valueSpec: { label: 'Angle'; unit: 'deg'; min: 0.1; defaultValue: 90 } }
  | { kind: 'pointDistance'; valueSpec: { label: 'Distance'; unit: 'mm'; min: 0.01; defaultValue: 10 } }

function getDimensionDistanceIntent(
  selectedTargets: readonly SketchConstraintTargetRecord[],
): DimensionDistanceIntent | null {
  const [first, second] = selectedTargets

  if (!first) {
    return null
  }

  if (first.circle && !second) {
    return { kind: 'diameter', valueSpec: { label: 'Diameter', unit: 'mm', min: 0.01, defaultValue: 10 } }
  }

  if (first.entity?.kind === 'lineSegment' && !second) {
    return { kind: 'lineLength', valueSpec: { label: 'Length', unit: 'mm', min: 0.01, defaultValue: 10 } }
  }

  if (!second) {
    return null
  }

  if (first.line && second.line) {
    return areLinesParallel(first.line, second.line)
      ? { kind: 'lineDistance', valueSpec: { label: 'Distance', unit: 'mm', min: 0.01, defaultValue: 10 } }
      : { kind: 'lineAngle', valueSpec: { label: 'Angle', unit: 'deg', min: 0.1, defaultValue: 90 } }
  }

  if ((first.line && !second.line) || (!first.line && second.line)) {
    return { kind: 'linePointDistance', valueSpec: { label: 'Distance', unit: 'mm', min: 0.01, defaultValue: 10 } }
  }

  if (
    (first.point || first.datum?.reference.datumId === 'origin')
    && (second.point || second.datum?.reference.datumId === 'origin')
  ) {
    return { kind: 'pointDistance', valueSpec: { label: 'Distance', unit: 'mm', min: 0.01, defaultValue: 10 } }
  }

  return null
}

function getPointPairDimensionPlacement(input: {
  first: readonly [number, number]
  second: readonly [number, number]
  pointer: readonly [number, number] | null
  referenceKind: Extract<SketchToolDimensionReferenceKind, 'aligned' | 'horizontal' | 'vertical'>
}): DimensionLineAnnotationPlacement | undefined {
  if (!input.pointer) {
    return undefined
  }

  if (input.referenceKind === 'horizontal') {
    return { kind: 'dimensionLine', offset: input.pointer[1] - input.first[1] }
  }

  if (input.referenceKind === 'vertical') {
    return { kind: 'dimensionLine', offset: input.pointer[0] - input.first[0] }
  }

  const axis = normalize([input.second[0] - input.first[0], input.second[1] - input.first[1]])
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  return {
    kind: 'dimensionLine',
    offset: (input.pointer[0] - input.first[0]) * normal[0] + (input.pointer[1] - input.first[1]) * normal[1],
  }
}

export function inferDimensionAnnotationPlacement(
  selectedTargets: readonly SketchConstraintTargetRecord[],
  point: readonly [number, number] | null,
): DimensionAnnotationPlacement | null {
  const [first, second] = selectedTargets

  if (first?.circle && !second) {
    const direction = point
      ? [point[0] - first.circle.center[0], point[1] - first.circle.center[1]] as const
      : [1, 0] as const
    return {
      kind: 'dimensionLine',
      offset: 0,
      angleRadians: Math.atan2(direction[1], direction[0]),
    }
  }

  if (first?.line && !second) {
    return getLineDimensionPlacement(first.line, point) ?? null
  }

  if (first?.line && second?.line && !areLinesParallel(first.line, second.line)) {
    const center = lineIntersection(first.line, second.line) ?? first.anchor
    const firstVector = lineDirectionFromCenter(first.line, center, first.anchor)
    const secondVector = lineDirectionFromCenter(second.line, center, second.anchor)
    return {
      kind: 'angleArc',
      radius: Math.max(0.1, point ? distanceBetween(center, point) : 1),
      side: getAngleArcSide({
        center,
        startVector: firstVector,
        endVector: secondVector,
        point,
      }),
    }
  }

  if (first?.line) {
    return getLineDimensionPlacement(first.line, point) ?? null
  }

  if (second?.line) {
    return getLineDimensionPlacement(second.line, point) ?? null
  }

  if (first && second) {
    const referenceKind = selectPointToPointDimensionReference({
      first: first.anchor,
      second: second.anchor,
      pointer: point,
    })
    return getPointPairDimensionPlacement({
      first: first.anchor,
      second: second.anchor,
      pointer: point,
      referenceKind,
    }) ?? null
  }

  return null
}

function buildPointDimensionDescriptor(input: {
  id: string
  label: string
  first: readonly [number, number]
  second: readonly [number, number]
  pointer: readonly [number, number] | null
  referenceKind: Extract<SketchToolDimensionReferenceKind, 'aligned' | 'horizontal' | 'vertical'>
  value: number | null
  unit: string
  placement?: DimensionLineAnnotationPlacement | null
}): SketchToolOverlayDescriptor {
  if (input.referenceKind === 'horizontal') {
    const y = input.placement?.kind === 'dimensionLine'
      ? input.first[1] + input.placement.offset
      : input.pointer?.[1] ?? input.first[1] - 1
    const start: readonly [number, number] = [input.first[0], y]
    const end: readonly [number, number] = [input.second[0], y]

    return {
      id: input.id,
      kind: 'dimensionLine',
      label: input.label,
      referenceKind: 'horizontal',
      start,
      end,
      value: input.value,
      unit: input.unit,
      dragHandle: { id: `${input.id}-drag`, kind: 'dimensionLine' },
      labelAnchor: {
        kind: 'sketchPoint',
        point: midpoint(start, end),
        offset: { x: 0, y: -18 },
      },
      extensionLines: [
        { id: `${input.id}-extension-a`, label: 'Extension', start: input.first, end: start },
        { id: `${input.id}-extension-b`, label: 'Extension', start: input.second, end },
      ],
    }
  }

  if (input.referenceKind === 'vertical') {
    const x = input.placement?.kind === 'dimensionLine'
      ? input.first[0] + input.placement.offset
      : input.pointer?.[0] ?? input.first[0] + 1
    const start: readonly [number, number] = [x, input.first[1]]
    const end: readonly [number, number] = [x, input.second[1]]

    return {
      id: input.id,
      kind: 'dimensionLine',
      label: input.label,
      referenceKind: 'vertical',
      start,
      end,
      value: input.value,
      unit: input.unit,
      dragHandle: { id: `${input.id}-drag`, kind: 'dimensionLine' },
      labelAnchor: {
        kind: 'sketchPoint',
        point: midpoint(start, end),
        offset: { x: 16, y: 0 },
      },
      extensionLines: [
        { id: `${input.id}-extension-a`, label: 'Extension', start: input.first, end: start },
        { id: `${input.id}-extension-b`, label: 'Extension', start: input.second, end },
      ],
    }
  }

  const axis = normalize([input.second[0] - input.first[0], input.second[1] - input.first[1]])
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  const pointerOffset = input.placement?.kind === 'dimensionLine'
    ? input.placement.offset
    : input.pointer
    ? (input.pointer[0] - input.first[0]) * normal[0] + (input.pointer[1] - input.first[1]) * normal[1]
    : 0
  const offset: readonly [number, number] = [normal[0] * pointerOffset, normal[1] * pointerOffset]
  const start: readonly [number, number] = [input.first[0] + offset[0], input.first[1] + offset[1]]
  const end: readonly [number, number] = [input.second[0] + offset[0], input.second[1] + offset[1]]

  return {
    id: input.id,
    kind: 'dimensionLine',
    label: input.label,
    referenceKind: 'aligned',
    start,
    end,
    value: input.value,
    unit: input.unit,
    dragHandle: { id: `${input.id}-drag`, kind: 'dimensionLine' },
    labelAnchor: {
      kind: 'sketchPoint',
      point: midpoint(start, end),
      offset: { x: 0, y: -18 },
    },
    extensionLines: pointerOffset === 0
      ? []
      : [
          { id: `${input.id}-extension-a`, label: 'Extension', start: input.first, end: start },
          { id: `${input.id}-extension-b`, label: 'Extension', start: input.second, end },
        ],
  }
}

function buildPointDimensionPreview(
  input: SketchConstraintPreviewInput,
  options: {
    id: string
    unit: string
    fixedReferenceKind?: Extract<SketchToolDimensionReferenceKind, 'horizontal' | 'vertical'>
  },
): readonly SketchToolOverlayDescriptor[] {
  const first = input.selectedTargets[0]?.anchor
  const second = input.selectedTargets[1]?.anchor ?? input.hoverTarget?.anchor ?? input.pointer

  if (!first || !second) {
    return buildSinglePreview(options.id, 'Dimension preview', 'Select two points', input)
  }

  const referenceKind = getPointDimensionReferenceKind(input, options.fixedReferenceKind)

  return [
    buildPointDimensionDescriptor({
      id: options.id,
      label: getDimensionLabel(referenceKind, input.value, options.unit),
      first,
      second,
      pointer: input.pointer,
      referenceKind,
      value: input.value,
      unit: options.unit,
      placement: input.annotationPlacement?.kind === 'dimensionLine'
        ? input.annotationPlacement
        : undefined,
    }),
  ]
}

function buildLineAnglePreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const first = input.selectedTargets[0]
  const second = input.selectedTargets[1] ?? input.hoverTarget

  if (!first?.line || !second?.line) {
    return buildSinglePreview(
      'parallel-preview',
      'Parallel preview',
      input.selectedTargets.length >= 2 ? formatSelectedLabels(input.selectedTargets) : 'Select two lines',
      input,
    )
  }

  const center = lineIntersection(first.line, second.line) ?? first.anchor
  const firstVector = lineDirectionFromCenter(first.line, center, first.anchor)
  const secondVector = lineDirectionFromCenter(second.line, center, second.anchor)
  const radius = input.annotationPlacement?.kind === 'angleArc'
    ? input.annotationPlacement.radius
    : Math.max(
        0.75,
        Math.min(distanceBetween(first.line.start, first.line.end), distanceBetween(second.line.start, second.line.end)) * 0.22,
      )
  const side = input.annotationPlacement?.kind === 'angleArc'
    ? input.annotationPlacement.side
    : 'minor'
  const start: readonly [number, number] = [
    center[0] + firstVector[0] * radius,
    center[1] + firstVector[1] * radius,
  ]
  const end: readonly [number, number] = [
    center[0] + secondVector[0] * radius,
    center[1] + secondVector[1] * radius,
  ]
  const labelDirection = normalize(
    side === 'major'
      ? [-(firstVector[0] + secondVector[0]), -(firstVector[1] + secondVector[1])]
      : [firstVector[0] + secondVector[0], firstVector[1] + secondVector[1]],
  )
  const labelPoint: readonly [number, number] = [
    center[0] + labelDirection[0] * radius,
    center[1] + labelDirection[1] * radius,
  ]

  return [
    {
      id: 'parallel-angle-preview',
      kind: 'angleArc',
      label: 'Angle preview',
      center,
      start,
      end,
      radius,
      side,
      witnessLines: createAngleWitnessLines('parallel-angle-preview', first.line, second.line, start, end),
      labelAnchor: {
        kind: 'sketchPoint',
        point: labelPoint,
        offset: { x: 12, y: -12 },
      },
      dragHandle: { id: 'parallel-angle-preview-drag', kind: 'angleArc' },
      referenceLabel: formatSelectedLabels([first, second]),
    },
  ]
}

function buildLineDistancePreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const first = input.selectedTargets[0]
  const second = input.selectedTargets[1] ?? input.hoverTarget

  if (!first?.line || !second?.line) {
    return buildSinglePreview('line-distance-preview', 'Line distance preview', 'Select two parallel lines', input)
  }

  const placement = input.annotationPlacement?.kind === 'dimensionLine'
    ? input.annotationPlacement
    : getLineDimensionPlacement(first.line, input.pointer)
  const axis = normalize(lineVector(first.line))
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  const offset = placement?.offset ?? pointLineSignedDistance(second.anchor, first.line.start, first.line.end)
  const start: readonly [number, number] = [
    first.anchor[0] + normal[0] * offset,
    first.anchor[1] + normal[1] * offset,
  ]
  const end: readonly [number, number] = [
    second.anchor[0] + normal[0] * offset,
    second.anchor[1] + normal[1] * offset,
  ]

  return [
    {
      id: 'line-distance-preview',
      kind: 'dimensionLine',
      label: getDimensionLabel('lineDistance', input.value, 'mm'),
      referenceKind: 'lineDistance',
      start,
      end,
      value: input.value,
      unit: 'mm',
      dragHandle: { id: 'line-distance-preview-drag', kind: 'dimensionLine' },
      labelAnchor: {
        kind: 'sketchPoint',
        point: midpoint(start, end),
        offset: { x: 0, y: -18 },
      },
      extensionLines: [
        { id: 'line-distance-preview-extension-a', label: 'Extension', start: first.anchor, end: start },
        { id: 'line-distance-preview-extension-b', label: 'Extension', start: second.anchor, end },
      ],
    },
  ]
}

function buildLineLengthPreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const target = input.selectedTargets[0] ?? input.hoverTarget

  if (!target?.line) {
    return buildSinglePreview('line-length-preview', 'Line length preview', 'Select one line', input)
  }

  const placement = input.annotationPlacement?.kind === 'dimensionLine'
    ? input.annotationPlacement
    : getLineDimensionPlacement(target.line, input.pointer)
  const axis = normalize(lineVector(target.line))
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  const offset = placement?.offset ?? 0
  const start: readonly [number, number] = [
    target.line.start[0] + normal[0] * offset,
    target.line.start[1] + normal[1] * offset,
  ]
  const end: readonly [number, number] = [
    target.line.end[0] + normal[0] * offset,
    target.line.end[1] + normal[1] * offset,
  ]

  return [
    {
      id: 'line-length-preview',
      kind: 'dimensionLine',
      label: getDimensionLabel('lineLength', input.value, 'mm'),
      referenceKind: 'lineLength',
      start,
      end,
      value: input.value,
      unit: 'mm',
      dragHandle: { id: 'line-length-preview-drag', kind: 'dimensionLine' },
      labelAnchor: {
        kind: 'sketchPoint',
        point: midpoint(start, end),
        offset: { x: 0, y: -18 },
      },
      extensionLines: offset === 0
        ? []
        : [
            { id: 'line-length-preview-extension-a', label: 'Extension', start: target.line.start, end: start },
            { id: 'line-length-preview-extension-b', label: 'Extension', start: target.line.end, end },
          ],
    },
  ]
}

function buildLinePointDistancePreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const first = input.selectedTargets[0]
  const second = input.selectedTargets[1] ?? input.hoverTarget
  const lineTarget = first?.line ? first : second?.line ? second : null
  const pointTarget = first && !first.line ? first : second && !second.line ? second : null

  if (!lineTarget?.line || !pointTarget) {
    return buildSinglePreview('line-point-distance-preview', 'Point-line preview', 'Select a line and a point', input)
  }

  const axis = normalize(lineVector(lineTarget.line))
  const normal: readonly [number, number] = [-axis[1], axis[0]]
  const signedDistance = pointLineSignedDistance(pointTarget.anchor, lineTarget.line.start, lineTarget.line.end)
  const placement = input.annotationPlacement?.kind === 'dimensionLine'
    ? input.annotationPlacement
    : getLineDimensionPlacement(lineTarget.line, input.pointer)
  const offset = placement?.offset ?? signedDistance
  const projectedPoint: readonly [number, number] = [
    pointTarget.anchor[0] - normal[0] * signedDistance,
    pointTarget.anchor[1] - normal[1] * signedDistance,
  ]
  const start: readonly [number, number] = [
    projectedPoint[0] + normal[0] * offset,
    projectedPoint[1] + normal[1] * offset,
  ]
  const end: readonly [number, number] = [
    pointTarget.anchor[0] + normal[0] * (offset - signedDistance),
    pointTarget.anchor[1] + normal[1] * (offset - signedDistance),
  ]

  return [
    {
      id: 'line-point-distance-preview',
      kind: 'dimensionLine',
      label: getDimensionLabel('pointLineDistance', input.value, 'mm'),
      referenceKind: 'pointLineDistance',
      start,
      end,
      value: input.value,
      unit: 'mm',
      dragHandle: { id: 'line-point-distance-preview-drag', kind: 'dimensionLine' },
      labelAnchor: {
        kind: 'sketchPoint',
        point: midpoint(start, end),
        offset: { x: 0, y: -18 },
      },
      extensionLines: [
        { id: 'line-point-distance-preview-extension-a', label: 'Extension', start: projectedPoint, end: start },
        { id: 'line-point-distance-preview-extension-b', label: 'Extension', start: pointTarget.anchor, end },
      ],
    },
  ]
}

function buildRadiusPreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const target = input.selectedTargets[0]

  if (!target?.circle) {
    return buildSinglePreview('radius-preview', 'Radius preview', 'Select one circle', input)
  }

  const direction = normalize(input.pointer
    ? [input.pointer[0] - target.circle.center[0], input.pointer[1] - target.circle.center[1]]
    : [1, 0])
  const end: readonly [number, number] = [
    target.circle.center[0] + direction[0] * target.circle.radius,
    target.circle.center[1] + direction[1] * target.circle.radius,
  ]

  return [
    {
      id: 'radius-preview',
      kind: 'dimensionLine',
      label: getDimensionLabel('radius', input.value, 'mm'),
      referenceKind: 'radius',
      start: target.circle.center,
      end,
      value: input.value,
      unit: 'mm',
      labelAnchor: {
        kind: 'sketchPoint',
        point: end,
        offset: { x: 16, y: -16 },
      },
      dragHandle: { id: 'radius-preview-drag', kind: 'dimensionLine' },
    },
  ]
}

function buildDiameterPreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const target = input.selectedTargets[0] ?? input.hoverTarget

  if (!target?.circle) {
    return buildSinglePreview('diameter-preview', 'Diameter preview', 'Select one circle or arc', input)
  }

  const placement = input.annotationPlacement?.kind === 'dimensionLine'
    ? input.annotationPlacement
    : inferDimensionAnnotationPlacement([target], input.pointer)
  const angle = placement?.kind === 'dimensionLine' && placement.angleRadians !== undefined
    ? placement.angleRadians
    : Math.atan2(
        (input.pointer?.[1] ?? target.circle.center[1]) - target.circle.center[1],
        (input.pointer?.[0] ?? target.circle.center[0] + 1) - target.circle.center[0],
      )
  const direction: readonly [number, number] = [Math.cos(angle), Math.sin(angle)]
  const start: readonly [number, number] = [
    target.circle.center[0] - direction[0] * target.circle.radius,
    target.circle.center[1] - direction[1] * target.circle.radius,
  ]
  const end: readonly [number, number] = [
    target.circle.center[0] + direction[0] * target.circle.radius,
    target.circle.center[1] + direction[1] * target.circle.radius,
  ]

  return [
    {
      id: 'diameter-preview',
      kind: 'dimensionLine',
      label: getDimensionLabel('diameter', input.value, 'mm'),
      referenceKind: 'diameter',
      start,
      end,
      value: input.value,
      unit: 'mm',
      dragHandle: { id: 'diameter-preview-drag', kind: 'dimensionLine' },
      labelAnchor: {
        kind: 'sketchPoint',
        point: end,
        offset: { x: 16, y: -16 },
      },
    },
  ]
}

function buildExpandedDimensionPreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[] {
  const first = input.selectedTargets[0]
  const second = input.selectedTargets[1] ?? input.hoverTarget

  if (first?.circle && !second) {
    return buildDiameterPreview(input)
  }

  if (first?.line && !second) {
    return buildLineLengthPreview(input)
  }

  if (first?.line && second?.line) {
    return areLinesParallel(first.line, second.line)
      ? buildLineDistancePreview(input)
      : buildLineAnglePreview(input)
  }

  if ((first?.line && second && !second.line) || (first && !first.line && second?.line)) {
    return buildLinePointDistancePreview(input)
  }

  return buildPointDimensionPreview(input, { id: 'distance-preview', unit: 'mm' })
}

function buildSinglePreview(
  id: string,
  label: string,
  detail: string,
  input: SketchConstraintPreviewInput,
) {
  const anchor =
    input.pointer
    ?? input.hoverTarget?.anchor
    ?? input.selectedTargets[input.selectedTargets.length - 1]?.anchor
    ?? [0, 0]

  return [
    {
      id,
      kind: 'constraintPreview' as const,
      label,
      detail,
      anchor: { kind: 'sketchPoint' as const, point: anchor },
    },
  ]
}

const sketchConstraintDefinitions = [
  {
    metadata: {
      id: 'constraintCoincident',
      name: 'Coincident',
      tooltip: 'Constrain two sketch points to the same position.',
      icon: 'constraintCoincident',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'point-a', label: 'Select first coincident target', acceptedKinds: ['point', 'line', 'circle', 'spline'] },
      { id: 'point-b', label: 'Select second coincident target', acceptedKinds: ['point', 'line', 'circle', 'spline'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolveCoincidentTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildSinglePreview(
        'coincident-preview',
        'Coincident preview',
        input.selectedTargets.length >= 2
          ? formatSelectedLabels(input.selectedTargets)
          : input.hoverTarget
            ? `Hover ${input.hoverTarget.label}`
            : 'Select a local point and coincident target',
        input,
      )
    },
    createCommitContribution(input) {
      const [left, right] = input.selectedTargets

      if (!left || !right) {
        return {}
      }

      if (left.point && right.point) {
        return {
          constraints: [
            {
              constraintId: input.createConstraintId('coincident'),
              kind: 'coincident',
              label: `Coincident ${input.sequence}`,
              pointIds: [left.point.pointId, right.point.pointId],
            },
          ],
        }
      }

      const local = localCoincidentPointOperand(left)
        ? left
        : localCoincidentPointOperand(right)
          ? right
          : null
      const referenceTarget = left.projected || left.datum
        ? left
        : right.projected || right.datum
          ? right
          : null
      const point = local ? localCoincidentPointOperand(local) : null

      if (!point || !referenceTarget) {
        return {}
      }

      if (
        referenceTarget.datum?.reference.geometryKind === 'lineSegment'
        || referenceTarget.projected?.geometry.kind === 'lineSegment'
        || referenceTarget.projected?.geometry.kind === 'circle'
        || referenceTarget.projected?.geometry.kind === 'arc'
        || referenceTarget.projected?.geometry.kind === 'spline'
      ) {
        const projectedCurve = referenceTarget.projected
          ? projectedOperand(referenceTarget.projected)
          : referenceTarget.datum
            ? datumOperand(referenceTarget.datum)
            : null

        return {
          constraints: projectedCurve
            ? [{
                constraintId: input.createConstraintId('point-on-projected-curve'),
                kind: 'pointOnProjectedCurve',
                label: `Coincident ${input.sequence}`,
                point,
                projectedCurve,
              }]
            : [],
        }
      }

      const projectedPoint = referenceTarget.projected
        ? projectedOperand(referenceTarget.projected)
        : referenceTarget.datum
          ? datumOperand(referenceTarget.datum)
          : null

      return {
        constraints: projectedPoint
          ? [{
              constraintId: input.createConstraintId('coincident-projected-point'),
              kind: 'coincidentProjectedPoint',
              label: `Coincident ${input.sequence}`,
              point,
              projectedPoint,
            }]
          : [],
      }
    },
  },
  {
    metadata: {
      id: 'constraintParallel',
      name: 'Parallel',
      tooltip: 'Constrain two lines to remain parallel.',
      icon: 'constraintParallel',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'line-a', label: 'Select first line', acceptedKinds: ['line'] },
      { id: 'line-b', label: 'Select second line', acceptedKinds: ['line'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolveLineTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildLineAnglePreview(input)
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first || !second) {
        return {}
      }

      const local = first.entity ? first : second.entity ? second : null
      const referenceLineTarget = selectedReferenceLineTarget(input.selectedTargets)

      return createLocalOrProjectedConstraint({
        localBuilder: () => first.entity && second.entity
          ? {
              constraintId: input.createConstraintId('parallel'),
              kind: 'parallel',
              label: `Parallel ${input.sequence}`,
              entityIds: [first.entity.entityId, second.entity.entityId],
            }
          : null,
        projectedBuilder: () => {
          const line = local ? localEntityOperand(local) : null

          return line && referenceLineTarget
            ? {
                constraintId: input.createConstraintId('parallel-projected-line'),
                kind: 'parallelProjectedLine',
                label: `Parallel ${input.sequence}`,
                line,
                projectedLine: lineDimensionOperand(referenceLineTarget)!,
              }
            : null
        },
      })
    },
  },
  {
    metadata: {
      id: 'constraintPerpendicular',
      name: 'Perpendicular',
      tooltip: 'Constrain two lines to remain perpendicular.',
      icon: 'constraintPerpendicular',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'line-a', label: 'Select first line', acceptedKinds: ['line'] },
      { id: 'line-b', label: 'Select second line', acceptedKinds: ['line'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolveLineTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildLineAnglePreview(input)
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first || !second) {
        return {}
      }

      const local = first.entity ? first : second.entity ? second : null
      const referenceLineTarget = selectedReferenceLineTarget(input.selectedTargets)

      return createLocalOrProjectedConstraint({
        localBuilder: () => first.entity && second.entity
          ? {
              constraintId: input.createConstraintId('perpendicular'),
              kind: 'perpendicular',
              label: `Perpendicular ${input.sequence}`,
              entityIds: [first.entity.entityId, second.entity.entityId],
            }
          : null,
        projectedBuilder: () => {
          const line = local ? localEntityOperand(local) : null

          return line && referenceLineTarget
            ? {
                constraintId: input.createConstraintId('perpendicular-projected-line'),
                kind: 'perpendicularProjectedLine',
                label: `Perpendicular ${input.sequence}`,
                line,
                projectedLine: lineDimensionOperand(referenceLineTarget)!,
              }
            : null
        },
      })
    },
  },
  {
    metadata: {
      id: 'constraintTangent',
      name: 'Tangent',
      tooltip: 'Constrain local curves tangent to projected circles or arcs.',
      icon: 'constraintTangent',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'curve-a', label: 'Select local curve', acceptedKinds: ['line', 'circle'] },
      { id: 'curve-b', label: 'Select projected circle or arc', acceptedKinds: ['circle'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolveCircleTarget(definition, target, projectedReferences)
        ?? resolveLineTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildSinglePreview(
        'tangent-preview',
        'Tangent preview',
        input.selectedTargets.length >= 2
          ? formatSelectedLabels(input.selectedTargets)
          : 'Select a local curve and projected circle',
        input,
      )
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first || !second) {
        return {}
      }

      const local = first.entity ? first : second.entity ? second : null
      const projected = first.projected && (first.projected.geometry.kind === 'circle' || first.projected.geometry.kind === 'arc')
        ? first.projected
        : second.projected && (second.projected.geometry.kind === 'circle' || second.projected.geometry.kind === 'arc')
          ? second.projected
          : null
      const curve = local ? localEntityOperand(local) : null

      if (!curve || !projected) {
        return {}
      }

      return {
        constraints: [
          {
            constraintId: input.createConstraintId('tangent-projected-curve'),
            kind: 'tangentProjectedCurve',
            label: `Tangent ${input.sequence}`,
            curve,
            projectedCurve: projectedOperand(projected),
            relation: 'external',
          },
        ],
      }
    },
  },
  {
    metadata: {
      id: 'constraintEqual',
      name: 'Equal',
      tooltip: 'Constrain two lines to equal length.',
      icon: 'constraintEqual',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'equal-a', label: 'Select first line', acceptedKinds: ['line'] },
      { id: 'equal-b', label: 'Select second line', acceptedKinds: ['line'] },
    ],
    resolveTarget(definition, target) {
      return resolveLineTarget(definition, target)
    },
    buildPreview(input) {
      return buildSinglePreview(
        'equal-preview',
        'Equal-length preview',
        input.selectedTargets.length >= 2
          ? formatSelectedLabels(input.selectedTargets)
          : 'Select two lines',
        input,
      )
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first?.entity || !second?.entity) {
        return {}
      }

      return {
        constraints: [
          {
            constraintId: input.createConstraintId('equal'),
            kind: 'equalLength',
            label: `Equal ${input.sequence}`,
            entityIds: [first.entity.entityId, second.entity.entityId],
          },
        ],
      }
    },
  },
  {
    metadata: {
      id: 'constraintHorizontal',
      name: 'Horizontal',
      tooltip: 'Constrain a line parallel to the sketch horizontal axis.',
      icon: 'constraintHorizontal',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [{ id: 'horizontal-line', label: 'Select line', acceptedKinds: ['line'] }],
    resolveTarget(definition, target) {
      return resolveLocalLineTarget(definition, target)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'horizontal-preview', 'Horizontal preview', 'Select a local line')
    },
    createCommitContribution(input) {
      const line = selectedLocalLine(input.selectedTargets)

      return line?.entity
        ? {
            constraints: [{
              constraintId: input.createConstraintId('horizontal'),
              kind: 'horizontal',
              label: `Horizontal ${input.sequence}`,
              entityId: line.entity.entityId,
            }],
          }
        : {}
    },
  },
  {
    metadata: {
      id: 'constraintVertical',
      name: 'Vertical',
      tooltip: 'Constrain a line parallel to the sketch vertical axis.',
      icon: 'constraintVertical',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [{ id: 'vertical-line', label: 'Select line', acceptedKinds: ['line'] }],
    resolveTarget(definition, target) {
      return resolveLocalLineTarget(definition, target)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'vertical-preview', 'Vertical preview', 'Select a local line')
    },
    createCommitContribution(input) {
      const line = selectedLocalLine(input.selectedTargets)

      return line?.entity
        ? {
            constraints: [{
              constraintId: input.createConstraintId('vertical'),
              kind: 'vertical',
              label: `Vertical ${input.sequence}`,
              entityId: line.entity.entityId,
            }],
          }
        : {}
    },
  },
  {
    metadata: {
      id: 'constraintConcentric',
      name: 'Concentric',
      tooltip: 'Constrain circle and arc centers to coincide.',
      icon: 'constraintConcentric',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'concentric-a', label: 'Select first circle or arc', acceptedKinds: ['circle'] },
      { id: 'concentric-b', label: 'Select second circle or arc', acceptedKinds: ['circle'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolveCircleTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'concentric-preview', 'Concentric preview', 'Select two circles or arcs')
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first || !second) {
        return {}
      }

      const local = selectedLocalCircleLike(input.selectedTargets)
      const projected = selectedProjectedCircleLike(input.selectedTargets)

      return createLocalOrProjectedConstraint({
        localBuilder: () => first.entity && second.entity
          ? {
              constraintId: input.createConstraintId('concentric'),
              kind: 'concentric',
              label: `Concentric ${input.sequence}`,
              entityIds: [first.entity.entityId, second.entity.entityId],
            }
          : null,
        projectedBuilder: () => {
          const curve = local ? localEntityOperand(local) : null

          return curve && projected
            ? {
                constraintId: input.createConstraintId('concentric-projected-curve'),
                kind: 'concentricProjectedCurve',
                label: `Concentric ${input.sequence}`,
                curve,
                projectedCurve: projectedOperand(projected),
              }
            : null
        },
      })
    },
  },
  {
    metadata: {
      id: 'constraintMidpoint',
      name: 'Midpoint',
      tooltip: 'Constrain a point to the midpoint of a line.',
      icon: 'constraintMidpoint',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'midpoint-point-or-line-a', label: 'Select point or line', acceptedKinds: ['point', 'line'] },
      { id: 'midpoint-point-or-line-b', label: 'Select remaining point or line', acceptedKinds: ['point', 'line'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolvePointOrLineTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'midpoint-preview', 'Midpoint preview', 'Select a point and a line')
    },
    createCommitContribution(input) {
      const point = selectedLocalPoint(input.selectedTargets)
      const localLine = selectedLocalLine(input.selectedTargets)
      const referenceLineTarget = selectedReferenceLineTarget(input.selectedTargets)
      const pointOperand = point ? localPointOperand(point) : null

      if (!pointOperand) {
        return {}
      }

      return createLocalOrProjectedConstraint({
        localBuilder: () => {
          const line = localLine ? localEntityOperand(localLine) : null

          return line
            ? {
                constraintId: input.createConstraintId('midpoint'),
                kind: 'midpoint',
                label: `Midpoint ${input.sequence}`,
                point: pointOperand,
                line,
              }
            : null
        },
        projectedBuilder: () => referenceLineTarget
          ? {
              constraintId: input.createConstraintId('midpoint-projected-line'),
              kind: 'midpointProjectedLine',
              label: `Midpoint ${input.sequence}`,
              point: pointOperand,
              projectedLine: lineDimensionOperand(referenceLineTarget)!,
            }
          : null,
      })
    },
  },
  {
    metadata: {
      id: 'constraintNormal',
      name: 'Normal',
      tooltip: 'Constrain a line normal to a curve at a contact point.',
      icon: 'constraintNormal',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'normal-line', label: 'Select line, curve, or contact point', acceptedKinds: ['line', 'circle', 'point'] },
      { id: 'normal-curve', label: 'Select another normal target', acceptedKinds: ['line', 'circle', 'point'] },
      { id: 'normal-point', label: 'Select remaining normal target', acceptedKinds: ['line', 'circle', 'point'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolveNormalTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'normal-preview', 'Normal preview', 'Select a line, curve, and contact point')
    },
    createCommitContribution(input) {
      const point = selectedLocalPoint(input.selectedTargets)
      const lineTarget = selectedLocalLine(input.selectedTargets)
      const localCurveTarget = selectedLocalCircleLike(input.selectedTargets)
      const projectedCurve = selectedProjectedCircleLike(input.selectedTargets)
      const pointOperand = point ? localPointOperand(point) : null
      const line = lineTarget ? localEntityOperand(lineTarget) : null

      if (!pointOperand || !line) {
        return {}
      }

      if (localCurveTarget) {
        const curve = localEntityOperand(localCurveTarget)

        return curve
          ? {
              constraints: [{
                constraintId: input.createConstraintId('normal'),
                kind: 'normal',
                label: `Normal ${input.sequence}`,
                line,
                curve,
                point: pointOperand,
              }],
            }
          : {}
      }

      return projectedCurve
        ? {
            constraints: [{
              constraintId: input.createConstraintId('normal-projected-curve'),
              kind: 'normalProjectedCurve',
              label: `Normal ${input.sequence}`,
              line,
              projectedCurve: projectedOperand(projectedCurve),
              point: pointOperand,
            }],
          }
        : {}
    },
  },
  {
    metadata: {
      id: 'constraintPierce',
      name: 'Pierce',
      tooltip: 'Constrain a point onto a selected curve.',
      icon: 'constraintPierce',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'pierce-point-or-curve-a', label: 'Select point or curve', acceptedKinds: ['point', 'line', 'circle', 'spline'] },
      { id: 'pierce-point-or-curve-b', label: 'Select remaining point or curve', acceptedKinds: ['point', 'line', 'circle', 'spline'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolvePierceTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'pierce-preview', 'Pierce preview', 'Select a point and a curve')
    },
    createCommitContribution(input) {
      const point = selectedLocalPoint(input.selectedTargets)
      const localCurve = selectedLocalCurve(input.selectedTargets)
      const projectedCurve = selectedProjectedCurve(input.selectedTargets)
      const datumAxis = selectedReferenceLineTarget(input.selectedTargets)?.datum
      const pointOperand = point ? localPointOperand(point) : null

      if (!pointOperand) {
        return {}
      }

      return createLocalOrProjectedConstraint({
        localBuilder: () => {
          const curve = localCurve ? localEntityOperand(localCurve) : null

          return curve
            ? {
                constraintId: input.createConstraintId('point-on-curve'),
                kind: 'pointOnCurve',
                label: `Pierce ${input.sequence}`,
                point: pointOperand,
                curve,
              }
            : null
        },
        projectedBuilder: () => projectedCurve || datumAxis
          ? {
              constraintId: input.createConstraintId('point-on-projected-curve'),
              kind: 'pointOnProjectedCurve',
              label: `Pierce ${input.sequence}`,
              point: pointOperand,
              projectedCurve: projectedCurve ? projectedOperand(projectedCurve) : datumOperand(datumAxis!),
            }
          : null,
      })
    },
  },
  {
    metadata: {
      id: 'constraintSymmetric',
      name: 'Symmetric',
      tooltip: 'Constrain two points symmetric about a line.',
      icon: 'constraintSymmetric',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [
      { id: 'symmetric-a', label: 'Select point or symmetry axis', acceptedKinds: ['point', 'line'] },
      { id: 'symmetric-b', label: 'Select second point or symmetry axis', acceptedKinds: ['point', 'line'] },
      { id: 'symmetric-axis', label: 'Select remaining symmetric target', acceptedKinds: ['point', 'line'] },
    ],
    resolveTarget(definition, target, projectedReferences) {
      return resolvePointOrLineTarget(definition, target, projectedReferences)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'symmetric-preview', 'Symmetric preview', 'Select two points and a line axis')
    },
    createCommitContribution(input) {
      const points = input.selectedTargets.filter((target) => target.point)
      const localLine = selectedLocalLine(input.selectedTargets)
      const referenceLineTarget = selectedReferenceLineTarget(input.selectedTargets)

      const [firstPoint, secondPoint] = points

      if (!firstPoint?.point || !secondPoint?.point) {
        return {}
      }

      const pointIds = [firstPoint.point.pointId, secondPoint.point.pointId] as const

      return createLocalOrProjectedConstraint({
        localBuilder: () => {
          const axis = localLine ? localEntityOperand(localLine) : null

          return axis
            ? {
                constraintId: input.createConstraintId('symmetric'),
                kind: 'symmetric',
                label: `Symmetric ${input.sequence}`,
                pointIds,
                axis,
              }
            : null
        },
        projectedBuilder: () => referenceLineTarget
          ? {
              constraintId: input.createConstraintId('symmetric-projected-line'),
              kind: 'symmetricProjectedLine',
              label: `Symmetric ${input.sequence}`,
              pointIds,
              projectedLine: lineDimensionOperand(referenceLineTarget)!,
            }
          : null,
      })
    },
  },
  {
    metadata: {
      id: 'constraintFix',
      name: 'Fix Geometry',
      tooltip: 'Fix selected geometry at its current placement.',
      icon: 'constraintFix',
      group: 'constraints',
      modes: ['sketch'],
    },
    steps: [{ id: 'fix-target', label: 'Select geometry to fix', acceptedKinds: ['point', 'line', 'circle', 'spline'] }],
    resolveTarget(definition, target) {
      return resolveFixTarget(definition, target)
    },
    buildPreview(input) {
      return buildRelationshipPreview(input, 'fix-preview', 'Fix geometry preview', 'Select geometry to fix')
    },
    createCommitContribution(input) {
      const [target] = input.selectedTargets

      if (!target) {
        return {}
      }

      const fixedPoints = target.point
        ? [{ pointId: target.point.pointId, position: target.point.position }]
        : target.entityPoints ?? []

      if (fixedPoints.length === 0) {
        return {}
      }

      const constraints = fixedPoints.map((point, index) => ({
        constraintId: input.createConstraintId(`fix-${index}`),
        kind: 'fixPoint' as const,
        label: `Fix ${input.sequence}`,
        pointId: point.pointId,
        position: point.position,
      }))

      const dimensions = target.entity?.kind === 'circle'
        ? [{
            dimensionId: input.createDimensionId('fix-radius'),
            kind: 'circleRadius' as const,
            label: `Fixed radius ${input.sequence}`,
            entityId: target.entity.entityId,
            value: target.entity.radius,
          }]
        : []

      return { constraints, dimensions }
    },
  },
  {
    metadata: {
      id: 'dimensionDistance',
      name: 'Distance',
      tooltip: 'Create aligned distance dimensions.',
      icon: 'dimension',
      group: 'dimensions',
      modes: ['sketch'],
    },
    steps: [
      { id: 'distance-a', label: 'Select first dimension target', acceptedKinds: ['point', 'line', 'circle'] },
      { id: 'distance-b', label: 'Select second dimension target', acceptedKinds: ['point', 'line'] },
    ],
    valueSpec: {
      label: 'Distance',
      unit: 'mm',
      min: 0.01,
      defaultValue: 10,
    },
    resolveTarget(definition, target, projectedReferences) {
      return createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget])(
        definition,
        target,
        projectedReferences,
      )
    },
    buildPreview(input) {
      return buildExpandedDimensionPreview(input)
    },
    getValueSpec(selectedTargets) {
      return getDimensionDistanceIntent(selectedTargets)?.valueSpec ?? null
    },
    isReadyForValue(selectedTargets) {
      return getDimensionDistanceIntent(selectedTargets) !== null
    },
    canSelectMoreTargets(selectedTargets) {
      const [first, second] = selectedTargets
      return Boolean(first?.line && !second)
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first || input.value === null) {
        return {}
      }

      if (first.entity && (first.entity.kind === 'circle' || first.entity.kind === 'arc')) {
        return {
          dimensions: [
            {
              dimensionId: input.createDimensionId('diameter'),
              kind: 'diameter',
              label: `Diameter ${input.sequence}`,
              entityId: first.entity.entityId,
              value: input.value,
              annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                ? input.annotationPlacement
                : undefined,
            },
          ],
        }
      }

      if (!second) {
        if (first.entity?.kind === 'lineSegment') {
          return {
            dimensions: [
              {
                dimensionId: input.createDimensionId('line-length'),
                kind: 'lineLength',
                label: `Line length ${input.sequence}`,
                entityId: first.entity.entityId,
                value: input.value,
                annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                  ? input.annotationPlacement
                  : undefined,
              },
            ],
          }
        }

        return {}
      }

      const firstLine = lineDimensionOperand(first)
      const secondLine = lineDimensionOperand(second)
      const firstPoint = pointDimensionOperand(first)
      const secondPoint = pointDimensionOperand(second)

      if (firstLine && secondLine && first.line && second.line) {
        if (areLinesParallel(first.line, second.line)) {
          return {
            dimensions: [
              {
                dimensionId: input.createDimensionId('line-distance'),
                kind: 'lineDistance',
                label: `Line distance ${input.sequence}`,
                lines: [firstLine, secondLine],
                value: input.value,
                annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                  ? input.annotationPlacement
                  : undefined,
              },
            ],
          }
        }

        return {
          dimensions: [
            {
              dimensionId: input.createDimensionId('line-angle'),
              kind: 'lineAngle',
              label: `Line angle ${input.sequence}`,
              lines: [firstLine, secondLine],
              valueRadians: input.value * Math.PI / 180,
              annotationPlacement: input.annotationPlacement?.kind === 'angleArc'
                ? input.annotationPlacement
                : undefined,
            },
          ],
        }
      }

      if (firstLine && secondPoint) {
        return {
          dimensions: [
            {
              dimensionId: input.createDimensionId('line-point-distance'),
              kind: 'linePointDistance',
              label: `Point-line distance ${input.sequence}`,
              line: firstLine,
              point: secondPoint,
              value: input.value,
              annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                ? input.annotationPlacement
                : undefined,
            },
          ],
        }
      }

      if (firstPoint && secondLine) {
        return {
          dimensions: [
            {
              dimensionId: input.createDimensionId('line-point-distance'),
              kind: 'linePointDistance',
              label: `Point-line distance ${input.sequence}`,
              line: secondLine,
              point: firstPoint,
              value: input.value,
              annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                ? input.annotationPlacement
                : undefined,
            },
          ],
        }
      }

      if (!firstPoint || !secondPoint) {
        return {}
      }

      const axis = input.referenceKind === 'horizontal' || input.referenceKind === 'vertical'
        ? input.referenceKind
        : selectPointToPointDimensionReference({
            first: first.anchor,
            second: second.anchor,
            pointer: input.pointer,
          })
      const localPointTarget = first.point ? first : second.point ? second : null
      const datumPointTarget = first.datum?.reference.datumId === 'origin'
        ? first
        : second.datum?.reference.datumId === 'origin'
          ? second
          : null

      if (!localPointTarget || !datumPointTarget) {
        return first.point && second.point
          ? {
              dimensions: [
                {
                  dimensionId: input.createDimensionId('distance'),
                  kind: 'distance',
                  label: `Distance ${input.sequence}`,
                  axis,
                  pointIds: [first.point.pointId, second.point.pointId],
                  value: input.value,
                  annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                    ? input.annotationPlacement
                    : undefined,
                },
              ],
            }
          : {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('distance'),
            kind: 'pointDatumDistance',
            label: `Distance ${input.sequence}`,
            axis,
            point: { kind: 'localPoint', pointId: localPointTarget.point!.pointId },
            datum: { kind: 'sketchDatum', datum: datumPointTarget.datum!.reference.datumId },
            value: input.value,
            annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
              ? input.annotationPlacement
              : undefined,
          },
        ],
      }
    },
  },
  {
    metadata: {
      id: 'dimensionHorizontal',
      name: 'Horizontal',
      tooltip: 'Create horizontal distance dimensions.',
      icon: 'dimension',
      group: 'dimensions',
      modes: ['sketch'],
    },
    steps: [
      { id: 'horizontal-a', label: 'Select first point', acceptedKinds: ['point'] },
      { id: 'horizontal-b', label: 'Select second point', acceptedKinds: ['point'] },
    ],
    valueSpec: {
      label: 'Horizontal distance',
      unit: 'mm',
      min: 0.01,
      defaultValue: 10,
    },
    resolveTarget(definition, target) {
      return resolvePointTarget(definition, target)
    },
    buildPreview(input) {
      return buildPointDimensionPreview(input, {
        id: 'horizontal-distance-preview',
        unit: 'mm',
        fixedReferenceKind: 'horizontal',
      })
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      const firstPoint = first ? pointDimensionOperand(first) : null
      const secondPoint = second ? pointDimensionOperand(second) : null

      if (!firstPoint || !secondPoint || input.value === null) {
        return {}
      }

      if (first.point && second.point) {
        return {
          dimensions: [
            {
              dimensionId: input.createDimensionId('horizontal-distance'),
              kind: 'horizontalDistance',
              label: `Horizontal distance ${input.sequence}`,
              pointIds: [first.point.pointId, second.point.pointId],
              value: input.value,
              annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                ? input.annotationPlacement
                : undefined,
            },
          ],
        }
      }

      const localPointTarget = first.point ? first : second.point ? second : null
      const datumPointTarget = first.datum?.reference.datumId === 'origin'
        ? first
        : second.datum?.reference.datumId === 'origin'
          ? second
          : null

      if (!localPointTarget || !datumPointTarget) {
        return {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('horizontal-distance'),
            kind: 'pointDatumDistance',
            label: `Horizontal distance ${input.sequence}`,
            axis: 'horizontal',
            point: { kind: 'localPoint', pointId: localPointTarget.point!.pointId },
            datum: { kind: 'sketchDatum', datum: datumPointTarget.datum!.reference.datumId },
            value: input.value,
            annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
              ? input.annotationPlacement
              : undefined,
          },
        ],
      }
    },
  },
  {
    metadata: {
      id: 'dimensionVertical',
      name: 'Vertical',
      tooltip: 'Create vertical distance dimensions.',
      icon: 'dimension',
      group: 'dimensions',
      modes: ['sketch'],
    },
    steps: [
      { id: 'vertical-a', label: 'Select first point', acceptedKinds: ['point'] },
      { id: 'vertical-b', label: 'Select second point', acceptedKinds: ['point'] },
    ],
    valueSpec: {
      label: 'Vertical distance',
      unit: 'mm',
      min: 0.01,
      defaultValue: 10,
    },
    resolveTarget(definition, target) {
      return resolvePointTarget(definition, target)
    },
    buildPreview(input) {
      return buildPointDimensionPreview(input, {
        id: 'vertical-distance-preview',
        unit: 'mm',
        fixedReferenceKind: 'vertical',
      })
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      const firstPoint = first ? pointDimensionOperand(first) : null
      const secondPoint = second ? pointDimensionOperand(second) : null

      if (!firstPoint || !secondPoint || input.value === null) {
        return {}
      }

      if (first.point && second.point) {
        return {
          dimensions: [
            {
              dimensionId: input.createDimensionId('vertical-distance'),
              kind: 'verticalDistance',
              label: `Vertical distance ${input.sequence}`,
              pointIds: [first.point.pointId, second.point.pointId],
              value: input.value,
              annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
                ? input.annotationPlacement
                : undefined,
            },
          ],
        }
      }

      const localPointTarget = first.point ? first : second.point ? second : null
      const datumPointTarget = first.datum?.reference.datumId === 'origin'
        ? first
        : second.datum?.reference.datumId === 'origin'
          ? second
          : null

      if (!localPointTarget || !datumPointTarget) {
        return {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('vertical-distance'),
            kind: 'pointDatumDistance',
            label: `Vertical distance ${input.sequence}`,
            axis: 'vertical',
            point: { kind: 'localPoint', pointId: localPointTarget.point!.pointId },
            datum: { kind: 'sketchDatum', datum: datumPointTarget.datum!.reference.datumId },
            value: input.value,
            annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
              ? input.annotationPlacement
              : undefined,
          },
        ],
      }
    },
  },
  {
    metadata: {
      id: 'dimensionRadius',
      name: 'Radius',
      tooltip: 'Create circle radius dimensions.',
      icon: 'dimension',
      group: 'dimensions',
      modes: ['sketch'],
    },
    steps: [{ id: 'radius-circle', label: 'Select circle', acceptedKinds: ['circle'] }],
    valueSpec: {
      label: 'Radius',
      unit: 'mm',
      min: 0.01,
      defaultValue: 5,
    },
    resolveTarget(definition, target) {
      return resolveCircleTarget(definition, target)
    },
    buildPreview(input) {
      return buildRadiusPreview(input)
    },
    createCommitContribution(input) {
      const [circle] = input.selectedTargets

      if (!circle?.entity || input.value === null) {
        return {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('radius'),
            kind: 'circleRadius',
            label: `Radius ${input.sequence}`,
            entityId: circle.entity.entityId,
            value: input.value,
            annotationPlacement: input.annotationPlacement?.kind === 'dimensionLine'
              ? input.annotationPlacement
              : undefined,
          },
        ],
      }
    },
  },
] as const satisfies readonly SketchConstraintDefinition[]

const constraintRegistry = createRegistry<SketchConstraintToolId, SketchConstraintDefinition>(
  sketchConstraintDefinitions,
  (definition) => definition.metadata.id,
  'Sketch constraint tool',
)

export function getSketchConstraintDefinition(toolId: SketchConstraintToolId) {
  return constraintRegistry.get(toolId)
}

export function getRegisteredSketchConstraintDefinitions() {
  return constraintRegistry.getAll()
}

export function isRegisteredSketchConstraintToolId(toolId: string): toolId is SketchConstraintToolId {
  return constraintRegistry.has(toolId)
}

export function resolveSketchConstraintTarget(
  toolId: SketchConstraintToolId,
  definition: Parameters<SketchConstraintDefinition['resolveTarget']>[0],
  target: PrimitiveRef,
  projectedReferences?: Parameters<SketchConstraintDefinition['resolveTarget']>[2],
) {
  return getSketchConstraintDefinition(toolId).resolveTarget(definition, target, projectedReferences)
}
