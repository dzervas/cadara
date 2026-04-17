import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/domain/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import {
  createIdleState,
  createPointerMoveResult,
  createPointerReleaseResult,
  midpoint,
  validateRectangle,
} from '@/domain/sketch-tools/shared'

function getRectangleCorners(start: SketchPoint, end: SketchPoint) {
  const [x0, y0] = start
  const [x1, y1] = end
  const bottomLeft: SketchPoint = [Math.min(x0, x1), Math.min(y0, y1)]
  const topRight: SketchPoint = [Math.max(x0, x1), Math.max(y0, y1)]
  const topLeft: SketchPoint = [bottomLeft[0], topRight[1]]
  const bottomRight: SketchPoint = [topRight[0], bottomLeft[1]]

  return {
    bottomLeft,
    bottomRight,
    topRight,
    topLeft,
  }
}

function buildRectanglePreview(start: SketchPoint, end: SketchPoint): readonly SketchDraftEntity[] {
  const { bottomLeft, bottomRight, topRight, topLeft } = getRectangleCorners(start, end)

  return [
    {
      id: 'preview-rectangle-bottom',
      kind: 'line',
      start: bottomLeft,
      end: bottomRight,
      entityId: null,
      status: 'preview',
      label: 'Rectangle preview bottom',
      isConstruction: false,
    },
    {
      id: 'preview-rectangle-right',
      kind: 'line',
      start: bottomRight,
      end: topRight,
      entityId: null,
      status: 'preview',
      label: 'Rectangle preview right',
      isConstruction: false,
    },
    {
      id: 'preview-rectangle-top',
      kind: 'line',
      start: topRight,
      end: topLeft,
      entityId: null,
      status: 'preview',
      label: 'Rectangle preview top',
      isConstruction: false,
    },
    {
      id: 'preview-rectangle-left',
      kind: 'line',
      start: topLeft,
      end: bottomLeft,
      entityId: null,
      status: 'preview',
      label: 'Rectangle preview left',
      isConstruction: false,
    },
  ]
}

function buildRectanglePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const start = state.status === 'drawing' ? state.pointerDownPoint : null
  const end = state.status === 'drawing' ? state.livePoint : null
  const isDrawing = start !== null && end !== null
  const width = isDrawing ? Math.abs(end[0] - start[0]) : null
  const height = isDrawing ? Math.abs(end[1] - start[1]) : null
  const widthValue = width ?? 0
  const heightValue = height ?? 0
  const validation = state.validationMessage
    ? [{ id: 'rectangle-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const completionReady = isDrawing
    ? validateRectangle(start, end).valid
    : false

  return {
    prompts: [
      {
        id: 'rectangle-prompt',
        text: isDrawing ? 'Place opposite corner' : 'Pick first corner',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'rectangle-step', label: isDrawing ? 'Opposite corner' : 'First corner' }],
    controls: [
      {
        id: 'rectangle-width',
        kind: 'numeric',
        label: 'Width',
        value: width,
        unit: 'mm',
        disabled: true,
        action: { type: 'patch', patch: { width } },
      },
      {
        id: 'rectangle-height',
        kind: 'numeric',
        label: 'Height',
        value: height,
        unit: 'mm',
        disabled: true,
        action: { type: 'patch', patch: { height } },
      },
    ],
    measurements: isDrawing
      ? [
          { id: 'rectangle-width-measure', label: 'Width', value: widthValue, unit: 'mm' },
          { id: 'rectangle-height-measure', label: 'Height', value: heightValue, unit: 'mm' },
        ]
      : [],
    completionHints: [
      {
        id: 'rectangle-completion',
        text: isDrawing ? 'Click to accept the rectangle' : 'Click to set the first corner',
        ready: completionReady,
      },
    ],
    overlays: isDrawing
      ? [
          {
            id: 'rectangle-start-anchor',
            kind: 'anchor',
            label: 'First corner',
            point: start,
          },
          {
            id: 'rectangle-width-overlay',
            kind: 'measurement',
            label: 'Width',
            value: widthValue,
            unit: 'mm',
            anchor: {
              kind: 'sketchPoint',
              point: midpoint(start, [end[0], start[1]]),
              offset: { x: 0, y: 22 },
            },
          },
          {
            id: 'rectangle-height-overlay',
            kind: 'measurement',
            label: 'Height',
            value: heightValue,
            unit: 'mm',
            anchor: {
              kind: 'sketchPoint',
              point: midpoint(start, [start[0], end[1]]),
              offset: { x: 48, y: 0 },
            },
          },
          {
            id: 'rectangle-completion-cue',
            kind: 'completionCue',
            label: 'Place corner',
            point: end,
            ready: completionReady,
          },
        ]
      : [],
    validation,
  }
}

export const rectangleSketchToolDefinition: SketchToolDefinition<'rectangle'> = {
  metadata: {
    id: 'rectangle',
    group: 'drawing',
    name: 'Rectangle',
    tooltip: 'Create rectangle geometry.',
    icon: 'rectangle',
    modes: ['sketch'],
  },
  activate() {
    const state = createIdleState()

    return {
      state,
      stagedEntities: [],
      presentation: buildRectanglePresentation(state),
    }
  },
  pointerMove(input) {
    return createPointerMoveResult({
      pointerInput: input,
      buildPreview: buildRectanglePreview,
      buildPresentation: buildRectanglePresentation,
      validate: validateRectangle,
    })
  },
  pointerRelease(input) {
    return createPointerReleaseResult({
      pointerInput: input,
      buildPreview: buildRectanglePreview,
      buildPresentation: buildRectanglePresentation,
      validate: validateRectangle,
    })
  },
  getStagedEntities(state) {
    return state.pointerDownPoint && state.livePoint
      ? buildRectanglePreview(state.pointerDownPoint, state.livePoint)
      : []
  },
  validate: validateRectangle,
  getPresentation: buildRectanglePresentation,
  createCommitContribution({ sequence, start, end, factories }): SketchToolCommitContribution {
    const { bottomLeft, bottomRight, topRight, topLeft } = getRectangleCorners(start, end)
    const cornerIds = [
      factories.createPointId('rect-bottom-left'),
      factories.createPointId('rect-bottom-right'),
      factories.createPointId('rect-top-right'),
      factories.createPointId('rect-top-left'),
    ] as const
    const entityIds = [
      factories.createEntityId('rect-bottom'),
      factories.createEntityId('rect-right'),
      factories.createEntityId('rect-top'),
      factories.createEntityId('rect-left'),
    ] as const

    return {
      points: [
        factories.createPoint(`Rectangle ${sequence} bottom left`, cornerIds[0], bottomLeft),
        factories.createPoint(`Rectangle ${sequence} bottom right`, cornerIds[1], bottomRight),
        factories.createPoint(`Rectangle ${sequence} top right`, cornerIds[2], topRight),
        factories.createPoint(`Rectangle ${sequence} top left`, cornerIds[3], topLeft),
      ],
      entities: [
        factories.createLineEntity(`Rectangle ${sequence} bottom`, entityIds[0], cornerIds[0], cornerIds[1]),
        factories.createLineEntity(`Rectangle ${sequence} right`, entityIds[1], cornerIds[1], cornerIds[2]),
        factories.createLineEntity(`Rectangle ${sequence} top`, entityIds[2], cornerIds[2], cornerIds[3]),
        factories.createLineEntity(`Rectangle ${sequence} left`, entityIds[3], cornerIds[3], cornerIds[0]),
      ],
      constraints: [
        {
          constraintId: factories.createConstraintId('bottom-horizontal'),
          kind: 'horizontal',
          label: `Rectangle ${sequence} bottom horizontal`,
          entityId: entityIds[0],
        },
        {
          constraintId: factories.createConstraintId('top-horizontal'),
          kind: 'horizontal',
          label: `Rectangle ${sequence} top horizontal`,
          entityId: entityIds[2],
        },
        {
          constraintId: factories.createConstraintId('right-vertical'),
          kind: 'vertical',
          label: `Rectangle ${sequence} right vertical`,
          entityId: entityIds[1],
        },
        {
          constraintId: factories.createConstraintId('left-vertical'),
          kind: 'vertical',
          label: `Rectangle ${sequence} left vertical`,
          entityId: entityIds[3],
        },
      ],
      dimensions: [
        {
          dimensionId: factories.createDimensionId('width'),
          kind: 'distance',
          label: `Rectangle ${sequence} width`,
          axis: 'horizontal',
          pointIds: [cornerIds[0], cornerIds[1]],
          value: Math.abs(topRight[0] - bottomLeft[0]),
        },
        {
          dimensionId: factories.createDimensionId('height'),
          kind: 'distance',
          label: `Rectangle ${sequence} height`,
          axis: 'vertical',
          pointIds: [cornerIds[0], cornerIds[3]],
          value: Math.abs(topRight[1] - bottomLeft[1]),
        },
      ],
    }
  },
}
