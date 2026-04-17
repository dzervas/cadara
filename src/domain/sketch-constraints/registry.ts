import type { PrimitiveRef } from '@/domain/editor/schema'
import type {
  SketchConstraintDefinition,
  SketchConstraintPreviewInput,
  SketchConstraintTargetRecord,
  SketchConstraintToolId,
} from '@/domain/sketch-constraints/definition'
import {
  resolveCircleTarget,
  resolveLineTarget,
  resolvePointTarget,
} from '@/domain/sketch-constraints/definition'

function formatSelectedLabels(targets: readonly SketchConstraintTargetRecord[]) {
  return targets.map((target) => target.label).join(' / ')
}

function buildSinglePreview(
  id: string,
  label: string,
  detail: string,
  input: SketchConstraintPreviewInput,
) {
  const anchor =
    input.hoverTarget?.anchor
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
      { id: 'point-a', label: 'Select first point', acceptedKinds: ['point'] },
      { id: 'point-b', label: 'Select second point', acceptedKinds: ['point'] },
    ],
    resolveTarget(definition, target) {
      return resolvePointTarget(definition, target)
    },
    buildPreview(input) {
      return buildSinglePreview(
        'coincident-preview',
        'Coincident preview',
        input.selectedTargets.length >= 2
          ? formatSelectedLabels(input.selectedTargets)
          : input.hoverTarget
            ? `Hover ${input.hoverTarget.label}`
            : 'Select two points',
        input,
      )
    },
    createCommitContribution(input) {
      const [left, right] = input.selectedTargets

      if (!left?.point || !right?.point) {
        return {}
      }

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
    resolveTarget(definition, target) {
      return resolveLineTarget(definition, target)
    },
    buildPreview(input) {
      return buildSinglePreview(
        'parallel-preview',
        'Parallel preview',
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
            constraintId: input.createConstraintId('parallel'),
            kind: 'parallel',
            label: `Parallel ${input.sequence}`,
            entityIds: [first.entity.entityId, second.entity.entityId],
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
      return buildSinglePreview(
        'distance-preview',
        'Distance preview',
        input.selectedTargets.length < 2 || input.value === null
          ? 'Select two points'
          : `${formatSelectedLabels(input.selectedTargets)} = ${input.value.toFixed(2)} mm`,
        input,
      )
    },
    createCommitContribution(input) {
      const [first, second] = input.selectedTargets

      if (!first?.point || !second?.point || input.value === null) {
        return {}
      }

      return {
        dimensions: [
          {
            dimensionId: input.createDimensionId('distance'),
            kind: 'distance',
            label: `Distance ${input.sequence}`,
            axis: 'aligned',
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
      return buildSinglePreview(
        'horizontal-distance-preview',
        'Horizontal dimension preview',
        input.selectedTargets.length < 2 || input.value === null
          ? 'Select two points'
          : `${formatSelectedLabels(input.selectedTargets)} = ${input.value.toFixed(2)} mm`,
        input,
      )
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
      return buildSinglePreview(
        'vertical-distance-preview',
        'Vertical dimension preview',
        input.selectedTargets.length < 2 || input.value === null
          ? 'Select two points'
          : `${formatSelectedLabels(input.selectedTargets)} = ${input.value.toFixed(2)} mm`,
        input,
      )
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
      return buildSinglePreview(
        'radius-preview',
        'Radius preview',
        input.selectedTargets.length < 1 || input.value === null
          ? 'Select one circle'
          : `${formatSelectedLabels(input.selectedTargets)} = ${input.value.toFixed(2)} mm`,
        input,
      )
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
) {
  return getSketchConstraintDefinition(toolId).resolveTarget(definition, target)
}
