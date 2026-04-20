import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/domain/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import { createMidpointConstraint } from '@/domain/sketch-tools/constraints'
import { mirrorPointAcrossCenter } from '@/domain/sketch-tools/geometry'
import {
  createIdleState,
  createPointerMoveResult,
  createPointerReleaseResult,
  distanceBetween,
  validateDistance,
} from '@/domain/sketch-tools/shared'

function buildMidpointLinePreview(midpoint: SketchPoint, endpoint: SketchPoint): readonly SketchDraftEntity[] {
  return [
    {
      id: 'preview-midpoint-line',
      kind: 'line',
      start: mirrorPointAcrossCenter(midpoint, endpoint),
      end: endpoint,
      entityId: null,
      status: 'preview',
      label: 'Midpoint line preview',
      isConstruction: false,
    },
  ]
}

function validateMidpointLine(midpoint: SketchPoint, endpoint: SketchPoint) {
  return validateDistance(midpoint, endpoint, 'Midpoint line requires a midpoint and distinct endpoint.')
}

function buildMidpointLinePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const start = state.status === 'drawing' ? state.pointerDownPoint : null
  const end = state.status === 'drawing' ? state.livePoint : null
  const isDrawing = start !== null && end !== null
  const length = isDrawing ? distanceBetween(mirrorPointAcrossCenter(start, end), end) : 0
  const validation = state.validationMessage
    ? [{ id: 'midpoint-line-validation', message: state.validationMessage, severity: 'error' as const }]
    : []

  return {
    prompts: [
      {
        id: 'midpoint-line-prompt',
        text: isDrawing ? 'Place endpoint' : 'Pick line midpoint',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'midpoint-line-step', label: isDrawing ? 'Endpoint' : 'Midpoint' }],
    measurements: isDrawing
      ? [{ id: 'midpoint-line-length', label: 'Length', value: length, unit: 'mm' }]
      : [],
    completionHints: [
      {
        id: 'midpoint-line-completion',
        text: isDrawing ? 'Click to accept the midpoint line' : 'Click to set the midpoint',
        ready: isDrawing ? validateMidpointLine(start, end).valid : false,
      },
    ],
    overlays: isDrawing
      ? [
          { id: 'midpoint-line-center', kind: 'helperMarker', label: 'Midpoint', point: start },
          {
            id: 'midpoint-line-completion-cue',
            kind: 'completionCue',
            label: 'Place endpoint',
            point: end,
            ready: validateMidpointLine(start, end).valid,
          },
        ]
      : [],
    validation,
  }
}

export const midpointLineSketchToolDefinition: SketchToolDefinition<'midpointLine'> = {
  metadata: {
    id: 'midpointLine',
    group: 'drawing',
    name: 'Midpoint Line',
    tooltip: 'Create a line from its midpoint and one endpoint.',
    icon: 'line',
    modes: ['sketch'],
  },
  activate() {
    const state = createIdleState()

    return {
      state,
      stagedEntities: [],
      presentation: buildMidpointLinePresentation(state),
    }
  },
  pointerMove(input) {
    return createPointerMoveResult({
      pointerInput: input,
      buildPreview: buildMidpointLinePreview,
      buildPresentation: buildMidpointLinePresentation,
      validate: validateMidpointLine,
    })
  },
  pointerRelease(input) {
    return createPointerReleaseResult({
      pointerInput: input,
      buildPreview: buildMidpointLinePreview,
      buildPresentation: buildMidpointLinePresentation,
      validate: validateMidpointLine,
    })
  },
  getStagedEntities(state) {
    return state.pointerDownPoint && state.livePoint
      ? buildMidpointLinePreview(state.pointerDownPoint, state.livePoint)
      : []
  },
  validate: validateMidpointLine,
  getPresentation: buildMidpointLinePresentation,
  createCommitContribution({ sequence, start, end, factories }): SketchToolCommitContribution {
    const reflected = mirrorPointAcrossCenter(start, end)
    const midpointId = factories.createPointId('midpoint-line-midpoint')
    const startPointId = factories.createPointId('midpoint-line-start')
    const endPointId = factories.createPointId('midpoint-line-end')
    const entityId = factories.createEntityId('midpoint-line')

    return {
      points: [
        factories.createPoint(`Midpoint line ${sequence} midpoint`, midpointId, start),
        factories.createPoint(`Midpoint line ${sequence} start`, startPointId, reflected),
        factories.createPoint(`Midpoint line ${sequence} end`, endPointId, end),
      ],
      entities: [
        factories.createLineEntity(`Midpoint line ${sequence}`, entityId, startPointId, endPointId),
      ],
      constraints: [
        createMidpointConstraint({
          constraintId: factories.createConstraintId('midpoint-line-midpoint'),
          label: `Midpoint line ${sequence} midpoint`,
          pointId: midpointId,
          lineEntityId: entityId,
        }),
      ],
    }
  },
}
