import { test, expect } from "vitest";

import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import { createSeedAuthoredModelDocument } from "@/domain/modeling/modeling-test-fixtures";
import type { DocumentRepositoryChangeSource } from "@/domain/modeling/document-repository";
import type {
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
} from "@/domain/modeling/document-sync-worker-protocol";
import { createDeterministicGeometryAsset } from "@/domain/modeling/geometry-asset-test-helpers";
import { createWorkerBackedDocumentRepository } from "@/infrastructure/modeling/worker-backed-document-repository";
import type { DocumentRepositoryUrlStore } from "@/infrastructure/persistence/document-repository-url-store";
import {
  DocumentSyncWorkerClient,
  type DocumentSyncWorkerLike,
} from "@/infrastructure/workers/document-sync-worker-client";

test("src/infrastructure/modeling/worker-backed-document-repository.spec.ts", async () => {
  async function testLoadMutatePeerUpdateAndDiagnostics() {
    const seed = await createSeedAuthoredModelDocument();
    const worker = new FakeDocumentSyncWorker();
    const client = new DocumentSyncWorkerClient({ worker });
    const urlStore = createMemoryUrlStore();
    urlStore.set(
      seed.documentId,
      "automerge:stored-url" as Parameters<
        DocumentRepositoryUrlStore["set"]
      >[1],
    );
    const repository = createWorkerBackedDocumentRepository({
      client,
      urlStore,
    });

    const load = repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    const loadRequest = worker.takePosted("load");
    expect(
      loadRequest.storageKey,
      "Worker-backed loads should pass the stored Automerge URL to the worker.",
    ).toBe("automerge:stored-url");
    const repositoryDiagnostics: ModelingDiagnostic[] = [
      {
        code: "geometry-asset-missing",
        severity: "error",
        message: "Referenced geometry asset bytes are missing.",
        target: null,
        detail: null,
      },
    ];
    worker.emit({
      kind: "loaded",
      requestId: loadRequest.requestId,
      result: {
        ok: true,
        document: seed,
        diagnostics: repositoryDiagnostics,
        status: { kind: "restored", documentId: seed.documentId },
        metadata: {
          documentId: seed.documentId,
          heads: ["head_load"],
          source: "restore",
          storageKey: "automerge:worker-url",
        },
      },
    });
    await flushAsync();
    const loadNormalizeRequest = worker.takePosted("normalize");
    const loadDiagnostics: ModelingDiagnostic[] = [
      {
        code: "normalized-order",
        severity: "warning",
        message: "Normalized collaborative document order.",
        target: null,
        detail: null,
      },
    ];
    worker.emit({
      kind: "normalized",
      requestId: loadNormalizeRequest.requestId,
      result: {
        document: {
          ...seed,
          bodyLabels: seed.bodyLabels.map((label) => ({
            ...label,
            label: "Worker Loaded Body",
          })),
        },
        diagnostics: loadDiagnostics,
        metadata: {
          documentId: seed.documentId,
          heads: ["head_load"],
          source: "restore",
          storageKey: "automerge:worker-url",
        },
      },
    });
    const loaded = await load;
    expect(
      loaded.ok,
      "Worker-backed repository load should resolve with worker-normalized documents.",
    ).toBeTruthy();
    expect(
      loaded.ok &&
        loaded.diagnostics?.map((diagnostic) => diagnostic.code).join(",") ===
          "geometry-asset-missing,normalized-order",
      "Worker-backed loads should preserve repository diagnostics and worker normalization diagnostics.",
    ).toBeTruthy();
    expect(
      urlStore.get(seed.documentId),
      "A restore result must not overwrite the shared URL store (cadara-l99p).",
    ).toBe("automerge:stored-url");

    const mutation = repository.mutate({
      expected: seed,
      documentId: seed.documentId,
      document: seed,
    });
    const mutateRequest = worker.takePosted("mutate");
    worker.emit({
      kind: "mutated",
      requestId: mutateRequest.requestId,
      result: {
        ok: true,
        document: seed,
        status: { kind: "restored", documentId: seed.documentId },
        metadata: {
          documentId: seed.documentId,
          heads: ["head_mutate"],
          source: "local",
        },
      },
    });
    await flushAsync();
    const mutateNormalizeRequest = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: mutateNormalizeRequest.requestId,
      result: {
        document: seed,
        diagnostics: [],
        metadata: {
          documentId: seed.documentId,
          heads: ["head_mutate"],
          source: "local",
        },
      },
    });
    const mutated = await mutation;
    expect(
      mutated.ok && mutated.metadata.source === "local",
      "Worker-backed mutations should preserve repository metadata.",
    ).toBeTruthy();

    const pendingFailure = repository.mutate({
      expected: seed,
      documentId: seed.documentId,
      document: seed,
    });
    const failedMutateRequest = worker.takePosted("mutate");
    worker.emit({
      kind: "mutated",
      requestId: failedMutateRequest.requestId,
      result: {
        ok: false,
        status: {
          kind: "failed",
          documentId: seed.documentId,
          diagnostic: {
            reasonCode: "automerge-durability-failed",
            message: "flush failed",
          },
        },
        appliedLive: {
          document: { ...seed, name: "Live merged publication" },
          metadata: {
            documentId: seed.documentId,
            actorId: "actor_worker",
            heads: ["head_live"],
            source: "local",
          },
        },
      },
    });
    await flushAsync();
    const failedNormalizeRequest = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: failedNormalizeRequest.requestId,
      result: {
        document: failedNormalizeRequest.document,
        diagnostics: [],
        metadata: failedNormalizeRequest.metadata,
      },
    });
    const failedMutation = await pendingFailure;
    expect(
      !failedMutation.ok && failedMutation.appliedLive?.document.name,
    ).toBe("Live merged publication");
    expect(
      !failedMutation.ok && failedMutation.appliedLive?.metadata.heads,
    ).toEqual(["head_live"]);

    const asset = await createDeterministicGeometryAsset({
      ownerFeatureIds: [seed.features[0]!.featureId],
    });
    const documentWithAsset = {
      ...seed,
      assets: {
        schemaVersion: "geometry-asset-manifest/v1alpha1" as const,
        records: [asset.asset],
      },
    };
    const assetMutation = repository.mutate({
      expected: seed,
      documentId: seed.documentId,
      document: documentWithAsset,
      assets: [asset],
    });
    const assetMutateRequest = worker.takePosted("mutate");
    expect(
      assetMutateRequest.assets?.[0]?.bytes.byteLength,
      "Worker-backed asset mutations should send package blobs to the document sync worker.",
    ).toBe(asset.bytes.byteLength);
    worker.emit({
      kind: "mutated",
      requestId: assetMutateRequest.requestId,
      result: {
        ok: true,
        document: documentWithAsset,
        assetAvailability: [
          {
            assetId: asset.asset.assetId,
            hash: asset.asset.hash,
            byteLength: asset.asset.byteLength,
            format: asset.asset.format,
            available: true,
          },
        ],
        status: { kind: "restored", documentId: seed.documentId },
        metadata: {
          documentId: seed.documentId,
          heads: ["head_asset"],
          source: "local",
        },
      },
    });
    await flushAsync();
    const assetMutateNormalizeRequest = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: assetMutateNormalizeRequest.requestId,
      result: {
        document: documentWithAsset,
        diagnostics: [],
        metadata: {
          documentId: seed.documentId,
          heads: ["head_asset"],
          source: "local",
        },
      },
    });
    const assetMutated = await assetMutation;
    expect(
      assetMutated.ok && assetMutated.assetAvailability?.[0]?.available,
      "Worker-backed asset mutations should preserve asset availability metadata.",
    ).toBeTruthy();

    const recordBytes = repository.getGeometryAssetRecord(asset.asset);
    const recordRequest = worker.takePosted("getGeometryAssetRecord");
    expect(
      recordRequest.asset.hash,
      "Worker-backed asset record reads should proxy through the worker.",
    ).toBe(asset.asset.hash);
    worker.emit({
      kind: "geometryAssetRecord",
      requestId: recordRequest.requestId,
      bytes: asset.bytes,
    });
    expect(
      (await recordBytes)?.byteLength,
      "Worker-backed asset record reads should return worker bytes.",
    ).toBe(asset.bytes.byteLength);

    const hashBytes = repository.getGeometryAssetBytes(asset.asset.hash);
    const hashRequest = worker.takePosted("getGeometryAssetBytes");
    expect(
      hashRequest.hash,
      "Worker-backed asset hash reads should proxy through the worker.",
    ).toBe(asset.asset.hash);
    worker.emit({
      kind: "geometryAssetBytes",
      requestId: hashRequest.requestId,
      bytes: asset.bytes,
    });
    expect(
      (await hashBytes)?.byteLength,
      "Worker-backed asset hash reads should return worker bytes.",
    ).toBe(asset.bytes.byteLength);

    const observed: string[] = [];
    const unsubscribe = repository.subscribe(seed.documentId, (event) => {
      observed.push(
        `${event.metadata.source}:${event.diagnostics?.length ?? 0}`,
      );
    });
    const subscribeRequest = worker.takePosted("subscribe");
    worker.emit({
      kind: "subscribed",
      requestId: subscribeRequest.requestId,
      subscriptionId: subscribeRequest.subscriptionId,
    });
    await flushAsync();
    worker.emit({
      kind: "documentChanged",
      subscriptionId: subscribeRequest.subscriptionId,
      event: {
        document: seed,
        diagnostics: repositoryDiagnostics,
        status: { kind: "restored", documentId: seed.documentId },
        metadata: {
          documentId: seed.documentId,
          heads: ["head_peer"],
          source: "peer",
        },
      },
    });
    await flushAsync();
    const peerNormalizeRequest = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: peerNormalizeRequest.requestId,
      result: {
        document: seed,
        diagnostics: [
          {
            code: "invalid-peer-merge",
            severity: "warning",
            message: "Peer merge repaired a missing cursor.",
            target: null,
            detail: null,
          },
        ],
        metadata: {
          documentId: seed.documentId,
          heads: ["head_peer"],
          source: "peer",
        },
      },
    });
    await flushAsync();
    expect(
      observed.join(","),
      "Peer updates should keep repository diagnostics after worker normalization.",
    ).toBe("peer:2");
    unsubscribe();
    client.dispose();
  }

  async function testDurableHistoryMethodsProxyThroughWorker() {
    const seed = await createSeedAuthoredModelDocument();
    const worker = new FakeDocumentSyncWorker();
    const client = new DocumentSyncWorkerClient({ worker });
    const repository = createWorkerBackedDocumentRepository({ client });

    const availabilityPromise = repository.getDurableHistoryAvailability(
      seed.documentId,
    );
    const availabilityRequest = worker.takePosted(
      "getDurableHistoryAvailability",
    );
    worker.emit({
      kind: "durableHistoryAvailability",
      requestId: availabilityRequest.requestId,
      availability: { canUndo: true, canRedo: false },
    });
    const availability = await availabilityPromise;
    expect(
      availability.canUndo && !availability.canRedo,
      "Worker-backed repositories should proxy durable-history availability queries.",
    ).toBeTruthy();

    const undoPromise = repository.undoDurableHistory(seed.documentId, 17);
    const undoRequest = worker.takePosted("undoDurableHistory");
    expect(undoRequest.actionSequence).toBe(17);
    worker.emit({
      kind: "durableHistoryMutated",
      requestId: undoRequest.requestId,
      result: {
        ok: true,
        document: seed,
        status: { kind: "restored", documentId: seed.documentId },
        metadata: {
          documentId: seed.documentId,
          heads: ["head_undo"],
          source: "undo",
        },
      },
    });
    await flushAsync();
    const undoNormalizeRequest = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: undoNormalizeRequest.requestId,
      result: {
        document: seed,
        diagnostics: [],
        metadata: {
          documentId: seed.documentId,
          heads: ["head_undo"],
          source: "undo",
        },
      },
    });
    const undone = await undoPromise;
    expect(
      undone?.ok && undone.metadata.source === "undo",
      "Worker-backed durable undo should preserve worker metadata.",
    ).toBeTruthy();

    client.dispose();
  }

  await testLoadMutatePeerUpdateAndDiagnostics();
  await testDurableHistoryMethodsProxyThroughWorker();
});

