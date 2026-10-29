import type {
  ModelCheckpoint,
  ModelCheckpointEvent,
  ModelCheckpointStore,
} from "@/infrastructure/persistence/model-checkpoint-store";
import { OCC_ASSET_VERSION } from "@/infrastructure/occ/asset-version";
import type { NativeTopologyPayloadCheckpointRecord } from "@/infrastructure/occ/native-topology-payload-checkpoint";
import { validateModelCheckpointShapeRecords } from "@/infrastructure/modeling/model-checkpoint-file-store.runtime-schema";

/**
 * cadara-dx2k.6: the browser's model checkpoint cache, the IndexedDB
 * counterpart of the CLI's filesystem store. The OCC worker reads it when a
 * session opens a stored document and fills it after a cold open settled.
 *
 * IndexedDB, not OPFS: the document repository and its geometry assets
 * already live there, and an entry is a few megabytes of strings (2 MB for
 * the bracket example, 13 MB for the enclosure) plus the bodies' display
 * payloads as typed arrays (0.1-0.5 MB), which one structured-clone put
 * stores atomically. Two object stores share the key: `entries` holds the
 * members, `usage` a small `{ key, bytes, usedAt }` record per entry, so
 * retention lists entries without loading them. Entries are this origin's own
 * writes, but they outlive the build that wrote them, so a read still checks
 * the record's format, compatibility and shape records before the adapter
 * decodes and re-validates the state.
 */

const DATABASE_VERSION = 1;
const ENTRIES = "entries";
const USAGE = "usage";
const ENTRY_FORMAT = "cadara-model-checkpoint-idb/v1";
/** Largest single entry stored (the enclosure example is ~13 MB). */
export const BROWSER_MODEL_CHECKPOINT_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** Retention bound: least recently used entries are evicted above it. */
export const BROWSER_MODEL_CHECKPOINT_CACHE_MAX_BYTES = 256 * 1024 * 1024;

interface ModelCheckpointRecord extends ModelCheckpoint {
  format: typeof ENTRY_FORMAT;
  compatibility: string;
}

interface ModelCheckpointUsageRecord {
  key: string;
  /** String length of the members: their size within a small factor, as retention needs. */
  bytes: number;
  usedAt: number;
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The compatibility digest of a production browser build: the entry format,
 * the kernel assets' content hash, the OCC worker bundle's URL (Vite names it
 * by its content hash, and it holds every evaluator module the worker runs)
 * and the user agent (the solver's Math results are the engine's).
 */
export function fingerprintBrowserModelCheckpointRuntime(input: {
  workerScriptPath: string;
  userAgent: string;
}) {
  return sha256Hex(
    JSON.stringify({
      entryFormat: ENTRY_FORMAT,
      occAssetVersion: OCC_ASSET_VERSION,
      workerScriptPath: input.workerScriptPath,
      userAgent: input.userAgent,
    }),
  );
}

function memberBytes(checkpoint: ModelCheckpoint) {
  return (
    checkpoint.graph.length +
    checkpoint.brep.length +
    checkpoint.exportedDocument.length +
    JSON.stringify(checkpoint.shapes).length +
    (checkpoint.nativeTopologyPayloads ?? []).reduce(
      (sum, record) =>
        sum +
        record.payload.length +
        record.positions.byteLength +
        record.triangleIndices.byteLength,
      0,
    )
  );
}

function isNativeTopologyPayloadRecord(
  value: unknown,
): value is NativeTopologyPayloadCheckpointRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<
    Record<keyof NativeTopologyPayloadCheckpointRecord, unknown>
  >;
  return (
    typeof record.bodyId === "string" &&
    typeof record.topologyToken === "string" &&
    (record.lodTierId === "startup" ||
      record.lodTierId === "normal" ||
      record.lodTierId === "fine") &&
    typeof record.payload === "string" &&
    record.positions instanceof Float64Array &&
    record.triangleIndices instanceof Uint32Array
  );
}

