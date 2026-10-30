// cadara-728r (Sentry CADARA-14): what restore sees when the stored Automerge
// document behind a remembered URL is missing or incomplete, using the real
// automerge-repo Repo over storage shared between "tabs" the way every tab's
// document-sync worker shares one IndexedDB database. cadara-rnsb: restore
// reports missing and incomplete storage distinctly, and "Reset stored
// history" stores the displayed document so later edits persist.
// cadara-l99p: with one URL store shared by all tabs (localStorage, forwarded
// with every worker request), a tab never writes a document another tab reset
// or replaced, so no incomplete storage is produced. Rows that model older
// builds keep a URL store per tab.
import { afterEach, expect, test } from "vitest";
import {
  Automerge,
  initializeBase64Wasm,
  Repo,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { CollaborativeDocument } from "@/core/modeling/collaborative-document";
import {
  createMemoryGeometryAssetStore,
  type GeometryAssetStore,
} from "@/core/modeling/geometry-asset-store";
import { createDeterministicGeometryAsset } from "@/core/modeling/geometry-asset-test-helpers";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { createModelingService } from "@/application/modeling/modeling-service";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import {
  IndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
  type AutomergeRepositoryLike,
} from "./indexeddb-automerge-document-repository";
import { SharedMemoryStorage } from "./shared-memory-automerge-storage.fixtures";

const repos: Repo[] = [];
// Repo.shutdown() flushes every cached handle and throws on unavailable ones.
afterEach(() => {
  for (const repo of repos.splice(0)) repo.networkSubsystem.disconnect();
});

async function tab(
  storage: SharedMemoryStorage,
  options: {
    channelName?: string;
    /** The tabs' shared localStorage URL store (cadara-l99p). */
    urls?: MemoryDocumentRepositoryUrlStore;
  } = {},
) {
  await initializeBase64Wasm(automergeWasmBase64);
  const repo = new Repo({
    storage,
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
  // Without a shared store: an older build, whose worker URL store was
  // per-tab memory fed from localStorage on load only.
  const urls = options.urls ?? new MemoryDocumentRepositoryUrlStore();
  const repository = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: urls,
    assetStore: createMemoryGeometryAssetStore(),
  });
  return { repo, urls, repository };
}

async function seedOnce(
  storage: SharedMemoryStorage,
  urls?: MemoryDocumentRepositoryUrlStore,
) {
  const seed = await createSeedAuthoredModelDocument();
  const writer = await tab(storage, { urls });
  const seeded = await writer.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(seeded.ok && seeded.status.kind).toBe("seeded");
  const url = writer.urls.get(seed.documentId)!;
  return { seed, url, writer };
}

async function restoreWithRememberedUrl(
  storage: SharedMemoryStorage,
  seed: AuthoredModelDocument,
  url: AutomergeUrl,
  options?: { channelName?: string },
) {
  const reader = await tab(storage, options);
  reader.urls.set(seed.documentId, url);
  return reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
}

test("a remembered URL whose storage is gone fails as missing storage, not as an unsupported storage format", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url } = await seedOnce(storage);
  storage.chunks.clear(); // IndexedDB evicted/cleared, localStorage URL kept

  const bare = await tab(storage);
  await expect(bare.repo.find(url)).rejects.toThrow(
    `Document ${url} is unavailable`,
  );
  const restored = await restoreWithRememberedUrl(storage, seed, url);
  expect(!restored.ok && restored.status).toMatchObject({
    kind: "failed",
    diagnostic: {
      reasonCode: "automerge-document-missing",
      message: expect.stringContaining("no longer has its stored copy"),
    },
  });
});