test("worker-backed reset preserves URL and actor/heads on rejection, clearing only after success", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const worker = new FakeDocumentSyncWorker();
  const client = new DocumentSyncWorkerClient({ worker });
  const urlStore = createMemoryUrlStore();
  const url = "automerge:retained-reset-association" as Parameters<
    DocumentRepositoryUrlStore["set"]
  >[1];
  const metadata = {
    actorId: "actual-session-actor",
    documentId: seed.documentId,
    heads: ["applied-head"],
    source: "restore" as const,
    storageKey: url,
  };
  urlStore.set(seed.documentId, url);
  const repository = createWorkerBackedDocumentRepository({ client, urlStore });
  try {
    const load = repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    const loadRequest = worker.takePosted("load");
    worker.emit({
      kind: "loaded",
      requestId: loadRequest.requestId,
      result: {
        ok: true,
        document: seed,
        status: { kind: "restored", documentId: seed.documentId },
        metadata,
      },
    });
    await flushAsync();
    const normalize = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: normalize.requestId,
      result: { document: seed, metadata, diagnostics: [] },
    });
    expect((await load).ok).toBe(true);
    expect(urlStore.get(seed.documentId)).toBe(url);
    const failed = {
      kind: "failed" as const,
      documentId: seed.documentId,
      diagnostic: {
        reasonCode: "automerge-durability-failed",
        message: "Applied changes still need persistence.",
      },
    };
    const rejected = repository.reset(seed.documentId);
    const rejectedRequest = worker.takePosted("reset");
    expect(urlStore.get(seed.documentId)).toBe(url);
    worker.emit({
      kind: "reset",
      requestId: rejectedRequest.requestId,
      status: failed,
    });
    expect(await rejected).toEqual(failed);
    expect(repository.getRestoreStatus(seed.documentId)).toEqual(failed);
    expect(urlStore.get(seed.documentId)).toBe(url);
    expect(repository.getMetadata(seed.documentId)).toEqual(metadata);
    const successful = repository.reset(seed.documentId);
    const successfulRequest = worker.takePosted("reset");
    expect(urlStore.get(seed.documentId)).toBe(url);
    worker.emit({
      kind: "reset",
      requestId: successfulRequest.requestId,
      status: { kind: "reset", documentId: seed.documentId },
    });
    expect((await successful).kind).toBe("reset");
    expect(urlStore.get(seed.documentId)).toBeNull();
    expect(repository.getMetadata(seed.documentId)).toEqual({
      actorId: "",
      documentId: seed.documentId,
      heads: [],
      source: "reset",
    });
  } finally {
    client.dispose();
  }
});

