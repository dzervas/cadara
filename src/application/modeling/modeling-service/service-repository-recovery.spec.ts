import { expect, it, vi } from "vitest";
import { snapshotRepresentsRepositoryDocument } from "@/contracts/modeling/repository-basis";
import type {
  DocumentRepositoryChangeEvent,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
} from "@/contracts/modeling/document-repository";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { createModelingService } from "./service";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import { createMemoryOperationHistoryStore } from "@/application/modeling/modeling-history-persistence";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class ReplayableRepository extends MemoryDocumentRepository {
  replay!: (event: DocumentRepositoryChangeEvent) => void;
  latest!: DocumentRepositoryChangeEvent;
  override subscribe(...[id, listener]: Parameters<MemoryDocumentRepository["subscribe"]>) {
    this.replay = listener;
    return super.subscribe(id, (event) => {
      this.latest = event;
      listener(event);
    });
  }
}

class InitiallyUnavailableRepository extends ReplayableRepository {
  private unavailable = true;
  override async load(input: Parameters<MemoryDocumentRepository["load"]>[0]): Promise<DocumentRepositoryLoadResult> {
    if (this.unavailable) {
      this.unavailable = false;
      return {
        ok: false,
        status: {
          kind: "failed",
          documentId: input.documentId,
          diagnostic: { reasonCode: "automerge-document-missing", message: "The stored copy is missing." },
        },
      };
    }
    return super.load(input);
  }
}

it.each(["late peer", "failed restore then retry"] as const)(
  "a failed initial repository load recovers history and persistence after %s adoption",
  async (arrival) => {
    const original = await createSeedAuthoredModelDocument();
    const repository = new InitiallyUnavailableRepository([original]);
    const adapter = new MockKernelAdapter();
    const historyStore = createMemoryOperationHistoryStore();
    const service = createModelingService(adapter, {
      currentDocumentId: original.documentId, documentRepository: repository, operationHistoryStore: historyStore,
    });
    try {
      expect(await service.getHistoryRestoreState()).toMatchObject({
        kind: "failed", diagnostics: [{ reasonCode: "automerge-document-missing" }],
      });
      const mutate = vi.spyOn(repository, "mutate");
      const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
      if (arrival === "failed restore then retry") restore.mockRejectedValueOnce(new Error("Late peer restore failed"));
      const received = await repository.receivePeerDocument({ ...original, name: "Late peer" }, original);
      if (!received.ok) throw new Error("Expected peer document");
      if (arrival === "failed restore then retry") {
        await expect(service.getCurrentDocumentSnapshot()).rejects.toThrow("Late peer restore failed");
        expect(await service.getHistoryRestoreState()).toMatchObject({
          kind: "failed", diagnostics: [{ reasonCode: "repository-restore-exception" }],
        });
        repository.replay(repository.latest);
      }
      const recovered = await service.getCurrentDocumentSnapshot();
      expect(recovered.document.name).toBe("Late peer");
      expect(await service.getHistoryRestoreState()).toEqual({ kind: "restored", entriesReplayed: 0, diagnostics: [] });
      expect(service.initialLoadingStatus.getSnapshot()).toBe("ready");
      expect(mutate).not.toHaveBeenCalled();
      const added = await service.addDocumentVariable({
        baseRevisionId: recovered.document.revisionId, name: "AfterRecovery", valueText: "5",
      });
      expect(added.isOk()).toBe(true);
      await service.waitForPersistence();
      const stored = await repository.load({ documentId: original.documentId, seedDocument: original });
      expect(stored).toMatchObject({ ok: true, document: { variables: [{ name: "AfterRecovery" }] } });
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(historyStore.savedPayloads.flatMap((payload) => payload.entries)).toHaveLength(1);
      if (!stored.ok) throw new Error("Expected stored recovered document");
      const peerRepository = new MemoryDocumentRepository([received.document]);
      const peerService = createModelingService(new MockKernelAdapter(), {
        currentDocumentId: original.documentId, documentRepository: peerRepository,
      });
      try {
        await peerService.getCurrentDocumentSnapshot();
        expect((await peerRepository.receivePeerDocument(stored.document, received.document)).ok).toBe(true);
        expect((await peerService.getCurrentDocumentSnapshot()).document.variables).toMatchObject([{ name: "AfterRecovery" }]);
      } finally { peerService.dispose(); }
    } finally { service.dispose(); }
  },
);

