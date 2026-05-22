import { test, expect } from "vitest";

import type {
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
} from "@/domain/modeling/document-sync-worker-protocol";
import { createBrowserDocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-browser-client";
import type { DocumentSyncWorkerLike } from "@/infrastructure/workers/document-sync-worker-client";

test("createBrowserDocumentSyncWorkerClient bootstraps the worker search string and owns worker lifecycle through the exported seam", async () => {
  const worker = new FakeBrowserWorker();
  const client = createBrowserDocumentSyncWorkerClient({
    search: "?document=abc",
    createWorker: () => worker,
  });

  expect(
    worker.bootstrapMessages.length === 1 &&
      worker.bootstrapMessages[0]?.search === "?document=abc",
    "The browser worker client should bootstrap the worker with the requested location search string.",
  ).toBeTruthy();

  const statusPromise = client.getWriteStatus({
    documentId: "document_browser_worker" as DocumentSyncWorkerRequest extends {
      kind: "getWriteStatus";
      documentId: infer T;
    }
      ? T
      : never,
  });
  const request = worker.postedRequests[0];
  expect(
    request?.kind,
    "The returned client should be wired to the created worker instance.",
  ).toBe("getWriteStatus");
  worker.emit({
    kind: "writeStatus",
    requestId: request.requestId,
    status: {
      kind: "idle",
      documentId: request.documentId,
      sequence: 0,
    },
  });

  const status = await statusPromise;
  expect(
    status.kind,
    "The browser client seam should proxy worker responses through the returned DocumentSyncWorkerClient.",
  ).toBe("idle");

  client.dispose();
  expect(
    worker.terminated,
    "Disposing the browser client should terminate the owned worker instance.",
  ).toBeTruthy();
});

test("createBrowserDocumentSyncWorkerClient defaults bootstrap search to an empty string", () => {
  const worker = new FakeBrowserWorker();

  createBrowserDocumentSyncWorkerClient({
    createWorker: () => worker,
  }).dispose();

  expect(
    worker.bootstrapMessages[0]?.search,
    "Browser worker bootstrap should default the search string when none is provided.",
  ).toBe("");
});

test("createBrowserDocumentSyncWorkerClient appends a session scoped local-history key for the worker bootstrap", () => {
  const worker = new FakeBrowserWorker();
  const sessionStorage = createMemorySessionStorage();

  createBrowserDocumentSyncWorkerClient({
    search: "?document=abc",
    createWorker: () => worker,
    sessionStorage,
  }).dispose();

  const firstSearch = worker.bootstrapMessages[0]?.search ?? "";
  const firstScope = new URLSearchParams(firstSearch).get(
    "cadLocalHistoryScope",
  );
  expect(
    firstScope !== null &&
      new URLSearchParams(firstSearch).get("document") === "abc",
    "Browser worker bootstrap should preserve the provided search and append a stable local-history scope.",
  ).toBeTruthy();

  const secondWorker = new FakeBrowserWorker();
  createBrowserDocumentSyncWorkerClient({
    search: "?document=xyz",
    createWorker: () => secondWorker,
    sessionStorage,
  }).dispose();

  expect(
    new URLSearchParams(secondWorker.bootstrapMessages[0]?.search ?? "").get(
      "cadLocalHistoryScope",
    ),
    "Browser worker bootstrap should reuse the same session scoped local-history key across refreshes in one tab.",
  ).toBe(firstScope);
});

class FakeBrowserWorker implements DocumentSyncWorkerLike {
  readonly postedRequests: Extract<
    DocumentSyncWorkerRequest,
    { kind: "getWriteStatus" }
  >[] = [];
  readonly bootstrapMessages: { kind: "bootstrap"; search: string }[] = [];
  terminated = false;
  private listener:
    | ((event: MessageEvent<DocumentSyncWorkerResponse>) => void)
    | null = null;

  postMessage(
    message: DocumentSyncWorkerRequest | { kind: "bootstrap"; search: string },
  ) {
    if (message.kind === "bootstrap") {
      this.bootstrapMessages.push(message);
      return;
    }

    if (message.kind === "getWriteStatus") {
      this.postedRequests.push(message);
      return;
    }

    throw new Error(`Unexpected worker request ${message.kind}.`);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void,
  ) {
    this.listener = listener;
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void,
  ) {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: DocumentSyncWorkerResponse) {
    this.listener?.({
      data: message,
    } as MessageEvent<DocumentSyncWorkerResponse>);
  }
}

function createMemorySessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
