import {
  createIndexedDbAutomergeDocumentRepository,
  MemoryDocumentRepositoryUrlStore,
} from '@/domain/modeling/automerge-indexeddb-document-repository'
import { createDocumentSyncWorkerMessageHandler } from '@/domain/modeling/document-sync-worker-runtime'
import type { DocumentSyncWorkerRequest, DocumentSyncWorkerResponse } from '@/domain/modeling/document-sync-worker-protocol'
import { createIndexedDbLocalFileBindingStore } from '@/domain/modeling/local-file-binding-store'

interface DocumentSyncWorkerGlobalScope {
  postMessage(message: DocumentSyncWorkerResponse): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DocumentSyncWorkerRequest>) => void): void
}

const workerScope = globalThis as unknown as DocumentSyncWorkerGlobalScope
const repositoryUrlStore = new MemoryDocumentRepositoryUrlStore()
const handleMessage = createDocumentSyncWorkerMessageHandler(
  {
    repository: createIndexedDbAutomergeDocumentRepository({ urlStore: repositoryUrlStore }),
    repositoryUrlStore,
    bindingStore: createIndexedDbLocalFileBindingStore(),
  },
  (message) => workerScope.postMessage(message),
)

workerScope.addEventListener('message', (event: MessageEvent<DocumentSyncWorkerRequest>) => {
  void handleMessage(event.data)
})