/** Reads a stored value; a string is the reason it is unusable. */
function parseModelCheckpointRecord(
  value: unknown,
  expectedCompatibility: string,
): ModelCheckpoint | string {
  if (typeof value !== "object" || value === null) return "not a record.";
  const record = value as Partial<Record<keyof ModelCheckpointRecord, unknown>>;
  if (record.format !== ENTRY_FORMAT) return "another entry format.";
  if (record.compatibility !== expectedCompatibility) {
    return "the record names another build/runtime.";
  }
  const { graph, brep, exportedDocument } = record;
  if (
    typeof graph !== "string" ||
    typeof brep !== "string" ||
    typeof exportedDocument !== "string"
  ) {
    return "a member is not a string.";
  }
  const shapes = validateModelCheckpointShapeRecords(record.shapes);
  if (!shapes.success) return "invalid shape records.";
  const { nativeTopologyPayloads } = record;
  if (nativeTopologyPayloads === undefined) {
    return { graph, shapes: shapes.data, brep, exportedDocument };
  }
  if (
    !Array.isArray(nativeTopologyPayloads) ||
    !nativeTopologyPayloads.every(isNativeTopologyPayloadRecord)
  ) {
    return "invalid display payload records.";
  }
  return {
    graph,
    shapes: shapes.data,
    brep,
    exportedDocument,
    nativeTopologyPayloads,
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Model checkpoint request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () =>
      reject(
        transaction.error ??
          new Error("Model checkpoint transaction was aborted."),
      );
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

function failureReason(error: unknown) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

export function createIndexedDbModelCheckpointStore(options: {
  /** Hex SHA-256 of the build (see fingerprintBrowserModelCheckpointRuntime), or null when it has none. */
  fingerprint: () => Promise<string | null>;
  report: (event: ModelCheckpointEvent) => void;
  indexedDB?: IDBFactory;
  databaseName?: string;
  maxBytes?: number;
  now?: () => number;
}): ModelCheckpointStore {
  const { report } = options;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName ?? "cadara-model-checkpoints";
  const maxBytes = options.maxBytes ?? BROWSER_MODEL_CHECKPOINT_CACHE_MAX_BYTES;
  const now = options.now ?? Date.now;
  let compatibility: Promise<string | null> | null = null;
  let database: Promise<IDBDatabase> | null = null;

  function openDatabase() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) throw new Error("IndexedDB is unavailable.");
      const request = factory.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(ENTRIES);
        request.result.createObjectStore(USAGE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Model checkpoint database failed to open."),
        );
    }).catch((error: unknown) => {
      // A later open may succeed (another tab held an upgrade).
      database = null;
      throw error;
    });
    return database;
  }

  async function enforceRetention(keep: string) {
    const transaction = (await openDatabase()).transaction(
      [ENTRIES, USAGE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const usage = (await requestResult(
      transaction.objectStore(USAGE).getAll(),
    )) as ModelCheckpointUsageRecord[];
    let total = usage.reduce((sum, entry) => sum + entry.bytes, 0);
    const evicted: string[] = [];
    for (const entry of usage.sort((a, b) => a.usedAt - b.usedAt)) {
      if (total <= maxBytes) break;
      if (entry.key === keep) continue;
      transaction.objectStore(ENTRIES).delete(entry.key);
      transaction.objectStore(USAGE).delete(entry.key);
      total -= entry.bytes;
      evicted.push(entry.key);
    }
    await done;
    if (evicted.length) report({ kind: "evicted", keys: evicted });
  }

  const store: ModelCheckpointStore = {
    compatibility() {
      compatibility ??= options.fingerprint().catch((error: unknown) => {
        report({
          kind: "degraded",
          key: null,
          reason: `unfingerprinted-runtime: ${failureReason(error)}`,
        });
        return null;
      });
      return compatibility;
    },
    report,
    async read(key) {
      const expected = await store.compatibility();
      if (expected === null) return null;
      let value: unknown;
      try {
        const transaction = (await openDatabase()).transaction(
          [ENTRIES, USAGE],
          "readwrite",
        );
        const done = transactionDone(transaction);
        value = await requestResult(transaction.objectStore(ENTRIES).get(key));
        if (value !== undefined) {
          // Least-recently-used retention orders entries by their last read.
          const usage = (await requestResult(
            transaction.objectStore(USAGE).get(key),
          )) as ModelCheckpointUsageRecord | undefined;
          if (usage) {
            transaction.objectStore(USAGE).put({ ...usage, usedAt: now() });
          }
        }
        await done;
      } catch (error) {
        report({ kind: "degraded", key, reason: failureReason(error) });
        return null;
      }
      if (value === undefined) {
        report({ kind: "miss", key, reason: "absent" });
        return null;
      }
      const parsed = parseModelCheckpointRecord(value, expected);
      if (typeof parsed === "string") {
        report({ kind: "degraded", key, reason: `corrupt-entry: ${parsed}` });
        return null;
      }
      return parsed;
    },
    async publish(key, checkpoint) {
      const expected = await store.compatibility();
      if (expected === null) return;
      // The display payloads are an optional part: an entry too large with
      // them is stored without them.
      if (
        checkpoint.nativeTopologyPayloads &&
        memberBytes(checkpoint) > BROWSER_MODEL_CHECKPOINT_MAX_ENTRY_BYTES
      ) {
        checkpoint = { ...checkpoint, nativeTopologyPayloads: undefined };
      }
      const bytes = memberBytes(checkpoint);
      if (bytes > BROWSER_MODEL_CHECKPOINT_MAX_ENTRY_BYTES) {
        report({ kind: "bypass", reason: "checkpoint-exceeds-entry-bound" });
        return;
      }
      const record: ModelCheckpointRecord = {
        format: ENTRY_FORMAT,
        compatibility: expected,
        graph: checkpoint.graph,
        shapes: checkpoint.shapes,
        brep: checkpoint.brep,
        exportedDocument: checkpoint.exportedDocument,
        ...(checkpoint.nativeTopologyPayloads
          ? { nativeTopologyPayloads: checkpoint.nativeTopologyPayloads }
          : {}),
      };
      const usage: ModelCheckpointUsageRecord = { key, bytes, usedAt: now() };
      try {
        // One transaction: readers see the previous entry or this one.
        const transaction = (await openDatabase()).transaction(
          [ENTRIES, USAGE],
          "readwrite",
        );
        const done = transactionDone(transaction);
        transaction.objectStore(ENTRIES).put(record, key);
        transaction.objectStore(USAGE).put(usage);
        await done;
      } catch (error) {
        report({ kind: "degraded", key, reason: failureReason(error) });
        return;
      }
      report({ kind: "published", key, bytes });
      try {
        await enforceRetention(key);
      } catch (error) {
        report({ kind: "degraded", key: null, reason: failureReason(error) });
      }
    },
  };
  return store;
}
