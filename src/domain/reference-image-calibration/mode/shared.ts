import type { SketchAuthoringOperationId } from '@/contracts/shared/ids'
import type { SolvedReferenceImageOperationState } from '@/contracts/reference-image/schema'

export const REFERENCE_IMAGE_CALIBRATION_MODE_ID = 'referenceImage.calibration'

export interface ReferenceImageCalibrationModeState {
  operationId: SketchAuthoringOperationId
  draftState: SolvedReferenceImageOperationState
  selectedAnchorId: string | null
  selectedConstraintId: string | null
  pendingAnchorPlacement: boolean
  pendingConstraintAnchorIds: readonly string[] | null
}
