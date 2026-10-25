// Logic lane (cadara-8p7o); seam: the modeling service's local save status
// (`getLocalSaveStatus` / `subscribeToLocalSaveStatus`) under the workbench's
// background persistence, over a memory repository and the mock kernel. The
// page-leave guard and the logo save animation read this status.
import { expect, test } from "vitest";

import { createDurableHistoryService } from "@/application/history/durable-history";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import type { DocumentSyncWriteStatus } from "@/domain/modeling/document-sync-worker-protocol";
import type { LocalFileSyncDocumentRepository } from "@/domain/modeling/document-repository";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  createModelingService,
  type ModelingService,
} from "@/domain/modeling/modeling-service";

const documentId = "doc_workspace";
const bodyId = "body_part-1";
const custom: BodyAppearance = { kind: "custom", hex: "#336699" };

function recordSaving(service: ModelingService) {
  const saving: boolean[] = [];
  service.subscribeToLocalSaveStatus(() =>
    saving.push(service.getLocalSaveStatus().saving),
  );
  return saving;
}

async function changeColour(service: ModelingService) {
  const snapshot = await service.getCurrentDocumentSnapshot();
  return service.setBodyAppearance({
    baseRevisionId: snapshot.document.revisionId,
    bodyId,
    appearance: custom,
  });
}

test("an edit is saving from its request through its repository write, then idle", async () => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  try {
    const snapshot = await service.getCurrentDocumentSnapshot();
    let releaseWrite!: () => void;
    const mutate = repository.mutate.bind(repository);
    repository.mutate = async (input) => {
      await new Promise<void>((resolve) => (releaseWrite = resolve));
      return mutate(input);
    };
    const saving = recordSaving(service);

    const set = service.setBodyAppearance({
      baseRevisionId: snapshot.document.revisionId,
      bodyId,
      appearance: custom,
    });
    expect(
      service.getLocalSaveStatus().saving,
      "saving starts with the mutation request",
    ).toBe(true);
    expect((await set).isOk(), "premise: the edit was accepted").toBe(true);
    await expect.poll(() => typeof releaseWrite).toBe("function");
    expect(
      service.getLocalSaveStatus().saving,
      "the accepted edit is still saving while its repository write runs",
    ).toBe(true);

    releaseWrite();
    await service.waitForLocalChanges();
    await expect.poll(() => service.getLocalSaveStatus()).toEqual({
      saving: false,
      failure: null,
    });
    expect(saving, "one saving period, without a gap between kernel and write").toEqual([
      true,
      false,
    ]);
  } finally {
    service.dispose();
  }
});

test("a failed repository write leaves the status with its reason, reported as one failure", async () => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  try {
    await service.getCurrentDocumentSnapshot();
    repository.mutate = () => Promise.reject(new Error("quota exceeded"));
    expect((await changeColour(service)).isOk()).toBe(true);
    await service.waitForPersistence();
    const status = service.getLocalSaveStatus();
    expect(status).toEqual({
      saving: false,
      failure: {
        documentId,
        target: "repository",
        reasonCode: "repository-write-exception",
        message: "quota exceeded",
      },
    });

    await changeColour(service);
    await service.waitForPersistence();
    expect(
      service.getLocalSaveStatus().failure,
      "a later edit that cannot be stored keeps the same failure, so it is reported once",
    ).toBe(status.failure);
  } finally {
    service.dispose();
  }
});

test("a bound local file write is saving until it is written; a failed one is a local-file failure", async () => {
  const fileStatusListeners = new Set<(status: DocumentSyncWriteStatus) => void>();
  const repository = Object.assign(createMemoryDocumentRepository(), {
    bindLocalFile: () => Promise.reject(new Error("unused")),
    restoreLocalFileBinding: async () => null,
    getLocalFileSyncStatus: () => Promise.reject(new Error("unused")),
    subscribeToLocalFileSyncStatus(
      listener: (status: DocumentSyncWriteStatus) => void,
    ) {
      fileStatusListeners.add(listener);
      return () => fileStatusListeners.delete(listener);
    },
  }) satisfies LocalFileSyncDocumentRepository;
  const metadata = {
    documentId,
    fileName: "part.cadara",
    storedAt: "2026-10-25T00:00:00.000Z",
  } as Extract<DocumentSyncWriteStatus, { kind: "syncing" }>["metadata"];
  const emit = (status: DocumentSyncWriteStatus) => {
    for (const listener of fileStatusListeners) listener(status);
  };
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  try {
    emit({ kind: "syncing", documentId: "doc_other", sequence: 1, metadata });
    expect(service.getLocalSaveStatus().saving, "another document's file").toBe(false);
    emit({ kind: "syncing", documentId, sequence: 1, metadata });
    expect(service.getLocalSaveStatus().saving).toBe(true);
    emit({ kind: "failed", documentId, sequence: 2, metadata, message: "disk full" });
    expect(service.getLocalSaveStatus()).toEqual({
      saving: false,
      failure: {
        documentId,
        target: "local-file",
        reasonCode: "local-file-failed",
        message: "disk full",
      },
    });
    emit({ kind: "syncing", documentId, sequence: 3, metadata });
    emit({ kind: "synced", documentId, sequence: 4, metadata });
    expect(service.getLocalSaveStatus()).toEqual({ saving: false, failure: null });
  } finally {
    service.dispose();
  }
  expect(fileStatusListeners.size, "dispose unsubscribes").toBe(0);
});

test("a durable undo is saving until its repository write settles", async () => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  const history = createDurableHistoryService({
    documentRepository: repository,
    modelingService: service,
  });
  try {
    expect((await changeColour(service)).isOk()).toBe(true);
    await service.waitForLocalChanges();
    let releaseUndo!: () => void;
    const undoDurableHistory = repository.undoDurableHistory.bind(repository);
    repository.undoDurableHistory = async (...args) => {
      await new Promise<void>((resolve) => (releaseUndo = resolve));
      return undoDurableHistory(...args);
    };

    const undo = history.undo({ documentId });
    await expect.poll(() => typeof releaseUndo).toBe("function");
    expect(service.getLocalSaveStatus().saving, "the undo write is a local save").toBe(true);
    releaseUndo();
    expect((await undo)?.compensation?.kind).toBe("committed");
    expect(service.getLocalSaveStatus()).toEqual({ saving: false, failure: null });
  } finally {
    service.dispose();
  }
});

test("downloading a copy writes nothing and is not saving", async () => {
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: createMemoryDocumentRepository(),
    documentRepositoryPersistence: "background",
  });
  try {
    await service.getCurrentDocumentSnapshot();
    const saving = recordSaving(service);
    const exported = service.exportCurrentDocument();
    expect(service.getLocalSaveStatus().saving).toBe(false);
    expect(await exported, "premise: the copy was exported").toBeTruthy();
    expect(saving).toEqual([]);
  } finally {
    service.dispose();
  }
});
