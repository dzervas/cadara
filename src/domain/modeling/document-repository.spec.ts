import { describe, test, expect } from "vitest";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
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
import type { AppResultAsync } from "@/contracts/errors";
import type { BodyId, RevisionId } from "@/contracts/shared/ids";
import { getDefaultCadaraExportOptions } from "@/contracts/modeling/export.runtime-schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "./mock-kernel-adapter";
import {
  createModelingService,
  type ModelingService,
} from "./modeling-service";

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

// T17e (P-8; specification "Two-author editing": conflicting compensation
// blocks with a reason). Logic lane; seam: the document repositories'
// blocked Undo after a peer changed or deleted what the entry wrote (real
// Automerge merge, and the memory repository's peer receive). The reason
// names the entry and the sketch by label, once, never an address or id;
// the reason code is unchanged.
describe("T17e: a blocked document Undo names the entry and the sketch by label", () => {
  const sketchDocument = async () => {
    const seed = await createSeedAuthoredModelDocument();
    const plane = createStandardPlaneDefinition("xy");
    const sketch = {
      sketchId: "sketch_bracket" as const,
      label: "Bracket",
      plane,
      definition: createNewSketchSession(plane, OCC_KERNEL_SETTINGS).definition,
    };
    return {
      seed,
      published: {
        ...seed,
        sketches: [...seed.sketches, sketch],
        historyOrder: [
          ...seed.historyOrder,
          { kind: "sketch" as const, sketchId: sketch.sketchId },
        ],
      },
    };
  };
  const changedBy = (document: AuthoredModelDocument) => ({
    ...document,
    sketches: document.sketches.map((sketch) =>
      sketch.sketchId === "sketch_bracket"
        ? {
            ...sketch,
            definition: { ...sketch.definition, svgRenderingEnabled: true },
          }
        : sketch,
    ),
  });
  const deletedBy = (
    document: AuthoredModelDocument,
    seed: typeof document,
  ) => ({
    ...document,
    sketches: seed.sketches,
    historyOrder: seed.historyOrder,
  });
  const expectBlocked = (
    result: Awaited<ReturnType<DocumentRepository["undoDurableHistory"]>>,
    message: string,
  ) => {
    expect(result?.ok).toBe(false);
    if (!result || result.ok) throw new Error("not blocked");
    expect(result.status).toMatchObject({
      kind: "failed",
      diagnostic: { reasonCode: "expected-state-changed", message },
    });
    expectNoInternalIds([message]);
  };

  for (const [what, expected] of [
    [
      "deleted",
      "Can't undo Publish Sketch: ‘Bracket’ was deleted by another session.",
    ],
    [
      "changed",
      "Can't undo Publish Sketch: ‘Bracket’ was changed by another session.",
    ],
  ] as const) {
    test(`Automerge: a peer ${what} the published sketch`, async () => {
      const { seed, published } = await sketchDocument();
      const repoA = new RealAutomergeRepo(),
        urlsA = new MemoryDocumentRepositoryUrlStore();
      const a = persistent(repoA, urlsA);
      await a.load({ documentId: seed.documentId, seedDocument: seed });
      expect(
        (
          await a.mutate({
            documentId: seed.documentId,
            expected: seed,
            document: published,
            label: "Publish Sketch",
          })
        ).ok,
      ).toBe(true);
      const handleA = await repoA.find<CollaborativeDocument>(
        urlsA.get(seed.documentId)!,
      );
      const handleB = handleA.fork(),
        repoB = new RealAutomergeRepo(),
        urlsB = new MemoryDocumentRepositoryUrlStore();
      repoB.handles.set(handleB.url, handleB as never);
      urlsB.set(seed.documentId, handleB.url);
      const b = persistent(repoB, urlsB);
      const base = await b.load({
        documentId: seed.documentId,
        seedDocument: seed,
      });
      if (!base.ok) throw new Error(JSON.stringify(base.status));
      expect(
        (
          await b.mutate({
            documentId: seed.documentId,
            expected: base.document,
            document:
              what === "deleted"
                ? deletedBy(base.document, seed)
                : changedBy(base.document),
          })
        ).ok,
      ).toBe(true);
      handleA.merge(handleB);
      expectBlocked(await a.undoDurableHistory(seed.documentId), expected);
      expect(
        await a.getDurableHistoryAvailability(seed.documentId),
        "the entry is kept",
      ).toMatchObject({ canUndo: true });
    });
  }

  // T17b0 P-8's case: a re-publish edits the sketch's records (many deep
  // addresses, each reported twice by the owner); after a peer deletes the
  // sketch, the Undo names it once.
  test("Automerge: a peer deleted a re-published sketch; the edited records are named once, as the sketch", async () => {
    const { seed, published } = await sketchDocument();
    const republished = changedBy(published);
    republished.sketches = republished.sketches.map((sketch) =>
      sketch.sketchId === "sketch_bracket"
        ? {
            ...sketch,
            definition: {
              ...sketch.definition,
              constraintIds: [],
              constraints: [],
              dimensionIds: [],
              dimensions: [],
            },
          }
        : sketch,
    );
    const repoA = new RealAutomergeRepo(),
      urlsA = new MemoryDocumentRepositoryUrlStore();
    const a = persistent(repoA, urlsA);
    await a.load({ documentId: seed.documentId, seedDocument: seed });
    for (const [expected, document] of [
      [seed, published],
      [published, republished],
    ] as const)
      expect(
        (
          await a.mutate({
            documentId: seed.documentId,
            expected,
            document,
            label: "Publish Sketch",
          })
        ).ok,
      ).toBe(true);
    const handleA = await repoA.find<CollaborativeDocument>(
      urlsA.get(seed.documentId)!,
    );
    const handleB = handleA.fork();
    handleB.change((storage) => {
      const document = storage as unknown as {
        authored: { sketches: Record<string, unknown> };
      };
      delete document.authored.sketches["sketch_bracket"];
    });
    handleA.merge(handleB);
    expectBlocked(
      await a.undoDurableHistory(seed.documentId),
      "Can't undo Publish Sketch: ‘Bracket’ was deleted by another session.",
    );
  });

  // Review A-3 (probe P1): a sketch this session never wrote whole (it was
  // there before) has no label in this session's history: the fallback
  // names it generically, still without an id.
  test("Automerge: a peer deleted a sketch this session only edited; the fallback names no id", async () => {
    const { seed } = await sketchDocument();
    const existing = seed.sketches[0]!;
    const edited = {
      ...seed,
      sketches: seed.sketches.map((sketch) =>
        sketch.sketchId === existing.sketchId
          ? {
              ...sketch,
              definition: { ...sketch.definition, svgRenderingEnabled: true },
            }
          : sketch,
      ),
    };
    const repoA = new RealAutomergeRepo(),
      urlsA = new MemoryDocumentRepositoryUrlStore();
    const a = persistent(repoA, urlsA);
    await a.load({ documentId: seed.documentId, seedDocument: seed });
    expect(
      (
        await a.mutate({
          documentId: seed.documentId,
          expected: seed,
          document: edited,
          label: "Publish Sketch",
        })
      ).ok,
    ).toBe(true);
    const handleA = await repoA.find<CollaborativeDocument>(
      urlsA.get(seed.documentId)!,
    );
    const handleB = handleA.fork();
    handleB.change((storage) => {
      const document = storage as unknown as {
        authored: { sketches: Record<string, unknown> };
      };
      delete document.authored.sketches[existing.sketchId];
    });
    handleA.merge(handleB);
    const message =
      "Can't undo Publish Sketch: a sketch was deleted by another session.";
    expectBlocked(await a.undoDurableHistory(seed.documentId), message);
    expectNoInternalIds([message], [existing.sketchId]);
  });

  for (const [what, expected] of [
    [
      "deleted",
      "Can't undo Publish Sketch: ‘Bracket’ was deleted by another session.",
    ],
    [
      "changed",
      "Can't undo Publish Sketch: ‘Bracket’ was changed by another session.",
    ],
  ] as const) {
    test(`memory: a peer ${what} the published sketch`, async () => {
      const { seed, published } = await sketchDocument();
      const repository = createMemoryDocumentRepository();
      await repository.load({
        documentId: seed.documentId,
        seedDocument: seed,
      });
      const written = await repository.mutate({
        documentId: seed.documentId,
        expected: seed,
        document: published,
        label: "Publish Sketch",
      });
      if (!written.ok) throw new Error(JSON.stringify(written.status));
      const peer = await repository.receivePeerDocument(
        what === "deleted"
          ? deletedBy(written.document, seed)
          : changedBy(written.document),
        written.document,
      );
      expect(peer.ok).toBe(true);
      expectBlocked(
        await repository.undoDurableHistory(seed.documentId),
        expected,
      );
    });
  }
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

// T17k3 (K3). Logic lane; seam: two modeling services (mock kernel), each
// over its own Automerge repository on one shared document (forked handles).
// A state this session did not author (a concurrent peer write, an Undo or
// Redo) gets a revision id this session has not used before, so a result
// computed against the earlier revision is stale: the export check rejects
// it and the kernel refuses a mutation based on it.
describe("T17k3: a state this session did not author gets a new revision", () => {
  const unwrap = async <T>(result: AppResultAsync<T>) => {
    const resolved = await result;
    if (resolved.isErr()) throw new Error(resolved.error.message);
    return resolved.value;
  };
  type Persistence = "blocking" | "background";
  async function session(
    repo: RealAutomergeRepo,
    urls = new MemoryDocumentRepositoryUrlStore(),
    persistence: Persistence = "blocking",
  ) {
    const repository = persistent(repo, urls);
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository: repository,
      documentRepositoryPersistence: persistence,
    });
    await service.getCurrentDocumentSnapshot();
    return { service, repository, urls };
  }
  async function twoSessions(persistence: Persistence = "blocking") {
    const repoA = new RealAutomergeRepo();
    const a = await session(repoA, undefined, persistence);
    const handleA = await repoA.find<CollaborativeDocument>(
      a.urls.get("doc_workspace")!,
    );
    const handleB = handleA.fork(),
      repoB = new RealAutomergeRepo(),
      urlsB = new MemoryDocumentRepositoryUrlStore();
    repoB.handles.set(handleB.url, handleB as never);
    urlsB.set("doc_workspace", handleB.url);
    const b = await session(repoB, urlsB, persistence);
    return {
      a: a.service,
      b: b.service,
      repositoryA: a.repository,
      handleA,
      handleB,
    };
  }
  const snapshotOf = (service: ModelingService) =>
    service.getCurrentDocumentSnapshot();
  const revisionOf = async (service: ModelingService) =>
    (await snapshotOf(service)).document.revisionId;
  const exportAt = (service: ModelingService, baseRevisionId: RevisionId) =>
    service.exportDocument({
      baseRevisionId,
      target: { kind: "body", bodyId: "body_part-1" as BodyId },
      targetLabel: "Part 1",
      format: "cadara",
      options: getDefaultCadaraExportOptions(),
    });
  const renameAt = (
    service: ModelingService,
    baseRevisionId: RevisionId,
    bodyLabel: string,
  ) =>
    service.renameBody({
      baseRevisionId,
      bodyId: "body_part-1" as BodyId,
      bodyLabel,
    });
  async function expectStale(service: ModelingService, stale: RevisionId) {
    const current = await revisionOf(service);
    expect
      .soft(current, "the new state has a revision this session never had")
      .not.toBe(stale);
    const exported = await exportAt(service, stale);
    expect
      .soft(exported.ok, "an export requested at the earlier revision is stale")
      .toBe(false);
    expect
      .soft(exported.diagnostics.map((d) => d.code))
      .toEqual(["export-revision-conflict"]);
    const renamed = await (await renameAt(service, stale, "Stale"))
      .map((result) => result.revisionState.kind)
      .unwrapOr("error");
    expect
      .soft(renamed, "a mutation based on the earlier revision is refused")
      .not.toBe("accepted");
    expect(
      (await snapshotOf(service)).document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
    ).not.toBe("Stale");
  }

  test("two concurrent writers: the merged state is a new revision in each session", async () => {
    const { a, b, handleA, handleB } = await twoSessions();
    await unwrap(renameAt(a, await revisionOf(a), "A body"));
    await unwrap(
      b.addDocumentVariable({
        baseRevisionId: await revisionOf(b),
        name: "Width",
        valueText: "10",
      }),
    );
    const writtenA = await revisionOf(a),
      writtenB = await revisionOf(b);
    handleB.merge(handleA);
    handleA.merge(handleB);
    const mergedB = await snapshotOf(b),
      mergedA = await snapshotOf(a);
    // Both sessions now hold both writes.
    for (const merged of [mergedA, mergedB]) {
      expect(
        merged.document.bodies.find((body) => body.bodyId === "body_part-1")
          ?.label,
      ).toBe("A body");
      expect(merged.document.variables.map((v) => v.name)).toContain("Width");
    }
    await expectStale(b, writtenB);
    await expectStale(a, writtenA);
  });

  test("Undo and Redo, own and a peer's: each resulting state is a new revision", async () => {
    const { a, b, repositoryA, handleA, handleB } = await twoSessions();
    const label = async (service: ModelingService) =>
      (await snapshotOf(service)).document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label;
    const seedLabel = await label(a);
    await unwrap(renameAt(a, await revisionOf(a), "A body"));
    handleB.merge(handleA);
    expect(await label(b)).toBe("A body");
    for (const [direction, expected] of [
      ["undo", seedLabel],
      ["redo", "A body"],
    ] as const) {
      const beforeA = await revisionOf(a),
        beforeB = await revisionOf(b);
      const result =
        direction === "undo"
          ? await repositoryA.undoDurableHistory("doc_workspace")
          : await repositoryA.redoDurableHistory("doc_workspace");
      expect(result?.ok, direction).toBe(true);
      handleB.merge(handleA);
      expect(await label(a)).toBe(expected);
      expect(await label(b)).toBe(expected);
      await expectStale(a, beforeA);
      await expectStale(b, beforeB);
      // expectStale's refused rename must not have changed anything.
      expect(await label(a)).toBe(expected);
    }
  });

  // T17k3 review A-1: a peer change that reaches A after A's kernel accepted
  // an edit but before A's repository write lands. A's restore waits for the
  // write and restores the merged state: A keeps its own edit (kernel and
  // file export) and gets the peer's. Base: A restored the event's older
  // state and lost "A body" while the shared document kept it.
  for (const persistence of ["blocking", "background"] as const)
    test(`a peer change during A's repository write keeps A's edit (${persistence})`, async () => {
      const { a, b, repositoryA, handleA, handleB } =
        await twoSessions(persistence);
      await unwrap(
        b.addDocumentVariable({
          baseRevisionId: await revisionOf(b),
          name: "Width",
          valueText: "10",
        }),
      );
      const write = repositoryA.mutate.bind(repositoryA);
      let peerArrived = false;
      repositoryA.mutate = async (input) => {
        if (!peerArrived) {
          peerArrived = true;
          handleA.merge(handleB);
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return write(input);
      };
      const renamed = await unwrap(renameAt(a, await revisionOf(a), "A body"));
      expect(renamed.revisionState.kind).toBe("accepted");
      await a.waitForPersistence();
      expect(peerArrived, "premise: the peer change arrived mid-write").toBe(
        true,
      );
      const stateA = await snapshotOf(a);
      expect(
        stateA.document.bodies.find((body) => body.bodyId === "body_part-1")
          ?.label,
        "A keeps its own edit",
      ).toBe("A body");
      expect(stateA.document.variables.map((v) => v.name)).toContain("Width");
      expect(
        JSON.stringify(await a.exportCurrentDocument()),
        "A's file export keeps it",
      ).toContain("A body");
      expect(
        stateA.document.revisionId,
        "the merged state is not the edit's own revision",
      ).not.toBe(renamed.revisionId);
      handleB.merge(handleA);
      const stateB = await snapshotOf(b);
      expect(
        stateB.document.bodies.find((body) => body.bodyId === "body_part-1")
          ?.label,
      ).toBe("A body");
    });

  // T17k3 re-review RR-1 (probe P6). A's first mutation is in its repository
  // write when a peer change arrives, so the peer restore waits for it; a
  // second mutation started then (based on the kernel's current revision)
  // runs after that restore. It is refused as stale or kept, never accepted
  // and then dropped. Mutant Ma (`runLocalMutation` without
  // `await changesBefore`): accepted, then lost to the restore.
  for (const persistence of ["blocking", "background"] as const)
    test(`a mutation started while a peer restore waits is never accepted and then lost (${persistence})`, async () => {
      const repoA = new RealAutomergeRepo();
      const urlsA = new MemoryDocumentRepositoryUrlStore();
      const repositoryA = persistent(repoA, urlsA);
      const kernelA = new MockKernelAdapter();
      const a = createModelingService(kernelA, {
        currentDocumentId: "doc_workspace",
        documentRepository: repositoryA,
        documentRepositoryPersistence: persistence,
      });
      await a.getCurrentDocumentSnapshot();
      const handleA = await repoA.find<CollaborativeDocument>(
        urlsA.get("doc_workspace")!,
      );
      const handleB = handleA.fork(),
        repoB = new RealAutomergeRepo(),
        urlsB = new MemoryDocumentRepositoryUrlStore();
      repoB.handles.set(handleB.url, handleB as never);
      urlsB.set("doc_workspace", handleB.url);
      const b = (await session(repoB, urlsB, persistence)).service;
      await unwrap(
        b.addDocumentVariable({
          baseRevisionId: await revisionOf(b),
          name: "Width",
          valueText: "10",
        }),
      );
      const write = repositoryA.mutate.bind(repositoryA);
      let writes = 0;
      let releaseFirst!: () => void;
      const firstHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let peerQueued!: () => void;
      const peerArrived = new Promise<void>((resolve) => {
        peerQueued = resolve;
      });
      repositoryA.mutate = async (input) => {
        if (writes++ === 0) {
          handleA.merge(handleB);
          await new Promise((resolve) => setTimeout(resolve, 20));
          peerQueued();
          await firstHeld;
        }
        return write(input);
      };
      // The kernel's own revision: the service's reads wait for the restore.
      const kernelRevision = async () =>
        (
          await kernelA.getDocumentSnapshot({
            contractVersion: CONTRACT_VERSION,
            documentId: "doc_workspace",
          })
        ).snapshot.document.revisionId;
      const first = unwrap(renameAt(a, await revisionOf(a), "A body"));
      await peerArrived;
      const second = a.addDocumentVariable({
        baseRevisionId: await kernelRevision(),
        name: "Depth",
        valueText: "5",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      releaseFirst();
      expect((await first).revisionState.kind).toBe("accepted");
      const secondResult = await second;
      const secondAccepted =
        secondResult.isOk() &&
        secondResult.value.revisionState.kind === "accepted";
      await a.waitForPersistence();
      const state = await snapshotOf(a);
      expect(
        state.document.bodies.find((body) => body.bodyId === "body_part-1")
          ?.label,
        "the first edit is kept",
      ).toBe("A body");
      const variables = state.document.variables.map((v) => v.name);
      expect(variables, "the peer's change arrived").toContain("Width");
      expect(
        variables.includes("Depth"),
        `an accepted second edit is kept (accepted: ${secondAccepted})`,
      ).toBe(secondAccepted);
    });

  // T17k3 review R-1: a peer write (same counter value) lands while A's
  // Publish Sketch is in the repository. Every state A's kernel holds has
  // its own revision id: the merged document A restores after its write is
  // not the published candidate, so it is renumbered. Base and before R-1:
  // the merged state reused the candidate's id.
  test("a peer write during Publish Sketch: no revision names two states in A", async () => {
    const repository = createMemoryDocumentRepository();
    const adapter = new MockKernelAdapter();
    const held = new Map<string, string>();
    const collisions: string[] = [];
    const record = async (why: string) => {
      const { revisionId, ...rest } =
        await adapter.exportAuthoredModelDocument("doc_workspace");
      const content = JSON.stringify(rest);
      if ((held.get(revisionId) ?? content) !== content)
        collisions.push(`${why}: ${revisionId}`);
      held.set(revisionId, content);
    };
    for (const method of [
      "commitSketch",
      "restoreAuthoredModelDocument",
      "renameBody",
    ] as const) {
      const original = adapter[method].bind(adapter) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      (adapter as unknown as Record<string, unknown>)[method] = async (
        ...args: unknown[]
      ) => {
        const result = await original(...args);
        await record(method);
        return result;
      };
    }
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
      documentRepository: repository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    await record("initial");
    const original = createAuthoredModelDocumentFromSnapshot(snapshot);
    const sketch = original.sketches[0]!;
    const definition = structuredClone(sketch.definition);
    definition.points[0] = { ...definition.points[0]!, position: [41, 17] };
    const write = repository.mutate.bind(repository);
    let peerArrived = false;
    repository.mutate = async (input) => {
      if (!peerArrived) {
        peerArrived = true;
        const peer = structuredClone(original);
        peer.revisionId = input.document.revisionId;
        peer.bodyLabels[0] = { ...peer.bodyLabels[0]!, label: "Peer label" };
        expect((await repository.receivePeerDocument(peer, original)).ok).toBe(
          true,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return write(input);
    };
    const published = await unwrap(
      service.commitSketch({
        baseRevisionId: snapshot.document.revisionId,
        sketchId: sketch.sketchId,
        sketchLabel: sketch.label,
        plane: sketch.plane,
        definition,
        solverCorrelation: {
          requestId: "request_t17k3_publish",
          projectionRequestId: "request_t17k3_publish:project",
          validationRequestId: "request_t17k3_publish:validate",
          solveRequestId: "request_t17k3_publish:solve",
          regionRequestId: "request_t17k3_publish:regions",
        },
        publicationBase: {
          actionContextId: sketch.sketchId,
          expectedSketch: sketch,
        },
      }),
    );
    expect(published.revisionState.kind).toBe("accepted");
    expect(peerArrived).toBe(true);
    const after = await service.getCurrentDocumentSnapshot();
    expect(published.revisionId, "the result names the kernel's state").toBe(
      after.document.revisionId,
    );
    expect(after.document.bodies[0]?.label).toBe("Peer label");
    await unwrap(
      service.renameBody({
        baseRevisionId: after.document.revisionId,
        bodyId: "body_part-1" as BodyId,
        bodyLabel: "A next",
      }),
    );
    expect(collisions).toEqual([]);
  });
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
