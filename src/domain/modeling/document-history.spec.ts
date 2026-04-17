import { test } from 'bun:test'

import {
  getDocumentHistoryCursorIndex,
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
} from '@/domain/modeling/document-history'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/modeling/document-history.spec.ts', async () => {
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
  const items = snapshot.presentation.documentHistory

  assert(items.length >= 2, 'Seed document should expose multiple document history items.')
  assert(
    getDocumentHistoryCursorIndex(items, snapshot.document.cursor) === items.length - 1,
    'Seed document cursor should start at the document history tail.',
  )

  const previous = getPreviousDocumentHistoryCursor(snapshot)
  assert(previous !== null, 'Undo should be available at the document history tail.')
  assert(
    getDocumentHistoryCursorIndex(items, previous) === items.length - 2,
    'Previous document cursor should step back one history item.',
  )
  assert(getNextDocumentHistoryCursor(snapshot) === null, 'Redo should be unavailable at the document history tail.')

  const rolledBackSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: previous,
    },
    cursor: previous,
  }
  const next = getNextDocumentHistoryCursor(rolledBackSnapshot)

  assert(next !== null, 'Redo should be available after a document cursor rollback.')
  assert(
    getDocumentHistoryCursorIndex(items, next) === items.length - 1,
    'Next document cursor should step forward one history item.',
  )

  const beforeFirstSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: 'empty' as const },
    },
    cursor: { kind: 'empty' as const },
  }

  assert(
    getPreviousDocumentHistoryCursor(beforeFirstSnapshot) === null,
    'Undo should be unavailable before the first document history item.',
  )
  assert(
    getNextDocumentHistoryCursor(beforeFirstSnapshot)?.kind === items[0]?.kind,
    'Redo should be available from the before-first document cursor position.',
  )
})