it("a failed initial repository load refuses authored mutations before touching the provisional kernel", async () => {
  const original = await createSeedAuthoredModelDocument();
  const repository = new InitiallyUnavailableRepository([original]);
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, { currentDocumentId: original.documentId, documentRepository: repository });
  try {
    const before = await service.getCurrentDocumentSnapshot();
    const add = vi.spyOn(adapter, "addDocumentVariable");
    const rename = vi.spyOn(adapter, "renameDocument");
    const mutate = vi.spyOn(repository, "mutate");
    const attempted = await service.addDocumentVariable({
      baseRevisionId: before.document.revisionId, name: "Provisional", valueText: "3",
    });
    expect(attempted.isOk()).toBe(false);
    expect(await service.renameDocument({ name: "Provisional name" })).toMatchObject({ ok: false });
    expect(add).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect((await service.getCurrentDocumentSnapshot()).document).toEqual(before.document);
    expect(await service.getHistoryRestoreState()).toMatchObject({ kind: "failed", diagnostics: [{ reasonCode: "automerge-document-missing" }] });
  } finally { service.dispose(); }
});

it.each(["invalid document", "identity mismatch", "stale heads", "stale storage key", "failed current status"] as const)(
  "a %s peer event cannot reopen a failed initial repository bootstrap",
  async (kind) => {
    const original = await createSeedAuthoredModelDocument();
    const repository = new InitiallyUnavailableRepository([original]);
    const adapter = new MockKernelAdapter();
    const service = createModelingService(adapter, { currentDocumentId: original.documentId, documentRepository: repository });
    try {
      await service.getHistoryRestoreState();
      const base = await repository.load({ documentId: original.documentId, seedDocument: original });
      if (!base.ok) throw new Error("Expected stored fixture");
      const event: DocumentRepositoryChangeEvent = {
        ...base, metadata: { ...base.metadata, source: "peer" },
      };
      if (kind === "invalid document") event.document = { ...event.document, name: 123 } as unknown as typeof original;
      if (kind === "identity mismatch") event.document = { ...event.document, documentId: "doc_other" };
      if (kind === "stale heads") event.metadata.heads = ["stale-head"];
      if (kind === "stale storage key") event.metadata.storageKey = "superseded-copy";
      if (kind === "failed current status") vi.spyOn(repository, "getRestoreStatus").mockReturnValue({
        kind: "failed", documentId: original.documentId,
        diagnostic: { reasonCode: "automerge-document-superseded", message: "The copy was replaced." },
      });
      const mutate = vi.spyOn(repository, "mutate");
      repository.replay(event);
      expect(await service.getHistoryRestoreState()).toMatchObject({ kind: "failed" });
      expect((await adapter.exportAuthoredModelDocument(original.documentId)).name).toBe(original.name);
      const attempted = await service.addDocumentVariable({ baseRevisionId: original.revisionId, name: "MustNotWrite", valueText: "1" });
      expect(attempted.isOk()).toBe(false);
      expect(mutate).not.toHaveBeenCalled();
    } finally { service.dispose(); }
  },
);

