// Lane: logic (docs/testing.md). Seam: IndexedDbAutomergeDocumentRepository
// load/mutate/subscribe with the materialized-document cache (cadara-dx2k.17),
// over the real automerge-repo Repo and storage shared between "tabs" the way
// every tab's document-sync worker shares one IndexedDB database. A reload
// answers from the cache only while the stored chunk keys are the record's;
// every other case is today's Automerge load with today's reason codes, and
// the Automerge load a cached answer stands for runs on the document's queue
// before any later request. The browser's IndexedDB is exercised by the
// reload row of bench:mutation and the offline E2E lane.
import { afterEach, expect, test, vi } from "vitest";
import {
  Automerge,
  initializeBase64Wasm,
  Repo,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import type { DocumentRepositoryChangeEvent } from "@/contracts/modeling/document-repository";
import type { CollaborativeDocument } from "@/core/modeling/collaborative-document";
import { createMemoryGeometryAssetStore } from "@/core/modeling/geometry-asset-store";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import {
  IndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
  type AutomergeRepositoryLike,
} from "./indexeddb-automerge-document-repository";
import { AutomergeChunkKeyRecorder } from "./automerge-chunk-key-recorder";
import {
  SharedMemoryMaterializedDocumentStore,
  SharedMemoryStorage,
} from "./shared-memory-automerge-storage.fixtures";

const repos: Repo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.networkSubsystem.disconnect();
});

/** One tab's document-sync worker; `cache: null` is a build without the cache. */
async function tab(
  storage: SharedMemoryStorage,
  cache: SharedMemoryMaterializedDocumentStore | null,
  options: {
    urls?: MemoryDocumentRepositoryUrlStore;
    channelName?: string;
    compatibility?: string;
  } = {},
) {
  await initializeBase64Wasm(automergeWasmBase64);
  const recorder = new AutomergeChunkKeyRecorder(storage);
  const repo = new Repo({
    storage: recorder,
    network: options.channelName
      ? [
          new BroadcastChannelNetworkAdapter({
            channelName: options.channelName,
            peerWaitMs: 50,
          }),
        ]
      : [],
  });
  repos.push(repo);
  // Every Automerge read of this tab, and a gate that holds them.
  const finds: string[] = [];
  let held: Promise<void> | null = null;
  let release = () => {};
  const find = repo.find.bind(repo);
  repo.find = (async (id: AutomergeUrl) => {
    finds.push(id);
    if (held) await held;
    return find(id);
  }) as typeof repo.find;
  const urls = options.urls ?? new MemoryDocumentRepositoryUrlStore();
  const repository = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    chunkKeyRecorder: recorder,
    urlStore: urls,
    assetStore: createMemoryGeometryAssetStore(),
    materializedDocuments: cache?.options(options.compatibility),
  });
  return {
    repo,
    urls,
    repository,
    finds,
    holdAutomergeReads() {
      held = new Promise((resolve) => {
        release = resolve;
      });
    },
    releaseAutomergeReads() {
      held = null;
      release();
    },
  };
}

async function waitForStoredRecord(
  cache: SharedMemoryMaterializedDocumentStore,
  count = 1,
) {
  await vi.waitFor(() =>
    expect(
      cache.events.filter((event) => event.kind === "stored").length,
    ).toBeGreaterThanOrEqual(count),
  );
}

/** Tab A seeds the document and records it; the URL store is shared. */
async function seedRecorded(
  storage: SharedMemoryStorage,
  cache: SharedMemoryMaterializedDocumentStore,
) {
  const seed = await createSeedAuthoredModelDocument();
  const urls = new MemoryDocumentRepositoryUrlStore();
  const writer = await tab(storage, cache, { urls });
  const seeded = await writer.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(seeded.ok && seeded.status.kind).toBe("seeded");
  await waitForStoredRecord(cache);
  const url = urls.get(seed.documentId)!;
  expect(cache.records.has(url)).toBe(true);
  // The document as stored (the collaborative form orders some members).
  const stored = seeded.ok ? seeded.document : seed;
  return { seed, stored, url, urls, writer };
}

