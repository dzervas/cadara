import {
  createIndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
} from '@/infrastructure/persistence/indexeddb-automerge-document-repository'
import { createDocumentSyncWorkerMessageHandler } from '@/infrastructure/workers/document-sync-worker-runtime'
import type { DocumentSyncWorkerRequest, DocumentSyncWorkerResponse } from '@/domain/modeling/document-sync-worker-protocol'
import { createIndexedDbLocalFileBindingStore } from '@/domain/modeling/local-file-binding-store'

type DocumentSyncWorkerBootstrapMessage = {
  kind: 'bootstrap'
  search: string
}

interface DocumentSyncWorkerGlobalScope {
  postMessage(message: DocumentSyncWorkerResponse): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest>) => void,
  ): void
}

const workerScope = globalThis as unknown as DocumentSyncWorkerGlobalScope
const repositoryUrlStore = new MemoryDocumentRepositoryUrlStore()
let handleMessage: ReturnType<typeof createDocumentSyncWorkerMessageHandler> | null = null

function isBootstrapMessage(message: DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest): message is DocumentSyncWorkerBootstrapMessage {
  return message.kind === 'bootstrap'
}

function createWorkerMessageHandler(search: string) {
  const workerSearchParams = new URLSearchParams(search)
  const localPeerSyncEnabled = workerSearchParams.get('cadLocalPeerSync') === '1'
  return createDocumentSyncWorkerMessageHandler(
    {
      repository: createIndexedDbAutomergeDocumentRepository({
        urlStore: repositoryUrlStore,
        databaseName: workerSearchParams.get('cadRepositoryDbName') ?? undefined,
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

workerScope.addEventListener('message', (event: MessageEvent<DocumentSyncWorkerBootstrapMessage | DocumentSyncWorkerRequest>) => {
  if (isBootstrapMessage(event.data)) {
    handleMessage = createWorkerMessageHandler(event.data.search)
    return
  }

  const activeHandleMessage = handleMessage ?? createWorkerMessageHandler('')
  handleMessage = activeHandleMessage
  void activeHandleMessage(event.data)
})
