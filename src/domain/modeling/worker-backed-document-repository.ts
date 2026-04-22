import type { GeometryAssetHash, GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import type { DocumentId } from '@/contracts/shared/ids'
import type { DocumentRepositoryUrlStore } from '@/domain/modeling/automerge-indexeddb-document-repository'
import type { DocumentSyncWorkerClient } from '@/domain/modeling/document-sync-worker-client'
import type { LocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type {
  DocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMetadata,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
  LocalFileBindingResult,
  LocalFileSyncDocumentRepository,
  GeometryAssetDocumentRepository,
} from '@/domain/modeling/document-repository'
import type { DocumentSyncWriteStatus } from '@/domain/modeling/document-sync-worker-protocol'
import type { LocalFileSystemFileHandle } from '@/lib/local-file-system-access'

export interface WorkerBackedDocumentRepositoryOptions {
  client: DocumentSyncWorkerClient
  urlStore?: DocumentRepositoryUrlStore | null
}

export class WorkerBackedDocumentRepository implements LocalFileSyncDocumentRepository, GeometryAssetDocumentRepository {
  private readonly client: DocumentSyncWorkerClient
  private readonly urlStore: DocumentRepositoryUrlStore | null
  private readonly statuses = new Map<DocumentId, DocumentRepositoryRestoreStatus>()
  private readonly metadata = new Map<DocumentId, DocumentRepositoryMetadata>()

  constructor(options: WorkerBackedDocumentRepositoryOptions) {
    this.client = options.client
    this.urlStore = options.urlStore ?? null
  }

  async load(input: Parameters<DocumentRepository['load']>[0]): Promise<DocumentRepositoryLoadResult> {
    const result = await this.client.load({
      ...input,
      storageKey: this.urlStore?.get(input.documentId) ?? null,
    })
    if (!result.ok) {
      this.statuses.set(input.documentId, result.status)
      return result
    }

    return this.normalizeResult(result)
  }

  async mutate(input: Parameters<DocumentRepository['mutate']>[0]): Promise<DocumentRepositoryMutationResult> {
    const result = await this.client.mutate(input)
    if (!result.ok) {
      this.statuses.set(input.documentId, result.status)
      return result
    }

    return this.normalizeResult(result)
  }

  getGeometryAssetBytes(hash: GeometryAssetHash): Promise<Uint8Array | null> {
    return this.client.getGeometryAssetBytes({ hash })
  }

  getGeometryAssetRecord(asset: GeometryAssetRecord): Promise<Uint8Array | null> {
    return this.client.getGeometryAssetRecord({ asset })
  }

  subscribe(
    documentId: DocumentId,
    listener: (event: DocumentRepositoryChangeEvent) => void,
  ) {
    let disposed = false
    let unsubscribeWorker: (() => void) | null = null

    void this.client.subscribe(documentId, (event) => {
      void this.normalizeEvent(event).then((normalized) => {
        if (!disposed) {
          listener(normalized)
        }
      })
    }).then((unsubscribe) => {
      if (disposed) {
        unsubscribe()
        return
      }
      unsubscribeWorker = unsubscribe
    })

    return () => {
      disposed = true
      unsubscribeWorker?.()
    }
  }

  async reset(documentId: DocumentId): Promise<DocumentRepositoryRestoreStatus> {
    const status = await this.client.reset({ documentId })
    this.urlStore?.delete(documentId)
    this.statuses.set(documentId, status)
    this.metadata.set(documentId, { documentId, heads: [], source: 'reset' })
    return status
  }

  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus {
    return this.statuses.get(documentId) ?? { kind: 'pending', documentId }
  }

  getMetadata(documentId: DocumentId): DocumentRepositoryMetadata {
    return this.metadata.get(documentId) ?? { documentId, heads: [], source: 'restore' }
  }

  async bindLocalFile(input: {
    documentId: DocumentId
    handle: LocalFileSystemFileHandle
    metadata: LocalFileBindingMetadata
  }): Promise<LocalFileBindingResult> {
    try {
      return {
        ok: true,
        metadata: await this.client.bindFileHandle(input),
      }
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Local file sync target could not be bound.',
      }
    }
  }

  async restoreLocalFileBinding(documentId: DocumentId) {
    const record = await this.client.restoreBinding({ documentId })
    return record?.metadata ?? null
  }

  getLocalFileSyncStatus(documentId: DocumentId): Promise<DocumentSyncWriteStatus> {
    return this.client.getWriteStatus({ documentId })
  }

  subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void) {
    return this.client.subscribeToWriteStatus(listener)
  }

  private async normalizeResult<T extends Extract<DocumentRepositoryLoadResult | DocumentRepositoryMutationResult, { ok: true }>>(
    result: T,
  ): Promise<T> {
    const normalized = await this.client.normalize({
      document: result.document,
      metadata: result.metadata,
    })
    const metadata = normalized.metadata
    this.persistMetadata(metadata)
    this.statuses.set(result.status.documentId, result.status)
    this.metadata.set(metadata.documentId, metadata)

    return {
      ...result,
      document: normalized.document,
      diagnostics: [...(result.diagnostics ?? []), ...normalized.diagnostics],
      assetAvailability: result.assetAvailability,
      metadata,
    }
  }

  private async normalizeEvent(event: DocumentRepositoryChangeEvent): Promise<DocumentRepositoryChangeEvent> {
    const normalized = await this.client.normalize({
      document: event.document,
      metadata: event.metadata,
    })
    this.persistMetadata(normalized.metadata)
    this.statuses.set(event.status.documentId, event.status)
    this.metadata.set(normalized.metadata.documentId, normalized.metadata)

    return {
      ...event,
      document: normalized.document,
      diagnostics: [...(event.diagnostics ?? []), ...normalized.diagnostics],
      assetAvailability: event.assetAvailability,
      metadata: normalized.metadata,
    }
  }

  private persistMetadata(metadata: DocumentRepositoryMetadata) {
    if (metadata.storageKey) {
      this.urlStore?.set(
        metadata.documentId,
        metadata.storageKey as Parameters<DocumentRepositoryUrlStore['set']>[1],
      )
    }
  }
}

export function createWorkerBackedDocumentRepository(options: WorkerBackedDocumentRepositoryOptions) {
  return new WorkerBackedDocumentRepository(options)
}
