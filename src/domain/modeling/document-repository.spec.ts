import { test, expect } from "vitest";
import { createSeedAuthoredModelDocument } from "./modeling-test-fixtures";
import { createMemoryDocumentRepository } from "./memory-document-repository";
import {
  IndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
} from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { createMemoryGeometryAssetStore } from "./geometry-asset-store";
import { createDeterministicGeometryAsset } from "./geometry-asset-test-helpers";
import {
  materializeCollaborativeDocument,
  createCollaborativeDocument,
  type CollaborativeDocument,
} from "./collaborative-document";
import type { DocumentRepository } from "./document-repository";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "./opencascade-kernel-seed";

function persistent(
  repo = new RealAutomergeRepo(),
  urlStore = new MemoryDocumentRepositoryUrlStore(),
) {
  return new IndexedDbAutomergeDocumentRepository({
    repo,
    urlStore,
    assetStore: createMemoryGeometryAssetStore(),
  });
}
for (const [name, make] of [
  ["memory", () => createMemoryDocumentRepository()],
  ["Automerge", () => persistent()],
] as const) {
  test(`${name}: conditional writes, compensation, fresh initialization and actor identity`, async () => {
    const seed = await createSeedAuthoredModelDocument();
    const repository: DocumentRepository = make();
    const loaded = await repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("load failed");
    expect(loaded.metadata.actorId).not.toBe("");
    expect(
      (
        await repository.initialize({
          documentId: "doc_wrong_context",
          document: seed,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await repository.load({
          documentId: "doc_wrong_context",
          seedDocument: seed,
        })
      ).ok,
    ).toBe(false);
    const candidate = { ...seed, name: "Local name" };
    const first = await repository.mutate({
      documentId: seed.documentId,
      expected: seed,
      document: candidate,
    });
    expect(first.ok).toBe(true);
    const conflict = await repository.mutate({
      documentId: seed.documentId,
      expected: seed,
      document: { ...seed, name: "Stale name", bodyLabels: [] },
    });
    expect(conflict.ok).toBe(false);
    const current = await repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect(current.ok && current.document.bodyLabels).toEqual(seed.bodyLabels);
    const undone = await repository.undoDurableHistory(seed.documentId);
    expect(undone?.ok && undone.document.name).toBe(seed.name);
    const redone = await repository.redoDurableHistory(seed.documentId);
    expect(redone?.ok && redone.document.name).toBe("Local name");
    await repository.initialize({
      documentId: seed.documentId,
      document: candidate,
    });
    expect(
      await repository.getDurableHistoryAvailability(seed.documentId),
    ).toMatchObject({ canUndo: false, canRedo: false });
  });
  test(`${name}: deletion compensation carries non-history sketch provenance`, async () => {
    const seed = await createSeedAuthoredModelDocument(),
      repository = make();
    const plane = createStandardPlaneDefinition("xy");
    const sketch = {
      sketchId: "sketch_provenance",
      label: "Retained provenance",
      plane,
      definition: createNewSketchSession(plane, OCC_KERNEL_SETTINGS).definition,
    };
    const document = {
      ...seed,
      sketches: [...seed.sketches, sketch],
      historyOrder: [
        ...seed.historyOrder,
        { kind: "sketch" as const, sketchId: sketch.sketchId },
      ],
    };
    const initialized = await repository.initialize({
      documentId: seed.documentId,
      document,
    });
    expect(initialized, JSON.stringify(initialized)).toMatchObject({
      ok: true,
    });
    expect(
      (
        await repository.mutate({
          documentId: seed.documentId,
          expected: document,
          document: seed,
        })
      ).ok,
    ).toBe(true);
    const undo = await repository.undoDurableHistory(seed.documentId);
    expect(
      undo?.ok &&
        undo.document.sketches.find((s) => s.sketchId === sketch.sketchId),
      "Undoing the deletion restores the sketch with its authored fields.",
    ).toEqual(sketch);
  });
  test(`${name}: asset errors do not create document actions`, async () => {
    const seed = await createSeedAuthoredModelDocument(),
      repository = make();
    await repository.load({ documentId: seed.documentId, seedDocument: seed });
    const asset = await createDeterministicGeometryAsset({
      ownerFeatureIds: [seed.features[0]!.featureId],
    });
    const invalid = await repository.mutate({
      documentId: seed.documentId,
      expected: seed,
      document: { ...seed, name: "Not saved" },
      assets: [asset],
    });
    expect(invalid.ok).toBe(false);
    expect(
      await repository.getDurableHistoryAvailability(seed.documentId),
    ).toMatchObject({ canUndo: false, canRedo: false });
    const document = {
      ...seed,
      assets: { ...seed.assets, records: [asset.asset] },
    };
    const saved = await repository.mutate({
      documentId: seed.documentId,
      expected: seed,
      document,
      assets: [asset],
    });
    expect(saved.ok).toBe(true);
    expect(await repository.getGeometryAssetRecord(asset.asset)).toEqual(
      asset.bytes,
    );
  });
}

test("real Automerge peer merge preserves unrelated fields and history, blocks atomic compensation conflicts", async () => {
  const seed = await createSeedAuthoredModelDocument(),
    repoA = new RealAutomergeRepo(),
    urlsA = new MemoryDocumentRepositoryUrlStore();
  const a = persistent(repoA, urlsA);
  await a.load({ documentId: seed.documentId, seedDocument: seed });
  const handleA = await repoA.find<CollaborativeDocument>(
    urlsA.get(seed.documentId)!,
  );
  const handleB = handleA.fork(),
    repoB = new RealAutomergeRepo(),
    urlsB = new MemoryDocumentRepositoryUrlStore();
  repoB.handles.set(handleB.url, handleB as never);
  urlsB.set(seed.documentId, handleB.url);
  const b = persistent(repoB, urlsB);
  await b.load({ documentId: seed.documentId, seedDocument: seed });
  expect(a.getMetadata(seed.documentId).actorId).not.toBe(
    b.getMetadata(seed.documentId).actorId,
  );
  const local = {
    ...seed,
    name: "A",
    bodyLabels: seed.bodyLabels.map((r) => ({ ...r, label: "A body" })),
  };
  expect(
    (
      await a.mutate({
        documentId: seed.documentId,
        expected: seed,
        document: local,
      })
    ).ok,
  ).toBe(true);
  const peer = {
    ...seed,
    settings: {
      ...seed.settings,
      modelingTolerance: seed.settings.modelingTolerance * 2,
    },
  };
  expect(
    (
      await b.mutate({
        documentId: seed.documentId,
        expected: seed,
        document: peer,
      })
    ).ok,
  ).toBe(true);
  handleA.merge(handleB);
  const undo = await a.undoDurableHistory(seed.documentId);
  expect(undo?.ok && undo.document.name).toBe(seed.name);
  expect(undo?.ok && undo.document.settings.modelingTolerance).toBe(
    peer.settings.modelingTolerance,
  );
  expect((await a.redoDurableHistory(seed.documentId))?.ok).toBe(true);
  handleB.merge(handleA);
  const base = await b.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  if (!base.ok) throw new Error(JSON.stringify(base.status));
  await b.mutate({
    documentId: seed.documentId,
    expected: base.document,
    document: { ...base.document, name: "B conflict" },
  });
  handleA.merge(handleB);
  const blocked = await a.undoDurableHistory(seed.documentId);
  expect(blocked?.ok).toBe(false);
  expect(await a.getDurableHistoryAvailability(seed.documentId)).toMatchObject({
    canUndo: true,
    canRedo: false,
  });
  const after = await a.load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(after.ok && after.document.name).toBe("B conflict");
  expect(after.ok && after.document.bodyLabels).toEqual(local.bodyLabels);
});

test("Automerge peer changes during a pending local flush are not hidden from subscribers", async () => {
  const seed = await createSeedAuthoredModelDocument(),
    repo = new RealAutomergeRepo(),
    urls = new MemoryDocumentRepositoryUrlStore(),
    repository = persistent(repo, urls);
  await repository.load({ documentId: seed.documentId, seedDocument: seed });
  const handle = await repo.find<CollaborativeDocument>(
    urls.get(seed.documentId)!,
  );
  const peer = handle.fork();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  repo.flush = async () => {
    started();
    await gate;
  };
  const observed: string[] = [];
  repository.subscribe(seed.documentId, (event) => {
    if (event.metadata.source === "peer") observed.push(event.document.name);
  });
  const write = repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: {
      ...seed,
      bodyLabels: seed.bodyLabels.map((record) => ({
        ...record,
        label: "Local body",
      })),
    },
  });
  await pending;
  peer.change((storage) => {
    storage.authored.name = "Peer during flush";
  });
  handle.merge(peer);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(observed).toContain("Peer during flush");
  release();
  const result = await write;
  expect(result.ok && result.document.name).toBe("Peer during flush");
  expect(
    (await repository.getDurableHistoryAvailability(seed.documentId)).canUndo,
  ).toBe(true);
});

