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
  createArcEndpointDimensions,
  createDistanceDimension,
} from '@/domain/sketch-tools/constraints'
import {
  pointsDistinct,
  sampleArcPoints,
} from '@/domain/sketch-tools/geometry'
import { distanceBetween } from '@/domain/sketch-tools/shared'

const REQUIRED_POINTS = 3

function getPlacedPoints(state: SketchToolRuntimeState): readonly SketchPoint[] {
  return state.placedPoints ?? []
}

function buildCenterPointArcPreview(points: readonly SketchPoint[]): readonly SketchDraftEntity[] {
  if (points.length < 2) {
    return []
  }

  if (points.length < 3) {
    return [{
      id: 'preview-center-point-arc-radius',
      kind: 'line',
      start: points[0]!,
      end: points[1]!,
      entityId: null,
      status: 'preview',
      label: 'Center-point arc radius',
      isConstruction: false,
    }]
  }

  return [{
    id: 'preview-center-point-arc',
    kind: 'polyline',
    points: sampleArcPoints(points[0]!, points[1]!, points[2]!, 'counterClockwise'),
    isClosed: false,
    entityId: null,
    status: 'preview',
    label: 'Center-point arc preview',
    isConstruction: false,
  }]
}

function validateCenterPointArc(points: readonly SketchPoint[]): SketchToolValidationResult {
  if (points.length < REQUIRED_POINTS) {
    return { valid: false, message: `Center-point arc requires ${REQUIRED_POINTS} points.` }
  }

  if (!pointsDistinct(points[0]!, points[1]!) || !pointsDistinct(points[0]!, points[2]!)) {
    return { valid: false, message: 'Arc radius must be greater than zero.' }
  }

  return { valid: true, message: null }
}

function buildCenterPointArcPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const points = state.livePoint && state.status === 'drawing'
    ? [...getPlacedPoints(state), state.livePoint]
    : getPlacedPoints(state)
  const validation = state.validationMessage
    ? [{ id: 'center-point-arc-validation', message: state.validationMessage, severity: 'error' as const }]
    : []
  const ready = validateCenterPointArc(points).valid
  const radius = points.length >= 2 ? distanceBetween(points[0]!, points[1]!) : null

  return {
    prompts: [{ id: 'center-point-arc-prompt', text: points.length < 2 ? 'Pick center and start' : 'Place arc end', tone: validation.length > 0 ? 'warning' : 'neutral' }],
    steps: [{ id: 'center-point-arc-step', label: `${Math.min(points.length, REQUIRED_POINTS)}/${REQUIRED_POINTS} points` }],
    measurements: radius === null ? [] : [{ id: 'center-point-arc-radius', label: 'Radius', value: radius, unit: 'mm' }],
    completionHints: [{ id: 'center-point-arc-completion', text: ready ? 'Click to accept the arc' : `Place ${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS)} more point${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS) === 1 ? '' : 's'}`, ready }],
    overlays: [
      ...getPlacedPoints(state).map((point, index) => ({ id: `center-point-arc-point-${index}`, kind: 'anchor' as const, label: `Point ${index + 1}`, point })),
      ...(points.at(-1) ? [{ id: 'center-point-arc-cue', kind: 'completionCue' as const, label: ready ? 'Accept arc' : 'Add point', point: points.at(-1)!, ready }] : []),
    ],
    validation,
  }
}

export const centerPointArcSketchToolDefinition: SketchToolDefinition<'centerPointArc'> = {
  metadata: {
    id: 'centerPointArc',
    group: 'drawing',
    name: 'Center Arc',
    tooltip: 'Create an arc from center, start, and end points.',
    icon: 'circle',
    modes: ['sketch'],
    dropdown: {
      familyId: 'arc-family',
      variantIds: ['centerPointArc', 'threePointArc', 'tangentArc'],
    },
  },
  activate() {
    const state = { status: 'idle', pointerDownPoint: null, livePoint: null, placedPoints: [], validationMessage: null } satisfies SketchToolRuntimeState

    return { state, stagedEntities: [], presentation: buildCenterPointArcPresentation(state) }
  },
  pointerMove({ state, point }) {
    const nextState = { ...state, livePoint: point }
    const previewPoints = point && state.status === 'drawing' ? [...getPlacedPoints(state), point] : getPlacedPoints(state)

    return { state: nextState, stagedEntities: buildCenterPointArcPreview(previewPoints), presentation: buildCenterPointArcPresentation(nextState) }
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return { state, stagedEntities: buildCenterPointArcPreview(getPlacedPoints(state)), presentation: buildCenterPointArcPresentation(state) }
    }

    const nextPoints = [...getPlacedPoints(state), point]
    const validation = validateCenterPointArc(nextPoints)
    const complete = nextPoints.length >= REQUIRED_POINTS && validation.valid
    const nextState = {
      status: complete ? 'idle' : 'drawing',
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: point,
      placedPoints: nextPoints,
      validationMessage: complete || nextPoints.length < REQUIRED_POINTS ? null : validation.message,
    } satisfies SketchToolRuntimeState

    return { state: nextState, stagedEntities: complete ? [] : buildCenterPointArcPreview(nextPoints), presentation: buildCenterPointArcPresentation(nextState) }
  },
  getStagedEntities(state) {
    const points = state.livePoint && state.status === 'drawing'
      ? [...getPlacedPoints(state), state.livePoint]
      : getPlacedPoints(state)

    return buildCenterPointArcPreview(points)
  },
  validate(start, end) {
    return pointsDistinct(start, end)
      ? { valid: false, message: `Center-point arc requires ${REQUIRED_POINTS} points.` }
      : { valid: false, message: 'Arc radius must be greater than zero.' }
  },
  getPresentation: buildCenterPointArcPresentation,
  createCommitContribution({ sequence, points, factories }): SketchToolCommitContribution {
    const arcPoints = (points ?? []).slice(0, REQUIRED_POINTS)
    if (arcPoints.length < REQUIRED_POINTS) {
      return { points: [], entities: [] }
    }

    const centerPointId = factories.createPointId('center-arc-center')
    const startPointId = factories.createPointId('center-arc-start')
    const endPointId = factories.createPointId('center-arc-end')
    const entityId = factories.createEntityId('center-arc')

    return {
      points: [
        factories.createPoint(`Center arc ${sequence} center`, centerPointId, arcPoints[0]!),
        factories.createPoint(`Center arc ${sequence} start`, startPointId, arcPoints[1]!),
        factories.createPoint(`Center arc ${sequence} end`, endPointId, arcPoints[2]!),
      ],
      entities: [
        factories.createArcEntity(`Center arc ${sequence}`, entityId, centerPointId, startPointId, endPointId, 'counterClockwise'),
      ],
      dimensions: [
        createDistanceDimension({ dimensionId: factories.createDimensionId('center-arc-radius'), label: `Center arc ${sequence} radius`, axis: 'aligned', pointIds: [centerPointId, startPointId], value: distanceBetween(arcPoints[0]!, arcPoints[1]!) }),
        ...createArcEndpointDimensions({ createDimensionId: factories.createDimensionId, labelPrefix: `Center arc ${sequence}`, entityId, startPointId, endPointId }),
      ],
    }
  },
}
