import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/domain/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import {
  angleBetweenDegrees,
  createSketchToolDefinition,
  distanceBetween,
  midpoint,
  validateDistance,
} from '@/domain/sketch-tools/shared'

function buildLinePreview(start: SketchPoint, end: SketchPoint): readonly SketchDraftEntity[] {
  return [
    {
      id: 'preview-line',
      kind: 'line',
      start,
      end,
      entityId: null,
      status: 'preview',
      label: 'Line preview',
      isConstruction: false,
    },
  ]
}

function validateLine(start: SketchPoint, end: SketchPoint) {
  return validateDistance(start, end, 'Line requires two distinct points.')
}

function buildLinePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const start = state.status === 'drawing' ? state.pointerDownPoint : null
  const end = state.status === 'drawing' ? state.livePoint : null
  const isDrawing = start !== null && end !== null
  const validation = state.validationMessage
    ? [{ id: 'line-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const length = isDrawing ? distanceBetween(start, end) : null
  const angle = isDrawing ? angleBetweenDegrees(start, end) : null
  const measurements = isDrawing
    ? [
        { id: 'line-length', label: 'Length', value: length ?? 0, unit: 'mm' },
        { id: 'line-angle', label: 'Angle', value: angle ?? 0, unit: 'deg' },
      ]
    : []
  const overlays = isDrawing
    ? [
        {
          id: 'line-start-anchor',
          kind: 'anchor' as const,
          label: 'Start',
          point: start,
        },
        {
          id: 'line-length-overlay',
          kind: 'measurement' as const,
          label: 'Length',
          value: length ?? 0,
          unit: 'mm',
          anchor: { kind: 'sketchPoint' as const, point: midpoint(start, end), offset: { x: 0, y: -28 } },
        },
        {
          id: 'line-angle-overlay',
          kind: 'measurement' as const,
          label: 'Angle',
          value: angle ?? 0,
          unit: 'deg',
          anchor: { kind: 'cursor' as const, point: end, offset: { x: 18, y: -18 } },
        },
        {
          id: 'line-completion-cue',
          kind: 'completionCue' as const,
          label: 'Place endpoint',
          point: end,
          ready: validateLine(start, end).valid,
        },
      ]
    : []

  return {
    prompts: [
      {
        id: 'line-prompt',
        text: isDrawing ? 'Place endpoint' : 'Pick line start',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'line-step', label: isDrawing ? 'Endpoint' : 'Start point' }],
    measurements,
    completionHints: [
      {
        id: 'line-completion',
        text: isDrawing ? 'Click to accept the line' : 'Click to set the first point',
        ready: isDrawing ? validateLine(start, end).valid : false,
      },
    ],
    overlays,
    validation,
  }
}

export const lineSketchToolDefinition: SketchToolDefinition<'line'> = createSketchToolDefinition({
    id: 'line',
    group: 'drawing',
    name: 'Line',
    tooltip: 'Create line geometry.',
    icon: 'line',
    modes: ['sketch'],
    dropdown: {
      familyId: 'line-family',
      variantIds: ['line', 'midpointLine'],
    },
}, {
  buildPreview: buildLinePreview,
  buildPresentation: buildLinePresentation,
  validate: validateLine,
  createCommitContribution({ sequence, start, end, factories }): SketchToolCommitContribution {
    const startPointId = factories.createPointId('line-start')
    const endPointId = factories.createPointId('line-end')
    const entityId = factories.createEntityId('line')

    return {
      points: [
        factories.createPoint(`Line ${sequence} start`, startPointId, start),
        factories.createPoint(`Line ${sequence} end`, endPointId, end),
      ],
      entities: [
        factories.createLineEntity(`Line ${sequence}`, entityId, startPointId, endPointId),
      ],
    }
  },
})
