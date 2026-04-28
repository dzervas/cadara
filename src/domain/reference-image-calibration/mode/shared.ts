import type { SketchAuthoringOperationId, SketchId } from '@/contracts/shared/ids'
import type { SolvedReferenceImageOperationState } from '@/contracts/reference-image/schema'
import type { SketchPointDefinition } from '@/contracts/sketch/schema'

export const REFERENCE_IMAGE_CALIBRATION_MODE_ID = 'referenceImage.calibration'

export interface ReferenceImageCalibrationModeState {
  sketchId: SketchId
  operationId: SketchAuthoringOperationId
  draftState: SolvedReferenceImageOperationState
  draftPoints: readonly SketchPointDefinition[]
  selectedAnchorId: string | null
  pendingAnchorPlacement: boolean
}