it("a failed explicit reset preserves unsaved displayed state instead of auto-adopting a late bootstrap peer", async () => {
  const original = await createSeedAuthoredModelDocument();
  const repository = new InitiallyUnavailableRepository([original]);
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, { currentDocumentId: original.documentId, documentRepository: repository });
  try {
    const before = await service.getCurrentDocumentSnapshot();
    vi.spyOn(repository, "reset").mockResolvedValueOnce({
      kind: "failed", documentId: original.documentId,
      diagnostic: { reasonCode: "recovery-write-failed", message: "The displayed document could not be saved." },
    });
    service.resetOperationHistory();
    await service.waitForPersistence();
    const saveFailure = service.getLocalSaveStatus().failure;
    expect(saveFailure).toMatchObject({ reasonCode: "recovery-write-failed" });
    const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
    const mutate = vi.spyOn(repository, "mutate");
    expect((await repository.receivePeerDocument({ ...original, name: "Late peer" }, original)).ok).toBe(true);
    expect((await service.getCurrentDocumentSnapshot()).document).toEqual(before.document);
    expect(await service.getHistoryRestoreState()).toMatchObject({ kind: "failed", diagnostics: [{ reasonCode: "recovery-write-failed" }] });
    expect(service.getLocalSaveStatus().failure).toBe(saveFailure);
    expect(restore).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  } finally { service.dispose(); }
});

it.each(["peer first", "reset first"] as const)(
  "failed reset and late bootstrap adoption serialize without deadlock when %s",
  async (order) => {
    const original = await createSeedAuthoredModelDocument();
    const repository = new InitiallyUnavailableRepository([original]);
    const adapter = new MockKernelAdapter();
    const service = createModelingService(adapter, {
      currentDocumentId: original.documentId, documentRepository: repository,
    });
    const firstExportStarted = deferred(), releaseFirstExport = deferred();
    try {
      const before = await service.getCurrentDocumentSnapshot();
      const exportDocument = adapter.exportAuthoredModelDocument.bind(adapter);
      let exports = 0;
      const resetError = new Error("Reset could not export the displayed state");
      vi.spyOn(adapter, "exportAuthoredModelDocument").mockImplementation(async (...args) => {
        const call = ++exports;
        if (call === 1) {
          firstExportStarted.resolve();
          await releaseFirstExport.promise;
        }
        if (call === (order === "peer first" ? 2 : 1)) throw resetError;
        return exportDocument(...args);
      });
      const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
      const mutate = vi.spyOn(repository, "mutate");
      const reset = vi.spyOn(repository, "reset");
      if (order === "reset first") service.resetOperationHistory();
      else expect((await repository.receivePeerDocument({ ...original, name: "Late peer" }, original)).ok).toBe(true);
      await firstExportStarted.promise;
      if (order === "peer first") service.resetOperationHistory();
      else expect((await repository.receivePeerDocument({ ...original, name: "Late peer" }, original)).ok).toBe(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const exportsWhileFirstHeld = exports;
      expect(restore).not.toHaveBeenCalled();
      releaseFirstExport.resolve();
      await service.waitForPersistence();
      const current = await service.getCurrentDocumentSnapshot();
      expect(current.document.name).toBe(order === "peer first" ? "Late peer" : before.document.name);
      expect(await service.getHistoryRestoreState()).toMatchObject({
        kind: "failed", diagnostics: [{ reasonCode: "repository-reset-exception", message: resetError.message }],
      });
      expect(service.getLocalSaveStatus().failure).toMatchObject({ reasonCode: "repository-reset-exception" });
      expect(exportsWhileFirstHeld, "the later operation cannot export while the earlier operation is held").toBe(1);
      expect(reset).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
      const added = await service.addDocumentVariable({
        baseRevisionId: current.document.revisionId, name: "AfterFailedReset", valueText: "2",
      });
      // A peer adopted before reset established a trusted basis: ordinary
      // post-load save failure still permits in-memory editing, not persistence.
      expect(added.isOk()).toBe(order === "peer first");
      expect(mutate).not.toHaveBeenCalled();
      expect((await service.getHistoryRestoreState()).kind).toBe("failed");
    } finally {
      releaseFirstExport.resolve();
      service.dispose();
    }
  },
);

it.each(["peer first", "reset first"] as const)(
  "reset and peer recovery queued in one turn complete without a cyclic persistence dependency when %s",
  async (order) => {
    const original = await createSeedAuthoredModelDocument();
    const repository = new InitiallyUnavailableRepository([original]);
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: original.documentId, documentRepository: repository,
    });
    try {
      await service.getHistoryRestoreState();
      const stored = await repository.load({ documentId: original.documentId, seedDocument: original });
      if (!stored.ok) throw new Error("Expected canonical fixture");
      const publish = () => repository.replay({ ...stored, metadata: { ...stored.metadata, source: "peer" } });
      // No await between these calls: the earlier peer has not yet reached its
      // persistence drain when reset captures the repository-adoption tail.
      if (order === "peer first") { publish(); service.resetOperationHistory(); }
      else { service.resetOperationHistory(); publish(); }
      await service.waitForPersistence();
      expect((await service.getHistoryRestoreState()).kind).not.toBe("failed");
      const current = await service.getCurrentDocumentSnapshot();
      expect((await service.addDocumentVariable({
        baseRevisionId: current.document.revisionId, name: "AfterSerializedReset", valueText: "2",
      })).isOk()).toBe(true);
      const saved = await repository.load({ documentId: original.documentId, seedDocument: original });
      expect(saved).toMatchObject({ ok: true, document: { variables: [{ name: "AfterSerializedReset" }] } });
    } finally { service.dispose(); }
  },
);

