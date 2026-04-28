import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationConstraint,
  ReferenceImageCalibrationState,
  ReferenceImageOperationState,
  ReferenceImagePayload,
  SolvedReferenceImageCalibrationState,
  SolvedReferenceImageOperationState,
} from '@/contracts/reference-image/schema'
import type { SketchPoint2D } from '@/contracts/sketch/schema'

import { solveReferenceImageCalibration } from '@/domain/reference-image-calibration/solver/solve-reference-image-calibration'

export function createDefaultReferenceImageCalibrationState(): ReferenceImageCalibrationState {
  return {
    scaleMode: 'lockedAspect',
    showExportedAnchorsInSketch: false,
    anchors: [],
    constraints: [],
  }
}

export function solveReferenceImageOperationState(
  state: ReferenceImageOperationState,
): SolvedReferenceImageOperationState {
  const calibration = state.calibration ?? createDefaultReferenceImageCalibrationState()
  const solveResult = solveReferenceImageCalibration({
    image: state.image,
    initialPlacement: state.placement,
    scaleMode: calibration.scaleMode,
    anchors: calibration.anchors,
    constraints: calibration.constraints,
  })

  return {
    ...state,
    placement: canExportSolvedReferenceImageAnchors({
      ...calibration,
      solveResult,
    })
      ? solveResult.placement
      : state.placement,
    calibration: {
      ...calibration,
      solveResult,
    },
  }
}

export function createReferenceImageCalibrationAnchor(input: {
  anchorId: string
  anchorIndex: number
  uv: SketchPoint2D
  worldPosition: SketchPoint2D | null
}): ReferenceImageCalibrationAnchor {
  return {
    anchorId: input.anchorId,
    label: `Anchor ${input.anchorIndex + 1}`,
    uv: clampUv(input.uv),
    worldPosition: input.worldPosition,
  }
}

export function createReferenceImageCalibrationConstraint(input: {
  constraintId: string
  constraintIndex: number
  firstAnchorId: string
  secondAnchorId: string
  distance: number
}): ReferenceImageCalibrationConstraint {
  return {
    constraintId: input.constraintId,
    kind: 'distance',
    label: `Distance ${input.constraintIndex + 1}`,
    firstAnchorId: input.firstAnchorId,
    secondAnchorId: input.secondAnchorId,
    distance: input.distance,
  }
}

export function stripReferenceImageRuntimeState(
  state: ReferenceImageOperationState,
): ReferenceImageOperationState {
  const calibration = state.calibration

  return {
    ...state,
    calibration: calibration
      ? {
          scaleMode: calibration.scaleMode,
          showExportedAnchorsInSketch: calibration.showExportedAnchorsInSketch,
          anchors: [...calibration.anchors],
          constraints: [...calibration.constraints],
        }
      : undefined,
  }
}

export function canExportSolvedReferenceImageAnchors(
  calibration: SolvedReferenceImageCalibrationState,
) {
  return calibration.solveResult.diagnostics.length === 0
}

export function replaceReferenceImagePayloadPreservingCalibration(input: {
  state: ReferenceImageOperationState
  image: ReferenceImagePayload
}): SolvedReferenceImageOperationState {
  const calibration = input.state.calibration ?? createDefaultReferenceImageCalibrationState()
  return solveReferenceImageOperationState({
    ...input.state,
    image: input.image,
    calibration: {
      ...calibration,
      anchors: calibration.anchors.map((anchor) => ({
        ...anchor,
        uv: clampUv(anchor.uv),
      })),
    },
  })
}

function clampUv(uv: SketchPoint2D): SketchPoint2D {
  return [
    Math.min(1, Math.max(0, uv[0])),
    Math.min(1, Math.max(0, uv[1])),
  ]
}
