import type { DocumentId } from '@/contracts/shared/ids'
import type { LocalFileSystemFileHandle } from '@/lib/local-file-system-access'

export interface LocalFileBindingMetadata {
  documentId: DocumentId
  fileName: string
  storedAt: string
}

export interface LocalFileBindingRecord {
  metadata: LocalFileBindingMetadata
  handle: LocalFileSystemFileHandle
}

export type LocalFileBindingStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'unsupported-storage' }
  | { ok: false; reason: 'failed'; error: unknown }

export interface LocalFileBindingStore {
  isSupported(): boolean
  load(documentId: DocumentId): Promise<LocalFileBindingStoreResult<LocalFileBindingRecord | null>>
  save(record: LocalFileBindingRecord): Promise<LocalFileBindingStoreResult<LocalFileBindingMetadata>>
  clear(documentId: DocumentId): Promise<LocalFileBindingStoreResult<null>>
}

export interface IndexedDbLocalFileBindingStoreOptions {
  indexedDB?: IDBFactory
  databaseName?: string
  storeName?: string
}

const DEFAULT_DATABASE_NAME = 'cad-local-file-bindings'
const DEFAULT_STORE_NAME = 'bindings'

export function createIndexedDbLocalFileBindingStore(
  options: IndexedDbLocalFileBindingStoreOptions = {},
): LocalFileBindingStore {
  const indexedDBFactory = options.indexedDB ?? globalThis.indexedDB
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
  const storeName = options.storeName ?? DEFAULT_STORE_NAME

  function isSupported() {
    return typeof indexedDBFactory?.open === 'function'
  }

  async function withStore<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<LocalFileBindingStoreResult<T>> {
    if (!isSupported()) {
      return { ok: false, reason: 'unsupported-storage' }
    }

    try {
      const database = await openLocalFileBindingDatabase(indexedDBFactory, databaseName, storeName)
      try {
        const transaction = database.transaction(storeName, mode)
        const request = callback(transaction.objectStore(storeName))
        return { ok: true, value: await resolveIdbRequest(request) }
      } finally {
        database.close()
      }
    } catch (error: unknown) {
      return { ok: false, reason: 'failed', error }
    }
  }

  return {
    isSupported,
    load(documentId) {
      return withStore('readonly', (store) => store.get(documentId) as IDBRequest<LocalFileBindingRecord | null>)
    },
    save(record) {
      return withStore('readwrite', (store) => {
        store.put(record)
        return store.get(record.metadata.documentId) as IDBRequest<LocalFileBindingRecord>
      }).then((result) => {
        if (!result.ok) {
          return result
        }

        return {
          ok: true,
          value: result.value.metadata,
        }
      })
    },
    clear(documentId) {
      return withStore('readwrite', (store) => store.delete(documentId) as unknown as IDBRequest<null>)
    },
  }
}

export function createLocalFileBindingMetadata(
  documentId: DocumentId,
  handle: Pick<LocalFileSystemFileHandle, 'name'>,
  now = new Date(),
): LocalFileBindingMetadata {
  return {
    documentId,
    fileName: handle.name,
    storedAt: now.toISOString(),
  }
}

function openLocalFileBindingDatabase(
  indexedDBFactory: IDBFactory,
  databaseName: string,
  storeName: string,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDBFactory.open(databaseName, 1)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: 'metadata.documentId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local file binding database failed to open.'))
  })
}

function resolveIdbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local file binding request failed.'))
  })
}
