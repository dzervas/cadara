import type { DocumentSyncWorkerRequest } from '@/domain/modeling/document-sync-worker-protocol'
import { DocumentSyncWorkerClient, type DocumentSyncWorkerLike } from '@/infrastructure/workers/document-sync-worker-client'

export interface BrowserDocumentSyncWorkerClientOptions {
  search?: string
  createWorker?: () => BrowserDocumentSyncWorkerLike
}

type DocumentSyncWorkerBootstrapMessage = {
  kind: 'bootstrap'
  search: string
}

type BrowserDocumentSyncWorkerLike = DocumentSyncWorkerLike & {
  postMessage(message: DocumentSyncWorkerRequest | DocumentSyncWorkerBootstrapMessage): void
}

export function createBrowserDocumentSyncWorkerClient(options: BrowserDocumentSyncWorkerClientOptions = {}) {
  const worker = options.createWorker?.() ?? createDefaultWorker()
  const bootstrapMessage: DocumentSyncWorkerBootstrapMessage = {
    kind: 'bootstrap',
    search: options.search ?? '',
  }
  worker.postMessage(bootstrapMessage)

  return new DocumentSyncWorkerClient({
    worker,
  })
}

function createDefaultWorker(): BrowserDocumentSyncWorkerLike {
  return new Worker(new URL('./document-sync.worker.ts', import.meta.url), { type: 'module' }) as unknown as BrowserDocumentSyncWorkerLike
}