test("Automerge flush failure returns the merged live document as transaction-specific evidence", async () => {
  const seed = await createSeedAuthoredModelDocument(),
    repo = new RealAutomergeRepo(),
    urls = new MemoryDocumentRepositoryUrlStore(),
    repository = persistent(repo, urls);
  await repository.load({ documentId: seed.documentId, seedDocument: seed });
  const handle = await repo.find<CollaborativeDocument>(
    urls.get(seed.documentId)!,
  );
  const peer = handle.fork();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  repo.flush = async () => {
    started();
    await gate;
    throw new Error("Injected persistence failure");
  };
  const write = repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Local publication" },
    label: "Publish Sketch",
  });
  await pending;
  const peerTolerance = seed.settings.modelingTolerance * 2;
  peer.change((storage) => {
    storage.authored.settings.modelingTolerance = peerTolerance;
  });
  handle.merge(peer);
  release();
  const result = await write;
  expect(result.ok).toBe(false);
  expect(!result.ok && result.appliedLive?.document).toMatchObject({
    name: "Local publication",
    settings: { modelingTolerance: peerTolerance },
  });
  expect(!result.ok && result.appliedLive?.metadata.heads).toEqual(
    handle.heads(),
  );
});

for (const direction of ["commit", "undo", "redo"] as const) {
  test(`Automerge ${direction} flush failure retains the applied ledger, fails closed and explicitly retries durability`, async () => {
    const seed = await createSeedAuthoredModelDocument(),
      repo = new RealAutomergeRepo(),
      urls = new MemoryDocumentRepositoryUrlStore(),
      repository = persistent(repo, urls);
    await repository.load({ documentId: seed.documentId, seedDocument: seed });
    const local = { ...seed, name: "Applied local action" };
    if (direction !== "commit")
      await repository.mutate({
        documentId: seed.documentId,
        expected: seed,
        document: local,
      });
    if (direction === "redo")
      await repository.undoDurableHistory(seed.documentId);
    const handle = await repo.find<CollaborativeDocument>(
      urls.get(seed.documentId)!,
    );
    repo.failFlush = true;
    const result =
      direction === "commit"
        ? await repository.mutate({
            documentId: seed.documentId,
            expected: seed,
            document: local,
          })
        : direction === "undo"
          ? await repository.undoDurableHistory(seed.documentId)
          : await repository.redoDurableHistory(seed.documentId);
    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.appliedLive?.document.name).toBe(
      direction === "undo" ? seed.name : local.name,
    );
    expect(repository.getRestoreStatus(seed.documentId)).toMatchObject({
      kind: "failed",
      diagnostic: { reasonCode: "automerge-durability-failed" },
    });
    const current = materializeCollaborativeDocument(handle.doc());
    expect(current.name).toBe(direction === "undo" ? seed.name : local.name);
    expect(
      await repository.getDurableHistoryAvailability(seed.documentId),
    ).toMatchObject({
      canUndo: direction !== "undo",
      canRedo: direction === "undo",
    });
    const heads = handle.heads();
    const rejectedWhilePending = await repository.mutate({
      documentId: seed.documentId,
      expected: current,
      document: { ...current, name: "Must fail closed" },
    });
    expect(rejectedWhilePending.ok).toBe(false);
    expect(
      !rejectedWhilePending.ok && rejectedWhilePending.appliedLive,
      "A prior pending write must not be evidence that this rejected mutation applied.",
    ).toBeUndefined();
    expect(handle.heads()).toEqual(heads);
    expect(
      (
        await repository.load({
          documentId: seed.documentId,
          seedDocument: seed,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await repository.initialize({
          documentId: seed.documentId,
          document: seed,
        })
      ).ok,
    ).toBe(false);
    expect((await repository.reset(seed.documentId)).kind).toBe("failed");
    const peer = handle.fork();
    peer.change((storage) => {
      (
        storage.authored.settings as { modelingTolerance: number }
      ).modelingTolerance = seed.settings.modelingTolerance * 2;
    });
    handle.merge(peer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.getRestoreStatus(seed.documentId)).toMatchObject({
      kind: "failed",
      diagnostic: { reasonCode: "automerge-durability-failed" },
    });
    repo.failFlush = false;
    const retried = await repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect(retried.ok && retried.document.name).toBe(current.name);
    expect(repository.getRestoreStatus(seed.documentId).kind).toBe("restored");
    const compensated =
      direction === "undo"
        ? await repository.redoDurableHistory(seed.documentId)
        : await repository.undoDurableHistory(seed.documentId);
    expect(compensated?.ok && compensated.document.name).toBe(
      direction === "undo" ? local.name : seed.name,
    );
    expect(
      compensated?.ok && compensated.document.settings.modelingTolerance,
    ).toBe(seed.settings.modelingTolerance * 2);
    const reopened = persistent(repo, urls);
    expect(
      (await reopened.load({ documentId: seed.documentId, seedDocument: seed }))
        .ok,
    ).toBe(true);
    expect(
      await reopened.getDurableHistoryAvailability(seed.documentId),
    ).toMatchObject({ canUndo: false, canRedo: false });
  });
}

for (const replacement of ["peer", "initialize", "reset"] as const) {
  test(`delayed peer publication cannot overtake ${replacement} or pair old data with new heads`, async () => {
    const seed = await createSeedAuthoredModelDocument();
    const asset = await createDeterministicGeometryAsset({
      ownerFeatureIds: [seed.features[0]!.featureId],
    });
    seed.assets.records = [asset.asset];
    const inner = createMemoryGeometryAssetStore();
    let delay = false,
      release!: () => void,
      started!: () => void,
      lookupCompleted!: () => void,
      newerPublished!: () => void;
    const completed = new Promise<void>((resolve) => {
      lookupCompleted = resolve;
    });
    const newer = new Promise<void>((resolve) => {
      newerPublished = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const repo = new RealAutomergeRepo(),
      urls = new MemoryDocumentRepositoryUrlStore();
    const repository = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore: urls,
      assetStore: {
        put: (input) => inner.put(input),
        get: (input) => inner.get(input),
        async has(input) {
          const delayed = delay;
          if (delayed) {
            delay = false;
            started();
            await gate;
          }
          const result = await inner.has(input);
          if (delayed) lookupCompleted();
          return result;
        },
      },
    });
    await repository.load({ documentId: seed.documentId, seedDocument: seed });
    const handle = await repo.find<CollaborativeDocument>(
      urls.get(seed.documentId)!,
    );
    const peer = handle.fork();
    const observed: Array<{ name: string; heads: readonly string[] }> = [];
    repository.subscribe(seed.documentId, (event) => {
      observed.push({ name: event.document.name, heads: event.metadata.heads });
      if (event.document.name === "PEER-NEW") newerPublished();
    });
    observed.length = 0;
    delay = true;
    peer.change((storage) => {
      storage.authored.name = "PEER-OLD";
    });
    handle.merge(peer);
    await pending;
    if (replacement === "peer") {
      peer.change((storage) => {
        storage.authored.name = "PEER-NEW";
      });
      handle.merge(peer);
      await newer;
      expect(observed).toEqual([{ name: "PEER-NEW", heads: handle.heads() }]);
    } else if (replacement === "initialize") {
      expect(
        (
          await repository.initialize({
            documentId: seed.documentId,
            document: { ...seed, name: "FRESH" },
          })
        ).ok,
      ).toBe(true);
      expect(observed.map((event) => event.name)).toEqual(["FRESH"]);
    } else {
      expect((await repository.reset(seed.documentId)).kind).toBe("reset");
      expect(observed).toEqual([]);
    }
    const beforeRelease = structuredClone(observed);
    const metadata = repository.getMetadata(seed.documentId);
    release();
    await completed;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observed).toEqual(beforeRelease);
    expect(repository.getMetadata(seed.documentId)).toEqual(metadata);
    if (replacement === "reset")
      expect(repository.getRestoreStatus(seed.documentId).kind).toBe("reset");
    else {
      let replay: { name: string; heads: readonly string[] } | undefined;
      const unsubscribe = repository.subscribe(seed.documentId, (event) => {
        replay = { name: event.document.name, heads: event.metadata.heads };
      });
      expect(replay).toEqual(observed.at(-1));
      unsubscribe();
    }
  });
}