test("worker-backed writes carry the shared URL store's current URL and only seed results write it back (cadara-l99p)", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const worker = new FakeDocumentSyncWorker();
  const client = new DocumentSyncWorkerClient({ worker });
  const urlStore = createMemoryUrlStore();
  type Url = Parameters<DocumentRepositoryUrlStore["set"]>[1];
  const loadedUrl = "automerge:loaded" as Url;
  const replacedUrl = "automerge:replaced" as Url;
  urlStore.set(seed.documentId, loadedUrl);
  const repository = createWorkerBackedDocumentRepository({ client, urlStore });
  const metadata = (source: DocumentRepositoryChangeSource, url: string) => ({
    actorId: "tab-actor",
    documentId: seed.documentId,
    heads: [`head_${source}`],
    source,
    storageKey: url,
  });
  /** Answers the posted request and its follow-up normalize request. */
  async function answer(
    response: DocumentSyncWorkerResponse,
    responseMetadata: ReturnType<typeof metadata>,
  ) {
    worker.emit(response);
    await flushAsync();
    const normalize = worker.takePosted("normalize");
    worker.emit({
      kind: "normalized",
      requestId: normalize.requestId,
      result: { document: seed, diagnostics: [], metadata: responseMetadata },
    });
  }
  try {
    // Restore and local results report the URL they were loaded from.
    const load = repository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    const loadRequest = worker.takePosted("load");
    expect(loadRequest.storageKey).toBe(loadedUrl);
    urlStore.delete(seed.documentId); // another tab resets meanwhile
    await answer(
      {
        kind: "loaded",
        requestId: loadRequest.requestId,
        result: {
          ok: true,
          document: seed,
          status: { kind: "restored", documentId: seed.documentId },
          metadata: metadata("restore", loadedUrl),
        },
      },
      metadata("restore", loadedUrl),
    );
    expect((await load).ok).toBe(true);
    expect(
      urlStore.get(seed.documentId),
      "A restore result must not resurrect a URL another tab deleted.",
    ).toBeNull();

    const mutation = repository.mutate({
      documentId: seed.documentId,
      expected: seed,
      document: seed,
    });
    const mutateRequest = worker.takePosted("mutate");
    expect(
      mutateRequest.storageKey,
      "A write carries null when the shared URL store has no URL.",
    ).toBeNull();
    await answer(
      {
        kind: "mutated",
        requestId: mutateRequest.requestId,
        result: {
          ok: true,
          document: seed,
          status: { kind: "restored", documentId: seed.documentId },
          metadata: metadata("local", loadedUrl),
        },
      },
      metadata("local", loadedUrl),
    );
    expect((await mutation).ok).toBe(true);
    expect(urlStore.get(seed.documentId)).toBeNull();

    // Another tab replaced the document.
    urlStore.set(seed.documentId, replacedUrl);
    for (const direction of ["undo", "redo"] as const) {
      const pending =
        direction === "undo"
          ? repository.undoDurableHistory(seed.documentId, 3)
          : repository.redoDurableHistory(seed.documentId, 3);
      const request = worker.takePosted(
        direction === "undo" ? "undoDurableHistory" : "redoDurableHistory",
      );
      expect(request.storageKey).toBe(replacedUrl);
      await answer(
        {
          kind: "durableHistoryMutated",
          requestId: request.requestId,
          result: {
            ok: true,
            document: seed,
            status: { kind: "restored", documentId: seed.documentId },
            metadata: metadata(direction, loadedUrl),
          },
        },
        metadata(direction, loadedUrl),
      );
      expect((await pending)?.ok).toBe(true);
      expect(
        urlStore.get(seed.documentId),
        `A ${direction} result must not overwrite a URL another tab moved.`,
      ).toBe(replacedUrl);
    }

    // A seed result is a URL this tab just created.
    const seeding = repository.initialize({
      documentId: seed.documentId,
      document: seed,
    });
    const initializeRequest = worker.takePosted("initialize");
    await answer(
      {
        kind: "mutated",
        requestId: initializeRequest.requestId,
        result: {
          ok: true,
          document: seed,
          status: { kind: "seeded", documentId: seed.documentId },
          metadata: metadata("seed", "automerge:seeded"),
        },
      },
      metadata("seed", "automerge:seeded"),
    );
    expect((await seeding).ok).toBe(true);
    expect(urlStore.get(seed.documentId)).toBe("automerge:seeded");
  } finally {
    client.dispose();
  }

  // Without a shared URL store the worker keeps its own URL.
  const standaloneWorker = new FakeDocumentSyncWorker();
  const standaloneClient = new DocumentSyncWorkerClient({
    worker: standaloneWorker,
  });
  try {
    const pending = createWorkerBackedDocumentRepository({
      client: standaloneClient,
    }).mutate({ documentId: seed.documentId, expected: seed, document: seed });
    // Disposing the client below rejects the unanswered request.
    void pending.catch(() => undefined);
    expect(standaloneWorker.takePosted("mutate").storageKey).toBeUndefined();
  } finally {
    standaloneClient.dispose();
  }
});