test("with the BroadcastChannel adapter, missing storage is still missing unless a live peer has the document", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url } = await seedOnce(storage);
  const peerStorage = new SharedMemoryStorage();
  for (const [key, chunk] of storage.chunks) peerStorage.chunks.set(key, chunk);
  storage.chunks.clear();

  // No peer on the channel.
  const alone = await restoreWithRememberedUrl(storage, seed, url, {
    channelName: "cadara-728r-alone",
  });
  expect(!alone.ok && alone.status.diagnostic.reasonCode).toBe(
    "automerge-document-missing",
  );

  // A peer that also lacks the document answers doc-unavailable.
  const emptyPeer = await tab(new SharedMemoryStorage(), {
    channelName: "cadara-728r-empty-peer",
  });
  await emptyPeer.repo.networkSubsystem.whenReady();
  const withEmptyPeer = await restoreWithRememberedUrl(storage, seed, url, {
    channelName: "cadara-728r-empty-peer",
  });
  expect(!withEmptyPeer.ok && withEmptyPeer.status.diagnostic.reasonCode).toBe(
    "automerge-document-missing",
  );

  // A peer tab that still holds the document syncs it back: restore succeeds.
  const livePeer = await tab(peerStorage, {
    channelName: "cadara-728r-live-peer",
  });
  await livePeer.repo.find(url);
  const withLivePeer = await restoreWithRememberedUrl(storage, seed, url, {
    channelName: "cadara-728r-live-peer",
  });
  expect(withLivePeer.ok && withLivePeer.status.kind).toBe("restored");
});

async function latePeer(
  assetStore: GeometryAssetStore = createMemoryGeometryAssetStore(),
) {
  const channelName = `late-discovery-${crypto.randomUUID()}`;
  const { seed, url, writer } = await seedOnce(new SharedMemoryStorage());
  const network = new BroadcastChannelNetworkAdapter({
    channelName,
    peerWaitMs: 1,
  });
  // Pin the interleaving: the discovery window has ended before the peer is visible.
  await network.whenReady();
  const readerRepo = new Repo({
    storage: new SharedMemoryStorage(),
    network: [network],
  });
  repos.push(readerRepo);
  const urls = new MemoryDocumentRepositoryUrlStore();
  urls.set(seed.documentId, url);
  const reader = new IndexedDbAutomergeDocumentRepository({
    repo: readerRepo as unknown as AutomergeRepositoryLike,
    urlStore: urls,
    assetStore,
  });
  const publications: string[] = [];
  reader.subscribe(seed.documentId, (event) =>
    publications.push(event.document.name),
  );
  const load = () =>
    reader.load({ documentId: seed.documentId, seedDocument: seed });
  const connect = () =>
    writer.repo.networkSubsystem.addNetworkAdapter(
      new BroadcastChannelNetworkAdapter({ channelName, peerWaitMs: 1 }),
    );
  return {
    seed,
    url,
    writer,
    reader,
    readerRepo,
    urls,
    publications,
    load,
    connect,
  };
}

async function expectMissingCopy(peer: Awaited<ReturnType<typeof latePeer>>) {
  expect(await peer.load()).toMatchObject({
    ok: false,
    status: { diagnostic: { reasonCode: "automerge-document-missing" } },
  });
  expect(
    (
      await peer.reader.mutate({
        documentId: peer.seed.documentId,
        expected: peer.seed,
        document: { ...peer.seed, name: "Must stay private" },
      })
    ).ok,
  ).toBe(false);
  expect(peer.publications).toEqual([]);
}

test("a fresh peer recovers a missing-copy restore when the same document arrives after discovery readiness", async () => {
  const peer = await latePeer();
  await expectMissingCopy(peer);
  peer.connect();
  await expect
    .poll(() => peer.reader.getRestoreStatus(peer.seed.documentId))
    .toMatchObject({ kind: "restored" });
  expect(peer.publications).toEqual([peer.seed.name]);
  expect(await peer.load()).toMatchObject({
    ok: true,
    document: { name: peer.seed.name },
  });
  expect(
    await peer.writer.repository.load({
      documentId: peer.seed.documentId,
      seedDocument: peer.seed,
    }),
  ).toMatchObject({
    ok: true,
    document: { name: peer.seed.name },
  });
});

