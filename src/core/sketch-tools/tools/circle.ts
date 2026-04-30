import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/core/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/core/sketch-tools/editor-schema'
import {
  createSketchToolDefinition,
  distanceBetween,
  validateDistance,
} from '@/core/sketch-tools/shared'

function buildCirclePreview(start: SketchPoint, end: SketchPoint): readonly SketchDraftEntity[] {
  return [
    {
      id: 'preview-circle',
      kind: 'circle',
      center: start,
      radius: distanceBetween(start, end),
      entityId: null,
      status: 'preview',
      label: 'Circle preview',
      isConstruction: false,
    },
  ]
}

function validateCircle(start: SketchPoint, end: SketchPoint) {
  return validateDistance(start, end, 'Circle radius must be greater than zero.')
}

function buildCirclePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const start = state.status === 'drawing' ? state.pointerDownPoint : null
  const end = state.status === 'drawing' ? state.livePoint : null
  const isDrawing = start !== null && end !== null
  const radius = isDrawing ? distanceBetween(start, end) : null
  const radiusValue = radius ?? 0
  const diameterValue = radiusValue * 2
  const validation = state.validationMessage
    ? [{ id: 'circle-validation', message: state.validationMessage, severity: 'error' as const }]
    : []

  return {
    prompts: [
      {
        id: 'circle-prompt',
        text: isDrawing ? 'Set radius' : 'Pick circle center',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'circle-step', label: isDrawing ? 'Radius' : 'Center' }],
    controls: [
      {
        id: 'circle-radius',
        kind: 'numeric',
        label: 'Radius',
        value: radius,
        unit: 'mm',
        disabled: true,
        action: {
          type: 'patch',
          patch: { radius },
        },
      },
    ],
    measurements: radius === null
      ? []
      : [{ id: 'circle-diameter-measure', label: 'Diameter', value: diameterValue, unit: 'mm' }],
    completionHints: [
      {
        id: 'circle-completion',
        text: isDrawing ? 'Click to accept the circle' : 'Click to set the center',
        ready: isDrawing ? validateCircle(start, end).valid : false,
      },
    ],
    overlays: isDrawing
      ? [
          {
            id: 'circle-center-anchor',
            kind: 'anchor',
            label: 'Center',
            point: start,
          },
          {
            id: 'circle-diameter-overlay',
            kind: 'measurement',
            label: 'Diameter',
            value: diameterValue,
            unit: 'mm',
            anchor: { kind: 'cursor', point: end, offset: { x: 18, y: -18 } },
          },
          {
            id: 'circle-completion-cue',
            kind: 'completionCue',
            label: 'Place radius',
            point: end,
            ready: validateCircle(start, end).valid,
          },
        ]
      : [],
    validation,
  }
}

export const circleSketchToolDefinition: SketchToolDefinition<'circle'> = createSketchToolDefinition({
    id: 'circle',
    group: 'drawing',
    name: 'Circle',
    tooltip: 'Create circular geometry.',
    icon: 'circle',
    modes: ['sketch'],
    dropdown: {
      familyId: 'circle-family',
      variantIds: ['circle', 'threePointCircle'],
    },
}, {
  buildPreview: buildCirclePreview,
  buildPresentation: buildCirclePresentation,
  validate: validateCircle,
  createCommitContribution({ sequence, start, end, factories }): SketchToolCommitContribution {
    const centerPointId = factories.createPointId('circle-center')
    const radius = distanceBetween(start, end)
    const entityId = factories.createEntityId('circle')

    return {
      points: [
        factories.createPoint(`Circle ${sequence} center`, centerPointId, start),
      ],
      entities: [
        factories.createCircleEntity(`Circle ${sequence}`, entityId, centerPointId, radius),
      ],
      dimensions: [
        {
          dimensionId: factories.createDimensionId('radius'),
          kind: 'circleRadius',
          label: `Circle ${sequence} radius`,
          entityId,
          value: radius,
        },
      ],
    }
  },
})
