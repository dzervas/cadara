import type { DocumentSyncWorkerRequest } from "@/domain/modeling/document-sync-worker-protocol";
import {
  DocumentSyncWorkerClient,
  type DocumentSyncWorkerLike,
} from "@/infrastructure/workers/document-sync-worker-client";

export interface BrowserDocumentSyncWorkerClientOptions {
  search?: string;
  createWorker?: () => BrowserDocumentSyncWorkerLike;
  sessionStorage?: Pick<Storage, "getItem" | "setItem"> | null;
}

type DocumentSyncWorkerBootstrapMessage = {
  kind: "bootstrap";
  search: string;
};

type BrowserDocumentSyncWorkerLike = DocumentSyncWorkerLike & {
  postMessage(
    message: DocumentSyncWorkerRequest | DocumentSyncWorkerBootstrapMessage,
  ): void;
};

export function createBrowserDocumentSyncWorkerClient(
  options: BrowserDocumentSyncWorkerClientOptions = {},
) {
  const worker = options.createWorker?.() ?? createDefaultWorker();
  const bootstrapMessage: DocumentSyncWorkerBootstrapMessage = {
    kind: "bootstrap",
    search: createWorkerBootstrapSearch(
      options.search ?? "",
      options.sessionStorage ?? getDefaultSessionStorage(),
    ),
  };
  worker.postMessage(bootstrapMessage);

  return new DocumentSyncWorkerClient({
    worker,
  });
}

function createDefaultWorker(): BrowserDocumentSyncWorkerLike {
  return new Worker(new URL("./document-sync.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as BrowserDocumentSyncWorkerLike;
}

const LOCAL_HISTORY_SCOPE_SEARCH_PARAM = "cadLocalHistoryScope";
const LOCAL_HISTORY_SCOPE_STORAGE_KEY =
  "cad.documentRepository.localHistoryScope.v1";

function createWorkerBootstrapSearch(
  search: string,
  sessionStorage: Pick<Storage, "getItem" | "setItem"> | null,
) {
  const params = new URLSearchParams(search);
  if (params.has(LOCAL_HISTORY_SCOPE_SEARCH_PARAM) || !sessionStorage) {
    return params.size === 0 ? "" : `?${params.toString()}`;
  }

  const scope = getOrCreateLocalHistoryScope(sessionStorage);
  params.set(LOCAL_HISTORY_SCOPE_SEARCH_PARAM, scope);
  return `?${params.toString()}`;
}

function getOrCreateLocalHistoryScope(
  sessionStorage: Pick<Storage, "getItem" | "setItem">,
) {
  const existing = sessionStorage.getItem(LOCAL_HISTORY_SCOPE_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const scope =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `scope_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  sessionStorage.setItem(LOCAL_HISTORY_SCOPE_STORAGE_KEY, scope);
  return scope;
}

function getDefaultSessionStorage() {
  return typeof globalThis.sessionStorage?.getItem === "function" &&
    typeof globalThis.sessionStorage?.setItem === "function"
    ? globalThis.sessionStorage
    : null;
}