it.each(["new", "import", "reset"] as const)("explicit %s can resolve a failed initial repository load", async (resolution) => {
  const original = await createSeedAuthoredModelDocument();
  const repository = new InitiallyUnavailableRepository([original]);
  const service = createModelingService(new MockKernelAdapter(), { currentDocumentId: original.documentId, documentRepository: repository });
  try {
    await service.getHistoryRestoreState();
    if (resolution === "new") expect((await service.createNewDocument({ name: "Replacement" })).ok).toBe(true);
    else if (resolution === "import") expect((await service.importDocument({ document: { ...original, name: "Replacement" } })).ok).toBe(true);
    else { service.resetOperationHistory(); await service.waitForPersistence(); }
    expect((await service.getHistoryRestoreState()).kind).not.toBe("failed");
    const current = await service.getCurrentDocumentSnapshot();
    expect((await service.addDocumentVariable({ baseRevisionId: current.document.revisionId, name: "AfterResolution", valueText: "2" })).isOk()).toBe(true);
  } finally { service.dispose(); }
});

it.each(["newer peer", "same event retry"] as const)(
  "a rejected refresh is reported once and does not poison a %s",
  async (next) => {
    const adapter = new MockKernelAdapter();
    const repository = new ReplayableRepository();
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace", documentRepository: repository,
    });
    try {
      await service.getCurrentDocumentSnapshot();
      const original = await adapter.exportAuthoredModelDocument("doc_workspace");
      const error = new Error("Injected repository refresh failure");
      const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
      restore.mockRejectedValueOnce(error);
      const phases: string[] = [];
      const stop = service.initialLoadingStatus.subscribe(() =>
        phases.push(service.initialLoadingStatus.getSnapshot()));
      const first = await repository.receivePeerDocument(
        { ...original, name: "First peer" }, original,
      );
      if (!first.ok) throw new Error("Expected first peer write");
      await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(error);
      const failureState = await service.getHistoryRestoreState().then(
        (state) => state, (error: unknown) => ({ error }),
      );
      const failedEvent = repository.latest;
      let latest = first;
      if (next === "newer peer") {
        const second = await repository.receivePeerDocument(
          { ...first.document, name: "Second peer" }, first.document,
        );
        if (!second.ok) throw new Error("Expected second peer write");
        latest = second;
      } else repository.replay(failedEvent);
      const recovered = await service.getCurrentDocumentSnapshot();
      expect(failureState).toMatchObject({
        kind: "failed",
        diagnostics: [{ reasonCode: "repository-restore-exception", message: error.message }],
      });
      expect(recovered.document.name).toBe(latest.document.name);
      expect(snapshotRepresentsRepositoryDocument(recovered, latest)).toBe(true);
      expect(restore.mock.calls.filter(([document]) => document.name === latest.document.name).length)
        .toBeGreaterThanOrEqual(next === "same event retry" ? 2 : 1);
      expect(phases.filter((phase) => phase === "failed")).toHaveLength(1);
      expect(service.initialLoadingStatus.getSnapshot()).toBe("ready");
      const mutation = await service.addDocumentVariable({
        baseRevisionId: recovered.document.revisionId,
        name: "Depth", valueText: "5",
      });
      expect(mutation.isOk()).toBe(true);
      expect((await service.getCurrentDocumentSnapshot()).document.variables.map((v) => v.name)).toContain("Depth");
      stop();
    } finally { service.dispose(); }
  },
);

