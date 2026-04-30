import { test } from 'bun:test'

import {
  getDocumentHistoryOrderRestoreMoves,
  getWorkbenchHistoryAvailability,
} from '@/app/workbench/history/workbench-history'
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

  const a = { kind: 'feature' as const, featureId: 'feature_a' as const }
  const b = { kind: 'feature' as const, featureId: 'feature_b' as const }
  const c = { kind: 'feature' as const, featureId: 'feature_c' as const }
  const moves = getDocumentHistoryOrderRestoreMoves([a, b, c], [b, c, a])

  assert(moves?.length === 1, 'Restoring a first-to-tail reorder should require one durable move.')
  assert(
    moves[0]?.item.kind === 'feature' && moves[0].item.featureId === 'feature_a' && moves[0].beforeItem === null,
    'Restoring a first-to-tail reorder should move the first item to the tail.',
  )

  const undoMoves = getDocumentHistoryOrderRestoreMoves([b, c, a], [a, b, c])
  assert(undoMoves?.length === 1, 'Undoing a first-to-tail reorder should require one durable move.')
  assert(
    undoMoves[0]?.item.kind === 'feature'
      && undoMoves[0].item.featureId === 'feature_a'
      && undoMoves[0].beforeItem?.kind === 'feature'
      && undoMoves[0].beforeItem.featureId === 'feature_b',
    'Undoing a first-to-tail reorder should move the tail item before the original head.',
  )

  assert(
    getDocumentHistoryOrderRestoreMoves([a, b], [a, b, c]) === null,
    'Restore planning should reject orders with missing or extra history items.',
  )
})
