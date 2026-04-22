import { test } from 'bun:test'

import { createObjectExportModalState } from '@/app/object-export-state'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/app/object-export-state.spec.ts', async () => {
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

  const modalState = createObjectExportModalState(
    snapshot,
    { kind: 'body', bodyId: 'body_part-1' },
    'Part 1',
  )

  assert(modalState !== null, 'Export should produce modal-opening state for a selected row.')
  assert(modalState.label === 'Part 1', 'Export modal state should preserve the selected row label.')
  assert(modalState.baseRevisionId === snapshot.document.revisionId, 'Export modal state should capture the current revision.')
  assert(
    !JSON.stringify(modalState).includes('not implemented'),
    'Export should not produce the previous placeholder status message.',
  )
})
