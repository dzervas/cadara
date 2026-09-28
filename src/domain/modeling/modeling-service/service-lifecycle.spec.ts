import { expect, test, vi } from "vitest";

import type { DocumentRepository } from "@/domain/modeling/document-repository";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "./service";

class CountingAdapter extends MockKernelAdapter {
  disposeCalls = 0;

  override dispose() {
    this.disposeCalls += 1;
  }
}

function countingRepository(beforeLoad: Promise<void> = Promise.resolve()) {
  const inner = createMemoryDocumentRepository();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const repository: DocumentRepository = {
    load: async (input) => {
      await beforeLoad;
      return inner.load(input);
    },
    initialize: (input) => inner.initialize(input),
    mutate: (input) => inner.mutate(input),
    subscribe: (documentId, listener) => {
      subscribeCalls += 1;
      const unsubscribe = inner.subscribe(documentId, listener);
      return () => {
        unsubscribeCalls += 1;
        unsubscribe();
      };
    },
    reset: (documentId) => inner.reset(documentId),
    getRestoreStatus: (documentId) => inner.getRestoreStatus(documentId),
    getMetadata: (documentId) => inner.getMetadata(documentId),
    getDurableHistoryAvailability: (documentId) =>
      inner.getDurableHistoryAvailability(documentId),
    undoDurableHistory: (documentId, sequence) =>
      inner.undoDurableHistory(documentId, sequence),
    redoDurableHistory: (documentId, sequence) =>
      inner.redoDurableHistory(documentId, sequence),
  };
  return {
    repository,
    subscribeCalls: () => subscribeCalls,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

test("discarded render services stay inert while the committed service initializes once", async () => {
  const discardedAdapter = new CountingAdapter();
  const retainedAdapter = new CountingAdapter();
  const discardedRepository = countingRepository();
  const retainedRepository = countingRepository();
  const discarded = createModelingService(discardedAdapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: discardedRepository.repository,
  });
  const retained = createModelingService(retainedAdapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: retainedRepository.repository,
  });

  expect(discardedRepository.subscribeCalls()).toBe(0);
  expect(retainedRepository.subscribeCalls()).toBe(0);

  discarded.dispose();
  const unsubscribe = retained.subscribeToDocumentChanges(() => undefined);
  await retained.getHistoryRestoreState();

  expect(discardedRepository.subscribeCalls()).toBe(0);
  expect(discardedAdapter.disposeCalls).toBe(1);
  expect(retainedRepository.subscribeCalls()).toBe(1);
  expect(retainedAdapter.disposeCalls).toBe(0);

  unsubscribe();
  retained.dispose();
  expect(retainedRepository.unsubscribeCalls()).toBe(1);
  expect(retainedAdapter.disposeCalls).toBe(1);
});

test("disposing during initialization unsubscribes once and never resubscribes", async () => {
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const adapter = new CountingAdapter();
  const counted = countingRepository(loadGate);
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: counted.repository,
  });

  service.subscribeToDocumentChanges(() => undefined);
  expect(counted.subscribeCalls()).toBe(1);
  service.dispose();
  expect(counted.unsubscribeCalls()).toBe(1);

  releaseLoad();
  // The mock bootstrap derives region ids through async SHA-256 (T09 U5), so
  // initialization settles after more than one macrotask; the deferred
  // dispose runs exactly once when it does.
  await vi.waitFor(() => expect(adapter.disposeCalls).toBe(1));
  expect(counted.subscribeCalls()).toBe(1);
  expect(counted.unsubscribeCalls()).toBe(1);
  expect(adapter.disposeCalls).toBe(1);
});

test("independent committed services never share subscription or disposal ownership", async () => {
  const firstAdapter = new CountingAdapter();
  const secondAdapter = new CountingAdapter();
  const firstRepository = countingRepository();
  const secondRepository = countingRepository();
  const first = createModelingService(firstAdapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: firstRepository.repository,
  });
  const second = createModelingService(secondAdapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: secondRepository.repository,
  });

  const unsubscribeFirst = first.subscribeToDocumentChanges(() => undefined);
  const unsubscribeSecond = second.subscribeToDocumentChanges(() => undefined);
  await Promise.all([
    first.getHistoryRestoreState(),
    second.getHistoryRestoreState(),
  ]);
  first.dispose();

  expect(firstRepository.unsubscribeCalls()).toBe(1);
  expect(firstAdapter.disposeCalls).toBe(1);
  expect(secondRepository.unsubscribeCalls()).toBe(0);
  expect(secondAdapter.disposeCalls).toBe(0);
  await expect(second.getCurrentDocumentSnapshot()).resolves.toBeDefined();

  unsubscribeFirst();
  unsubscribeSecond();
  second.dispose();
  expect(secondRepository.unsubscribeCalls()).toBe(1);
  expect(secondAdapter.disposeCalls).toBe(1);
});
