import { expect, test, vi } from "vitest";

import type { DocumentId } from "@/contracts/shared/ids";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import type { GetDocumentSnapshotRequest } from "@/contracts/modeling/schema";
import { createDurableHistoryService } from "@/application/history/durable-history";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createSeedAuthoredModelDocument } from "@/domain/modeling/modeling-test-fixtures";
import { WorkbenchModelingServices } from "./workbench-modeling-services";

class CountingAdapter extends MockKernelAdapter {
  restoreCalls = 0;
  disposeCalls = 0;

  // The shared mock fixture uses doc_workspace internally; expose each tab's
  // identity at the read boundary. Mutating/history rows exercise doc_workspace.
  async getDocumentSnapshot(request: GetDocumentSnapshotRequest) {
    const result = await super.getDocumentSnapshot({
      ...request,
      documentId: "doc_workspace",
    });
    result.snapshot.document.documentId = request.documentId;
    return result;
  }

  async restoreAuthoredModelDocument(
    ...args: Parameters<MockKernelAdapter["restoreAuthoredModelDocument"]>
  ) {
    this.restoreCalls += 1;
    await super.restoreAuthoredModelDocument(...args);
  }

  dispose() {
    this.disposeCalls += 1;
  }
}

async function createTabsFixture() {
  const seed = await createSeedAuthoredModelDocument();
  const second = {
    ...structuredClone(seed),
    documentId: "doc_second" as DocumentId,
  };
  const repository = createMemoryDocumentRepository([seed, second]);
  const adapters: CountingAdapter[] = [];
  const release = vi.fn(async (_documentId: DocumentId) => {});
  const services = new WorkbenchModelingServices((documentId) => {
    const adapter = new CountingAdapter();
    adapters.push(adapter);
    return createModelingService(adapter, {
      currentDocumentId: documentId,
      documentRepository: repository,
      documentRepositoryPersistence: "background",
    });
  }, release);
  async function activate(documentId: DocumentId) {
    return services.get(documentId).getCurrentDocumentSnapshot();
  }
  return { services, repository, adapters, release, activate };
}

test("warm re-activation of an unchanged open document performs no native restore or owner growth", async () => {
  const f = await createTabsFixture();
  try {
    await f.activate("doc_workspace");
    await f.activate("doc_second");
    expect(f.adapters.map((adapter) => adapter.restoreCalls)).toEqual([1, 1]);
    for (let i = 0; i < 20; i++) {
      const documentId = i % 2 === 0 ? "doc_workspace" : "doc_second";
      const snapshot = await f.activate(documentId);
      expect(snapshot.document.documentId).toBe(documentId);
      await f.services.retainOpenDocuments(["doc_workspace", "doc_second"]);
    }
    expect(
      f.adapters.reduce((sum, adapter) => sum + adapter.restoreCalls, 0),
    ).toBe(2);
    expect(f.adapters).toHaveLength(2);
    expect(f.adapters.map((adapter) => adapter.restoreCalls)).toEqual([1, 1]);
    expect(f.adapters.map((adapter) => adapter.disposeCalls)).toEqual([0, 0]);
    expect(f.release).not.toHaveBeenCalled();
    await f.services.retainOpenDocuments(["doc_second"]);
    expect(f.adapters[0]!.disposeCalls).toBe(1);
    expect(f.release).toHaveBeenCalledExactlyOnceWith("doc_workspace");
    await f.services.retainOpenDocuments(["doc_second"]);
    expect(f.release).toHaveBeenCalledTimes(1);
    const reopened = await f.activate("doc_workspace");
    expect(reopened.document.documentId).toBe("doc_workspace");
    expect(f.adapters).toHaveLength(3);
    expect(f.adapters[2]!.restoreCalls).toBe(1);
  } finally {
    f.services.dispose();
  }
  expect(f.adapters.map((adapter) => adapter.disposeCalls)).toEqual([1, 1, 1]);
  // Host replacement is not tab close and must not release another host's worker state.
  expect(f.release).toHaveBeenCalledTimes(1);
});