test("a reload whose stored chunk keys are the record's answers with the document and heads a cold load returns, without waiting for the Automerge load", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, urls } = await seedRecorded(storage, cache);

  const reader = await tab(storage, cache, { urls });
  reader.holdAutomergeReads();
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cache.eventKinds()).toContain("hit");

  const cold = await tab(storage, null, { urls });
  const loaded = await cold.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  if (!cached.ok || !loaded.ok) throw new Error("load failed");
  expect(cached.document).toEqual(loaded.document);
  expect(cached.metadata.heads).toEqual(loaded.metadata.heads);
  expect(cached.status).toEqual({
    kind: "restored",
    documentId: seed.documentId,
  });
  expect(cached.metadata).toMatchObject({
    source: "restore",
    storageKey: loaded.metadata.storageKey,
  });
  expect(cached.metadata.actorId).not.toBe("");
  expect(cached.metadata.actorId).not.toBe(loaded.metadata.actorId);
  expect(reader.repository.getRestoreStatus(seed.documentId)).toEqual(
    cached.status,
  );
  reader.releaseAutomergeReads();
});

test("the Automerge load behind a cached answer waits for settleLoad, and equal heads publish nothing more", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, url, urls } = await seedRecorded(storage, cache);
  const reader = await tab(storage, cache, { urls });
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  if (!cached.ok) throw new Error("load failed");
  const events: DocumentRepositoryChangeEvent[] = [];
  reader.repository.subscribe(seed.documentId, (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(reader.finds, "nothing reads the Automerge document yet").toEqual([]);

  reader.repository.settleLoad(seed.documentId);
  await vi.waitFor(() => expect(reader.finds).toEqual([url]));
  // The installed handle is at the answered heads: a mutate conditioned on
  // the answered document applies, and its ledger is undoable.
  const renamed = await reader.repository.mutate({
    documentId: seed.documentId,
    expected: cached.document,
    document: { ...cached.document, name: "Renamed" },
  });
  expect(renamed.ok).toBe(true);
  expect(
    events.map((event) => event.metadata.source),
    "the answer replayed to the subscriber, then the edit; no peer publication",
  ).toEqual(["restore", "local"]);
  expect(reader.finds).toEqual([url]);
});

test("an edit before settleLoad (or with settleLoad never called) starts the deferred Automerge load, waits for it and applies", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, url, urls } = await seedRecorded(storage, cache);
  const reader = await tab(storage, cache, { urls });
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  if (!cached.ok) throw new Error("load failed");
  expect(reader.finds).toEqual([]);

  const renamed = await reader.repository.mutate({
    documentId: seed.documentId,
    expected: cached.document,
    document: { ...cached.document, name: "Renamed before settleLoad" },
  });
  expect(reader.finds).toEqual([url]);
  expect(renamed.ok && renamed.document.name).toBe("Renamed before settleLoad");
  const cold = await tab(storage, null, { urls });
  const reloaded = await cold.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(reloaded.ok && reloaded.document.name).toBe(
    "Renamed before settleLoad",
  );
  expect(reloaded.ok && reloaded.metadata.heads).toEqual(
    renamed.ok && renamed.metadata.heads,
  );
});

test("a mutate issued right after a cached answer waits for the Automerge load, applies to the stored document and keeps the session's actor", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, urls } = await seedRecorded(storage, cache);
  const reader = await tab(storage, cache, { urls });
  reader.holdAutomergeReads();
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  if (!cached.ok) throw new Error("load failed");

  const renaming = reader.repository.mutate({
    documentId: seed.documentId,
    expected: cached.document,
    document: { ...cached.document, name: "Renamed after the cached reload" },
  });
  let settled = false;
  void renaming.finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(settled, "the mutate queues behind the Automerge load").toBe(false);
  reader.releaseAutomergeReads();
  const renamed = await renaming;
  expect(renamed.ok && renamed.document.name).toBe(
    "Renamed after the cached reload",
  );
  expect(renamed.ok && renamed.metadata.actorId).toBe(cached.metadata.actorId);
  expect(reader.finds).toHaveLength(1);
  const undone = await reader.repository.undoDurableHistory(seed.documentId);
  expect(undone?.ok && undone.document.name).toBe(seed.name);
  const redone = await reader.repository.redoDurableHistory(seed.documentId);
  expect(redone?.ok && redone.document.name).toBe(
    "Renamed after the cached reload",
  );

  const cold = await tab(storage, null, { urls });
  const reloaded = await cold.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(reloaded.ok && reloaded.document.name).toBe(
    "Renamed after the cached reload",
  );
});

