import { test } from 'bun:test'

import {
  MemoryDocumentRepositoryUrlStore,
  createLocalStorageDocumentRepositoryUrlStore,
} from '@/infrastructure/persistence/document-repository-url-store'

test('src/infrastructure/persistence/document-repository-url-store.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const validUrl = 'automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu' as never
  const memoryStore = new MemoryDocumentRepositoryUrlStore()
  memoryStore.set('doc_workspace', validUrl)
  assert(
    memoryStore.get('doc_workspace') === validUrl,
    'Memory URL stores should return persisted Automerge URLs.',
  )
  memoryStore.delete('doc_workspace')
  assert(memoryStore.get('doc_workspace') === null, 'Memory URL stores should drop deleted URLs.')

  const persisted = new Map<string, string>()
  const removed: string[] = []
  const storage = {
    getItem(key: string) {
      return persisted.get(key) ?? null
    },
    setItem(key: string, value: string) {
      persisted.set(key, value)
    },
    removeItem(key: string) {
      removed.push(key)
      persisted.delete(key)
    },
  }

  persisted.set('cad.documentRepository.automergeUrls.v1', '{"doc_bad":"not-an-automerge-url"}')
  const urlStore = createLocalStorageDocumentRepositoryUrlStore(storage)
  assert(
    urlStore.get('doc_bad') === null,
    'Local-storage URL stores should ignore invalid persisted payloads instead of surfacing malformed URLs.',
  )

  urlStore.set('doc_workspace', validUrl)
  assert(
    persisted.get('cad.documentRepository.automergeUrls.v1')?.includes(validUrl),
    'Local-storage URL stores should persist valid Automerge URLs through the storage adapter.',
  )
  assert(
    urlStore.get('doc_workspace') === validUrl,
    'Local-storage URL stores should read back the persisted Automerge URL for the document id.',
  )

  urlStore.delete('doc_workspace')
  assert(
    removed.includes('cad.documentRepository.automergeUrls.v1'),
    'Local-storage URL stores should clear the storage key once the final repository URL is removed.',
  )
})
