import { test } from 'bun:test'

import { createEmptyOperationHistory } from '@/contracts/modeling/operation-history'
import { createLocalStorageOperationHistoryStore } from '@/infrastructure/persistence/local-storage-operation-history-store'

test('src/infrastructure/persistence/local-storage-operation-history-store.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

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

  const store = createLocalStorageOperationHistoryStore(storage)
  const empty = store.load()
  assert(
    empty.ok && empty.payload === null,
    'Operation history stores should treat missing storage as an empty history payload.',
  )

  persisted.set('cad.modeling.operationHistory.v1', '{"broken"')
  const invalid = store.load()
  assert(
    !invalid.ok && invalid.reasonCode === 'invalid-json',
    'Operation history stores should return an explicit invalid-json failure for malformed persisted payloads.',
  )

  const payload = createEmptyOperationHistory('doc_workspace', ['head_1'])
  store.save(payload)
  const loaded = store.load()
  assert(
    loaded.ok
      && loaded.payload?.documentId === 'doc_workspace'
      && loaded.payload.baseRepositoryHeads?.[0] === 'head_1',
    'Operation history stores should round-trip valid persisted payloads through the storage adapter.',
  )

  store.clear()
  assert(
    removed.includes('cad.modeling.operationHistory.v1'),
    'Operation history stores should remove the persisted key when the history is cleared.',
  )
})
