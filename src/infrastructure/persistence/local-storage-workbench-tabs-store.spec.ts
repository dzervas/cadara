import { describe, expect, it } from 'bun:test'

import type { DocumentId } from '@/contracts/shared/ids'
import type { WorkbenchTab, WorkbenchTabsState } from '@/domain/workspace/workbench-tabs'

import {
  createLocalStorageWorkbenchTabsStore,
  WORKBENCH_TABS_STORAGE_KEY,
  type StorageLike,
} from './local-storage-workbench-tabs-store'

function createMemoryStorage(): StorageLike & { snapshot(): Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem(key) {
      return map.get(key) ?? null
    },
    setItem(key, value) {
      map.set(key, value)
    },
    removeItem(key) {
      map.delete(key)
    },
    snapshot() {
      return Object.fromEntries(map)
    },
  }
}

const docA = 'doc_a' as DocumentId
const docB = 'doc_b' as DocumentId

function tab(documentId: DocumentId, overrides: Partial<WorkbenchTab> = {}): WorkbenchTab {
  return {
    documentId,
    title: documentId,
    storageKind: 'browser',
    storageDescriptor: null,
    ...overrides,
  }
}

describe('createLocalStorageWorkbenchTabsStore', () => {
  it('returns null state when nothing has been persisted yet', () => {
    const storage = createMemoryStorage()
    const store = createLocalStorageWorkbenchTabsStore(storage)

    const result = store.load()
    expect(result).toEqual({ ok: true, state: null })
  })

  it('round-trips a state through save and load', () => {
    const storage = createMemoryStorage()
    const store = createLocalStorageWorkbenchTabsStore(storage)
    const state: WorkbenchTabsState = {
      tabs: [
        tab(docA, { title: 'Bracket v3' }),
        tab(docB, { title: 'shaft.cadara', storageKind: 'filesystem', storageDescriptor: 'shaft.cadara' }),
      ],
      activeDocumentId: docB,
    }

    store.save(state)
    const result = store.load()

    expect(result).toEqual({ ok: true, state })
    expect(storage.snapshot()[WORKBENCH_TABS_STORAGE_KEY]).toContain('"version":1')
  })

  it('rejects malformed JSON with invalid-json reason', () => {
    const storage = createMemoryStorage()
    storage.setItem(WORKBENCH_TABS_STORAGE_KEY, '{not json')
    const store = createLocalStorageWorkbenchTabsStore(storage)

    const result = store.load()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('invalid-json')
    }
  })

  it('rejects payloads where activeDocumentId is not in the tab list', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      WORKBENCH_TABS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tabs: [{ documentId: docA, title: 'A', storageKind: 'browser', storageDescriptor: null }],
        activeDocumentId: docB,
      }),
    )
    const store = createLocalStorageWorkbenchTabsStore(storage)

    const result = store.load()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('invalid-shape')
    }
  })

  it('clear removes the persisted entry', () => {
    const storage = createMemoryStorage()
    const store = createLocalStorageWorkbenchTabsStore(storage)
    store.save({ tabs: [tab(docA)], activeDocumentId: docA })

    store.clear()
    expect(store.load()).toEqual({ ok: true, state: null })
  })
})
