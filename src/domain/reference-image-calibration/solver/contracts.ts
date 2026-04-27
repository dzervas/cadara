import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationConstraint,
  ReferenceImageCalibrationScaleMode,
  ReferenceImagePlacement,
  ReferenceImagePayload,
} from '@/contracts/reference-image/schema'

export interface ReferenceImageCalibrationSolverInput {
  image: Pick<ReferenceImagePayload, 'pixelWidth' | 'pixelHeight'>
  initialPlacement: ReferenceImagePlacement
  scaleMode: ReferenceImageCalibrationScaleMode
  anchors: readonly ReferenceImageCalibrationAnchor[]
  constraints: readonly ReferenceImageCalibrationConstraint[]
}

