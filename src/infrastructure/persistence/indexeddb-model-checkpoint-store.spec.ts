// Lane: logic (docs/testing.md). Seam: the browser model checkpoint store
// (cadara-dx2k.6) through its injected IDBFactory. Node has no IndexedDB, so
// a minimal in-memory factory below implements the part of the API the store
// uses, with IndexedDB's ordering: request results arrive asynchronously and
// a transaction completes once no request is pending after its callbacks ran.
// A real browser's IndexedDB is exercised by the reload row of bench:mutation.
import { describe, expect, it } from "vitest";
import type {
  ModelCheckpoint,
  ModelCheckpointEvent,
} from "@/infrastructure/persistence/model-checkpoint-store";
import {
  createIndexedDbModelCheckpointStore,
  fingerprintBrowserModelCheckpointRuntime,
} from "@/infrastructure/persistence/indexeddb-model-checkpoint-store";

type Handler = (() => void) | null;

class FakeRequest<T> {
  result = undefined as T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
}

class FakeTransaction {
  error: Error | null = null;
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  private pending = 0;
  private readonly database: FakeDatabase;
  private readonly names: readonly string[];
  constructor(database: FakeDatabase, names: readonly string[]) {
    this.database = database;
    this.names = names;
    this.scheduleCompletion();
  }
  objectStore(name: string) {
    if (!this.names.includes(name)) throw new Error(`${name} is out of scope.`);
    const table = this.database.tables.get(name)!;
    const keyPath = this.database.keyPaths.get(name);
    return {
      get: (key: string) => this.request(() => structuredClone(table.get(key))),
      getAll: () =>
        this.request(() => [...table.values()].map((v) => structuredClone(v))),
      delete: (key: string) => this.request(() => void table.delete(key)),
      put: (value: unknown, key?: string) =>
        this.request(() => {
          if (this.database.failWrites) {
            throw Object.assign(new Error("quota"), {
              name: "QuotaExceededError",
            });
          }
          const id = keyPath
            ? (value as Record<string, string>)[keyPath]!
            : key!;
          table.set(id, structuredClone(value));
          return id;
        }),
    };
  }
  private request<T>(run: () => T) {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      this.pending -= 1;
      try {
        request.result = run();
        request.onsuccess?.();
      } catch (error) {
        request.error = error as Error;
        this.error = error as Error;
        request.onerror?.();
        this.onerror?.();
        return;
      }
      this.scheduleCompletion();
    });
    return request;
  }
  private scheduleCompletion() {
    setTimeout(() => {
      if (this.pending === 0 && !this.error) this.oncomplete?.();
    }, 0);
  }
}

class FakeDatabase {
  readonly tables = new Map<string, Map<string, unknown>>();
  readonly keyPaths = new Map<string, string | undefined>();
  failWrites = false;
  createObjectStore(name: string, options?: { keyPath?: string }) {
    this.tables.set(name, new Map());
    this.keyPaths.set(name, options?.keyPath);
  }
  transaction(names: string | string[]) {
    return new FakeTransaction(
      this,
      typeof names === "string" ? [names] : names,
    );
  }
}

