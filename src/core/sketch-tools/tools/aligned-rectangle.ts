import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
  SketchToolValidationResult,
} from '@/core/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/core/sketch-tools/editor-schema'
import {
  createDistanceDimension,
  createEqualLengthConstraint,
  createParallelConstraint,
  createPerpendicularConstraint,
} from '@/core/sketch-tools/constraints'
import {
  getAlignedRectangleCorners,
  pointsDistinct,
  SKETCH_TOOL_EPSILON,
} from '@/core/sketch-tools/geometry'

const REQUIRED_POINTS = 3

function getPlacedPoints(state: SketchToolRuntimeState): readonly SketchPoint[] {
  return state.placedPoints ?? []
}

function buildAlignedRectanglePreview(points: readonly SketchPoint[]): readonly SketchDraftEntity[] {
  if (points.length < 2) {
    return []
  }

  if (points.length < 3) {
    return [
      {
        id: 'preview-aligned-rectangle-edge',
        kind: 'line',
        start: points[0]!,
        end: points[1]!,
        entityId: null,
        status: 'preview',
        label: 'Aligned rectangle first edge',
        isConstruction: false,
      },
    ]
  }

  const corners = getAlignedRectangleCorners(points[0]!, points[1]!, points[2]!)
  if (!corners) {
    return []
  }

  return [
    { id: 'preview-aligned-rect-bottom', kind: 'line', start: corners.first, end: corners.second, entityId: null, status: 'preview', label: 'Aligned rectangle preview bottom', isConstruction: false },
    { id: 'preview-aligned-rect-right', kind: 'line', start: corners.second, end: corners.third, entityId: null, status: 'preview', label: 'Aligned rectangle preview right', isConstruction: false },
    { id: 'preview-aligned-rect-top', kind: 'line', start: corners.third, end: corners.fourth, entityId: null, status: 'preview', label: 'Aligned rectangle preview top', isConstruction: false },
    { id: 'preview-aligned-rect-left', kind: 'line', start: corners.fourth, end: corners.first, entityId: null, status: 'preview', label: 'Aligned rectangle preview left', isConstruction: false },
  ]
}

function validateAlignedRectanglePoints(points: readonly SketchPoint[]): SketchToolValidationResult {
  if (points.length < REQUIRED_POINTS) {
    return { valid: false, message: `Aligned rectangle requires ${REQUIRED_POINTS} points.` }
  }

  if (!pointsDistinct(points[0]!, points[1]!)) {
    return { valid: false, message: 'Aligned rectangle first edge must have length.' }
  }

  const corners = getAlignedRectangleCorners(points[0]!, points[1]!, points[2]!)
  if (!corners || corners.height <= SKETCH_TOOL_EPSILON) {
    return { valid: false, message: 'Aligned rectangle height must be greater than zero.' }
  }

  return { valid: true, message: null }
}

function buildAlignedRectanglePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const points = state.livePoint && state.status === 'drawing'
    ? [...getPlacedPoints(state), state.livePoint]
    : getPlacedPoints(state)
  const validation = state.validationMessage
    ? [{ id: 'aligned-rectangle-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const corners = points.length >= 3 ? getAlignedRectangleCorners(points[0]!, points[1]!, points[2]!) : null
  const ready = validateAlignedRectanglePoints(points).valid

  return {
    prompts: [
      {
        id: 'aligned-rectangle-prompt',
        text: points.length < 2 ? 'Pick first edge' : 'Set rectangle height',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'aligned-rectangle-step', label: `${Math.min(points.length, REQUIRED_POINTS)}/${REQUIRED_POINTS} points` }],
    measurements: corners
      ? [
          { id: 'aligned-rectangle-width', label: 'Width', value: corners.width, unit: 'mm' },
          { id: 'aligned-rectangle-height', label: 'Height', value: corners.height, unit: 'mm' },
        ]
      : [],
    completionHints: [
      {
        id: 'aligned-rectangle-completion',
        text: ready ? 'Click to accept the aligned rectangle' : `Place ${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS)} more point${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS) === 1 ? '' : 's'}`,
        ready,
      },
    ],
    overlays: [
      ...getPlacedPoints(state).map((point, index) => ({
        id: `aligned-rectangle-point-${index}`,
        kind: 'anchor' as const,
        label: `Point ${index + 1}`,
        point,
      })),
      ...(points.at(-1)
        ? [{
            id: 'aligned-rectangle-completion-cue',
            kind: 'completionCue' as const,
            label: ready ? 'Accept rectangle' : 'Add point',
            point: points.at(-1)!,
            ready,
          }]
        : []),
    ],
    validation,
  }
}

export const alignedRectangleSketchToolDefinition: SketchToolDefinition<'alignedRectangle'> = {
  metadata: {
    id: 'alignedRectangle',
    group: 'drawing',
    name: 'Aligned Rectangle',
    tooltip: 'Create a rectangle aligned to a selected first edge.',
    icon: 'rectangle',
    modes: ['sketch'],
  },
  activate() {
    const state = {
      status: 'idle',
      pointerDownPoint: null,
      livePoint: null,
      placedPoints: [],
      validationMessage: null,
    } satisfies SketchToolRuntimeState

    return { state, stagedEntities: [], presentation: buildAlignedRectanglePresentation(state) }
  },
  pointerMove({ state, point }) {
    const nextState = { ...state, livePoint: point }
    const previewPoints = point && state.status === 'drawing'
      ? [...getPlacedPoints(state), point]
      : getPlacedPoints(state)

    return {
      state: nextState,
      stagedEntities: buildAlignedRectanglePreview(previewPoints),
      presentation: buildAlignedRectanglePresentation(nextState),
    }
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return { state, stagedEntities: buildAlignedRectanglePreview(getPlacedPoints(state)), presentation: buildAlignedRectanglePresentation(state) }
    }

    const nextPoints = [...getPlacedPoints(state), point]
    const validation = validateAlignedRectanglePoints(nextPoints)
    const complete = nextPoints.length >= REQUIRED_POINTS && validation.valid
    const nextState = {
      status: complete ? 'idle' : 'drawing',
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: point,
      placedPoints: nextPoints,
      validationMessage: complete || nextPoints.length < REQUIRED_POINTS ? null : validation.message,
    } satisfies SketchToolRuntimeState

    return {
      state: nextState,
      stagedEntities: complete ? [] : buildAlignedRectanglePreview(nextPoints),
      presentation: buildAlignedRectanglePresentation(nextState),
    }
  },
  getStagedEntities(state) {
    const points = state.livePoint && state.status === 'drawing'
      ? [...getPlacedPoints(state), state.livePoint]
      : getPlacedPoints(state)

    return buildAlignedRectanglePreview(points)
  },
  validate(start, end) {
    return pointsDistinct(start, end)
      ? { valid: false, message: `Aligned rectangle requires ${REQUIRED_POINTS} points.` }
      : { valid: false, message: 'Aligned rectangle first edge must have length.' }
  },
  getPresentation: buildAlignedRectanglePresentation,
  createCommitContribution({ sequence, points, factories }): SketchToolCommitContribution {
    const corners = getAlignedRectangleCorners(points?.[0] ?? [0, 0], points?.[1] ?? [0, 0], points?.[2] ?? [0, 0])
    if (!corners) {
      return { points: [], entities: [] }
    }

    const cornerIds = [
      factories.createPointId('aligned-rect-first'),
      factories.createPointId('aligned-rect-second'),
      factories.createPointId('aligned-rect-third'),
      factories.createPointId('aligned-rect-fourth'),
    ] as const
    const entityIds = [
      factories.createEntityId('aligned-rect-bottom'),
      factories.createEntityId('aligned-rect-right'),
      factories.createEntityId('aligned-rect-top'),
      factories.createEntityId('aligned-rect-left'),
    ] as const

    return {
      points: [
        factories.createPoint(`Aligned rectangle ${sequence} first`, cornerIds[0], corners.first),
        factories.createPoint(`Aligned rectangle ${sequence} second`, cornerIds[1], corners.second),
        factories.createPoint(`Aligned rectangle ${sequence} third`, cornerIds[2], corners.third),
        factories.createPoint(`Aligned rectangle ${sequence} fourth`, cornerIds[3], corners.fourth),
      ],
      entities: [
        factories.createLineEntity(`Aligned rectangle ${sequence} bottom`, entityIds[0], cornerIds[0], cornerIds[1]),
        factories.createLineEntity(`Aligned rectangle ${sequence} right`, entityIds[1], cornerIds[1], cornerIds[2]),
        factories.createLineEntity(`Aligned rectangle ${sequence} top`, entityIds[2], cornerIds[2], cornerIds[3]),
        factories.createLineEntity(`Aligned rectangle ${sequence} left`, entityIds[3], cornerIds[3], cornerIds[0]),
      ],
      constraints: [
        createParallelConstraint({ constraintId: factories.createConstraintId('aligned-rect-horizontal-pair'), label: `Aligned rectangle ${sequence} opposite edges`, entityIds: [entityIds[0], entityIds[2]] }),
        createParallelConstraint({ constraintId: factories.createConstraintId('aligned-rect-vertical-pair'), label: `Aligned rectangle ${sequence} side edges`, entityIds: [entityIds[1], entityIds[3]] }),
        createPerpendicularConstraint({ constraintId: factories.createConstraintId('aligned-rect-corner'), label: `Aligned rectangle ${sequence} corner`, entityIds: [entityIds[0], entityIds[1]] }),
        createEqualLengthConstraint({ constraintId: factories.createConstraintId('aligned-rect-widths'), label: `Aligned rectangle ${sequence} equal widths`, entityIds: [entityIds[0], entityIds[2]] }),
        createEqualLengthConstraint({ constraintId: factories.createConstraintId('aligned-rect-heights'), label: `Aligned rectangle ${sequence} equal heights`, entityIds: [entityIds[1], entityIds[3]] }),
      ],
      dimensions: [
        createDistanceDimension({ dimensionId: factories.createDimensionId('aligned-rect-width'), label: `Aligned rectangle ${sequence} width`, axis: 'aligned', pointIds: [cornerIds[0], cornerIds[1]], value: corners.width }),
        createDistanceDimension({ dimensionId: factories.createDimensionId('aligned-rect-height'), label: `Aligned rectangle ${sequence} height`, axis: 'aligned', pointIds: [cornerIds[1], cornerIds[2]], value: corners.height }),
      ],
    }
  },
}
