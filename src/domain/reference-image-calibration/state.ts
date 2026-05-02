import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationDiagnostic,
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
    showExportedAnchorsInSketch: true,
    anchors: [],
  }
}

export function solveReferenceImageOperationState(
  state: ReferenceImageOperationState,
  input?: {
    pointPositionsById?: ReadonlyMap<string, SketchPoint2D>
  },
): SolvedReferenceImageOperationState {
  const calibration = state.calibration ?? createDefaultReferenceImageCalibrationState()
  const diagnostics = collectCalibrationDiagnostics(calibration, input?.pointPositionsById)
  const solveResult = solveReferenceImageCalibration({
    image: state.image,
    initialPlacement: state.placement,
    scaleMode: calibration.scaleMode,
    anchors: calibration.anchors.map((anchor) => ({
      anchorId: anchor.anchorId,
      label: anchor.label,
      uv: anchor.uv,
      pointId: anchor.pointId,
      worldPosition: input?.pointPositionsById?.get(anchor.pointId) ?? null,
    })),
    constraints: [],
  })
  const combinedDiagnostics = [
    ...diagnostics,
    ...solveResult.diagnostics,
  ]

  return {
    ...state,
    placement: combinedDiagnostics.length === 0
      ? solveResult.placement
      : state.placement,
    calibration: {
      ...calibration,
      solveResult: {
        ...solveResult,
        diagnostics: combinedDiagnostics,
        anchors: calibration.anchors.flatMap((anchor) => {
          const solvedAnchor = solveResult.anchors.find((candidate) => candidate.anchorId === anchor.anchorId)
          return solvedAnchor
            ? [{
                anchorId: anchor.anchorId,
                pointId: anchor.pointId,
                worldPosition: solvedAnchor.worldPosition,
              }]
            : []
        }),
      },
    },
  }
}

export function createReferenceImageCalibrationAnchor(input: {
  anchorId: string
  anchorIndex: number
  uv: SketchPoint2D
  pointId: string
}): ReferenceImageCalibrationAnchor {
  return {
    anchorId: input.anchorId,
    label: `Anchor ${input.anchorIndex + 1}`,
    uv: clampUv(input.uv),
    pointId: input.pointId,
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
          anchors: calibration.anchors.map((anchor) => ({
            anchorId: anchor.anchorId,
            label: anchor.label,
            uv: anchor.uv,
            pointId: anchor.pointId,
          })),
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
  pointPositionsById?: ReadonlyMap<string, SketchPoint2D>
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
  }, {
    pointPositionsById: input.pointPositionsById,
  })
}

function collectCalibrationDiagnostics(
  calibration: ReferenceImageCalibrationState,
  pointPositionsById?: ReadonlyMap<string, SketchPoint2D>,
): ReferenceImageCalibrationDiagnostic[] {
  const diagnostics: ReferenceImageCalibrationDiagnostic[] = []

  for (const anchor of calibration.anchors) {
    if (!pointPositionsById?.has(anchor.pointId)) {
      diagnostics.push({
        code: 'missing-bound-anchor-point',
        severity: 'warning',
        message: `${anchor.label} is bound to a missing sketch point.`,
      })
    }
  }

  return diagnostics
}

function clampUv(uv: SketchPoint2D): SketchPoint2D {
  return [
    Math.min(1, Math.max(0, uv[0])),
    Math.min(1, Math.max(0, uv[1])),
  ]
}