test("a missing copy without a serving peer remains failed and cannot store a local draft", async () => {
  const peer = await latePeer();
  await expectMissingCopy(peer);
  await expectMissingCopy(peer);
  expect(peer.urls.get(peer.seed.documentId)).toBe(peer.url);
  expect(await peer.reader.undoDurableHistory(peer.seed.documentId)).toBeNull();
  expect(await peer.reader.redoDurableHistory(peer.seed.documentId)).toBeNull();
  expect(await peer.load()).toMatchObject({
    ok: false,
    status: { diagnostic: { reasonCode: "automerge-document-missing" } },
  });
  expect(peer.publications).toEqual([]);
});

test("a peer copy ready between find rejection and recovery attachment is not missed", async () => {
  const peer = await latePeer();
  const find = peer.readerRepo.find.bind(peer.readerRepo);
  peer.readerRepo.find = (async (...args: Parameters<typeof find>) => {
    try {
      return await find(...args);
    } catch (error) {
      const { handle } = peer.readerRepo.findWithProgress(peer.url);
      peer.connect();
      await handle.whenReady();
      throw error;
    }
  }) as typeof peer.readerRepo.find;
  await peer.load();
  await expect.poll(() => peer.publications).toEqual([peer.seed.name]);
  expect(peer.reader.getRestoreStatus(peer.seed.documentId)).toMatchObject({
    kind: "restored",
  });
});

test.each(["invalid", "identity-mismatch"] as const)(
  "late %s peer data cannot recover a missing copy or permit edits",
  async (kind) => {
    const peer = await latePeer();
    const handle = await peer.writer.repo.find<CollaborativeDocument>(peer.url);
    handle.change((document) => {
      if (kind === "invalid") document.authored.name = 123;
      else document.authored.documentId = "doc_another";
    });
    await expectMissingCopy(peer);
    peer.connect();
    await expect
      .poll(() => peer.reader.getRestoreStatus(peer.seed.documentId))
      .toMatchObject({
        kind: "failed",
        diagnostic: {
          reasonCode:
            kind === "invalid"
              ? "invalid-authored-document"
              : "identity-mismatch",
        },
      });
    expect(peer.publications).toEqual([]);
    expect(
      (
        await peer.reader.mutate({
          documentId: peer.seed.documentId,
          expected: peer.seed,
          document: { ...peer.seed, name: "Must stay private" },
        })
      ).ok,
    ).toBe(false);
  },
);

test.each(["url-changed", "reset", "initialize"] as const)(
  "late peer arrival cannot restore a %s document context",
  async (replacement) => {
    const peer = await latePeer();
    await expectMissingCopy(peer);
    if (replacement === "url-changed") peer.urls.delete(peer.seed.documentId);
    else if (replacement === "reset")
      await peer.reader.reset(peer.seed.documentId);
    else
      await peer.reader.initialize({
        documentId: peer.seed.documentId,
        document: { ...peer.seed, name: "Replacement" },
      });
    const before = peer.reader.getRestoreStatus(peer.seed.documentId);
    peer.publications.length = 0;
    peer.connect();
    // Await the actual late handle, then drain the repository queue; a discarded
    // context must not publish even though its Automerge copy is now ready.
    const handle = peer.readerRepo.findWithProgress(peer.url).handle;
    await handle.whenReady();
    expect(
      await peer.reader.undoDurableHistory(peer.seed.documentId),
    ).toBeNull();
    expect(peer.publications).toEqual([]);
    if (replacement === "initialize")
      expect(await peer.load()).toMatchObject({
        ok: true,
        document: { name: "Replacement" },
      });
    else
      expect(peer.reader.getRestoreStatus(peer.seed.documentId).kind).not.toBe(
        "restored",
      );
    expect(before.kind).not.toBe("restored");
  },
);

