import { expect, test, vi } from "vitest";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { OccCleanupError } from "@/infrastructure/occ/memory";
import { noopPerformanceTelemetry } from "@/contracts/performance/telemetry";
import { createInstrumentedModelingService } from "./instrumented-service";
import { createSeedAuthoredModelDocument } from "@/domain/modeling/modeling-test-fixtures";
import { createModelingService } from "./service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class PausedRepository extends MemoryDocumentRepository {
  readonly gate = deferred();
  override async load(input: Parameters<MemoryDocumentRepository["load"]>[0]) {
    await this.gate.promise;
    return super.load(input);
  }
}

class PausedSnapshotAdapter extends MockKernelAdapter {
  paused = false;
  readonly gate = deferred();
  override async getDocumentSnapshot(
    input: Parameters<MockKernelAdapter["getDocumentSnapshot"]>[0],
  ) {
    if (this.paused) await this.gate.promise;
    return super.getDocumentSnapshot(input);
  }
}

test("restore then snapshot publish honest phases, with immediate late replay through instrumentation", async () => {
  const repository = new PausedRepository();
  const adapter = new PausedSnapshotAdapter();
  const service = createInstrumentedModelingService(
    createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
      documentRepository: repository,
    }),
    noopPerformanceTelemetry,
  );
  const phases: string[] = [];
  const stop = service.initialLoadingStatus.subscribe(() =>
    phases.push(service.initialLoadingStatus.getSnapshot()),
  );
  const restore = service.getHistoryRestoreState();
  expect(phases).toEqual(["opening-document"]);
  repository.gate.resolve();
  await restore;
  adapter.paused = true;
  const snapshot = service.getCurrentDocumentSnapshot();
  expect(phases).toEqual(["opening-document", "preparing-geometry"]);
  adapter.gate.resolve();
  await snapshot;
  expect(phases).toEqual(["opening-document", "preparing-geometry", "ready"]);
  const late: string[] = [];
  const stopLate = service.initialLoadingStatus.subscribe(() =>
    late.push(service.initialLoadingStatus.getSnapshot()),
  );
  expect(late).toEqual(["ready"]);
  stop();
  stopLate();
  service.dispose();
});

test("snapshot failure terminates loading without swallowing the original error", async () => {
  const adapter = new MockKernelAdapter();
  const error = new Error("geometry failed");
  adapter.getDocumentSnapshot = async () => {
    throw error;
  };
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  expect(service.initialLoadingStatus.getSnapshot()).toBe("preparing-geometry");
  await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(error);
  expect(service.initialLoadingStatus.getSnapshot()).toBe("failed");
  service.dispose();
});

test.each(["snapshot", "cleanup"] as const)(
  "%s failure during seed initialization rejects reads and retains disposal ownership",
  async (kind) => {
    const original = new Error("seed snapshot initialization failed");
    const retry = vi.fn();
    const error =
      kind === "cleanup" ? new OccCleanupError([original], retry) : original;
    class FailingSeedAdapter extends MockKernelAdapter {
      // The adapter owns cleanup retries, as in OpenCascadeKernelAdapter.
      dispose = vi.fn(() => {
        if (error instanceof OccCleanupError) error.retry();
      });
    }
    const adapter = new FailingSeedAdapter();
    const snapshot = vi.spyOn(adapter, "getDocumentSnapshot");
    snapshot.mockRejectedValueOnce(error);
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
      documentRepository: new MemoryDocumentRepository(),
    });
    try {
      await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(error);
      expect(service.initialLoadingStatus.getSnapshot()).toBe("failed");
      // Initialization must not silently recover on a later read either.
      await expect(service.getHistoryRestoreState()).rejects.toBe(error);
      await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(error);
      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(adapter.dispose).not.toHaveBeenCalled();
      if (error instanceof OccCleanupError) {
        expect(error.errors).toEqual([original]);
      }
    } finally {
      service.dispose();
    }
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(kind === "cleanup" ? 1 : 0);
  },
);

