import type { PrimitiveRef } from '@/domain/editor/schema'
import type { ProjectedSketchGeometryRef } from '@/contracts/sketch/schema'
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

function distanceBetween(left: readonly [number, number], right: readonly [number, number]) {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

function midpoint(left: readonly [number, number], right: readonly [number, number]): readonly [number, number] {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
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

function resolveCoincidentTarget(
  definition: Parameters<SketchConstraintDefinition['resolveTarget']>[0],
  target: PrimitiveRef,
  projectedReferences?: Parameters<SketchConstraintDefinition['resolveTarget']>[2],
) {
  if (target.kind !== 'projectedReferenceGeometry') {
    return resolvePointTarget(definition, target, projectedReferences)
      ?? resolveCircleTarget(definition, target, projectedReferences)
  }

  return resolvePointTarget(definition, target, projectedReferences)
    ?? resolveLineTarget(definition, target, projectedReferences)
    ?? resolveCircleTarget(definition, target, projectedReferences)
    ?? resolveCurveTarget(definition, target, projectedReferences)
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

      if (first.entity && second.entity) {
        return {
          constraints: [
            {
              constraintId: input.createConstraintId('parallel'),
              kind: 'parallel',
              label: `Parallel ${input.sequence}`,
              entityIds: [first.entity.entityId, second.entity.entityId],
            },
          ],
        }
      }

      const local = first.entity ? first : second.entity ? second : null
      const projected = first.projected?.geometry.kind === 'lineSegment'
        ? first.projected
        : second.projected?.geometry.kind === 'lineSegment'
          ? second.projected
          : null
      const line = local ? localEntityOperand(local) : null

      if (!line || !projected) {
        return {}
      }

      return {
        constraints: [
          {
            constraintId: input.createConstraintId('parallel-projected-line'),
            kind: 'parallelProjectedLine',
            label: `Parallel ${input.sequence}`,
            line,
            projectedLine: projectedOperand(projected),
          },
        ],
      }
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

      if (first.entity && second.entity) {
        return {
          constraints: [
            {
              constraintId: input.createConstraintId('perpendicular'),
              kind: 'perpendicular',
              label: `Perpendicular ${input.sequence}`,
              entityIds: [first.entity.entityId, second.entity.entityId],
            },
          ],
        }
      }

      const local = first.entity ? first : second.entity ? second : null
      const projected = first.projected?.geometry.kind === 'lineSegment'
        ? first.projected
        : second.projected?.geometry.kind === 'lineSegment'
          ? second.projected
          : null
      const line = local ? localEntityOperand(local) : null

      if (!line || !projected) {
        return {}
      }

      return {
        constraints: [
          {
            constraintId: input.createConstraintId('perpendicular-projected-line'),
            kind: 'perpendicularProjectedLine',
            label: `Perpendicular ${input.sequence}`,
            line,
            projectedLine: projectedOperand(projected),
          },
        ],
      }
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
      id: 'dimensionDistance',
      name: 'Distance',
      tooltip: 'Author an aligned distance between two points.',
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
      tooltip: 'Author a horizontal distance between two points.',
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
      tooltip: 'Author a vertical distance between two points.',
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
      tooltip: 'Author a radius dimension for one circle.',
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

const constraintMap = new Map<SketchConstraintToolId, SketchConstraintDefinition>(
  sketchConstraintDefinitions.map((definition) => [definition.metadata.id, definition]),
)

export function getSketchConstraintDefinition(toolId: SketchConstraintToolId) {
  const definition = constraintMap.get(toolId)

  if (!definition) {
    throw new Error(`Sketch constraint tool ${toolId} is not registered.`)
  }

  return definition
}

export function getRegisteredSketchConstraintDefinitions() {
  return sketchConstraintDefinitions
}

export function isRegisteredSketchConstraintToolId(toolId: string): toolId is SketchConstraintToolId {
  return constraintMap.has(toolId as SketchConstraintToolId)
}

export function resolveSketchConstraintTarget(
  toolId: SketchConstraintToolId,
  definition: Parameters<SketchConstraintDefinition['resolveTarget']>[0],
  target: PrimitiveRef,
  projectedReferences?: Parameters<SketchConstraintDefinition['resolveTarget']>[2],
) {
  return getSketchConstraintDefinition(toolId).resolveTarget(definition, target, projectedReferences)
}
