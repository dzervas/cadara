import type { SketchAuthoringOperationId } from '@/contracts/shared/ids'
import type { ReferenceImageOperationState } from '@/contracts/reference-image/schema'

export const REFERENCE_IMAGE_CALIBRATION_MODE_ID = 'referenceImage.calibration'

export interface ReferenceImageCalibrationModeState {
  operationId: SketchAuthoringOperationId
  draftState: ReferenceImageOperationState
  selectedAnchorId: string | null
  selectedConstraintId: string | null
  pendingAnchorPlacement: boolean
  pendingConstraintAnchorIds: readonly string[] | null
}