test.each(["changed", "deleted"] as const)(
  "a remembered URL %s during recovery's asset read cannot publish the superseded copy",
  async (change) => {
    const assets = createMemoryGeometryAssetStore();
    let releaseRead!: () => void;
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let markReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    const peer = await latePeer({
      put: (input) => assets.put(input),
      get: (asset) => assets.get(asset),
      has: async (asset) => {
        markReading();
        await readHeld;
        return assets.has(asset);
      },
    });
    const asset = await createDeterministicGeometryAsset({
      ownerFeatureIds: [peer.seed.features[0]!.featureId],
    });
    const published = {
      ...peer.seed,
      assets: { ...peer.seed.assets, records: [asset.asset] },
    };
    expect(
      await peer.writer.repository.mutate({
        documentId: peer.seed.documentId,
        expected: peer.seed,
        document: published,
        assets: [asset],
      }),
    ).toMatchObject({ ok: true });
    await expectMissingCopy(peer);
    peer.connect();
    await reading;
    // Worker requests adopt their incoming URL synchronously, even while a
    // prior repository operation is queued behind this asset-availability read.
    const replacementUrl =
      change === "changed" ? peer.writer.repo.create({}).url : null;
    if (replacementUrl) peer.urls.set(peer.seed.documentId, replacementUrl);
    else peer.urls.delete(peer.seed.documentId);
    releaseRead();
    // Drain recovery without requesting a load, which could legitimately seed
    // a new document after a deleted URL.
    await peer.reader.undoDurableHistory(peer.seed.documentId);
    expect(peer.publications).toEqual([]);
    expect(peer.reader.getRestoreStatus(peer.seed.documentId)).toMatchObject({
      kind: "failed",
    });
    expect(
      await peer.reader.mutate({
        documentId: peer.seed.documentId,
        expected: peer.seed,
        document: { ...peer.seed, name: "Must stay private" },
      }),
    ).toMatchObject({
      ok: false,
      status: { diagnostic: { reasonCode: "automerge-document-superseded" } },
    });
    expect(peer.urls.get(peer.seed.documentId)).toBe(replacementUrl);
    expect(peer.publications).toEqual([]);
    expect(
      await peer.writer.repository.load({
        documentId: peer.seed.documentId,
        seedDocument: peer.seed,
      }),
    ).toMatchObject({
      ok: true,
      document: { name: peer.seed.name },
    });
  },
);

test("a stale tab writing after another tab's reset leaves incremental-only storage that restores as incomplete storage", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url, writer: tabA } = await seedOnce(storage);
  const tabB = await tab(storage);
  tabB.urls.set(seed.documentId, url);
  const opened = await tabB.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(opened.ok && opened.status.kind).toBe("restored");

  // Tab A: "Reset stored history" -> repo.delete(url) -> removeDoc(documentId).
  expect((await tabA.repository.reset(seed.documentId)).kind).toBe("reset");
  expect(storage.documentChunkKinds(url)).toEqual([]);

  // Tab B never learns about the deletion and keeps editing.
  const edited = await tabB.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited in the stale tab" },
  });
  expect(edited.ok).toBe(true);
  expect(storage.documentChunkKinds(url)).toEqual(["incremental"]);

  // Next restore with the URL tab B re-persisted (WorkerBackedDocumentRepository.persistMetadata).
  const bare = await tab(storage);
  const handle = await bare.repo.find<CollaborativeDocument>(url);
  expect(handle.state).toBe("ready");
  expect(handle.doc()).toEqual({});
  // The surviving changes are queued behind the deleted snapshot's changes.
  expect(Automerge.getMissingDeps(handle.doc(), []).length).toBeGreaterThan(0);
  const restored = await restoreWithRememberedUrl(storage, seed, url);
  expect(!restored.ok && restored.status).toMatchObject({
    kind: "failed",
    diagnostic: {
      reasonCode: "automerge-document-incomplete",
      message: expect.stringContaining("is incomplete"),
    },
  });
  expect(!restored.ok && restored.status.diagnostic.message).not.toContain(
    "Unsupported collaborative document storage format",
  );
});

