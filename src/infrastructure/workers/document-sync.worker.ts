import {
  createIndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
} from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { createDocumentSyncWorkerMessageHandler } from "@/infrastructure/workers/document-sync-worker-runtime";
import {
  createDocumentSyncWorkerDispatcher,
  type DocumentSyncWorkerBootstrapMessage,
} from "@/infrastructure/workers/document-sync-worker-dispatcher";
import type {
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
} from "@/infrastructure/workers/document-sync-worker-protocol";
import { createIndexedDbLocalFileBindingStore } from "@/infrastructure/persistence/local-file-binding-store";
import {
  createIndexedDbMaterializedDocumentStore,
  type MaterializedDocumentEvent,
} from "@/infrastructure/persistence/indexeddb-materialized-document-store";

function reportMaterializedDocumentEvent(event: MaterializedDocumentEvent) {
  // The cache only ever falls back to the Automerge load; a failing cache is
  // a warning for whoever debugs a slow reload, never a document failure.
  if (event.kind === "degraded") console.warn("[materialized-document]", event);
  else console.debug("[materialized-document]", event);
}

interface DocumentSyncWorkerGlobalScope {
  postMessage(message: DocumentSyncWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (
      event: MessageEvent<
        DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest
      >,
    ) => void,
  ): void;
}

const workerScope = globalThis as unknown as DocumentSyncWorkerGlobalScope;
const repositoryUrlStore = new MemoryDocumentRepositoryUrlStore();

function createWorkerMessageHandler(search: string) {
  const workerSearchParams = new URLSearchParams(search);
  const localPeerSyncEnabled =
    workerSearchParams.get("cadLocalPeerSync") === "1";
  const databaseName =
    workerSearchParams.get("cadRepositoryDbName") ?? "cad-authored-documents";
  return createDocumentSyncWorkerMessageHandler(
    {
      repository: createIndexedDbAutomergeDocumentRepository({
        urlStore: repositoryUrlStore,
        databaseName,
        // A dev server's worker is no content-named bundle (its modules
        // change under the same URL), so it never answers from the cache:
        // a record is only trusted by the build that materialized it.
        materializedDocuments: import.meta.env.DEV
          ? undefined
          : {
              store: createIndexedDbMaterializedDocumentStore({
                databaseName: `${databaseName}-materialized-documents`,
              }),
              compatibility: self.location.pathname,
              report: reportMaterializedDocumentEvent,
            },
        localPeerSync: localPeerSyncEnabled
          ? {
              channelName:
                workerSearchParams.get("cadLocalPeerSyncChannel") ?? undefined,
            }
          : false,
      }),
      repositoryUrlStore,
      bindingStore: createIndexedDbLocalFileBindingStore(),
    },
    (message) => workerScope.postMessage(message),
  );
}

const dispatchWorkerMessage = createDocumentSyncWorkerDispatcher(
  createWorkerMessageHandler,
);

workerScope.addEventListener(
  "message",
  (
    event: MessageEvent<
      DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest
    >,
  ) => {
    dispatchWorkerMessage(event.data);
  },
);
