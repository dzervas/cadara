import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  getDocumentHistoryOrderRestoreMoves,
  getWorkbenchHistoryAvailability,
} from '@/app/workbench/history/workbench-history'
import { getPreviousDocumentHistoryCursor } from '@/domain/modeling/document-history'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/app/workbench-history.spec.ts', async () => {  const adapter = new MockKernelAdapter()
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

  expectTrue(tailAvailability.canUndo, 'Document history should enable undo even when the local stack is empty.')
  expectTrue(!tailAvailability.canRedo, 'Document history should disable redo at the document history tail.')

  const previousCursor = getPreviousDocumentHistoryCursor(snapshot)
  expectTrue(previousCursor, 'Seed document should have a previous document history cursor.')

  const rolledBackAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: false, canRedo: true },
    undoStackLength: 0,
    redoStackLength: 0,
    isUndoRedoRunning: false,
  })

  expectTrue(rolledBackAvailability.canRedo, 'Document history should enable redo after a cursor rollback.')

  const localStackAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: false, canRedo: false },
    undoStackLength: 1,
    redoStackLength: 1,
    isUndoRedoRunning: false,
  })

  expectTrue(localStackAvailability.canUndo, 'Local undo entries should keep undo available without a snapshot.')
  expectTrue(localStackAvailability.canRedo, 'Local redo entries should keep redo available without a snapshot.')

  const runningAvailability = getWorkbenchHistoryAvailability({
    documentHistory: { canUndo: true, canRedo: true },
    undoStackLength: 1,
    redoStackLength: 1,
    isUndoRedoRunning: true,
  })

  expectTrue(!runningAvailability.canUndo, 'Undo should be disabled while an undo or redo mutation is running.')
  expectTrue(!runningAvailability.canRedo, 'Redo should be disabled while an undo or redo mutation is running.')

  const a = { kind: 'feature' as const, featureId: 'feature_a' as const }
  const b = { kind: 'feature' as const, featureId: 'feature_b' as const }
  const c = { kind: 'feature' as const, featureId: 'feature_c' as const }
  const moves = getDocumentHistoryOrderRestoreMoves([a, b, c], [b, c, a])

  expectTrue(moves?.length === 1, 'Restoring a first-to-tail reorder should require one durable move.')
  expectTrue(
    moves[0]?.item.kind === 'feature' && moves[0].item.featureId === 'feature_a' && moves[0].beforeItem === null,
    'Restoring a first-to-tail reorder should move the first item to the tail.',
  )

  const undoMoves = getDocumentHistoryOrderRestoreMoves([b, c, a], [a, b, c])
  expectTrue(undoMoves?.length === 1, 'Undoing a first-to-tail reorder should require one durable move.')
  expectTrue(
    undoMoves[0]?.item.kind === 'feature'
      && undoMoves[0].item.featureId === 'feature_a'
      && undoMoves[0].beforeItem?.kind === 'feature'
      && undoMoves[0].beforeItem.featureId === 'feature_b',
    'Undoing a first-to-tail reorder should move the tail item before the original head.',
  )

  expectTrue(
    getDocumentHistoryOrderRestoreMoves([a, b], [a, b, c]) === null,
    'Restore planning should reject orders with missing or extra history items.',
  )
})
