// cadara-728r (Sentry CADARA-14): what restore sees when the stored Automerge
// document behind a remembered URL is missing or incomplete, using the real
// automerge-repo Repo over storage shared between "tabs" the way every tab's
// document-sync worker shares one IndexedDB database. The last two rows pin
// the current defect; cadara-rnsb replaces their expectations with distinct
// missing/incomplete diagnostics and a working "Reset stored history".
import { afterEach, expect, test } from "vitest";
import {
  Automerge,
  initializeBase64Wasm,
  Repo,
  type AutomergeUrl,
  type Chunk,
  type StorageAdapterInterface,
  type StorageKey,
} from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { CollaborativeDocument } from "@/domain/modeling/collaborative-document";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createSeedAuthoredModelDocument } from "@/domain/modeling/modeling-test-fixtures";
import {
  IndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
  type AutomergeRepositoryLike,
} from "./indexeddb-automerge-document-repository";

/** One shared key space, like the single IndexedDB database all tabs open. */
class SharedMemoryStorage implements StorageAdapterInterface {
  readonly chunks = new Map<string, { key: StorageKey; data: Uint8Array }>();
  async load(key: StorageKey) {
    return this.chunks.get(key.join("/"))?.data;
  }
  async save(key: StorageKey, data: Uint8Array) {
    this.chunks.set(key.join("/"), { key, data });
  }
  async remove(key: StorageKey) {
    this.chunks.delete(key.join("/"));
  }
  async loadRange(prefix: StorageKey): Promise<Chunk[]> {
    return [...this.chunks.values()]
      .filter(({ key }) => prefix.every((part, index) => key[index] === part))
      .map(({ key, data }) => ({ key, data }));
  }
  async removeRange(prefix: StorageKey) {
    for (const chunk of await this.loadRange(prefix))
      this.chunks.delete(chunk.key.join("/"));
  }
  documentChunkKinds(url: AutomergeUrl) {
    const documentId = url.slice("automerge:".length);
    return [...this.chunks.values()]
      .filter(({ key }) => key[0] === documentId)
      .map(({ key }) => key[1])
      .sort();
  }
}

const repos: Repo[] = [];
// Repo.shutdown() flushes every cached handle and throws on unavailable ones.
afterEach(() => {
  for (const repo of repos.splice(0)) repo.networkSubsystem.disconnect();
});

async function tab(
  storage: SharedMemoryStorage,
  options: { channelName?: string } = {},
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
  // The worker's URL store is per-tab memory fed from localStorage on load.
  const urls = new MemoryDocumentRepositoryUrlStore();
  const repository = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: urls,
    assetStore: createMemoryGeometryAssetStore(),
  });
  return { repo, urls, repository };
}

async function seedOnce(storage: SharedMemoryStorage) {
  const seed = await createSeedAuthoredModelDocument();
  const writer = await tab(storage);
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

test("a remembered URL whose storage is gone fails as 'unavailable', not as an unsupported storage format", async () => {
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
      reasonCode: "automerge-load-failed",
      message: `Document ${url} is unavailable`,
    },
  });
});

test("with the BroadcastChannel adapter, missing storage is still 'unavailable' unless a live peer has the document", async () => {
  const storage = new SharedMemoryStorage();
  const { seed, url } = await seedOnce(storage);
  const peerStorage = new SharedMemoryStorage();
  for (const [key, chunk] of storage.chunks) peerStorage.chunks.set(key, chunk);
  storage.chunks.clear();

  // No peer on the channel.
  const alone = await restoreWithRememberedUrl(storage, seed, url, {
    channelName: "cadara-728r-alone",
  });
  expect(!alone.ok && alone.status.diagnostic.message).toBe(
    `Document ${url} is unavailable`,
  );

  // A peer that also lacks the document answers doc-unavailable.
  const emptyPeer = await tab(new SharedMemoryStorage(), {
    channelName: "cadara-728r-empty-peer",
  });
  await emptyPeer.repo.networkSubsystem.whenReady();
  const withEmptyPeer = await restoreWithRememberedUrl(storage, seed, url, {
    channelName: "cadara-728r-empty-peer",
  });
  expect(!withEmptyPeer.ok && withEmptyPeer.status.diagnostic.message).toBe(
    `Document ${url} is unavailable`,
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

test("a stale tab writing after another tab's reset leaves incremental-only storage that restores as an unsupported storage format", async () => {
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
      reasonCode: "automerge-load-failed",
      message: "Unsupported collaborative document storage format",
    },
  });
});

test("after the unsupported-format restore, 'Reset stored history' does not make edits persist until the document is loaded again", async () => {
  const storage = new SharedMemoryStorage();
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
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: seed.documentId,
    documentRepository: reopened.repository,
  });
  expect(await service.getHistoryRestoreState()).toMatchObject({
    kind: "failed",
    entriesReplayed: 0,
    diagnostics: [
      { message: "Unsupported collaborative document storage format" },
    ],
  });

  // The notification's only action (cad-workbench.tsx "Reset stored history").
  service.resetOperationHistory();
  await service.waitForPersistence();
  expect(reopened.urls.get(seed.documentId)).toBeNull();
  const renamed = await service.renameDocument({ name: "After reset" });
  expect(renamed).toMatchObject({
    ok: false,
    diagnostics: [
      { message: "Load or initialize the document before editing." },
    ],
  });

  // A reload finds no URL and seeds a fresh document; the authored work is gone.
  const reloaded = await reopened.repository.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(reloaded.ok && reloaded.status.kind).toBe("seeded");
});