test("the record follows every publication: a reload after edits answers from the cache with the edited document", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, urls, writer } = await seedRecorded(storage, cache);
  const edited = await writer.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited" },
  });
  expect(edited.ok).toBe(true);
  await waitForStoredRecord(cache, 2);

  const reader = await tab(storage, cache, { urls });
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cache.eventKinds().at(-1)).toBe("hit");
  expect(cached.ok && cached.document.name).toBe("Edited");
  expect(cached.ok && cached.metadata.heads).toEqual(
    edited.ok && edited.metadata.heads,
  );
});

test("any chunk-key difference (another tab's write, a compaction) misses and loads the stored document", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, url, urls } = await seedRecorded(storage, cache);

  // A tab of a build without the cache writes without updating the record.
  const other = await tab(storage, null, { urls });
  await other.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  await other.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Written by another tab" },
  });
  const afterWrite = await tab(storage, cache, { urls });
  const reloaded = await afterWrite.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cache.eventKinds()).toContain("miss: chunk-keys-changed");
  expect(reloaded.ok && reloaded.document.name).toBe("Written by another tab");
  await waitForStoredRecord(cache, 2);

  // Compaction: the same changes under another chunk key.
  const holder = await tab(storage, null, { urls });
  const handle = await holder.repo.find<CollaborativeDocument>(url);
  const documentId = url.slice("automerge:".length);
  const bytes = Automerge.save(handle.doc());
  await storage.removeRange([documentId]);
  await storage.save([documentId, "snapshot", "compacted"], bytes);
  const events = cache.events.length;
  const afterCompaction = await tab(storage, cache, { urls });
  const compacted = await afterCompaction.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cache.eventKinds().slice(events)).toContain(
    "miss: chunk-keys-changed",
  );
  expect(compacted.ok && compacted.document).toEqual(
    reloaded.ok && reloaded.document,
  );
});

test("missing and incomplete storage behind a record still fail with today's reason codes", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, url, urls } = await seedRecorded(storage, cache);
  const documentId = url.slice("automerge:".length);

  // Incremental-only storage: an edit by a build without the cache, then
  // the snapshot it builds on is lost.
  const other = await tab(storage, null, { urls });
  await other.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  await other.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited" },
  });
  await storage.removeRange([documentId, "snapshot"]);
  expect(storage.documentChunkKinds(url)).toEqual(["incremental"]);
  const incomplete = await (
    await tab(storage, cache, { urls })
  ).repository.load({ documentId: seed.documentId, seedDocument: seed });
  expect(!incomplete.ok && incomplete.status.diagnostic.reasonCode).toBe(
    "automerge-document-incomplete",
  );

  // Site data cleared except the record and the remembered URL.
  storage.chunks.clear();
  const missing = await (
    await tab(storage, cache, { urls })
  ).repository.load({ documentId: seed.documentId, seedDocument: seed });
  expect(!missing.ok && missing.status.diagnostic.reasonCode).toBe(
    "automerge-document-missing",
  );
  expect(cache.eventKinds().filter((kind) => kind === "hit")).toEqual([]);
});

test("a corrupt record, one from another build or one of another document falls back to the Automerge load", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, stored, url, urls } = await seedRecorded(storage, cache);
  const record = cache.records.get(url) as Record<string, unknown>;
  const document = record.document as Record<string, unknown>;

  const variants: [unknown, string][] = [
    ["not a record", "degraded: corrupt-entry: not a record."],
    [
      { ...record, document: { ...document, features: "corrupt" } },
      "degraded: corrupt-entry: invalid document",
    ],
    [
      { ...record, chunkKeys: [] },
      "degraded: corrupt-entry: invalid chunk keys or heads.",
    ],
    [
      { ...record, compatibility: "/assets/document-sync.worker-older.js" },
      "degraded: corrupt-entry: the record names another build.",
    ],
    [
      { ...record, document: { ...document, documentId: "doc_other" } },
      "miss: identity-mismatch",
    ],
  ];
  for (const [value, event] of variants) {
    cache.records.set(url, value);
    const events = cache.events.length;
    const reader = await tab(storage, cache, { urls });
    const loaded = await reader.repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect(loaded.ok && loaded.document).toEqual(stored);
    expect(cache.eventKinds()[events]).toContain(event);
    expect(reader.finds, event).toEqual([url]);
    // The Automerge load's publication replaces the unusable record.
    await vi.waitFor(() =>
      expect(cache.eventKinds().slice(events)).toContain("stored"),
    );
  }
});

