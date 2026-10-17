import { expect, it } from "vitest";
import { createDurableHistoryService } from "./durable-history";
import {
  createAuthoredHistoryOperation,
  HistoryOperationError,
} from "./authored-history";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";

it("retains exact appliedLive compensation when persistence fails after the undo applied", async () => {
  class FailedUndoRepository extends MemoryDocumentRepository {
    override async undoDurableHistory(
      ...args: Parameters<MemoryDocumentRepository["undoDurableHistory"]>
    ) {
      const result = await super.undoDurableHistory(...args);
      if (!result?.ok) return result;
      return {
        ok: false as const,
        status: {
          kind: "failed" as const,
          documentId: args[0],
          diagnostic: {
            reasonCode: "write-failed",
            message: "Compensation storage refused",
          },
        },
        appliedLive: result,
      };
    }
  }
  const repository = new FailedUndoRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const added = await service.addDocumentVariable({
      baseRevisionId: initial.document.revisionId,
      name: "Width",
      valueText: "20",
    });
    expect(added.isOk()).toBe(true);
    const stored = repository.savedDocuments.at(-1)!;
    expect(
      (
        await repository.receivePeerDocument(
          { ...stored, name: "Peer title" },
          stored,
        )
      ).ok,
    ).toBe(true);
    await service.getCurrentDocumentSnapshot();
    const history = createDurableHistoryService({
      documentRepository: repository,
      modelingService: service,
    });
    const failure = await history
      .undo({ documentId: initial.document.documentId })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(HistoryOperationError);
    expect(failure.compensation).toMatchObject({
      kind: "failed",
      document: { variables: [] },
      metadata: { source: "undo" },
    });
    expect(failure.snapshot.document.variables).toEqual([]);
    expect(failure.snapshot.document.name).toBe("Peer title");
    expect(failure.snapshot.document.revisionId).not.toBe(
      failure.compensation.document.revisionId,
    );
    expect(failure.compensation.liveRevisionId).toBe(
      failure.snapshot.document.revisionId,
    );
  } finally {
    service.dispose();
  }
});

it("a committed undo receipt survives failed exact-head synchronization without a stale snapshot", async () => {
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    expect(
      (
        await service.addDocumentVariable({
          baseRevisionId: initial.document.revisionId,
          name: "Width",
          valueText: "20",
        })
      ).isOk(),
    ).toBe(true);
    const history = createDurableHistoryService({
      documentRepository: repository,
      modelingService: {
        ...service,
        subscribeToDocumentChanges: (listener) =>
          service.subscribeToDocumentChanges((event) => {
            if (event.metadata.source !== "undo") listener(event);
          }),
      },
      repositorySynchronizationTimeoutMs: 5,
    });
    const failure = await history
      .undo({ documentId: initial.document.documentId })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(HistoryOperationError);
    expect(failure.compensation).toMatchObject({
      kind: "committed",
      document: { variables: [] },
      metadata: { source: "undo" },
    });
    expect(failure.snapshot).toBeUndefined();
  } finally {
    service.dispose();
  }
});

it("a committed compensation survives editor handoff failure", async () => {
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    expect(
      (
        await service.addDocumentVariable({
          baseRevisionId: initial.document.revisionId,
          name: "Width",
          valueText: "20",
        })
      ).isOk(),
    ).toBe(true);
    const operation = createAuthoredHistoryOperation({
      documentHistory: createDurableHistoryService({
        documentRepository: repository,
        modelingService: service,
      }),
      getContext: () => ({
        kind: "document",
        documentId: initial.document.documentId,
      }),
      privateHistory: async () => {
        throw new Error("Wrong private route");
      },
      handoff: async () => {
        throw new Error("Editor refused snapshot");
      },
    });
    const failure = await operation
      .execute({ commandId: "undo", direction: "undo" })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(HistoryOperationError);
    expect(failure.message).toBe("Editor refused snapshot");
    expect(failure.compensation).toMatchObject({
      kind: "committed",
      document: { variables: [] },
    });
  } finally {
    service.dispose();
  }
});

it("an old document compensation cannot replace a newly entered editing context", async () => {
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    expect(
      (
        await service.addDocumentVariable({
          baseRevisionId: initial.document.revisionId,
          name: "Width",
          valueText: "20",
        })
      ).isOk(),
    ).toBe(true);
    let switched = false;
    let handedOff = false;
    const durable = createDurableHistoryService({
      documentRepository: repository,
      modelingService: service,
    });
    const operation = createAuthoredHistoryOperation({
      documentHistory: {
        ...durable,
        undo: async (request) => {
          const result = await durable.undo(request);
          switched = true;
          return result;
        },
      },
      getContext: () =>
        switched
          ? { kind: "sketch" }
          : { kind: "document", documentId: initial.document.documentId },
      privateHistory: async () => {},
      handoff: async () => {
        handedOff = true;
      },
    });
    const failure = await operation
      .execute({ commandId: "old-undo", direction: "undo" })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(HistoryOperationError);
    expect(failure.compensation.kind).toBe("committed");
    expect(handedOff).toBe(false);
  } finally {
    service.dispose();
  }
});