/** A tab whose restore fails on storage left incomplete by a stale tab. */
async function openIncompleteDocumentInService(
  storage: SharedMemoryStorage,
  adapter = new MockKernelAdapter(),
) {
  const { seed, url, writer: tabA } = await seedOnce(storage);
  const tabB = await tab(storage);
  tabB.urls.set(seed.documentId, url);
  await tabB.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  await tabA.repository.reset(seed.documentId);
  await tabB.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited in the stale tab" },
  });

  const reopened = await tab(storage);
  reopened.urls.set(seed.documentId, url);
  const service = createModelingService(adapter, {
    currentDocumentId: seed.documentId,
    documentRepository: reopened.repository,
  });
  expect(await service.getHistoryRestoreState()).toMatchObject({
    kind: "failed",
    entriesReplayed: 0,
    diagnostics: [{ reasonCode: "automerge-document-incomplete" }],
  });
  return { seed, url, reopened, service };
}

test("after the incomplete-storage restore, 'Reset stored history' stores the displayed document so the next edit persists without a reload", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url, reopened, service } =
    await openIncompleteDocumentInService(storage);

  // Record the repository calls and hold the reset until released.
  const calls: string[] = [];
  let releaseReset!: () => void;
  const resetHeld = new Promise<void>((resolve) => {
    releaseReset = resolve;
  });
  const { reset, initialize, mutate } = reopened.repository;
  reopened.repository.reset = async (documentId) => {
    await resetHeld;
    return reset.call(reopened.repository, documentId);
  };
  reopened.repository.initialize = (request) => {
    calls.push("initialize");
    return initialize.call(reopened.repository, request);
  };
  reopened.repository.mutate = (request) => {
    calls.push(`mutate ${request.document.name}`);
    return mutate.call(reopened.repository, request);
  };

  // The notification's only action (cad-workbench.tsx "Reset stored history"),
  // followed at once by an edit: the edit queues behind the recovery.
  service.resetOperationHistory();
  const renaming = service.renameDocument({ name: "After reset" });
  let renameSettled = false;
  void renaming.finally(() => {
    renameSettled = true;
  });
  // Ample time for an unqueued rename to finish while the reset is held.
  await Promise.race([renaming, new Promise((r) => setTimeout(r, 50))]);
  expect(renameSettled).toBe(false);
  releaseReset();
  const renamed = await renaming;
  expect(renamed).toMatchObject({ ok: true, diagnostics: [] });
  expect(calls).toEqual(["initialize", "mutate After reset"]);
  await service.waitForPersistence();
  expect(service.getLocalSaveStatus()).toEqual({
    saving: false,
    failure: null,
  });
  expect(await service.getHistoryRestoreState()).toMatchObject({
    kind: "empty",
  });
  const replacementUrl = reopened.urls.get(seed.documentId);
  expect(replacementUrl).not.toBeNull();
  expect(replacementUrl).not.toBe(url);

  // A reload restores the renamed document from the replacement.
  const reloaded = await restoreWithRememberedUrl(
    storage,
    seed,
    replacementUrl!,
  );
  expect(reloaded.ok && reloaded.status.kind).toBe("restored");
  expect(reloaded.ok && reloaded.document.name).toBe("After reset");
});

