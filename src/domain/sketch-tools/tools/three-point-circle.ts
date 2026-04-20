import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
  SketchToolValidationResult,
} from '@/domain/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import {
  createCircleRadiusDimension,
  createPointOnCurveConstraint,
} from '@/domain/sketch-tools/constraints'
import { getCircumcircleFromPoints, pointsDistinct } from '@/domain/sketch-tools/geometry'

const REQUIRED_POINTS = 3

function getPlacedPoints(state: SketchToolRuntimeState): readonly SketchPoint[] {
  return state.placedPoints ?? []
}

function buildThreePointCirclePreview(points: readonly SketchPoint[]): readonly SketchDraftEntity[] {
  if (points.length < REQUIRED_POINTS) {
    return points.length >= 2
      ? [{
          id: 'preview-three-point-circle-chord',
          kind: 'line',
          start: points[0]!,
          end: points[1]!,
          entityId: null,
          status: 'preview',
          label: '3-point circle chord',
          isConstruction: false,
        }]
      : []
  }

  const circle = getCircumcircleFromPoints(points[0]!, points[1]!, points[2]!)

  return circle
    ? [{
        id: 'preview-three-point-circle',
        kind: 'circle',
        center: circle.center,
        radius: circle.radius,
        entityId: null,
        status: 'preview',
        label: '3-point circle preview',
        isConstruction: false,
      }]
    : []
}

function validateThreePointCircle(points: readonly SketchPoint[]): SketchToolValidationResult {
  if (points.length < REQUIRED_POINTS) {
    return { valid: false, message: `3-point circle requires ${REQUIRED_POINTS} points.` }
  }

  if (!pointsDistinct(points[0]!, points[1]!) || !pointsDistinct(points[1]!, points[2]!) || !pointsDistinct(points[0]!, points[2]!)) {
    return { valid: false, message: '3-point circle points must be distinct.' }
  }

  return getCircumcircleFromPoints(points[0]!, points[1]!, points[2]!)
    ? { valid: true, message: null }
    : { valid: false, message: '3-point circle points must not be collinear.' }
}

function buildThreePointCirclePresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const points = state.livePoint && state.status === 'drawing'
    ? [...getPlacedPoints(state), state.livePoint]
    : getPlacedPoints(state)
  const validation = state.validationMessage
    ? [{ id: 'three-point-circle-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const circle = points.length >= REQUIRED_POINTS
    ? getCircumcircleFromPoints(points[0]!, points[1]!, points[2]!)
    : null
  const ready = validateThreePointCircle(points).valid

  return {
    prompts: [
      {
        id: 'three-point-circle-prompt',
        text: ready ? 'Place circle' : 'Pick circle points',
        tone: validation.length > 0 ? 'warning' : 'neutral',
      },
    ],
    steps: [{ id: 'three-point-circle-step', label: `${Math.min(points.length, REQUIRED_POINTS)}/${REQUIRED_POINTS} points` }],
    measurements: circle
      ? [{ id: 'three-point-circle-radius', label: 'Radius', value: circle.radius, unit: 'mm' }]
      : [],
    completionHints: [
      {
        id: 'three-point-circle-completion',
        text: ready ? 'Click to accept the circle' : `Place ${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS)} more point${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS) === 1 ? '' : 's'}`,
        ready,
      },
    ],
    overlays: [
      ...getPlacedPoints(state).map((point, index) => ({
        id: `three-point-circle-point-${index}`,
        kind: 'anchor' as const,
        label: `Point ${index + 1}`,
        point,
      })),
      ...(points.at(-1)
        ? [{ id: 'three-point-circle-cue', kind: 'completionCue' as const, label: ready ? 'Accept circle' : 'Add point', point: points.at(-1)!, ready }]
        : []),
    ],
    validation,
  }
}

export const threePointCircleSketchToolDefinition: SketchToolDefinition<'threePointCircle'> = {
  metadata: {
    id: 'threePointCircle',
    group: 'drawing',
    name: '3-Point Circle',
    tooltip: 'Create a circle through three points.',
    icon: 'circle',
    modes: ['sketch'],
  },
  activate() {
    const state = { status: 'idle', pointerDownPoint: null, livePoint: null, placedPoints: [], validationMessage: null } satisfies SketchToolRuntimeState

    return { state, stagedEntities: [], presentation: buildThreePointCirclePresentation(state) }
  },
  pointerMove({ state, point }) {
    const nextState = { ...state, livePoint: point }
    const previewPoints = point && state.status === 'drawing' ? [...getPlacedPoints(state), point] : getPlacedPoints(state)

    return { state: nextState, stagedEntities: buildThreePointCirclePreview(previewPoints), presentation: buildThreePointCirclePresentation(nextState) }
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return { state, stagedEntities: buildThreePointCirclePreview(getPlacedPoints(state)), presentation: buildThreePointCirclePresentation(state) }
    }

    const nextPoints = [...getPlacedPoints(state), point]
    const validation = validateThreePointCircle(nextPoints)
    const complete = nextPoints.length >= REQUIRED_POINTS && validation.valid
    const nextState = {
      status: complete ? 'idle' : 'drawing',
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: point,
      placedPoints: nextPoints,
      validationMessage: complete || nextPoints.length < REQUIRED_POINTS ? null : validation.message,
    } satisfies SketchToolRuntimeState

    return { state: nextState, stagedEntities: complete ? [] : buildThreePointCirclePreview(nextPoints), presentation: buildThreePointCirclePresentation(nextState) }
  },
  getStagedEntities(state) {
    const points = state.livePoint && state.status === 'drawing'
      ? [...getPlacedPoints(state), state.livePoint]
      : getPlacedPoints(state)

    return buildThreePointCirclePreview(points)
  },
  validate(start, end) {
    return validateThreePointCircle([start, end])
  },
  getPresentation: buildThreePointCirclePresentation,
  createCommitContribution({ sequence, points, factories }): SketchToolCommitContribution {
    const circlePoints = (points ?? []).slice(0, REQUIRED_POINTS)
    const circle = circlePoints.length === REQUIRED_POINTS
      ? getCircumcircleFromPoints(circlePoints[0]!, circlePoints[1]!, circlePoints[2]!)
      : null

    if (!circle) {
      return { points: [], entities: [] }
    }

    const centerPointId = factories.createPointId('three-point-circle-center')
    const perimeterPointIds = circlePoints.map((_, index) => factories.createPointId(`three-point-circle-${index + 1}`))
    const entityId = factories.createEntityId('three-point-circle')

    return {
      points: [
        factories.createPoint(`3-point circle ${sequence} center`, centerPointId, circle.center),
        ...circlePoints.map((point, index) =>
          factories.createPoint(`3-point circle ${sequence} point ${index + 1}`, perimeterPointIds[index]!, point),
        ),
      ],
      entities: [
        factories.createCircleEntity(`3-point circle ${sequence}`, entityId, centerPointId, circle.radius),
      ],
      constraints: perimeterPointIds.map((pointId, index) =>
        createPointOnCurveConstraint({
          constraintId: factories.createConstraintId(`three-point-circle-point-${index + 1}`),
          label: `3-point circle ${sequence} point ${index + 1}`,
          pointId,
          curveEntityId: entityId,
        }),
      ),
      dimensions: [
        createCircleRadiusDimension({
          dimensionId: factories.createDimensionId('three-point-circle-radius'),
          label: `3-point circle ${sequence} radius`,
          entityId,
          value: circle.radius,
        }),
      ],
    }
  },
}