test("disposal during failed initialization still drains adapter-owned cleanup", async () => {
  const gate = deferred();
  const retry = vi.fn();
  const error = new OccCleanupError([new Error("seed cleanup failed")], retry);
  class PausedFailingAdapter extends MockKernelAdapter {
    dispose = vi.fn(() => error.retry());
  }
  const adapter = new PausedFailingAdapter();
  vi.spyOn(adapter, "getDocumentSnapshot").mockImplementationOnce(async () => {
    await gate.promise;
    throw error;
  });
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const rejected = expect(service.getHistoryRestoreState()).rejects.toBe(error);
  service.dispose();
  expect(adapter.dispose).not.toHaveBeenCalled();
  gate.resolve();
  await rejected;
  expect(adapter.dispose).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
});

test("a disposed old tab cannot update listeners or the new tab while its snapshot settles", async () => {
  const adapter = new PausedSnapshotAdapter();
  const old = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const active = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
  });
  const seen: string[] = [];
  old.initialLoadingStatus.subscribe(() =>
    seen.push(old.initialLoadingStatus.getSnapshot()),
  );
  await old.getHistoryRestoreState();
  adapter.paused = true;
  const pending = old.getCurrentDocumentSnapshot();
  old.dispose();
  await active.getCurrentDocumentSnapshot();
  adapter.gate.resolve();
  await pending;
  expect(seen).toEqual(["preparing-geometry"]);
  expect(active.initialLoadingStatus.getSnapshot()).toBe("ready");
  active.dispose();
});

test("repository restore failure stays failed even if a fallback snapshot can be read", async () => {
  const repository = new MemoryDocumentRepository();
  repository.load = async ({ documentId }) => ({
    ok: false,
    status: {
      kind: "failed",
      documentId,
      diagnostic: {
        reasonCode: "write-failed",
        message: "storage unavailable",
      },
    },
  });
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  await service.getCurrentDocumentSnapshot();
  expect(service.initialLoadingStatus.getSnapshot()).toBe("failed");
  expect((await service.getHistoryRestoreState()).kind).toBe("failed");
  service.dispose();
});

test("a restored document's feature rebuild reports measured progress under preparing geometry (cadara-ku5k)", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const step = (completed: number) => ({
    stage: "rebuilding-features" as const,
    completed,
    total: 2,
    label: completed < 2 ? `Extrude ${completed + 1}` : null,
  });
  class ReportingAdapter extends MockKernelAdapter {
    readonly gate = deferred();
    override async restoreAuthoredModelDocument(
      ...[document, diagnostics, resolver, options]: Parameters<MockKernelAdapter["restoreAuthoredModelDocument"]>
    ) {
      options?.onProgress?.(step(0));
      options?.onProgress?.(step(1));
      await this.gate.promise;
      options?.onProgress?.(step(2));
      return super.restoreAuthoredModelDocument(document, diagnostics, resolver, options);
    }
  }
  const adapter = new ReportingAdapter();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: new MemoryDocumentRepository([seed]),
  });
  const seen: unknown[] = [];
  const stop = service.initialLoadingStatus.subscribe(() =>
    seen.push([
      service.initialLoadingStatus.getSnapshot(),
      service.initialLoadingStatus.getProgress(),
    ]),
  );
  const restore = service.getHistoryRestoreState();
  await vi.waitFor(() =>
    expect(service.initialLoadingStatus.getProgress()).toEqual(step(1)),
  );
  // A tab mounting now reads the retained progress immediately.
  expect(service.initialLoadingStatus.getSnapshot()).toBe("preparing-geometry");
  adapter.gate.resolve();
  await restore;
  await service.getCurrentDocumentSnapshot();
  stop();
  expect(seen).toEqual([
    ["opening-document", null],
    ["preparing-geometry", null],
    ["preparing-geometry", step(0)],
    ["preparing-geometry", step(1)],
    ["preparing-geometry", step(2)],
    // Snapshot preparation has no measured total.
    ["preparing-geometry", null],
    ["ready", null],
  ]);
  service.dispose();
});