test("a record write that fails (quota) is reported, never fails the publication, and the next reload loads normally", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  cache.failWrites = true;
  const seed = await createSeedAuthoredModelDocument();
  const urls = new MemoryDocumentRepositoryUrlStore();
  const writer = await tab(storage, cache, { urls });
  const seeded = await writer.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(seeded.ok && seeded.status.kind).toBe("seeded");
  await vi.waitFor(() =>
    expect(cache.eventKinds()).toContain(
      "degraded: The quota has been exceeded.",
    ),
  );
  const edited = await writer.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited" },
  });
  expect(edited.ok).toBe(true);

  const reader = await tab(storage, cache, { urls });
  const loaded = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cache.eventKinds()).toContain("miss: absent");
  expect(loaded.ok && loaded.document.name).toBe("Edited");
});

test("a peer change that lands during the Automerge load behind a cached answer reaches subscribers", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, urls } = await seedRecorded(storage, cache);
  const channelName = "cadara-dx2k-17-peer-during-install";
  const peer = await tab(storage, cache, { urls, channelName });
  await peer.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  const reader = await tab(storage, cache, { urls, channelName });
  reader.holdAutomergeReads();
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cached.ok && cached.document.name).toBe(seed.name);
  const events: DocumentRepositoryChangeEvent[] = [];
  reader.repository.subscribe(seed.documentId, (event) => events.push(event));

  expect(
    (
      await peer.repository.mutate({
        documentId: seed.documentId,
        expected: seed,
        document: { ...seed, name: "Renamed by the peer" },
      })
    ).ok,
  ).toBe(true);
  reader.releaseAutomergeReads();
  reader.repository.settleLoad(seed.documentId);
  await vi.waitFor(() =>
    expect(events.at(-1)?.document.name).toBe("Renamed by the peer"),
  );
  expect(events.at(-1)?.metadata).toMatchObject({
    source: "peer",
    actorId: cached.ok && cached.metadata.actorId,
  });
});

test("a stored copy that fails to load after the cached answer refuses later writes with the load's reason code", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, urls } = await seedRecorded(storage, cache);
  const reader = await tab(storage, cache, { urls });
  reader.holdAutomergeReads();
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cached.ok).toBe(true);
  storage.chunks.clear(); // evicted between the answer and the Automerge load
  reader.releaseAutomergeReads();

  const edited = await reader.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited" },
  });
  expect(!edited.ok && edited.status.diagnostic.reasonCode).toBe(
    "automerge-document-missing",
  );
  expect(reader.repository.getRestoreStatus(seed.documentId)).toMatchObject({
    kind: "failed",
    diagnostic: { reasonCode: "automerge-document-missing" },
  });
  expect(cache.eventKinds()).toContain(
    "degraded: stored-copy-failed-after-answer: automerge-document-missing",
  );
  // An explicit load retries through the Automerge load.
  const reloaded = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(!reloaded.ok && reloaded.status.diagnostic.reasonCode).toBe(
    "automerge-document-missing",
  );
});

test("a reset in another tab between a cached answer and its Automerge load leaves this tab superseded", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, url, urls, writer } = await seedRecorded(storage, cache);
  const reader = await tab(storage, cache, { urls });
  reader.holdAutomergeReads();
  expect(
    (
      await reader.repository.load({
        documentId: seed.documentId,
        seedDocument: seed,
      })
    ).ok,
  ).toBe(true);
  expect((await writer.repository.reset(seed.documentId)).kind).toBe("reset");
  expect(cache.records.has(url), "reset frees the record").toBe(false);
  reader.releaseAutomergeReads();

  const edited = await reader.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited in the stale tab" },
  });
  expect(!edited.ok && edited.status.diagnostic.reasonCode).toBe(
    "automerge-document-superseded",
  );
  expect(storage.documentChunkKinds(url)).toEqual([]);
});

test("a preloaded document with a matching record is answered from the cache and read from Automerge once, after the answer", async () => {
  const storage = new SharedMemoryStorage();
  const cache = new SharedMemoryMaterializedDocumentStore();
  const { seed, stored, url, urls } = await seedRecorded(storage, cache);
  const reader = await tab(storage, cache, { urls });
  reader.holdAutomergeReads();

  await reader.repository.preload(seed.documentId);
  const cached = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cached.ok && cached.document).toEqual(stored);
  expect(cache.eventKinds().at(-1)).toBe("hit");
  reader.releaseAutomergeReads();
  const edited = await reader.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited" },
  });
  expect(edited.ok).toBe(true);
  expect(reader.finds).toEqual([url]);
});
