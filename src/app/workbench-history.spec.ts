import { test } from 'bun:test'

import { getWorkbenchHistoryAvailability } from '@/app/workbench-history'
import { getPreviousDocumentHistoryCursor } from '@/domain/modeling/document-history'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/app/workbench-history.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
  })).snapshot

  const tailAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: true, canRedo: false },
    undoStackLength: 0,
    redoStackLength: 0,
    isUndoRedoRunning: false,
  })

  assert(tailAvailability.canUndo, 'Document history should enable undo even when the local stack is empty.')
  assert(!tailAvailability.canRedo, 'Document history should disable redo at the document history tail.')

  const previousCursor = getPreviousDocumentHistoryCursor(snapshot)
  assert(previousCursor, 'Seed document should have a previous document history cursor.')

  const rolledBackAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: false, canRedo: true },
    undoStackLength: 0,
    redoStackLength: 0,
    isUndoRedoRunning: false,
  })

  assert(rolledBackAvailability.canRedo, 'Document history should enable redo after a cursor rollback.')

  const localStackAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: false, canRedo: false },
    undoStackLength: 1,
    redoStackLength: 1,
    isUndoRedoRunning: false,
  })

  assert(localStackAvailability.canUndo, 'Local undo entries should keep undo available without a snapshot.')
  assert(localStackAvailability.canRedo, 'Local redo entries should keep redo available without a snapshot.')

  const runningAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: true, canRedo: true },
    undoStackLength: 1,
    redoStackLength: 1,
    isUndoRedoRunning: true,
  })

  assert(!runningAvailability.canUndo, 'Undo should be disabled while an undo or redo mutation is running.')
  assert(!runningAvailability.canRedo, 'Redo should be disabled while an undo or redo mutation is running.')
})
