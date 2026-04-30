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
  createArcEndpointDimensions,
  createPointOnCurveConstraint,
} from '@/core/sketch-tools/constraints'
import {
  getArcSweepDirectionThroughPoint,
  getCircumcircleFromPoints,
  pointsDistinct,
  sampleArcPoints,
} from '@/core/sketch-tools/geometry'

const REQUIRED_POINTS = 3

function getPlacedPoints(state: SketchToolRuntimeState): readonly SketchPoint[] {
  return state.placedPoints ?? []
}

function buildThreePointArcPreview(points: readonly SketchPoint[]): readonly SketchDraftEntity[] {
  if (points.length < 2) {
    return []
  }

  if (points.length < 3) {
    return [{ id: 'preview-three-point-arc-chord', kind: 'line', start: points[0]!, end: points[1]!, entityId: null, status: 'preview', label: '3-point arc chord', isConstruction: false }]
  }

  const circle = getCircumcircleFromPoints(points[0]!, points[1]!, points[2]!)
  if (!circle) {
    return []
  }

  const sweepDirection = getArcSweepDirectionThroughPoint(circle.center, points[0]!, points[1]!, points[2]!)

  return [{
    id: 'preview-three-point-arc',
    kind: 'polyline',
    points: sampleArcPoints(circle.center, points[0]!, points[2]!, sweepDirection),
    isClosed: false,
    entityId: null,
    status: 'preview',
    label: '3-point arc preview',
    isConstruction: false,
  }]
}

function validateThreePointArc(points: readonly SketchPoint[]): SketchToolValidationResult {
  if (points.length < REQUIRED_POINTS) {
    return { valid: false, message: `3-point arc requires ${REQUIRED_POINTS} points.` }
  }

  if (!pointsDistinct(points[0]!, points[1]!) || !pointsDistinct(points[1]!, points[2]!) || !pointsDistinct(points[0]!, points[2]!)) {
    return { valid: false, message: '3-point arc points must be distinct.' }
  }

  return getCircumcircleFromPoints(points[0]!, points[1]!, points[2]!)
    ? { valid: true, message: null }
    : { valid: false, message: '3-point arc points must not be collinear.' }
}

function buildThreePointArcPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const points = state.livePoint && state.status === 'drawing'
    ? [...getPlacedPoints(state), state.livePoint]
    : getPlacedPoints(state)
  const validation = state.validationMessage
    ? [{ id: 'three-point-arc-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const ready = validateThreePointArc(points).valid

  return {
    prompts: [{ id: 'three-point-arc-prompt', text: ready ? 'Place arc' : 'Pick arc points', tone: validation.length > 0 ? 'warning' : 'neutral' }],
    steps: [{ id: 'three-point-arc-step', label: `${Math.min(points.length, REQUIRED_POINTS)}/${REQUIRED_POINTS} points` }],
    completionHints: [{ id: 'three-point-arc-completion', text: ready ? 'Click to accept the arc' : `Place ${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS)} more point${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS) === 1 ? '' : 's'}`, ready }],
    overlays: [
      ...getPlacedPoints(state).map((point, index) => ({ id: `three-point-arc-point-${index}`, kind: 'anchor' as const, label: `Point ${index + 1}`, point })),
      ...(points.at(-1) ? [{ id: 'three-point-arc-cue', kind: 'completionCue' as const, label: ready ? 'Accept arc' : 'Add point', point: points.at(-1)!, ready }] : []),
    ],
    validation,
  }
}

export const threePointArcSketchToolDefinition: SketchToolDefinition<'threePointArc'> = {
  metadata: {
    id: 'threePointArc',
    group: 'drawing',
    name: '3-Point Arc',
    tooltip: 'Create an arc through three points.',
    icon: 'circle',
    modes: ['sketch'],
  },
  activate() {
    const state = { status: 'idle', pointerDownPoint: null, livePoint: null, placedPoints: [], validationMessage: null } satisfies SketchToolRuntimeState

    return { state, stagedEntities: [], presentation: buildThreePointArcPresentation(state) }
  },
  pointerMove({ state, point }) {
    const nextState = { ...state, livePoint: point }
    const previewPoints = point && state.status === 'drawing' ? [...getPlacedPoints(state), point] : getPlacedPoints(state)

    return { state: nextState, stagedEntities: buildThreePointArcPreview(previewPoints), presentation: buildThreePointArcPresentation(nextState) }
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return { state, stagedEntities: buildThreePointArcPreview(getPlacedPoints(state)), presentation: buildThreePointArcPresentation(state) }
    }

    const nextPoints = [...getPlacedPoints(state), point]
    const validation = validateThreePointArc(nextPoints)
    const complete = nextPoints.length >= REQUIRED_POINTS && validation.valid
    const nextState = {
      status: complete ? 'idle' : 'drawing',
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: point,
      placedPoints: nextPoints,
      validationMessage: complete || nextPoints.length < REQUIRED_POINTS ? null : validation.message,
    } satisfies SketchToolRuntimeState

    return { state: nextState, stagedEntities: complete ? [] : buildThreePointArcPreview(nextPoints), presentation: buildThreePointArcPresentation(nextState) }
  },
  getStagedEntities(state) {
    const points = state.livePoint && state.status === 'drawing'
      ? [...getPlacedPoints(state), state.livePoint]
      : getPlacedPoints(state)

    return buildThreePointArcPreview(points)
  },
  validate(start, end) {
    return validateThreePointArc([start, end])
  },
  getPresentation: buildThreePointArcPresentation,
  createCommitContribution({ sequence, points, factories }): SketchToolCommitContribution {
    const arcPoints = (points ?? []).slice(0, REQUIRED_POINTS)
    const circle = arcPoints.length === REQUIRED_POINTS
      ? getCircumcircleFromPoints(arcPoints[0]!, arcPoints[1]!, arcPoints[2]!)
      : null
    if (!circle) {
      return { points: [], entities: [] }
    }

    const centerPointId = factories.createPointId('three-point-arc-center')
    const startPointId = factories.createPointId('three-point-arc-start')
    const throughPointId = factories.createPointId('three-point-arc-through')
    const endPointId = factories.createPointId('three-point-arc-end')
    const entityId = factories.createEntityId('three-point-arc')
    const sweepDirection = getArcSweepDirectionThroughPoint(circle.center, arcPoints[0]!, arcPoints[1]!, arcPoints[2]!)

    return {
      points: [
        factories.createPoint(`3-point arc ${sequence} center`, centerPointId, circle.center),
        factories.createPoint(`3-point arc ${sequence} start`, startPointId, arcPoints[0]!),
        factories.createPoint(`3-point arc ${sequence} through`, throughPointId, arcPoints[1]!),
        factories.createPoint(`3-point arc ${sequence} end`, endPointId, arcPoints[2]!),
      ],
      entities: [
        factories.createArcEntity(`3-point arc ${sequence}`, entityId, centerPointId, startPointId, endPointId, sweepDirection),
      ],
      constraints: [
        createPointOnCurveConstraint({ constraintId: factories.createConstraintId('three-point-arc-through'), label: `3-point arc ${sequence} through point`, pointId: throughPointId, curveEntityId: entityId }),
      ],
      dimensions: createArcEndpointDimensions({ createDimensionId: factories.createDimensionId, labelPrefix: `3-point arc ${sequence}`, entityId, startPointId, endPointId }),
    }
  },
}
