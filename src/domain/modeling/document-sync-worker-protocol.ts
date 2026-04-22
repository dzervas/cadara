import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type {
  GeometryAssetBlobInput,
  GeometryAssetHash,
  GeometryAssetRecord,
} from '@/contracts/modeling/geometry-assets'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { DocumentId, RequestId } from '@/contracts/shared/ids'
import type {
  DocumentRepositoryChangeEvent,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMetadata,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'
import type { LocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type { LocalFileSystemFileHandle } from '@/lib/local-file-system-access'

export type DocumentSyncSubscriptionId = `subscription_document_sync_${string}`

export interface DocumentSyncNormalizeResult {
  document: AuthoredModelDocument
  diagnostics: ModelingDiagnostic[]
  metadata: DocumentRepositoryMetadata
}

export type DocumentSyncWriteStatus =
  | { kind: 'idle'; documentId: DocumentId; sequence: number }
  | { kind: 'binding-restored'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata }
  | { kind: 'syncing'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata }
  | { kind: 'synced'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata }
  | { kind: 'persistent-binding-unavailable'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata; message: string }
  | { kind: 'permission-required'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata }
  | { kind: 'permission-denied'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata; message: string }
  | { kind: 'failed'; documentId: DocumentId; sequence: number; metadata: LocalFileBindingMetadata | null; message: string }

export interface DocumentSyncWorkerFailurePayload {
  code:
    | 'document-sync-worker-request-failed'
    | 'document-sync-worker-disposed'
    | 'document-sync-worker-unexpected-response'
  message: string
  detail?: unknown
}

export type DocumentSyncWorkerRequest =
  | {
      kind: 'load'
      requestId: RequestId
      documentId: DocumentId
      seedDocument: AuthoredModelDocument
      storageKey?: string | null
    }
  | {
      kind: 'mutate'
      requestId: RequestId
      documentId: DocumentId
      document: AuthoredModelDocument
      assets?: readonly GeometryAssetBlobInput[]
    }
  | {
      kind: 'getGeometryAssetBytes'
      requestId: RequestId
      hash: GeometryAssetHash
    }
  | {
      kind: 'getGeometryAssetRecord'
      requestId: RequestId
      asset: GeometryAssetRecord
    }
  | {
      kind: 'reset'
      requestId: RequestId
      documentId: DocumentId
    }
  | {
      kind: 'subscribe'
      requestId: RequestId
      subscriptionId: DocumentSyncSubscriptionId
      documentId: DocumentId
    }
  | {
      kind: 'unsubscribe'
      requestId: RequestId
      subscriptionId: DocumentSyncSubscriptionId
    }
  | {
      kind: 'normalize'
      requestId: RequestId
      document: AuthoredModelDocument
      metadata: DocumentRepositoryMetadata
    }
  | {
      kind: 'restoreBinding'
      requestId: RequestId
      documentId: DocumentId
    }
  | {
      kind: 'bindFileHandle'
      requestId: RequestId
      documentId: DocumentId
      handle: LocalFileSystemFileHandle
      metadata: LocalFileBindingMetadata
    }
  | {
      kind: 'getWriteStatus'
      requestId: RequestId
      documentId: DocumentId
    }

export type DocumentSyncWorkerResponse =
  | {
      kind: 'loaded'
      requestId: RequestId
      result: DocumentRepositoryLoadResult
    }
  | {
      kind: 'mutated'
      requestId: RequestId
      result: DocumentRepositoryMutationResult
    }
  | {
      kind: 'geometryAssetBytes'
      requestId: RequestId
      bytes: Uint8Array | null
    }
  | {
      kind: 'geometryAssetRecord'
      requestId: RequestId
      bytes: Uint8Array | null
    }
  | {
      kind: 'reset'
      requestId: RequestId
      status: DocumentRepositoryRestoreStatus
    }
  | {
      kind: 'subscribed'
      requestId: RequestId
      subscriptionId: DocumentSyncSubscriptionId
    }
  | {
      kind: 'unsubscribed'
      requestId: RequestId
      subscriptionId: DocumentSyncSubscriptionId
    }
  | {
      kind: 'normalized'
      requestId: RequestId
      result: DocumentSyncNormalizeResult
    }
  | {
      kind: 'bindingRestored'
      requestId: RequestId
      record: { metadata: LocalFileBindingMetadata; handle: LocalFileSystemFileHandle } | null
    }
  | {
      kind: 'fileHandleBound'
      requestId: RequestId
      metadata: LocalFileBindingMetadata
    }
  | {
      kind: 'writeStatus'
      requestId: RequestId
      status: DocumentSyncWriteStatus
    }
  | {
      kind: 'documentChanged'
      subscriptionId: DocumentSyncSubscriptionId
      event: DocumentRepositoryChangeEvent
    }
  | {
      kind: 'writeStatusChanged'
      status: DocumentSyncWriteStatus
    }
  | {
      kind: 'failure'
      requestId: RequestId
      error: DocumentSyncWorkerFailurePayload
    }

export function createDocumentSyncWorkerFailure(
  requestId: RequestId,
  error: unknown,
  code: DocumentSyncWorkerFailurePayload['code'] = 'document-sync-worker-request-failed',
): Extract<DocumentSyncWorkerResponse, { kind: 'failure' }> {
  return {
    kind: 'failure',
    requestId,
    error: {
      code,
      message: error instanceof Error ? error.message : 'Document sync worker request failed.',
      detail: error,
    },
  }
}
