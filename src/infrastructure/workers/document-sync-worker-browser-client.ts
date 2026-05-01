import DocumentSyncWorkerModule from './document-sync.worker.ts?worker'

import { DocumentSyncWorkerClient } from '@/infrastructure/workers/document-sync-worker-client'

export interface BrowserDocumentSyncWorkerClientOptions {
  search?: string
}

type DocumentSyncWorkerBootstrapMessage = {
  kind: 'bootstrap'
  search: string
}

export function createBrowserDocumentSyncWorkerClient(options: BrowserDocumentSyncWorkerClientOptions = {}) {
  const worker = new DocumentSyncWorkerModule()
  const bootstrapMessage: DocumentSyncWorkerBootstrapMessage = {
    kind: 'bootstrap',
    search: options.search ?? '',
  }
  worker.postMessage(bootstrapMessage)

  return new DocumentSyncWorkerClient({
    worker,
  })
}