test("a 'Reset stored history' that cannot store the replacement reports an unsaved local change instead of silently dropping edits", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, reopened, service } =
    await openIncompleteDocumentInService(storage);
  reopened.repository.initialize = async () => ({
    ok: false,
    status: {
      kind: "failed",
      documentId: seed.documentId,
      diagnostic: {
        reasonCode: "automerge-initialize-failed",
        message: "Quota exceeded",
      },
    },
  });

  service.resetOperationHistory();
  await service.waitForPersistence();
  expect(service.getLocalSaveStatus().saving).toBe(false);
  expect(service.getLocalSaveStatus().failure).toMatchObject({
    target: "repository",
    reasonCode: "automerge-initialize-failed",
    message: "Quota exceeded",
  });
  expect(await service.getHistoryRestoreState()).toMatchObject({
    kind: "failed",
    diagnostics: [{ reasonCode: "automerge-initialize-failed" }],
  });
});

test("a 'Reset stored history' whose export throws reports the exception and keeps the stored document", async () => {
  const storage = new SharedMemoryStorage();
  const adapter = new MockKernelAdapter();
  const { seed, url, reopened, service } =
    await openIncompleteDocumentInService(storage, adapter);
  const chunksBefore = storage.documentChunkKinds(url);
  let resetCalled = false;
  const { reset } = reopened.repository;
  reopened.repository.reset = (documentId) => {
    resetCalled = true;
    return reset.call(reopened.repository, documentId);
  };
  adapter.exportAuthoredModelDocument = async () => {
    throw new Error("Kernel export failed");
  };

  service.resetOperationHistory();
  await service.waitForPersistence();
  expect(resetCalled).toBe(false);
  expect(reopened.urls.get(seed.documentId)).toBe(url);
  expect(storage.documentChunkKinds(url)).toEqual(chunksBefore);
  expect(service.getLocalSaveStatus()).toMatchObject({
    saving: false,
    failure: {
      target: "repository",
      reasonCode: "repository-reset-exception",
      message: "Kernel export failed",
    },
  });
  expect(await service.getHistoryRestoreState()).toMatchObject({
    kind: "failed",
    diagnostics: [{ reasonCode: "repository-reset-exception" }],
  });
});

const SUPERSEDED = {
  reasonCode: "automerge-document-superseded",
  message:
    "This document was reset or replaced in another tab, so this tab can no longer save to it. Reload the tab to open the stored version.",
};

/** Tab A seeds; tab B opens the same document; both share one URL store. */
async function openInTwoTabsSharingUrls(storage: SharedMemoryStorage) {
  const urls = new MemoryDocumentRepositoryUrlStore();
  const { seed, url, writer: tabA } = await seedOnce(storage, urls);
  const tabB = await tab(storage, { urls });
  const opened = await tabB.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(opened.ok && opened.status.kind).toBe("restored");
  return { seed, url, urls, tabA, tabB };
}

test("a stale tab's edit after another tab's reset is refused as superseded and writes nothing (cadara-l99p)", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url, urls, tabA, tabB } =
    await openInTwoTabsSharingUrls(storage);

  expect((await tabA.repository.reset(seed.documentId)).kind).toBe("reset");
  expect(storage.documentChunkKinds(url)).toEqual([]);

  const edited = await tabB.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Edited in the stale tab" },
  });
  expect(edited).toEqual({
    ok: false,
    status: {
      kind: "failed",
      documentId: seed.documentId,
      diagnostic: SUPERSEDED,
    },
  });
  expect(
    storage.documentChunkKinds(url),
    "no incremental chunk without its snapshot",
  ).toEqual([]);
  expect(urls.get(seed.documentId)).toBeNull();

  // The next tab seeds a fresh document instead of reading incomplete storage.
  const fresh = await tab(storage, { urls });
  const reopened = await fresh.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(reopened.ok && reopened.status.kind).toBe("seeded");
  expect(reopened.ok && reopened.document.name).toBe(seed.name);
});