it("a partially applied failed peer restore retains the last coherent kernel and repository states", async () => {
  const adapter = new MockKernelAdapter();
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace", documentRepository: repository,
  });
  try {
    const before = await service.getCurrentDocumentSnapshot();
    const original = await adapter.exportAuthoredModelDocument("doc_workspace");
    const restore = adapter.restoreAuthoredModelDocument.bind(adapter);
    const error = new Error("Partially applied peer refresh failed");
    vi.spyOn(adapter, "restoreAuthoredModelDocument").mockImplementationOnce(async (...args) => {
      await restore(...args);
      throw error;
    });
    const peer = await repository.receivePeerDocument({ ...original, name: "Peer" }, original);
    if (!peer.ok) throw new Error("Expected peer write");
    await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(error);
    expect((await adapter.exportAuthoredModelDocument("doc_workspace")).name).toBe(before.document.name);
    const stored = await repository.load({ documentId: "doc_workspace", seedDocument: original });
    expect(stored.ok && stored.document.name).toBe("Peer");
  } finally { service.dispose(); }
});

it.each(["import", "new"] as const)(
  "%s waits for an earlier background write and holds peer restoration until replacement finishes",
  async (kind) => {
    const adapter = new MockKernelAdapter();
    const repository = new MemoryDocumentRepository();
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace", documentRepository: repository,
      documentRepositoryPersistence: "background",
    });
    const writeStarted = deferred(), releaseWrite = deferred();
    const replacementStarted = deferred(), releaseReplacement = deferred();
    let held = true;
    const mutate = repository.mutate.bind(repository);
    repository.mutate = async (input) => {
      if (held) {
        held = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      return mutate(input);
    };
    try {
      const before = await service.getCurrentDocumentSnapshot();
      const original = await adapter.exportAuthoredModelDocument("doc_workspace");
      const local = await service.addDocumentVariable({
        baseRevisionId: before.document.revisionId, name: "LocalDepth", valueText: "5",
      });
      expect(local.isOk()).toBe(true);
      await writeStarted.promise;
      const restore = adapter.restoreAuthoredModelDocument.bind(adapter);
      let replacing = false, peerRestores = 0;
      adapter.restoreAuthoredModelDocument = async (...args) => {
        if (args[3]?.newRevision) peerRestores += 1;
        if (args[0].name === "Replacement") {
          replacing = true;
          replacementStarted.resolve();
          await releaseReplacement.promise;
        }
        return restore(...args);
      };
      let settled = false;
      const replacement = (kind === "import"
        ? service.importDocument({ document: { ...original, name: "Replacement" } })
        : service.createNewDocument({ name: "Replacement" }))
        .then((result) => { settled = true; return result; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled, "replacement cannot overtake an older background candidate").toBe(false);
      expect(replacing, "replacement must drain background persistence before touching the kernel").toBe(false);
      releaseWrite.resolve();
      await replacementStarted.promise;
      const base = await repository.load({ documentId: "doc_workspace", seedDocument: original });
      if (!base.ok) throw new Error("Expected stored base");
      // Import/New intentionally replace the context, so a peer before their
      // initialize may be replaced atomically.
      const peer = await repository.receivePeerDocument({
        ...base.document,
        settings: { ...base.document.settings, modelingTolerance: 0.002 },
      }, base.document);
      if (!peer.ok) throw new Error("Expected peer write");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(peerRestores, "peer restoration waits for the lifecycle replacement").toBe(0);
      releaseReplacement.resolve();
      expect((await replacement).ok).toBe(true);
      await service.waitForPersistence();
      const current = await service.getCurrentDocumentSnapshot();
      const stored = await repository.load({ documentId: "doc_workspace", seedDocument: original });
      if (!stored.ok) throw new Error("Expected stored replacement");
      expect(current.document.name).toBe("Replacement");
      expect(stored.document.name).toBe("Replacement");
      expect(snapshotRepresentsRepositoryDocument(current, stored)).toBe(true);
      expect(current.document.variables.some((v) => v.name === "LocalDepth")).toBe(false);
    } finally {
      releaseWrite.resolve();
      releaseReplacement.resolve();
      service.dispose();
    }
  },
);

