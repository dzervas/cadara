import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolPointerInput,
  SketchToolPointerResult,
  SketchToolRuntimeState,
  SketchToolValidationResult,
} from '@/domain/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'

const epsilon = 0.0001

export function distanceBetween(start: SketchPoint, end: SketchPoint) {
  return Math.hypot(end[0] - start[0], end[1] - start[1])
}

export function angleBetweenDegrees(start: SketchPoint, end: SketchPoint) {
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * (180 / Math.PI)
  return angle < 0 ? angle + 360 : angle
}

export function midpoint(start: SketchPoint, end: SketchPoint): SketchPoint {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
}

export function validateDistance(
  start: SketchPoint,
  end: SketchPoint,
  message: string,
): SketchToolValidationResult {
  return {
    valid: distanceBetween(start, end) > epsilon,
    message: distanceBetween(start, end) > epsilon ? null : message,
  }
}

export function validateRectangle(start: SketchPoint, end: SketchPoint): SketchToolValidationResult {
  const valid = Math.abs(end[0] - start[0]) > epsilon && Math.abs(end[1] - start[1]) > epsilon

  return {
    valid,
    message: valid ? null : 'Rectangle requires non-zero width and height.',
  }
}

export function createIdleState(): SketchToolRuntimeState {
  return {
    status: 'idle',
    pointerDownPoint: null,
    livePoint: null,
    validationMessage: null,
  }
}

export function createPointerMoveResult(input: {
  pointerInput: SketchToolPointerInput
  buildPreview(start: SketchPoint, end: SketchPoint): readonly SketchDraftEntity[]
  buildPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema
  validate(start: SketchPoint, end: SketchPoint): SketchToolValidationResult
}): SketchToolPointerResult {
  const { state, point } = input.pointerInput

  if (state.status !== 'drawing' || state.pointerDownPoint === null || point === null) {
    const nextState = {
      ...state,
      livePoint: point,
    }

    return {
      state: nextState,
      stagedEntities: [],
      presentation: input.buildPresentation(nextState),
    }
  }

  const validation = input.validate(state.pointerDownPoint, point)
  const nextState = {
    ...state,
    livePoint: point,
    validationMessage: validation.message,
  }

  return {
    state: nextState,
    stagedEntities: input.buildPreview(state.pointerDownPoint, point),
    presentation: input.buildPresentation(nextState),
  }
}

export function createPointerReleaseResult(input: {
  pointerInput: SketchToolPointerInput
  buildPreview(start: SketchPoint, end: SketchPoint): readonly SketchDraftEntity[]
  buildPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema
  validate(start: SketchPoint, end: SketchPoint): SketchToolValidationResult
}): SketchToolPointerResult {
  const { state, point } = input.pointerInput

  if (point === null) {
    return {
      state,
      stagedEntities: [],
      presentation: input.buildPresentation(state),
    }
  }

  if (state.status !== 'drawing' || state.pointerDownPoint === null) {
    const validation = input.validate(point, point)
    const nextState = {
      status: 'drawing',
      pointerDownPoint: point,
      livePoint: point,
      validationMessage: validation.message,
    } satisfies SketchToolRuntimeState

    return {
      state: nextState,
      stagedEntities: input.buildPreview(point, point),
      presentation: input.buildPresentation(nextState),
    }
  }

  const validation = input.validate(state.pointerDownPoint, point)
  const nextState = {
    status: 'idle',
    pointerDownPoint: null,
    livePoint: point,
    validationMessage: validation.message,
  } satisfies SketchToolRuntimeState

  return {
    state: nextState,
    stagedEntities: validation.valid ? [] : [],
    presentation: input.buildPresentation(nextState),
  }
}
