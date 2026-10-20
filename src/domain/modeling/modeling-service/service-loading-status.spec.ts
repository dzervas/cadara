import { expect, test } from "vitest";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { noopPerformanceTelemetry } from "@/contracts/performance/telemetry";
import { createInstrumentedModelingService } from "./instrumented-service";
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
