import type { EditorHistoryAvailability } from '@/contracts/editor/state-machine'

interface WorkbenchHistoryAvailabilityInput {
  documentHistory: EditorHistoryAvailability
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
    canUndo: input.undoStackLength > 0 || input.documentHistory.canUndo,
    canRedo: input.redoStackLength > 0 || input.documentHistory.canRedo,
  }
}