test("a tab whose document another tab replaced refuses mutate, undo and redo, and reloading it restores the replacement (cadara-l99p)", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url, urls, tabA, tabB } =
    await openInTwoTabsSharingUrls(storage);
  // tabB can undo its edit; tabC can redo its undone edit.
  const bEdit = { ...seed, name: "Edited in tab B" };
  const bEdited = await tabB.repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: bEdit,
  });
  expect(bEdited.ok).toBe(true);
  const tabC = await tab(storage, { urls });
  const cOpened = await tabC.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(cOpened.ok && cOpened.document.name).toBe(bEdit.name);
  const cEdited = await tabC.repository.mutate({
    documentId: seed.documentId,
    expected: cOpened.ok ? cOpened.document : seed,
    document: { ...bEdit, name: "Edited in tab C" },
  });
  expect(cEdited.ok).toBe(true);
  expect((await tabC.repository.undoDurableHistory(seed.documentId))?.ok).toBe(
    true,
  );
  const tabD = await tab(storage, { urls });
  const dOpened = await tabD.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(dOpened.ok).toBe(true);
  const tabE = await tab(storage, { urls });
  expect(
    (
      await tabE.repository.load({
        documentId: seed.documentId,
        seedDocument: seed,
      })
    ).ok,
  ).toBe(true);

  // Tab A replaces the document (Import, or rnsb's reset + initialize).
  const replaced = await tabA.repository.initialize({
    documentId: seed.documentId,
    document: { ...seed, name: "Replaced in tab A" },
  });
  expect(replaced.ok && replaced.status.kind).toBe("seeded");
  const replacementUrl = urls.get(seed.documentId);
  expect(replacementUrl).not.toBe(url);
  const oldChunks = storage.documentChunkKeys(url);

  const refused = {
    ok: false,
    status: {
      kind: "failed",
      documentId: seed.documentId,
      diagnostic: SUPERSEDED,
    },
  };
  expect(await tabB.repository.undoDurableHistory(seed.documentId)).toEqual(
    refused,
  );
  expect(
    await tabB.repository.mutate({
      documentId: seed.documentId,
      expected: bEdit,
      document: { ...bEdit, name: "Edited in tab B after its refused undo" },
    }),
    "the released handle keeps the superseded refusal, not document-not-initialized",
  ).toEqual(refused);
  expect(await tabC.repository.redoDurableHistory(seed.documentId)).toEqual(
    refused,
  );
  expect(
    await tabD.repository.mutate({
      documentId: seed.documentId,
      expected: dOpened.ok ? dOpened.document : seed,
      document: { ...seed, name: "Edited in tab D" },
    }),
  ).toEqual(refused);
  expect(
    storage.documentChunkKeys(url),
    "the replaced document is not written",
  ).toEqual(oldChunks);
  expect(urls.get(seed.documentId)).toBe(replacementUrl);

  const fresh = await tab(storage, { urls });
  const reopened = await fresh.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(reopened.ok && reopened.status.kind).toBe("restored");
  expect(reopened.ok && reopened.document.name).toBe("Replaced in tab A");

  // Reloading a tab still holding the replaced document (tab E never wrote)
  // drops its stale handle and restores the replacement; so does tab B's.
  for (const stale of [tabE, tabB]) {
    const reloaded = await stale.repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect(reloaded.ok && reloaded.status.kind).toBe("restored");
    expect(reloaded.ok && reloaded.document.name).toBe("Replaced in tab A");
  }
  const replacement = { ...seed, name: "Replaced in tab A" };
  const bReloadedEdit = await tabB.repository.mutate({
    documentId: seed.documentId,
    expected: replacement,
    document: { ...replacement, name: "Edited in tab B after reloading" },
  });
  expect(bReloadedEdit.ok, "reloading clears the superseded refusal").toBe(
    true,
  );
  expect(storage.documentChunkKeys(url)).toEqual(oldChunks);
});