function createMemoryUrlStore(): DocumentRepositoryUrlStore {
  const values = new Map<string, string>();
  return {
    get(documentId) {
      return (values.get(documentId) ?? null) as ReturnType<
        DocumentRepositoryUrlStore["get"]
      >;
    },
    set(documentId, url) {
      values.set(documentId, url);
    },
    delete(documentId) {
      values.delete(documentId);
    },
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeDocumentSyncWorker implements DocumentSyncWorkerLike {
  private readonly posted: DocumentSyncWorkerRequest[] = [];
  private listener:
    | ((event: MessageEvent<DocumentSyncWorkerResponse>) => void)
    | null = null;

  postMessage(message: DocumentSyncWorkerRequest) {
    this.posted.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void,
  ) {
    this.listener = listener;
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void,
  ) {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  takePosted<TKind extends DocumentSyncWorkerRequest["kind"]>(kind: TKind) {
    const message = this.posted.shift();
    if (!message || message.kind !== kind) {
      throw new Error(`Expected posted ${kind} request.`);
    }

    return message as Extract<DocumentSyncWorkerRequest, { kind: TKind }>;
  }

  emit(message: DocumentSyncWorkerResponse) {
    this.listener?.({
      data: message,
    } as MessageEvent<DocumentSyncWorkerResponse>);
  }
}