test("inactive cached documents apply peer invalidation before re-activation", async () => {
  const f = await createTabsFixture();
  try {
    const initial = await f.activate("doc_workspace");
    await f.activate("doc_second");
    const expected = createAuthoredModelDocumentFromSnapshot(initial);
    const peer = structuredClone(expected);
    peer.revisionId = "rev_9999";
    peer.bodyLabels[0]!.label = "Peer body while inactive";
    const result = await f.repository.receivePeerDocument(peer, expected);
    expect(result.ok).toBe(true);
    const refreshed = await f.activate("doc_workspace");
    expect(refreshed.document.bodies[0]!.label).toBe(
      "Peer body while inactive",
    );
    expect(refreshed.document.revisionId).toBe("rev_9999");
    expect(f.adapters).toHaveLength(2);
    expect(f.adapters[0]!.restoreCalls).toBe(2);
    await f.activate("doc_second");
    await f.activate("doc_workspace");
    expect(f.adapters[0]!.restoreCalls).toBe(2);
  } finally {
    f.services.dispose();
  }
});

test("edits and durable undo/redo preserve the history cursor after switching", async () => {
  const f = await createTabsFixture();
  try {
    const initial = await f.activate("doc_workspace");
    const service = f.services.get("doc_workspace");
    const history = createDurableHistoryService({
      documentRepository: f.repository,
      modelingService: service,
    });
    const cursor = { kind: "feature", featureId: "feature_extrude-1" } as const;
    const changed = await service.setFeatureCursor({
      baseRevisionId: initial.document.revisionId,
      cursor,
    });
    expect(changed.isOk()).toBe(true);
    await service.waitForPersistence();
    const positioned = await f.activate("doc_workspace");
    const variable = await service.addDocumentVariable({
      baseRevisionId: positioned.document.revisionId,
      name: "Width",
      valueText: "25",
    });
    expect(variable.isOk()).toBe(true);
    await service.waitForPersistence();
    const edited = await f.activate("doc_workspace");
    expect(edited.document.cursor).toEqual(cursor);
    await f.activate("doc_second");
    const reactivated = await f.activate("doc_workspace");
    expect(reactivated.document.revisionId).toBe(edited.document.revisionId);
    expect(reactivated.document.cursor).toEqual(cursor);
    expect(f.adapters[0]!.restoreCalls).toBe(1);
    const undone = await history.undo({ documentId: "doc_workspace" });
    expect(undone?.context).toBe("document");
    const afterUndo = await f.activate("doc_workspace");
    expect(
      afterUndo.document.variables.some((entry) => entry.name === "Width"),
    ).toBe(false);
    expect(afterUndo.document.cursor).toEqual(cursor);
    await f.activate("doc_second");
    await f.activate("doc_workspace");
    const redone = await history.redo({ documentId: "doc_workspace" });
    expect(redone?.context).toBe("document");
    const afterRedo = await f.activate("doc_workspace");
    expect(
      afterRedo.document.variables.find((entry) => entry.name === "Width")
        ?.valueText,
    ).toBe("25");
    expect(afterRedo.document.cursor).toEqual(cursor);
    expect(
      (await history.getAvailability({ documentId: "doc_workspace" })).canUndo,
    ).toBe(true);
  } finally {
    f.services.dispose();
  }
});

test("close waits for initialization before releasing native state", async () => {
  let releaseLoad!: () => void;
  const loading = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const seed = await createSeedAuthoredModelDocument();
  const repository = createMemoryDocumentRepository([seed]);
  const load = repository.load.bind(repository);
  repository.load = async (input) => {
    await loading;
    return load(input);
  };
  const adapter = new CountingAdapter();
  const release = vi.fn(async () => {
    expect(adapter.disposeCalls).toBe(1);
  });
  const services = new WorkbenchModelingServices(
    (documentId) =>
      createModelingService(adapter, {
        currentDocumentId: documentId,
        documentRepository: repository,
      }),
    release,
  );
  const ready = services.get("doc_workspace").getHistoryRestoreState();
  const closed = services.retainOpenDocuments([]);
  expect(release).not.toHaveBeenCalled();
  releaseLoad();
  await ready;
  await closed;
  expect(adapter.restoreCalls).toBe(1);
  expect(release).toHaveBeenCalledTimes(1);
  services.dispose();
});