// cadara-rnsb review: automerge-repo 2.5.5 Repo.delete() also drops the
// handle from its cache, so the same tab reopening its deleted URL never gets
// find()'s "Document ... was deleted" (a generic automerge-load-failed). It
// reads storage again: missing, or incomplete after an older build's write.
test("a tab reopening a URL its own reset deleted fails as missing or incomplete storage, never as a generic load failure", async () => {
  async function reopenAfterOwnReset(staleWrite: boolean) {
    const storage = new SharedMemoryStorage();
    const { seed, url, writer } = await seedOnce(storage);
    const olderBuildTab = await tab(storage);
    olderBuildTab.urls.set(seed.documentId, url);
    await olderBuildTab.repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect((await writer.repository.reset(seed.documentId)).kind).toBe("reset");
    if (staleWrite)
      await olderBuildTab.repository.mutate({
        documentId: seed.documentId,
        expected: seed,
        document: { ...seed, name: "Edited in the stale tab" },
      });
    // The older build's tab wrote the URL back into localStorage.
    writer.urls.set(seed.documentId, url);
    const reopened = await writer.repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    return !reopened.ok && reopened.status.diagnostic.reasonCode;
  }
  expect(await reopenAfterOwnReset(false)).toBe("automerge-document-missing");
  expect(await reopenAfterOwnReset(true)).toBe("automerge-document-incomplete");
});

test("an edit in a tab whose document another tab reset is one unsaved repository change with the superseded reason, kept in memory (cadara-l99p)", async () => {
  const storage = new SharedMemoryStorage();
  const urls = new MemoryDocumentRepositoryUrlStore();
  const { seed, url, writer: tabA } = await seedOnce(storage, urls);
  const tabB = await tab(storage, { urls });
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: seed.documentId,
    documentRepository: tabB.repository,
    documentRepositoryPersistence: "background",
  });
  try {
    expect(await service.getHistoryRestoreState()).toMatchObject({
      kind: "restored",
    });
    await tabA.repository.reset(seed.documentId);

    expect(
      await service.renameDocument({ name: "Edited in the stale tab" }),
    ).toMatchObject({ ok: true });
    await service.waitForPersistence();
    const status = service.getLocalSaveStatus();
    expect(status).toEqual({
      saving: false,
      failure: {
        documentId: seed.documentId,
        target: "repository",
        ...SUPERSEDED,
      },
    });
    expect((await service.getCurrentDocumentSnapshot()).document.name).toBe(
      "Edited in the stale tab",
    );

    await service.renameDocument({ name: "Edited again" });
    await service.waitForPersistence();
    expect(
      service.getLocalSaveStatus().failure,
      "a later edit keeps the same failure, so it is reported once",
    ).toBe(status.failure);
    expect(storage.documentChunkKinds(url)).toEqual([]);
  } finally {
    service.dispose();
  }
});

// cadara-dx2k.15: a reload preloads the remembered document while the kernel
// boots; the load that follows takes that read instead of starting another.
test("a preloaded remembered document is read once, before its load, and restores", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url } = await seedOnce(storage);
  const reader = await tab(storage);
  reader.urls.set(seed.documentId, url);
  const finds: string[] = [];
  const find = reader.repo.find.bind(reader.repo);
  reader.repo.find = ((id: AutomergeUrl) => {
    finds.push(id);
    return find(id);
  }) as typeof reader.repo.find;

  await reader.repository.preload(seed.documentId);
  expect(finds, "the read starts without waiting for a load").toEqual([url]);
  const restored = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });

  expect(restored.ok && restored.status.kind).toBe("restored");
  expect(finds).toEqual([url]);
});

test("a preloaded remembered URL whose storage is gone fails its load as missing storage", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url } = await seedOnce(storage);
  await storage.removeRange([url.slice("automerge:".length)]);
  const reader = await tab(storage);
  reader.urls.set(seed.documentId, url);

  await reader.repository.preload(seed.documentId);
  const restored = await reader.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });

  expect(restored).toMatchObject({
    ok: false,
    status: { diagnostic: { reasonCode: "automerge-document-missing" } },
  });
});