test("replaced document and snapshot history storage is explicitly rejected", async () => {
  const seed = await createSeedAuthoredModelDocument(),
    repo = new RealAutomergeRepo(),
    urls = new MemoryDocumentRepositoryUrlStore();
  const old = repo.create({ authoredDocument: seed });
  urls.set(seed.documentId, old.url);
  const loaded = await persistent(repo, urls).load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(loaded.ok).toBe(false);
  expect(!loaded.ok && loaded.status.diagnostic.message).toContain(
    "Unsupported collaborative document",
  );
  const oldStable = repo.create({
    ...createCollaborativeDocument(seed),
    format: "cadara-stable-authored-v1",
  });
  urls.set(seed.documentId, oldStable.url);
  const replaced = await persistent(repo, urls).load({
    documentId: seed.documentId,
    seedDocument: seed,
  });
  expect(replaced.ok).toBe(false);
  expect(!replaced.ok && replaced.status.diagnostic.message).toContain(
    "Unsupported collaborative document",
  );
});

import * as Automerge from "@automerge/automerge";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type {
  AutomergeRepositoryLike,
  AutomergeHandleLike,
} from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";

export class RealAutomergeHandle<T> implements AutomergeHandleLike<T> {
  readonly documentId = crypto.randomUUID();
  readonly url = `automerge:${this.documentId}` as AutomergeUrl;
  private listeners = new Set<() => void>();
  private value: Automerge.Doc<T>;
  constructor(value: Automerge.Doc<T>) {
    this.value = value;
  }
  async whenReady() {}
  doc() {
    return this.value;
  }
  heads() {
    return Automerge.getHeads(this.value);
  }
  change(callback: (document: T) => void) {
    this.value = Automerge.change(this.value, callback);
    this.emit();
  }
  on(_event: "change", callback: () => void) {
    this.listeners.add(callback);
  }
  fork() {
    return new RealAutomergeHandle(Automerge.clone(this.value));
  }
  merge(peer: RealAutomergeHandle<T>) {
    this.value = Automerge.merge(this.value, peer.value);
    this.emit();
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
}
export class RealAutomergeRepo implements AutomergeRepositoryLike {
  handles = new Map<string, RealAutomergeHandle<unknown>>();
  failFlush = false;
  create<T>(initialValue?: T) {
    const handle = new RealAutomergeHandle(
      Automerge.from(
        initialValue as Record<string, unknown>,
      ) as Automerge.Doc<T>,
    );
    this.handles.set(handle.url, handle as RealAutomergeHandle<unknown>);
    return handle;
  }
  async find<T>(url: AutomergeUrl) {
    const handle = this.handles.get(url);
    if (!handle) throw new Error("Document handle missing");
    return handle as RealAutomergeHandle<T>;
  }
  delete(url: AutomergeUrl) {
    this.handles.delete(url);
  }
  async flush() {
    if (this.failFlush) throw new Error("Injected persistence failure");
  }
}
