import type { DocumentId } from "@/contracts/shared/ids";
import type { DocumentLocalDurableHistoryState } from "@/contracts/modeling/durable-history";
import { createEmptyDocumentLocalDurableHistoryState } from "@/contracts/modeling/durable-history";
import { parseDocumentLocalDurableHistoryState } from "@/contracts/modeling/durable-history.runtime-schema";

export type LocalDurableHistoryStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unsupported-storage" }
  | { ok: false; reason: "failed"; error: unknown };

export interface LocalDurableHistoryStore {
  isSupported(): boolean;
  load(input: {
    documentId: DocumentId;
    scope: string;
  }): Promise<LocalDurableHistoryStoreResult<DocumentLocalDurableHistoryState>>;
  save(input: {
    documentId: DocumentId;
    scope: string;
    state: DocumentLocalDurableHistoryState;
  }): Promise<LocalDurableHistoryStoreResult<DocumentLocalDurableHistoryState>>;
  clear(input: {
    documentId: DocumentId;
    scope: string;
  }): Promise<LocalDurableHistoryStoreResult<null>>;
}

export interface IndexedDbLocalDurableHistoryStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  storeName?: string;
}

const DEFAULT_DATABASE_NAME = "cad-local-durable-history";
const DEFAULT_STORE_NAME = "history";

interface LocalDurableHistoryRecord {
  storageKey: string;
  state: DocumentLocalDurableHistoryState;
}

export function createMemoryLocalDurableHistoryStore(
  initialState = new Map<DocumentId, DocumentLocalDurableHistoryState>(),
): LocalDurableHistoryStore {
  const states = new Map<string, DocumentLocalDurableHistoryState>();
  for (const [documentId, state] of initialState.entries()) {
    states.set(documentId, structuredClone(state));
  }

  return {
    isSupported() {
      return true;
    },
    async load({ documentId, scope }) {
      return {
        ok: true,
        value: structuredClone(
          states.get(createScopedStorageKey(documentId, scope)) ??
            createEmptyDocumentLocalDurableHistoryState(),
        ),
      };
    },
    async save({ documentId, scope, state }) {
      const clone = structuredClone(state);
      states.set(createScopedStorageKey(documentId, scope), clone);
      return {
        ok: true,
        value: structuredClone(clone),
      };
    },
    async clear({ documentId, scope }) {
      states.delete(createScopedStorageKey(documentId, scope));
      return { ok: true, value: null };
    },
  };
}

export function createIndexedDbLocalDurableHistoryStore(
  options: IndexedDbLocalDurableHistoryStoreOptions = {},
): LocalDurableHistoryStore {
  const indexedDBFactory = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;

  function isSupported() {
    return typeof indexedDBFactory?.open === "function";
  }

  async function withStore<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<LocalDurableHistoryStoreResult<T>> {
    if (!isSupported()) {
      return { ok: false, reason: "unsupported-storage" };
    }

    try {
      const database = await openLocalDurableHistoryDatabase(
        indexedDBFactory!,
        databaseName,
        storeName,
      );
      try {
        const transaction = database.transaction(storeName, mode);
        const request = callback(transaction.objectStore(storeName));
        return { ok: true, value: await resolveIdbRequest(request) };
      } finally {
        database.close();
      }
    } catch (error: unknown) {
      return { ok: false, reason: "failed", error };
    }
  }

  return {
    isSupported,
    async load({ documentId, scope }) {
      const result = await withStore(
        "readonly",
        (store) =>
          store.get(
            createScopedStorageKey(documentId, scope),
          ) as IDBRequest<LocalDurableHistoryRecord | null>,
      );
      if (!result.ok) {
        return result;
      }

      const parsed = parseDocumentLocalDurableHistoryState(
        result.value?.state ?? createEmptyDocumentLocalDurableHistoryState(),
      );
      if (!parsed.ok) {
        return {
          ok: false,
          reason: "failed",
          error: new Error(parsed.message),
        };
      }

      return {
        ok: true,
        value: parsed.state,
      };
    },
    async save({ documentId, scope, state }) {
      const result = await withStore("readwrite", (store) => {
        const storageKey = createScopedStorageKey(documentId, scope);
        store.put({ storageKey, state } satisfies LocalDurableHistoryRecord);
        return store.get(storageKey) as IDBRequest<LocalDurableHistoryRecord>;
      });
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        value: result.value.state,
      };
    },
    async clear({ documentId, scope }) {
      return withStore(
        "readwrite",
        (store) =>
          store.delete(
            createScopedStorageKey(documentId, scope),
          ) as unknown as IDBRequest<null>,
      );
    },
  };
}

function openLocalDurableHistoryDatabase(
  indexedDBFactory: IDBFactory,
  databaseName: string,
  storeName: string,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDBFactory.open(databaseName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "storageKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error("Local durable history database failed to open."),
      );
  });
}

function resolveIdbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Local durable history request failed."),
      );
  });
}

function createScopedStorageKey(documentId: DocumentId, scope: string) {
  return `${scope}:${documentId}`;
}
