import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DocumentId } from "@/contracts/shared/ids";
import { createSeedAuthoredModelDocument } from "@/domain/modeling/modeling-test-fixtures";
import type { OccWorkerRequest, OccWorkerResponse } from "./worker-protocol";

const mainThreadFactory = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Warmup must not initialize a main-thread kernel.");
  }),
);
vi.mock("@/infrastructure/occ/runtime", () => ({
  loadDefaultOpenCascadeFactory: mainThreadFactory,
  getOpenCascadeInstance: mainThreadFactory,
}));

async function createDocument(documentId: DocumentId) {
  return { ...(await createSeedAuthoredModelDocument()), documentId };
}

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  readonly posted: OccWorkerRequest[] = [];
  constructor(..._args: unknown[]) {
    super();
    FakeWorker.instances.push(this);
  }
  postMessage(request: OccWorkerRequest) {
    this.posted.push(request);
  }
  terminate() {}
  emit(response: OccWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }
  settleInvocations(error?: string) {
    for (const request of this.posted.splice(0)) {
      if (
        request.kind !== "invoke" ||
        (request.operation.kind !== "warmup" &&
          request.operation.kind !== "restoreAuthoredModelDocument")
      ) {
        throw new Error(
          "Expected a kernel warmup or document restore request.",
        );
      }
      this.emit(
        error
          ? {
              kind: "failure",
              requestId: request.requestId,
              error: {
                code: "occ-worker-initialization-failed",
                message: error,
              },
            }
          : {
              kind: "invoked",
              requestId: request.requestId,
              operation: request.operation.kind,
            },
      );
    }
  }
}

beforeEach(() => {
  vi.resetModules();
  mainThreadFactory.mockClear();
  FakeWorker.instances = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

// Cross-layer logic seam: real browser composition, adapters, instrumentation,
// and client; only the browser transport and native factory are substituted.
test("startup returns pending work immediately and repeated observers share it before and after settlement", async () => {
  const runtime = await import("@/infrastructure/occ/browser-kernel-runtime");
  const startup = runtime.startBrowserOccWarmup();
  expect(startup).toBeInstanceOf(Promise);
  expect(runtime.startBrowserOccWarmup()).toBe(startup);
  expect(runtime.startBrowserOccWarmup()).toBe(startup);
  expect(FakeWorker.instances).toHaveLength(1);
  const worker = FakeWorker.instances[0]!;
  expect(worker.posted).toHaveLength(1);
  expect(window.__cadOccPerf?.warmupStatus).toBe("pending");
  let settled = false;
  void startup!.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  worker.settleInvocations();
  await startup;
  expect(runtime.startBrowserOccWarmup()).toBe(startup);
  expect(worker.posted).toHaveLength(0);
  expect(window.__cadOccPerf?.warmupStatus).toBe("fulfilled");
  expect(mainThreadFactory).not.toHaveBeenCalled();
}, 60_000);

test("document adapters opened during and after startup use the same worker without a main-thread kernel", async () => {
  const runtime = await import("@/infrastructure/occ/browser-kernel-runtime");
  const startup = runtime.startBrowserOccWarmup();
  const worker = FakeWorker.instances[0]!;
  const immediate = runtime
    .createBrowserOccKernelAdapter("doc_immediate")
    .restoreAuthoredModelDocument(await createDocument("doc_immediate"));
  expect(FakeWorker.instances).toHaveLength(1);
  await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
  expect(worker.posted[1]).toMatchObject({
    kind: "invoke",
    operation: {
      kind: "restoreAuthoredModelDocument",
      document: { documentId: "doc_immediate" },
    },
  });
  worker.settleInvocations();
  await Promise.all([startup, immediate]);
  const later = runtime
    .createBrowserOccKernelAdapter("doc_later")
    .restoreAuthoredModelDocument(await createDocument("doc_later"));
  expect(FakeWorker.instances).toHaveLength(1);
  await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
  worker.settleInvocations();
  await later;
  expect(mainThreadFactory).not.toHaveBeenCalled();
});

test("failed startup remains observable but does not poison a later document adapter", async () => {
  const runtime = await import("@/infrastructure/occ/browser-kernel-runtime");
  const startup = runtime.startBrowserOccWarmup();
  const rejected = expect(startup).rejects.toThrow("warmup failed");
  FakeWorker.instances[0]!.settleInvocations("warmup failed");
  await rejected;
  expect(window.__cadOccPerf?.warmupStatus).toBe("rejected");
  // A late-mounted observer still receives the original failure, not a silent retry.
  expect(runtime.startBrowserOccWarmup()).toBe(startup);
  await expect(runtime.startBrowserOccWarmup()).rejects.toThrow(
    "warmup failed",
  );
  const later = runtime
    .createBrowserOccKernelAdapter("doc_after_failure")
    .restoreAuthoredModelDocument(await createDocument("doc_after_failure"));
  await vi.waitFor(() =>
    expect(FakeWorker.instances[0]!.posted).toHaveLength(1),
  );
  FakeWorker.instances[0]!.settleInvocations();
  await later;
  expect(FakeWorker.instances).toHaveLength(1);
  expect(mainThreadFactory).not.toHaveBeenCalled();
});

test("SSR starts no worker or warmup and unsupported Worker construction is safe", async () => {
  vi.stubGlobal("window", undefined);
  const runtime = await import("@/infrastructure/occ/browser-kernel-runtime");
  expect(runtime.startBrowserOccWarmup()).toBeNull();
  expect(runtime.getBrowserOccWorkerClient()).toBeNull();
  expect(FakeWorker.instances).toHaveLength(0);
  vi.stubGlobal("Worker", undefined);
  const { createBrowserOccWorkerClient } = await import("./worker-runtime");
  expect(createBrowserOccWorkerClient()).toBeNull();
  expect(mainThreadFactory).not.toHaveBeenCalled();
});

test("fatal startup failure is retained for late notification subscribers and a later adapter uses the replacement", async () => {
  const runtime = await import("@/infrastructure/occ/browser-kernel-runtime");
  const startup = runtime.startBrowserOccWarmup();
  const rejected = expect(startup).rejects.toThrow("OOM");
  FakeWorker.instances[0]!.emit({ kind: "fatal", error: { message: "OOM" } });
  await rejected;
  const report = vi.fn();
  const unsubscribe = runtime.subscribeBrowserOccWorkerFailure(report);
  expect(report).toHaveBeenCalledTimes(1);
  expect(report.mock.calls[0]![0].message).toContain("OOM");
  expect(FakeWorker.instances).toHaveLength(2);
  expect(FakeWorker.instances[1]!.posted).toHaveLength(0);
  const later = runtime
    .createBrowserOccKernelAdapter("doc_after_abort")
    .restoreAuthoredModelDocument(await createDocument("doc_after_abort"));
  await vi.waitFor(() =>
    expect(FakeWorker.instances[1]!.posted).toHaveLength(1),
  );
  FakeWorker.instances[1]!.settleInvocations();
  await later;
  expect(FakeWorker.instances).toHaveLength(2);
  expect(mainThreadFactory).not.toHaveBeenCalled();
  unsubscribe();
});
