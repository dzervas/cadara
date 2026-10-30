import { expect, it, vi } from "vitest";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { createMemoryOperationHistoryStore } from "@/application/modeling/modeling-history-persistence";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { createEmptyOperationHistory } from "@/contracts/modeling/operation-history";
import { createModelingService } from "./service";

it.each(["restored", "seeded"] as const)(
  "a repository-bound tail cannot replay over a %s replacement equal to the seed",
  async (status) => {
    const seed = await createSeedAuthoredModelDocument();
    const repository = new MemoryDocumentRepository(
      status === "restored" ? [seed] : [],
    );
    const history = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory(seed.documentId, ["superseded-head"]),
      entries: [
        {
          kind: "renameBody",
          payload: { bodyId: "body_part-1", bodyLabel: "Stale tab edit" },
        },
      ],
    });
    const mutate = vi.spyOn(repository, "mutate");
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: seed.documentId,
      documentRepository: repository,
      operationHistoryStore: history,
    });
    try {
      const snapshot = await service.getCurrentDocumentSnapshot();
      expect(
        snapshot.document.bodies.find((body) => body.bodyId === "body_part-1")
          ?.label,
      ).not.toBe("Stale tab edit");
      expect((await service.getHistoryRestoreState()).entriesReplayed).toBe(0);
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  },
);

it("matching heads cannot authorize a tail from a different document URL", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const repository = new MemoryDocumentRepository([seed]);
  const history = createMemoryOperationHistoryStore({
    ...createEmptyOperationHistory(
      seed.documentId,
      repository.getMetadata(seed.documentId).heads,
      "automerge:old-document",
    ),
    entries: [
      {
        kind: "renameBody",
        payload: { bodyId: "body_part-1", bodyLabel: "Wrong document edit" },
      },
    ],
  });
  const load = repository.load.bind(repository);
  vi.spyOn(repository, "load").mockImplementation(async (input) => {
    const result = await load(input);
    return result.ok
      ? {
          ...result,
          metadata: { ...result.metadata, storageKey: "automerge:replacement" },
        }
      : result;
  });
  const mutate = vi.spyOn(repository, "mutate");
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: seed.documentId,
    documentRepository: repository,
    operationHistoryStore: history,
  });
  try {
    expect(
      (await service.getCurrentDocumentSnapshot()).document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
    ).not.toBe("Wrong document edit");
    expect((await service.getHistoryRestoreState()).entriesReplayed).toBe(0);
    expect(mutate).not.toHaveBeenCalled();
  } finally {
    service.dispose();
  }
});

it("a single-tab crash tail replays when its stored repository basis still matches", async () => {
  const repository = new MemoryDocumentRepository();
  const history = createMemoryOperationHistoryStore();
  const load = repository.load.bind(repository);
  vi.spyOn(repository, "load").mockImplementation(async (input) => {
    const result = await load(input);
    return result.ok
      ? {
          ...result,
          metadata: { ...result.metadata, storageKey: "automerge:current" },
        }
      : result;
  });
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
    operationHistoryStore: history,
  });
  const before = await service.getCurrentDocumentSnapshot();
  // The operation journal survives a crash after acceptance but before the
  // repository write. Keep the stored base intact to model that boundary.
  vi.spyOn(repository, "mutate").mockResolvedValueOnce({
    ok: false,
    status: {
      kind: "failed",
      documentId: "doc_workspace",
      diagnostic: { reasonCode: "write-failed", message: "Interrupted write" },
    },
  });
  const renamed = await service.renameBody({
    baseRevisionId: before.document.revisionId,
    bodyId: "body_part-1",
    bodyLabel: "Recovered local edit",
  });
  expect(renamed.isOk()).toBe(true);
  expect(history.load()).toMatchObject({
    ok: true,
    payload: {
      baseRepositoryHeads: before.provenance!.repositoryHeads,
      baseRepositoryStorageKey: "automerge:current",
      entries: [{ kind: "renameBody" }],
    },
  });
  service.dispose();
  const recovered = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
    operationHistoryStore: history,
  });
  try {
    const snapshot = await recovered.getCurrentDocumentSnapshot();
    expect(
      snapshot.document.bodies.find((body) => body.bodyId === "body_part-1")
        ?.label,
    ).toBe("Recovered local edit");
    expect((await recovered.getHistoryRestoreState()).entriesReplayed).toBe(1);
    expect(history.load()).toEqual({ ok: true, payload: null });
  } finally {
    recovered.dispose();
  }
});

async function crashAfterEditAccepted(
  service: ReturnType<typeof createModelingService>,
  repository: MemoryDocumentRepository,
  bodyLabel: string,
) {
  const before = await service.getCurrentDocumentSnapshot();
  // The journal survives a crash after acceptance but before the repository
  // write; a failed write keeps the stored basis intact at that boundary.
  vi.spyOn(repository, "mutate").mockResolvedValueOnce({
    ok: false,
    status: {
      kind: "failed",
      documentId: "doc_workspace",
      diagnostic: { reasonCode: "write-failed", message: "Interrupted write" },
    },
  });
  const renamed = await service.renameBody({
    baseRevisionId: before.document.revisionId,
    bodyId: "body_part-1",
    bodyLabel,
  });
  expect(renamed.isOk()).toBe(true);
  await service.waitForPersistence();
  service.dispose();
}

it.each([
  ["this tab's Undo", "Recovered after undo", 1],
  ["a peer's change", "Recovered after peer", 0],
] as const)(
  "after %s, a crash tail replays only over a basis this tab adopted itself",
  async (step, bodyLabel, entriesReplayed) => {
    const repository = new MemoryDocumentRepository();
    const history = createMemoryOperationHistoryStore();
    const options = {
      currentDocumentId: "doc_workspace" as const,
      documentRepository: repository,
      operationHistoryStore: history,
      // The workbench's mode: the journal is trimmed after each stored write.
      documentRepositoryPersistence: "background" as const,
    };
    const service = createModelingService(new MockKernelAdapter(), options);
    const initial = await service.getCurrentDocumentSnapshot();
    const renamed = await service.renameBody({
      baseRevisionId: initial.document.revisionId,
      bodyId: "body_part-1",
      bodyLabel: "Saved edit",
    });
    expect(renamed.isOk()).toBe(true);
    await service.waitForPersistence();
    if (step === "this tab's Undo") {
      expect((await repository.undoDurableHistory("doc_workspace"))?.ok).toBe(
        true,
      );
    } else {
      const stored = createAuthoredModelDocumentFromSnapshot(
        await service.getCurrentDocumentSnapshot(),
      );
      const peer = await repository.receivePeerDocument(
        { ...stored, name: "Peer rename" },
        stored,
      );
      expect(peer.ok).toBe(true);
    }
    await service.getCurrentDocumentSnapshot();
    await crashAfterEditAccepted(service, repository, bodyLabel);
    vi.restoreAllMocks();

    const recovered = createModelingService(new MockKernelAdapter(), options);
    try {
      const label = (
        await recovered.getCurrentDocumentSnapshot()
      ).document.bodies.find((body) => body.bodyId === "body_part-1")?.label;
      expect((await recovered.getHistoryRestoreState()).entriesReplayed).toBe(
        entriesReplayed,
      );
      if (entriesReplayed) expect(label).toBe(bodyLabel);
      else expect(label).not.toBe(bodyLabel);
    } finally {
      recovered.dispose();
    }
  },
);
