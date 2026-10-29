import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";

/**
 * cadara-dx2k.17: the last published authored document of each stored
 * Automerge document, with the chunk keys and heads it was materialized
 * from. A reload whose stored chunk keys equal the record's answers with the
 * record's document instead of loading the Automerge document first (see
 * AutomergeChunkKeyRecorder for why equal keys mean an equal document).
 *
 * A sibling IndexedDB database, not a store in the Automerge one: the
 * IndexedDBStorageAdapter opens its database at version 1 with one store,
 * so another store there would need an upgrade it does not expect.
 */
export const MATERIALIZED_DOCUMENT_FORMAT = "cadara-materialized-document/v1";

export interface MaterializedDocumentRecord {
  format: typeof MATERIALIZED_DOCUMENT_FORMAT;
  /** The build that materialized the document; another build may materialize differently. */
  compatibility: string;
  automergeUrl: string;
  /** Sorted `documentId/kind/hash` names of the snapshot and incremental chunks. */
  chunkKeys: string[];
  heads: string[];
  document: AuthoredModelDocument;
}

export interface MaterializedDocumentStore {
  /** The stored value for the URL, unvalidated; undefined when absent. */
  read(automergeUrl: string): Promise<unknown>;
  write(record: MaterializedDocumentRecord): Promise<void>;
  remove(automergeUrl: string): Promise<void>;
}

export type MaterializedDocumentEvent =
  | { kind: "hit"; automergeUrl: string }
  /** The reload loads the Automerge document (and stores a new record after). */
  | { kind: "miss"; automergeUrl: string; reason: string }
  | { kind: "stored"; automergeUrl: string }
  /** A publication was not recorded because storage did not provably hold it. */
  | { kind: "skipped"; automergeUrl: string; reason: string }
  /** The store failed or held an unusable record; the normal load answered. */
  | { kind: "degraded"; automergeUrl: string; reason: string };

function isSortedStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item, index) =>
        typeof item === "string" && (index === 0 || value[index - 1]! < item),
    )
  );
}

/** Reads a stored value; a string is the reason it is unusable. */
export function parseMaterializedDocumentRecord(
  value: unknown,
  expected: { compatibility: string; automergeUrl: string },
): MaterializedDocumentRecord | string {
  if (typeof value !== "object" || value === null) return "not a record.";
  const record = value as Partial<
    Record<keyof MaterializedDocumentRecord, unknown>
  >;
  if (record.format !== MATERIALIZED_DOCUMENT_FORMAT)
    return "another entry format.";
  if (record.compatibility !== expected.compatibility)
    return "the record names another build.";
  if (record.automergeUrl !== expected.automergeUrl)
    return "the record names another document.";
  if (
    !isSortedStringArray(record.chunkKeys) ||
    record.chunkKeys.length === 0 ||
    !Array.isArray(record.heads) ||
    !record.heads.every((head) => typeof head === "string")
  )
    return "invalid chunk keys or heads.";
  const parsed = parseAuthoredModelDocument(record.document);
  if (!parsed.ok) return `invalid document: ${parsed.diagnostic.message}`;
  return {
    format: MATERIALIZED_DOCUMENT_FORMAT,
    compatibility: record.compatibility,
    automergeUrl: record.automergeUrl,
    chunkKeys: record.chunkKeys,
    heads: record.heads,
    document: parsed.document,
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Materialized document request failed."),
      );
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () =>
      reject(
        transaction.error ??
          new Error("Materialized document transaction was aborted."),
      );
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

const RECORDS = "documents";

export function createIndexedDbMaterializedDocumentStore(options: {
  databaseName: string;
  indexedDB?: IDBFactory;
}): MaterializedDocumentStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let database: Promise<IDBDatabase> | null = null;

  function openDatabase() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) throw new Error("IndexedDB is unavailable.");
      const request = factory.open(options.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(RECORDS);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Materialized document database failed to open."),
        );
    }).catch((error: unknown) => {
      // A later open may succeed (another tab held an upgrade).
      database = null;
      throw error;
    });
    return database;
  }

  async function update(write: (store: IDBObjectStore) => void): Promise<void> {
    const transaction = (await openDatabase()).transaction(
      RECORDS,
      "readwrite",
    );
    const done = transactionDone(transaction);
    write(transaction.objectStore(RECORDS));
    await done;
  }

  return {
    async read(automergeUrl) {
      const transaction = (await openDatabase()).transaction(RECORDS);
      return requestResult(transaction.objectStore(RECORDS).get(automergeUrl));
    },
    write(record) {
      return update((store) => store.put(record, record.automergeUrl));
    },
    remove(automergeUrl) {
      return update((store) => store.delete(automergeUrl));
    },
  };
}
