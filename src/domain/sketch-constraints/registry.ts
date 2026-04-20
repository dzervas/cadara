import type { PrimitiveRef } from '@/domain/editor/schema'
import type { ProjectedSketchGeometryRef } from '@/contracts/sketch/schema'
import type { ConstraintDefinition } from '@/contracts/sketch/schema'
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
  target.kind === 'projectedReferenceGeometry'
    ? createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget, resolveCurveTarget])(
        definition,
        target,
        projectedReferences,
      )
    : createCompositeResolver([resolvePointTarget, resolveCircleTarget])(definition, target, projectedReferences)

const resolvePointOrLineTarget = createCompositeResolver([resolvePointTarget, resolveLineTarget])
const resolvePierceTarget = createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget, resolveCurveTarget])
const resolveNormalTarget = createCompositeResolver([resolvePointTarget, resolveLineTarget, resolveCircleTarget])

const resolveFixTarget: ConstraintTargetResolver = (definition, target) =>
  target.kind === 'projectedReferenceGeometry'
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
  }[referenceKind]

  return value === null ? prefix : `${prefix} ${value.toFixed(2)} ${unit}`
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
}): SketchToolOverlayDescriptor {
  if (input.referenceKind === 'horizontal') {
    const y = input.pointer?.[1] ?? input.first[1] - 1
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
    const x = input.pointer?.[0] ?? input.first[0] + 1
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
  const pointerOffset = input.pointer
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

  const firstVector = normalize([
    first.line.end[0] - first.line.start[0],
    first.line.end[1] - first.line.start[1],
  ])
  const secondVector = normalize([
    second.line.end[0] - second.line.start[0],
    second.line.end[1] - second.line.start[1],
  ])
  const radius = Math.max(
    0.75,
    Math.min(distanceBetween(first.line.start, first.line.end), distanceBetween(second.line.start, second.line.end)) * 0.22,
  )
  const center = first.anchor
  const start: readonly [number, number] = [
    center[0] + firstVector[0] * radius,
    center[1] + firstVector[1] * radius,
  ]
  const end: readonly [number, number] = [
    center[0] + secondVector[0] * radius,
    center[1] + secondVector[1] * radius,
  ]
  const labelDirection = normalize([firstVector[0] + secondVector[0], firstVector[1] + secondVector[1]])
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
      labelAnchor: {
        kind: 'sketchPoint',
        point: labelPoint,
        offset: { x: 12, y: -12 },
      },
      referenceLabel: formatSelectedLabels([first, second]),
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
    },
  ]
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
      const projected = left.projected
        ? left.projected
        : right.projected
          ? right.projected
          : null
      const point = local ? localCoincidentPointOperand(local) : null

      if (!point || !projected) {
        return {}
      }

      if (
        projected.geometry.kind === 'lineSegment'
        || projected.geometry.kind === 'circle'
        || projected.geometry.kind === 'arc'
        || projected.geometry.kind === 'spline'
      ) {
        return {
          constraints: [
            {
              constraintId: input.createConstraintId('point-on-projected-curve'),
              kind: 'pointOnProjectedCurve',
              label: `Coincident ${input.sequence}`,
              point,
              projectedCurve: projectedOperand(projected),
            },
          ],
        }
      }

      return {
        constraints: [
          {
            constraintId: input.createConstraintId('coincident-projected-point'),
            kind: 'coincidentProjectedPoint',
            label: `Coincident ${input.sequence}`,
            point,
            projectedPoint: projectedOperand(projected),
          },
        ],
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
      const projected = first.projected?.geometry.kind === 'lineSegment'
        ? first.projected
        : second.projected?.geometry.kind === 'lineSegment'
          ? second.projected
          : null

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

          return line && projected
            ? {
            constraintId: input.createConstraintId('parallel-projected-line'),
            kind: 'parallelProjectedLine',
            label: `Parallel ${input.sequence}`,
            line,
            projectedLine: projectedOperand(projected),
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
      const projected = first.projected?.geometry.kind === 'lineSegment'
        ? first.projected
        : second.projected?.geometry.kind === 'lineSegment'
          ? second.projected
          : null

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

          return line && projected
            ? {
            constraintId: input.createConstraintId('perpendicular-projected-line'),
            kind: 'perpendicularProjectedLine',
            label: `Perpendicular ${input.sequence}`,
            line,
            projectedLine: projectedOperand(projected),
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
      const projectedLine = selectedProjectedLine(input.selectedTargets)
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
        projectedBuilder: () => projectedLine
          ? {
              constraintId: input.createConstraintId('midpoint-projected-line'),
              kind: 'midpointProjectedLine',
              label: `Midpoint ${input.sequence}`,
              point: pointOperand,
              projectedLine: projectedOperand(projectedLine),
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
        projectedBuilder: () => projectedCurve
          ? {
              constraintId: input.createConstraintId('point-on-projected-curve'),
              kind: 'pointOnProjectedCurve',
              label: `Pierce ${input.sequence}`,
              point: pointOperand,
              projectedCurve: projectedOperand(projectedCurve),
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
      const projectedLine = selectedProjectedLine(input.selectedTargets)

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
        projectedBuilder: () => projectedLine
          ? {
              constraintId: input.createConstraintId('symmetric-projected-line'),
              kind: 'symmetricProjectedLine',
              label: `Symmetric ${input.sequence}`,
              pointIds,
              projectedLine: projectedOperand(projectedLine),
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
      { id: 'distance-a', label: 'Select first point', acceptedKinds: ['point'] },
      { id: 'distance-b', label: 'Select second point', acceptedKinds: ['point'] },
    ],
    valueSpec: {
      label: 'Distance',
      unit: 'mm',
      min: 0.01,
      defaultValue: 10,
    },
    resolveTarget(definition, target) {
      return resolvePointTarget(definition, target)
    },
    buildPreview(input) {
      return buildPointDimensionPreview(input, { id: 'distance-preview', unit: 'mm' })
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first?.point || !second?.point || input.value === null) {
        return {}
      }

      const axis = input.referenceKind === 'horizontal' || input.referenceKind === 'vertical'
        ? input.referenceKind
        : selectPointToPointDimensionReference({
            first: first.anchor,
            second: second.anchor,
            pointer: input.pointer,
          })

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('distance'),
            kind: 'distance',
            label: `Distance ${input.sequence}`,
            axis,
            pointIds: [first.point.pointId, second.point.pointId],
            value: input.value,
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

      if (!first?.point || !second?.point || input.value === null) {
        return {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('horizontal-distance'),
            kind: 'horizontalDistance',
            label: `Horizontal distance ${input.sequence}`,
            pointIds: [first.point.pointId, second.point.pointId],
            value: input.value,
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

      if (!first?.point || !second?.point || input.value === null) {
        return {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('vertical-distance'),
            kind: 'verticalDistance',
            label: `Vertical distance ${input.sequence}`,
            pointIds: [first.point.pointId, second.point.pointId],
            value: input.value,
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
