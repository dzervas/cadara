import type { RequestId } from '@/contracts/shared/ids'
import type {
  DocumentSyncSubscriptionId,
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
  DocumentSyncWriteStatus,
} from '@/domain/modeling/document-sync-worker-protocol'

export interface DocumentSyncWorkerLike {
  postMessage(message: DocumentSyncWorkerRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void): void
  terminate?(): void
}

export interface BrowserDocumentSyncWorkerClientOptions {
  search?: string
}

type PendingRequest = {
  expectedKind: DocumentSyncWorkerResponse['kind']
  resolve: (value: DocumentSyncWorkerResponse) => void
  reject: (error: Error) => void
}

export class DocumentSyncWorkerClient {
  private readonly worker: DocumentSyncWorkerLike
  private nextRequestSequence = 0
  private nextSubscriptionSequence = 0
  private disposed = false
  private readonly pendingRequests = new Map<RequestId, PendingRequest>()
  private readonly documentListeners = new Map<DocumentSyncSubscriptionId, (event: Extract<DocumentSyncWorkerResponse, { kind: 'documentChanged' }>['event']) => void>()
  private readonly writeStatusListeners = new Set<(status: DocumentSyncWriteStatus) => void>()
  private readonly latestWriteStatusSequences = new Map<string, number>()
  private readonly handleMessage = (event: MessageEvent<DocumentSyncWorkerResponse>) => {
    this.receiveMessage(event.data)
  }

  constructor(options: { worker: DocumentSyncWorkerLike }) {
    this.worker = options.worker
    this.worker.addEventListener('message', this.handleMessage)
  }

  load(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'load' }>, 'kind' | 'requestId'>) {
    return this.request('load', 'loaded', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'loaded' }>).result,
    )
  }

  mutate(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'mutate' }>, 'kind' | 'requestId'>) {
    return this.request('mutate', 'mutated', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'mutated' }>).result,
    )
  }

  getGeometryAssetBytes(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'getGeometryAssetBytes' }>, 'kind' | 'requestId'>) {
    return this.request('getGeometryAssetBytes', 'geometryAssetBytes', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'geometryAssetBytes' }>).bytes,
    )
  }

  getGeometryAssetRecord(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'getGeometryAssetRecord' }>, 'kind' | 'requestId'>) {
    return this.request('getGeometryAssetRecord', 'geometryAssetRecord', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'geometryAssetRecord' }>).bytes,
    )
  }

  reset(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'reset' }>, 'kind' | 'requestId'>) {
    return this.request('reset', 'reset', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'reset' }>).status,
    )
  }

  normalize(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'normalize' }>, 'kind' | 'requestId'>) {
    return this.request('normalize', 'normalized', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'normalized' }>).result,
    )
  }

  restoreBinding(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'restoreBinding' }>, 'kind' | 'requestId'>) {
    return this.request('restoreBinding', 'bindingRestored', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'bindingRestored' }>).record,
    )
  }

  bindFileHandle(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'bindFileHandle' }>, 'kind' | 'requestId'>) {
    return this.request('bindFileHandle', 'fileHandleBound', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'fileHandleBound' }>).metadata,
    )
  }

  getWriteStatus(input: Omit<Extract<DocumentSyncWorkerRequest, { kind: 'getWriteStatus' }>, 'kind' | 'requestId'>) {
    return this.request('getWriteStatus', 'writeStatus', input).then((message) =>
      (message as Extract<DocumentSyncWorkerResponse, { kind: 'writeStatus' }>).status,
    )
  }

  async subscribe(
    documentId: Extract<DocumentSyncWorkerRequest, { kind: 'subscribe' }>['documentId'],
    listener: (event: Extract<DocumentSyncWorkerResponse, { kind: 'documentChanged' }>['event']) => void,
  ) {
    const subscriptionId = this.createSubscriptionId()
    this.documentListeners.set(subscriptionId, listener)
    try {
      await this.request('subscribe', 'subscribed', { documentId, subscriptionId })
    } catch (error: unknown) {
      this.documentListeners.delete(subscriptionId)
      throw error
    }

    return () => {
      this.documentListeners.delete(subscriptionId)
      if (!this.disposed) {
        void this.request('unsubscribe', 'unsubscribed', { subscriptionId }).catch(() => undefined)
      }
    }
  }

  subscribeToWriteStatus(listener: (status: DocumentSyncWriteStatus) => void) {
    this.writeStatusListeners.add(listener)
    return () => {
      this.writeStatusListeners.delete(listener)
    }
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessage)
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('Document sync worker client disposed.'))
      this.pendingRequests.delete(requestId)
    }
    this.documentListeners.clear()
    this.writeStatusListeners.clear()
    this.worker.terminate?.()
  }

  private request<TKind extends DocumentSyncWorkerRequest['kind']>(
    kind: TKind,
    expectedKind: DocumentSyncWorkerResponse['kind'],
    input: Omit<Extract<DocumentSyncWorkerRequest, { kind: TKind }>, 'kind' | 'requestId'>,
  ) {
    if (this.disposed) {
      return Promise.reject(new Error('Document sync worker client disposed.'))
    }

    const requestId = this.createRequestId()
    const request = { ...input, kind, requestId } as Extract<DocumentSyncWorkerRequest, { kind: TKind }>

    return new Promise<DocumentSyncWorkerResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { expectedKind, resolve, reject })
      this.worker.postMessage(request)
    })
  }

  private receiveMessage(message: DocumentSyncWorkerResponse) {
    if (message.kind === 'documentChanged') {
      this.documentListeners.get(message.subscriptionId)?.(message.event)
      return
    }

    if (message.kind === 'writeStatusChanged') {
      this.acceptWriteStatus(message.status)
      return
    }

    const pending = this.pendingRequests.get(message.requestId)
    if (!pending) {
      return
    }

    this.pendingRequests.delete(message.requestId)
    if (message.kind === 'failure') {
      pending.reject(new Error(message.error.message))
      return
    }

    if (message.kind !== pending.expectedKind) {
      pending.reject(new Error(`Unexpected document sync worker response ${message.kind}.`))
      return
    }

    if (message.kind === 'writeStatus') {
      this.acceptWriteStatus(message.status)
    }

    pending.resolve(message)
  }

  private acceptWriteStatus(status: DocumentSyncWriteStatus) {
    const previousSequence = this.latestWriteStatusSequences.get(status.documentId) ?? -1
    if (status.sequence <= previousSequence) {
      return
    }

    this.latestWriteStatusSequences.set(status.documentId, status.sequence)
    for (const listener of this.writeStatusListeners) {
      listener(status)
    }
  }

  private createRequestId() {
    this.nextRequestSequence += 1
    return `request_document_sync_${this.nextRequestSequence}` as RequestId
  }

  private createSubscriptionId() {
    this.nextSubscriptionSequence += 1
    return `subscription_document_sync_${this.nextSubscriptionSequence}` as DocumentSyncSubscriptionId
  }
}
