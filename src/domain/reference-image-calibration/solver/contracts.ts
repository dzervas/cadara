import type {
  ReferenceImageCalibrationConstraint,
  ReferenceImageCalibrationScaleMode,
  ReferenceImagePlacement,
  ReferenceImagePayload,
} from '@/contracts/reference-image/schema'
import type { SketchPoint2D } from '@/contracts/sketch/schema'

export interface ReferenceImageCalibrationSolverAnchor {
  anchorId: string
  label: string
  uv: SketchPoint2D
  pointId: string
  worldPosition: SketchPoint2D | null
}

export interface ReferenceImageCalibrationSolverInput {
  image: Pick<ReferenceImagePayload, 'pixelWidth' | 'pixelHeight'>
  initialPlacement: ReferenceImagePlacement
  scaleMode: ReferenceImageCalibrationScaleMode
  anchors: readonly ReferenceImageCalibrationSolverAnchor[]
  constraints: readonly ReferenceImageCalibrationConstraint[]
}
