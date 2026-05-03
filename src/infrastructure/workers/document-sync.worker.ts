import {
  createIndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
} from '@/infrastructure/persistence/indexeddb-automerge-document-repository'
import { createDocumentSyncWorkerMessageHandler } from '@/infrastructure/workers/document-sync-worker-runtime'
import {
  createDocumentSyncWorkerDispatcher,
  type DocumentSyncWorkerBootstrapMessage,
} from '@/infrastructure/workers/document-sync-worker-dispatcher'
import type { DocumentSyncWorkerRequest, DocumentSyncWorkerResponse } from '@/domain/modeling/document-sync-worker-protocol'
import { createIndexedDbLocalFileBindingStore } from '@/domain/modeling/local-file-binding-store'

interface DocumentSyncWorkerGlobalScope {
  postMessage(message: DocumentSyncWorkerResponse): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest>) => void,
  ): void
}

const workerScope = globalThis as unknown as DocumentSyncWorkerGlobalScope
const repositoryUrlStore = new MemoryDocumentRepositoryUrlStore()

function createWorkerMessageHandler(search: string) {
  const workerSearchParams = new URLSearchParams(search)
  const localPeerSyncEnabled = workerSearchParams.get('cadLocalPeerSync') === '1'
  return createDocumentSyncWorkerMessageHandler(
    {
      repository: createIndexedDbAutomergeDocumentRepository({
        urlStore: repositoryUrlStore,
        databaseName: workerSearchParams.get('cadRepositoryDbName') ?? undefined,
        historyScope: workerSearchParams.get('cadLocalHistoryScope') ?? undefined,
        localPeerSync: localPeerSyncEnabled
          ? { channelName: workerSearchParams.get('cadLocalPeerSyncChannel') ?? undefined }
          : false,
      }),
      repositoryUrlStore,
      bindingStore: createIndexedDbLocalFileBindingStore(),
    },
    (message) => workerScope.postMessage(message),
  )
}

const dispatchWorkerMessage = createDocumentSyncWorkerDispatcher(createWorkerMessageHandler)

workerScope.addEventListener('message', (event: MessageEvent<DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest>) => {
  dispatchWorkerMessage(event.data)
})
