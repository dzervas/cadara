import {
  createIndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
} from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { createDocumentSyncWorkerMessageHandler } from "@/infrastructure/workers/document-sync-worker-runtime";
import {
  createDocumentSyncWorkerDispatcher,
  type DocumentSyncWorkerBootstrapMessage,
} from "@/infrastructure/workers/document-sync-worker-dispatcher";
import {
  isProjectSyncWorkerRequest,
  type DocumentSyncWorkerInbound,
  type DocumentSyncWorkerOutbound,
} from "@/infrastructure/workers/project-sync-worker-protocol";
import { createProjectSyncWorkerHost } from "@/infrastructure/project-sync/project-sync-worker-host";
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
  postMessage(message: DocumentSyncWorkerOutbound): void;
  addEventListener(
    type: "message",
    listener: (
      event: MessageEvent<
        DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerInbound
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
  const repository = createIndexedDbAutomergeDocumentRepository({
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
  });
  const handleDocumentMessage = createDocumentSyncWorkerMessageHandler(
    {
      repository,
      repositoryUrlStore,
      bindingStore: createIndexedDbLocalFileBindingStore(),
    },
    (message) => workerScope.postMessage(message),
  );
  // Project sync joins the same Repo, so remote part changes reach open
  // documents through the repository's peer-change path.
  const projectSync = createProjectSyncWorkerHost({
    getRepo: () => repository.getOwnedAutomergeRepo(),
    postMessage: (message) => workerScope.postMessage(message),
  });
  return (request: DocumentSyncWorkerInbound) =>
    isProjectSyncWorkerRequest(request)
      ? projectSync.handle(request)
      : handleDocumentMessage(request);
}

const dispatchWorkerMessage = createDocumentSyncWorkerDispatcher(
  createWorkerMessageHandler,
);

workerScope.addEventListener(
  "message",
  (
    event: MessageEvent<
      DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerInbound
    >,
  ) => {
    dispatchWorkerMessage(event.data);
  },
);