// cadara-kv69: a rename is an ordinary authored action, applied in place.
it("rename applies in place behind an earlier background write, which persists first, and a later peer field survives it", async () => {
  const adapter = new MockKernelAdapter();
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace", documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  const writeStarted = deferred(), releaseWrite = deferred();
  let held = true;
  const writtenNames: string[] = [];
  const mutate = repository.mutate.bind(repository);
  repository.mutate = async (input) => {
    if (held) {
      held = false;
      writeStarted.resolve();
      await releaseWrite.promise;
    }
    writtenNames.push(input.document.name);
    return mutate(input);
  };
  try {
    const before = await service.getCurrentDocumentSnapshot();
    const original = await adapter.exportAuthoredModelDocument("doc_workspace");
    const local = await service.addDocumentVariable({
      baseRevisionId: before.document.revisionId, name: "LocalDepth", valueText: "5",
    });
    expect(local.isOk()).toBe(true);
    await writeStarted.promise;
    const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");

    expect((await service.renameDocument({ name: "Replacement" })).ok).toBe(true);
    expect(restore, "a rename restores no document").not.toHaveBeenCalled();
    releaseWrite.resolve();
    await service.waitForPersistence();
    expect(writtenNames).toEqual([original.name, "Replacement"]);

    const base = await repository.load({ documentId: "doc_workspace", seedDocument: original });
    if (!base.ok) throw new Error("Expected stored base");
    const peer = await repository.receivePeerDocument({
      ...base.document,
      settings: { ...base.document.settings, modelingTolerance: 0.002 },
    }, base.document);
    if (!peer.ok) throw new Error("Expected peer write");
    const current = await service.getCurrentDocumentSnapshot();
    const stored = await repository.load({ documentId: "doc_workspace", seedDocument: original });
    if (!stored.ok) throw new Error("Expected stored rename");
    expect(current.document.name).toBe("Replacement");
    expect(stored.document.name).toBe("Replacement");
    expect(snapshotRepresentsRepositoryDocument(current, stored)).toBe(true);
    expect(current.document.variables.some((v) => v.name === "LocalDepth")).toBe(true);
    expect(stored.document.settings.modelingTolerance).toBe(0.002);
  } finally {
    releaseWrite.resolve();
    service.dispose();
  }
});

it("a document rename whose write is refused before applying reports a kernel that refuses the rename back (cadara-kv69)", async () => {
  class RefusingRepository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ): Promise<DocumentRepositoryMutationResult> {
      return {
        ok: false,
        status: {
          kind: "failed",
          documentId: input.documentId,
          diagnostic: { reasonCode: "write-failed", message: "Injected pre-apply failure" },
        },
      };
    }
  }
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: new RefusingRepository(),
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const renameDocument = adapter.renameDocument.bind(adapter);
    const rename = vi
      .spyOn(adapter, "renameDocument")
      .mockImplementationOnce(renameDocument)
      // The rollback meets a stale revision.
      .mockImplementationOnce((request) =>
        renameDocument({ ...request, baseRevisionId: initial.document.revisionId }),
      );

    const result = await service.renameDocument({ name: "Not persisted" });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("mock-revision-conflict");
  } finally {
    service.dispose();
  }
});