function fakeIndexedDb() {
  const databases = new Map<string, FakeDatabase>();
  const factory = {
    open(name: string) {
      const request = new FakeRequest<FakeDatabase>();
      setTimeout(() => {
        let database = databases.get(name);
        if (!database) {
          database = new FakeDatabase();
          databases.set(name, database);
          request.result = database;
          request.onupgradeneeded?.();
        }
        request.result = database;
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, databases };
}

function checkpoint(tag: string, size = 16): ModelCheckpoint {
  return {
    graph: JSON.stringify({ o: [["tag", tag]] }),
    shapes: [
      {
        wrapper: "TopoDS_Solid",
        isNull: false,
        shapeType: 2,
        orientation: 0,
        mapIndex: 0,
      },
    ],
    brep: `${tag}:${"x".repeat(size)}`,
    exportedDocument: JSON.stringify({ name: tag, unicode: "αβγ" }),
  };
}

function makeStore(
  indexedDB: IDBFactory,
  options: {
    compatibility?: string | null | Error;
    maxBytes?: number;
    clock?: { now: number };
  } = {},
) {
  const events: ModelCheckpointEvent[] = [];
  const clock = options.clock ?? { now: 0 };
  const compatibility =
    options.compatibility === undefined
      ? "a".repeat(64)
      : options.compatibility;
  const store = createIndexedDbModelCheckpointStore({
    indexedDB,
    fingerprint: () =>
      compatibility instanceof Error
        ? Promise.reject(compatibility)
        : Promise.resolve(compatibility),
    report: (event) => events.push(event),
    maxBytes: options.maxBytes,
    now: () => (clock.now += 1),
  });
  return { store, events };
}

const kinds = (events: ModelCheckpointEvent[]) =>
  events.map((event) => event.kind);
const KEY_A = "1".repeat(64);
const KEY_B = "2".repeat(64);
const KEY_C = "3".repeat(64);

describe("IndexedDB model checkpoint store", () => {
  it("round-trips a published entry exactly and reports an absent key as a miss", async () => {
    const { factory } = fakeIndexedDb();
    const { store, events } = makeStore(factory);
    expect(await store.read(KEY_A)).toBeNull();
    await store.publish(KEY_A, checkpoint("a"));
    expect(await store.read(KEY_A)).toEqual(checkpoint("a"));
    expect(kinds(events)).toEqual(["miss", "published"]);
  });

  it("never returns another build's entry or a malformed record", async () => {
    const { factory, databases } = fakeIndexedDb();
    await makeStore(factory, { compatibility: "a".repeat(64) }).store.publish(
      KEY_A,
      checkpoint("a"),
    );
    const other = makeStore(factory, { compatibility: "b".repeat(64) });
    expect(await other.store.read(KEY_A)).toBeNull();
    expect(other.events).toEqual([
      {
        kind: "degraded",
        key: KEY_A,
        reason: "corrupt-entry: the record names another build/runtime.",
      },
    ]);

    const entries = [...databases.values()][0]!.tables.get("entries")!;
    const record = entries.get(KEY_A) as Record<string, unknown>;
    entries.set(KEY_A, { ...record, shapes: [{ wrapper: "TopoDS_Solid" }] });
    const reader = makeStore(factory);
    expect(await reader.store.read(KEY_A)).toBeNull();
    expect(reader.events.at(-1)).toMatchObject({
      kind: "degraded",
      reason: "corrupt-entry: invalid shape records.",
    });
    entries.set(KEY_A, { ...record, brep: 7 });
    expect(await reader.store.read(KEY_A)).toBeNull();
    expect(reader.events.at(-1)).toMatchObject({
      reason: "corrupt-entry: a member is not a string.",
    });
  });

  it("evicts the least recently read entries above its bound, never the one just published", async () => {
    const { factory, databases } = fakeIndexedDb();
    const entry = checkpoint("a", 100);
    const size =
      entry.graph.length +
      entry.brep.length +
      entry.exportedDocument.length +
      JSON.stringify(entry.shapes).length;
    // Room for two of the three equally sized entries.
    const { store, events } = makeStore(factory, { maxBytes: size * 2.5 });
    await store.publish(KEY_A, checkpoint("a", 100));
    await store.publish(KEY_B, checkpoint("b", 100));
    expect(await store.read(KEY_A)).not.toBeNull();
    await store.publish(KEY_C, checkpoint("c", 100));
    expect(events.at(-1)).toEqual({ kind: "evicted", keys: [KEY_B] });
    const tables = [...databases.values()][0]!.tables;
    expect([...tables.get("entries")!.keys()].sort()).toEqual([KEY_A, KEY_C]);
    expect([...tables.get("usage")!.keys()].sort()).toEqual([KEY_A, KEY_C]);
  });

  it("stays out of the open without a fingerprint and reports failures as degradation", async () => {
    const { factory, databases } = fakeIndexedDb();
    const unfingerprinted = makeStore(factory, { compatibility: null });
    await unfingerprinted.store.publish(KEY_A, checkpoint("a"));
    expect(await unfingerprinted.store.read(KEY_A)).toBeNull();
    expect(unfingerprinted.events).toEqual([]);
    expect(databases.size, "no database is opened").toBe(0);

    const failing = makeStore(factory, { compatibility: new Error("no hash") });
    expect(await failing.store.compatibility()).toBeNull();
    expect(failing.events).toEqual([
      {
        kind: "degraded",
        key: null,
        reason: "unfingerprinted-runtime: Error: no hash",
      },
    ]);

    const { store, events } = makeStore(factory);
    await store.read(KEY_A);
    [...databases.values()][0]!.failWrites = true;
    await store.publish(KEY_A, checkpoint("a"));
    expect(events.at(-1)).toEqual({
      kind: "degraded",
      key: KEY_A,
      reason: "QuotaExceededError: quota",
    });
    const unavailable = makeStore(undefined as unknown as IDBFactory);
    expect(await unavailable.store.read(KEY_A)).toBeNull();
    expect(kinds(unavailable.events)).toEqual(["degraded"]);
  });
});

describe("browser model checkpoint fingerprint", () => {
  it("changes with the worker bundle and the browser", async () => {
    const base = {
      workerScriptPath: "/assets/worker-AAAA.js",
      userAgent: "UA 1",
    };
    const fingerprint = await fingerprintBrowserModelCheckpointRuntime(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintBrowserModelCheckpointRuntime(base)).toBe(
      fingerprint,
    );
    for (const changed of [
      { ...base, workerScriptPath: "/assets/worker-BBBB.js" },
      { ...base, userAgent: "UA 2" },
    ]) {
      expect(await fingerprintBrowserModelCheckpointRuntime(changed)).not.toBe(
        fingerprint,
      );
    }
  });
});
