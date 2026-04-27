import type { SketchPoint2D } from '@/contracts/sketch/schema'

export interface ReferenceImagePayload {
  mediaType: string
  fileName?: string
  pixelWidth: number
  pixelHeight: number
  base64Data: string
}

export interface ReferenceImagePlacement {
  center: SketchPoint2D
  width: number
  height: number
  rotationRadians: number
}

export type ReferenceImageCalibrationScaleMode = 'lockedAspect' | 'independent'

export interface ReferenceImageCalibrationAnchor {
  anchorId: string
  label: string
  uv: SketchPoint2D
  worldPosition: SketchPoint2D | null
}

export interface ReferenceImageCalibrationConstraint {
  constraintId: string
  kind: 'distance'
  label: string
  firstAnchorId: string
  secondAnchorId: string
  distance: number
}

export interface ReferenceImageCalibrationDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface ReferenceImageCalibrationSolvedAnchor {
  anchorId: string
  worldPosition: SketchPoint2D
}

export interface ReferenceImageCalibrationSolveResult {
  placement: ReferenceImagePlacement
  anchors: readonly ReferenceImageCalibrationSolvedAnchor[]
  diagnostics: readonly ReferenceImageCalibrationDiagnostic[]
}

export interface ReferenceImageCalibrationState {
  scaleMode: ReferenceImageCalibrationScaleMode
  showExportedAnchorsInSketch: boolean
  anchors: readonly ReferenceImageCalibrationAnchor[]
  constraints: readonly ReferenceImageCalibrationConstraint[]
}

export interface SolvedReferenceImageCalibrationState extends ReferenceImageCalibrationState {
  solveResult: ReferenceImageCalibrationSolveResult
}

export interface ReferenceImageOperationState {
  kind: 'referenceImage'
  image: ReferenceImagePayload
  placement: ReferenceImagePlacement
  calibration?: ReferenceImageCalibrationState
}

export interface SolvedReferenceImageOperationState
  extends Omit<ReferenceImageOperationState, 'calibration'> {
  calibration: SolvedReferenceImageCalibrationState
}
