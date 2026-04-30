import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/core/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/core/sketch-tools/editor-schema'
import { createIdleState, distanceBetween } from '@/core/sketch-tools/shared'

const MIN_SPLINE_POINTS = 3
const EPSILON = 0.0001

function getPlacedPoints(state: SketchToolRuntimeState): readonly SketchPoint[] {
  return state.placedPoints ?? []
}

function hasDuplicateAdjacentPoint(points: readonly SketchPoint[]) {
  return points.some((point, index) =>
    index > 0 && distanceBetween(points[index - 1]!, point) <= EPSILON,
  )
}

function buildSplinePreview(points: readonly SketchPoint[]): readonly SketchDraftEntity[] {
  if (points.length < 2) {
    return []
  }

  return [
    {
      id: 'preview-spline',
      kind: 'spline',
      points,
      entityId: null,
      status: 'preview',
      label: 'Spline preview',
      isConstruction: false,
    },
  ]
}

function validateSpline(points: readonly SketchPoint[]) {
  if (points.length < MIN_SPLINE_POINTS) {
    return {
      valid: false,
      message: `Spline requires ${MIN_SPLINE_POINTS} points.`,
    }
  }

  if (hasDuplicateAdjacentPoint(points)) {
    return {
      valid: false,
      message: 'Spline points must be distinct.',
    }
  }

  return {
    valid: true,
    message: null,
  }
}

function buildSplinePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const placedPoints = getPlacedPoints(state)
  const previewPoints = state.livePoint && state.status === 'drawing'
    ? [...placedPoints, state.livePoint]
    : placedPoints
  const validation = state.validationMessage
    ? [{ id: 'spline-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const ready = previewPoints.length >= MIN_SPLINE_POINTS && validation.length === 0

  return {
    prompts: [
      {
        id: 'spline-prompt',
        text: ready ? 'Place final spline point' : 'Place spline points',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'spline-step', label: `${Math.min(previewPoints.length, MIN_SPLINE_POINTS)}/${MIN_SPLINE_POINTS} points` }],
    cursor: { id: 'spline-cursor', label: 'Spline point', icon: 'crosshair' },
    completionHints: [
      {
        id: 'spline-completion',
        text: ready ? 'Click to accept the spline' : `Place ${MIN_SPLINE_POINTS - previewPoints.length} more point${MIN_SPLINE_POINTS - previewPoints.length === 1 ? '' : 's'}`,
        ready,
      },
    ],
    overlays: [
      ...placedPoints.map((point, index) => ({
        id: `spline-point-${index}`,
        kind: 'anchor' as const,
        label: `Point ${index + 1}`,
        point,
      })),
      ...(previewPoints.at(-1)
        ? [{
            id: 'spline-completion-cue',
            kind: 'completionCue' as const,
            label: ready ? 'Accept spline' : 'Add point',
            point: previewPoints.at(-1)!,
            ready,
          }]
        : []),
    ],
    validation,
    extension: {
      id: 'spline-workflow',
      payload: {
        pointCount: previewPoints.length,
        minimumPointCount: MIN_SPLINE_POINTS,
        readyToComplete: ready,
      },
    },
  }
}

export const splineSketchToolDefinition: SketchToolDefinition<'spline'> = {
  metadata: {
    id: 'spline',
    group: 'drawing',
    name: 'Spline',
    tooltip: 'Create spline geometry.',
    icon: 'spline',
    modes: ['sketch'],
    dropdown: {
      familyId: 'spline-family',
      variantIds: ['spline', 'controlPointSpline'],
    },
  },
  activate() {
    const state = createIdleState()

    return {
      state,
      stagedEntities: [],
      presentation: buildSplinePresentation(state),
    }
  },
  pointerMove({ state, point }) {
    const nextState = {
      ...state,
      livePoint: point,
    }
    const previewPoints = point && state.status === 'drawing'
      ? [...getPlacedPoints(state), point]
      : getPlacedPoints(state)

    return {
      state: nextState,
      stagedEntities: buildSplinePreview(previewPoints),
      presentation: buildSplinePresentation(nextState),
    }
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return {
        state,
        stagedEntities: buildSplinePreview(getPlacedPoints(state)),
        presentation: buildSplinePresentation(state),
      }
    }

    const nextPoints = [...getPlacedPoints(state), point]
    const validation = validateSpline(nextPoints)
    const complete = nextPoints.length >= MIN_SPLINE_POINTS && validation.valid
    const nextState = {
      status: complete ? 'idle' : 'drawing',
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: point,
      placedPoints: nextPoints,
      validationMessage: complete || nextPoints.length < MIN_SPLINE_POINTS ? null : validation.message,
    } satisfies SketchToolRuntimeState

    return {
      state: nextState,
      stagedEntities: complete ? [] : buildSplinePreview(nextPoints),
      presentation: buildSplinePresentation(nextState),
    }
  },
  getStagedEntities(state) {
    const previewPoints = state.livePoint && state.status === 'drawing'
      ? [...getPlacedPoints(state), state.livePoint]
      : getPlacedPoints(state)

    return buildSplinePreview(previewPoints)
  },
  validate(start, end) {
    return validateSpline([start, end])
  },
  getPresentation: buildSplinePresentation,
  createCommitContribution({ sequence, points, factories }): SketchToolCommitContribution {
    const splinePoints = (points ?? []).slice(0, MIN_SPLINE_POINTS)
    const pointIds = splinePoints.map((_, index) => factories.createPointId(`spline-${index + 1}`))
    const entityId = factories.createEntityId('spline')

    return {
      points: splinePoints.map((point, index) =>
        factories.createPoint(`Spline ${sequence} point ${index + 1}`, pointIds[index]!, point),
      ),
      entities: [
        factories.createSplineEntity(`Spline ${sequence}`, entityId, pointIds),
      ],
    }
  },
}
