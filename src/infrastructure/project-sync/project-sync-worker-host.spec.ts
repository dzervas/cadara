import { beforeAll, expect, test, vi } from "vitest";
import { initializeBase64Wasm, Repo } from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { SharedMemoryStorage } from "@/infrastructure/persistence/shared-memory-automerge-storage.fixtures";
import { createProjectSyncWorkerHost } from "./project-sync-worker-host";
import { ProjectSyncBridge } from "./project-sync-bridge";
import {
  link,
  makeClient,
  makeManifest,
  makeRoom,
} from "./project-sync-room.fixtures";

beforeAll(async () => {
  await initializeBase64Wasm(automergeWasmBase64);
});

test("part documents reach the room only after it acknowledged the manifest listing them", async () => {
  const repo = new Repo({ storage: new SharedMemoryStorage(), network: [] });
  const part = repo.create({ length: 1 });
  const manifest = repo.create(
    makeManifest([
      {
        name: "Part",
        kind: "part",
        docId: "doc_part",
        automergeDocumentId: part.documentId,
      },
    ]),
  );
  const room = makeRoom(manifest.documentId);
  const synced = makeClient(room, repo);
  await synced.start(manifest.documentId);
  await vi.waitFor(() => expect(synced.status()?.connection).toBe("synced"), {
    timeout: 5_000,
  });
  expect(room.network.violations).toEqual([]);
  expect(
    room.repo.handles[part.documentId]?.doc(),
    "The room stored the part",
  ).toEqual({ length: 1 });

  const second = repo.create({ length: 2 });
  manifest.change((draft) => {
    draft.entries.push({
      name: "Second",
      kind: "part",
      docId: "doc_second",
      automergeDocumentId: second.documentId,
    });
  });
  await vi.waitFor(
    () => expect(room.repo.handles[second.documentId]?.isReady()).toBe(true),
    { timeout: 5_000 },
  );
  await vi.waitFor(() => expect(synced.status()?.connection).toBe("synced"));
  expect(room.network.violations).toEqual([]);
});

test("a second participant downloads the project and both see each other's presence", async () => {
  const ownerRepo = new Repo({
    storage: new SharedMemoryStorage(),
    network: [],
  });
  const part = ownerRepo.create({ length: 1 });
  const manifest = ownerRepo.create(
    makeManifest([
      {
        name: "Part",
        kind: "part",
        docId: "doc_part",
        automergeDocumentId: part.documentId,
      },
    ]),
  );
  const room = makeRoom(manifest.documentId);
  const owner = makeClient(room, ownerRepo);
  await owner.start(manifest.documentId);
  await owner.host.handle({
    kind: "projectSyncPresence",
    link,
    state: { userId: "u1", name: "Ada", activeDocumentId: "doc_part" },
  });
  await vi.waitFor(() => expect(owner.status()?.connection).toBe("synced"), {
    timeout: 5_000,
  });

  const guest = makeClient(room);
  await guest.start(manifest.documentId);
  await guest.host.handle({
    kind: "projectSyncPresence",
    link,
    state: { userId: "u2", name: "Grace", activeDocumentId: null },
  });
  await vi.waitFor(() => expect(guest.status()?.connection).toBe("synced"), {
    timeout: 5_000,
  });
  expect(guest.repo.handles[part.documentId]?.doc()).toEqual({ length: 1 });

  await vi.waitFor(
    () => {
      expect(owner.status()?.peers.map((peer) => peer.name)).toEqual(["Grace"]);
      expect(guest.status()?.peers).toEqual([
        expect.objectContaining({
          userId: "u1",
          name: "Ada",
          activeDocumentId: "doc_part",
        }),
      ]);
    },
    { timeout: 5_000 },
  );
  await owner.host.handle({ kind: "projectSyncStop", link });
  await guest.host.handle({ kind: "projectSyncStop", link });
  expect(room.network.violations).toEqual([]);
});

test("a manifest entry naming another local project's document is never uploaded", async () => {
  const repo = new Repo({ storage: new SharedMemoryStorage(), network: [] });
  const part = repo.create({ length: 1 });
  const private_ = repo.create({ secret: true });
  const manifest = repo.create(
    makeManifest([
      {
        name: "Part",
        kind: "part",
        docId: "doc_part",
        automergeDocumentId: part.documentId,
      },
      {
        name: "Planted",
        kind: "part",
        docId: "doc_planted",
        automergeDocumentId: private_.documentId,
      },
    ]),
  );
  const room = makeRoom(manifest.documentId);
  const client = makeClient(room, repo);
  await client.start(manifest.documentId, [private_.documentId]);
  await vi.waitFor(() => expect(client.status()?.connection).toBe("synced"), {
    timeout: 5_000,
  });
  expect(room.repo.handles[part.documentId]?.isReady()).toBe(true);
  expect(room.repo.handles[private_.documentId]?.isReady() ?? false).toBe(
    false,
  );
});

test("a stop that arrives while a start awaits the Repo cancels the start", async () => {
  let provideRepo: (repo: Repo) => void = () => undefined;
  const posted: string[] = [];
  const host = createProjectSyncWorkerHost({
    getRepo: () => new Promise<Repo>((resolve) => (provideRepo = resolve)),
    postMessage: (message) => posted.push(message.kind),
    createBridge: null,
  });
  const starting = host.handle({
    kind: "projectSyncStart",
    link,
    manifestDocumentId: "4NMNnkMhL8jXrdJ9jamS2BPhvMf",
    roomUrl: "ws://api.test/sync/remote",
    bridgeChannel: "page",
    foreignDocumentIds: [],
  });
  await host.handle({ kind: "projectSyncStop", link });
  provideRepo(new Repo({ network: [] }));
  await starting;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(posted).toEqual([]);
});

test("a page that rejoins with a new bridge channel replaces the old bridge", async () => {
  const repo = new Repo({ network: [] });
  const channels: string[] = [];
  const host = createProjectSyncWorkerHost({
    getRepo: async () => repo,
    postMessage: () => undefined,
    roomAdapterOptions: {
      // A room that never answers: this test is about the bridge only.
      createSocket: () => ({
        binaryType: "",
        readyState: 0,
        send: () => undefined,
        close: () => undefined,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      }),
      watchNetwork: () => () => undefined,
    },
    createBridge: (name) => {
      channels.push(name);
      return new ProjectSyncBridge(name);
    },
  });
  const start = (projectId: string, bridgeChannel: string) =>
    host.handle({
      kind: "projectSyncStart",
      link: { orgId: "org", projectId },
      manifestDocumentId: repo.create(makeManifest([])).documentId,
      roomUrl: `ws://api.test/sync/${projectId}`,
      bridgeChannel,
      foreignDocumentIds: [],
    });
  try {
    await start("first", "page-a");
    await start("second", "page-a");
    await start("third", "page-b");
    expect(channels).toEqual(["page-a", "page-b"]);
  } finally {
    repo.networkSubsystem.disconnect();
  }
});
