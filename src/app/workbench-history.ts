import type { EditorHistoryAvailability } from '@/contracts/editor/state-machine'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import {
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
} from '@/domain/modeling/document-history'

interface WorkbenchHistoryAvailabilityInput {
  snapshot: DocumentSnapshot | null
  undoStackLength: number
  redoStackLength: number
  isUndoRedoRunning: boolean
}

export function getWorkbenchHistoryAvailability(
  input: WorkbenchHistoryAvailabilityInput,
): EditorHistoryAvailability {
  if (input.isUndoRedoRunning) {
    return { canUndo: false, canRedo: false }
  }

  return {
    canUndo: input.undoStackLength > 0
      || (input.snapshot ? getPreviousDocumentHistoryCursor(input.snapshot) !== null : false),
    canRedo: input.redoStackLength > 0
      || (input.snapshot ? getNextDocumentHistoryCursor(input.snapshot) !== null : false),
  }
}
