import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createObjectExportModalState } from '@/app/object-export-state'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/app/object-export-state.spec.ts', async () => {  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
  })).snapshot

  const modalState = createObjectExportModalState(
    snapshot,
    { kind: 'body', bodyId: 'body_part-1' },
    'Part 1',
  )

  expectTrue(modalState !== null, 'Export should produce modal-opening state for a selected row.')
  expectTrue(modalState.label === 'Part 1', 'Export modal state should preserve the selected row label.')
  expectTrue(modalState.baseRevisionId === snapshot.document.revisionId, 'Export modal state should capture the current revision.')
  expectTrue(
    !JSON.stringify(modalState).includes('not implemented'),
    'Export should not produce the previous placeholder status message.',
  )
})
