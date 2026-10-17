import { expect, it } from "vitest";
import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import { snapshotRepresentsRepositoryDocument } from "@/contracts/modeling/repository-basis";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { createModelingService } from "./service";

// Logic adapter-conformance seam: real repository events and the production
// service, with gates only at the asynchronous adapter boundary.
it("same-revision peer content changes heads and cannot certify an old receipt; unchanged save keeps heads", async () => {
  const adapter = new MockKernelAdapter();
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    const before = await service.getCurrentDocumentSnapshot();
    const original = await repository.load({
      documentId: "doc_workspace",
      seedDocument: await adapter.exportAuthoredModelDocument("doc_workspace"),
    });
    if (!original.ok) throw new Error("Expected a stored document");
    expect(snapshotRepresentsRepositoryDocument(before, original)).toBe(true);
    const peer = await repository.receivePeerDocument(
      { ...original.document, name: "Peer title" },
      original.document,
    );
    if (!peer.ok) throw new Error("Expected peer write");
    const restored = await service.getCurrentDocumentSnapshot();
    expect(restored.document.name).toBe("Peer title");
    expect(peer.document.revisionId).toBe(original.document.revisionId);
    expect(restored.document.revisionId).not.toBe(peer.document.revisionId);
    expect(peer.metadata.heads).not.toEqual(original.metadata.heads);
    expect(snapshotRepresentsRepositoryDocument(restored, original)).toBe(
      false,
    );
    expect(snapshotRepresentsRepositoryDocument(restored, peer)).toBe(true);
    const saved = await service.exportCurrentDocument({
      observe: (receipt) => {
        expect(receipt.ok).toBe(true);
        if (receipt.ok)
          expect(receipt.metadata.heads).toEqual(peer.metadata.heads);
      },
    });
    expect(JSON.parse(saved.payload as string).name).toBe("Peer title");
    const afterSave = await service.getCurrentDocumentSnapshot();
    expect(afterSave.provenance!.repositoryHeads).toEqual(peer.metadata.heads);
    expect(snapshotRepresentsRepositoryDocument(afterSave, original)).toBe(
      false,
    );
    expect(snapshotRepresentsRepositoryDocument(afterSave, peer)).toBe(true);
  } finally {
    service.dispose();
  }
});

it("retries an adapter snapshot captured before an in-flight same-revision peer restore", async () => {
  let snapshotCaptured!: () => void, releaseSnapshot!: () => void;
  let restoreStarted!: () => void, releaseRestore!: () => void;
  const captured = new Promise<void>((resolve) => {
    snapshotCaptured = resolve;
  });
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  const started = new Promise<void>((resolve) => {
    restoreStarted = resolve;
  });
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  let holdSnapshot = false,
    holdRestore = false;
  class DelayedAdapter extends MockKernelAdapter {
    override async getDocumentSnapshot(
      ...args: Parameters<MockKernelAdapter["getDocumentSnapshot"]>
    ) {
      const snapshot = await super.getDocumentSnapshot(...args);
      if (holdSnapshot) {
        holdSnapshot = false;
        snapshotCaptured();
        await snapshotGate;
      }
      return snapshot;
    }
    override async restoreAuthoredModelDocument(
      ...args: Parameters<MockKernelAdapter["restoreAuthoredModelDocument"]>
    ) {
      if (holdRestore) {
        holdRestore = false;
        restoreStarted();
        await restoreGate;
      }
      return super.restoreAuthoredModelDocument(...args);
    }
  }
  const adapter = new DelayedAdapter();
  const repository = new MemoryDocumentRepository();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    await service.getCurrentDocumentSnapshot();
    const seed = await repository.load({
      documentId: "doc_workspace",
      seedDocument: await adapter.exportAuthoredModelDocument("doc_workspace"),
    });
    if (!seed.ok) throw new Error("Expected a stored document");
    const first = await repository.receivePeerDocument(
      { ...seed.document, name: "First peer" },
      seed.document,
    );
    if (!first.ok) throw new Error("Expected first peer write");
    const before = await service.getCurrentDocumentSnapshot();
    expect(before.document.revisionId).not.toBe(first.document.revisionId);
    holdSnapshot = true;
    let settled = false;
    const pending = service.getCurrentDocumentSnapshot().then((snapshot) => {
      settled = true;
      return snapshot;
    });
    await captured;
    holdRestore = true;
    const second = await repository.receivePeerDocument(
      { ...first.document, name: "Second peer" },
      first.document,
    );
    if (!second.ok) throw new Error("Expected second peer write");
    await started;
    releaseSnapshot();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      settled,
      "a snapshot captured before the queued restore is not current",
    ).toBe(false);
    releaseRestore();
    const current = await pending;
    expect(current.document.name).toBe("Second peer");
    expect(snapshotRepresentsRepositoryDocument(current, first)).toBe(false);
    expect(snapshotRepresentsRepositoryDocument(current, second)).toBe(true);
  } finally {
    releaseSnapshot();
    releaseRestore();
    service.dispose();
  }
});

it.each(["unsupported", "failed"] as const)(
  "%s repository restore cannot certify or export a foreign stored basis",
  async (kind) => {
    const adapter = new MockKernelAdapter();
    const foreign = {
      ...(await adapter.exportAuthoredModelDocument("doc_workspace")),
      name: "Foreign state",
      revisionId: "rev_0042" as const,
    };
    const boundary: ModelingKernelAdapter = adapter;
    boundary.restoreAuthoredModelDocument =
      kind === "unsupported"
        ? undefined
        : async () => {
            throw new Error("Repository restore failed deliberately.");
          };
    const repository = new MemoryDocumentRepository([foreign]);
    const service = createModelingService(boundary, {
      currentDocumentId: "doc_workspace",
      documentRepository: repository,
    });
    try {
      const status = await service.getHistoryRestoreState();
      expect(status.kind).toBe("failed");
      expect(status.diagnostics.some((d) => /restore/i.test(d.message))).toBe(
        true,
      );
      const snapshot = await service.getCurrentDocumentSnapshot();
      expect(snapshot.document.name).not.toBe("Foreign state");
      expect(snapshot.provenance).toBeNull();
      expect(
        snapshotRepresentsRepositoryDocument(snapshot, {
          document: foreign,
          metadata: repository.getMetadata("doc_workspace"),
        }),
      ).toBe(false);
      const exported = await service.exportCurrentDocument();
      expect(JSON.parse(exported.payload as string).name).not.toBe(
        "Foreign state",
      );
    } finally {
      service.dispose();
    }
  },
);
