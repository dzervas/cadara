import { expect, it, vi } from "vitest";
import { snapshotRepresentsRepositoryDocument } from "@/contracts/modeling/repository-basis";
import type {
  DocumentRepositoryChangeEvent,
  DocumentRepositoryMutationResult,
} from "@/domain/modeling/document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { createModelingService } from "./service";

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
