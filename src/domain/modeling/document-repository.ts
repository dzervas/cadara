import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { DocumentId } from '@/contracts/shared/ids'
import type { LocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type { DocumentSyncWriteStatus } from '@/domain/modeling/document-sync-worker-protocol'
import type { LocalFileSystemFileHandle } from '@/lib/local-file-system-access'

export type DocumentRepositoryChangeSource = 'local' | 'peer' | 'restore' | 'seed' | 'reset'

export interface DocumentRepositoryMetadata {
  documentId: DocumentId
  heads: readonly string[]
  source: DocumentRepositoryChangeSource
  storageKey?: string
}

export type DocumentRepositoryRestoreStatus =
  | { kind: 'pending'; documentId: DocumentId }
  | { kind: 'seeded'; documentId: DocumentId }
  | { kind: 'restored'; documentId: DocumentId }
  | { kind: 'reset'; documentId: DocumentId }
  | { kind: 'failed'; documentId: DocumentId; diagnostic: AuthoredModelDocumentDiagnostic }

export type DocumentRepositoryLoadResult =
  | {
      ok: true
      document: AuthoredModelDocument
      diagnostics?: ModelingDiagnostic[]
      status: DocumentRepositoryRestoreStatus
      metadata: DocumentRepositoryMetadata
    }
  | { ok: false; status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }> }

export type DocumentRepositoryMutationResult =
  | {
      ok: true
      document: AuthoredModelDocument
      diagnostics?: ModelingDiagnostic[]
      status: DocumentRepositoryRestoreStatus
      metadata: DocumentRepositoryMetadata
    }
  | { ok: false; status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }> }

export interface DocumentRepositoryChangeEvent {
  document: AuthoredModelDocument
  diagnostics?: ModelingDiagnostic[]
  status: DocumentRepositoryRestoreStatus
  metadata: DocumentRepositoryMetadata
}

export interface DocumentRepository {
  load(input: {
    documentId: DocumentId
    seedDocument: AuthoredModelDocument
  }): Promise<DocumentRepositoryLoadResult>
  mutate(input: {
    documentId: DocumentId
    document: AuthoredModelDocument
  }): Promise<DocumentRepositoryMutationResult>
  subscribe(
    documentId: DocumentId,
    listener: (event: DocumentRepositoryChangeEvent) => void,
  ): () => void
  reset(documentId: DocumentId): Promise<DocumentRepositoryRestoreStatus>
  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus
  getMetadata(documentId: DocumentId): DocumentRepositoryMetadata
}

export type LocalFileBindingResult =
  | { ok: true; metadata: LocalFileBindingMetadata }
  | { ok: false; message: string }

export interface LocalFileSyncDocumentRepository extends DocumentRepository {
  bindLocalFile(input: {
    documentId: DocumentId
    handle: LocalFileSystemFileHandle
    metadata: LocalFileBindingMetadata
  }): Promise<LocalFileBindingResult>
  restoreLocalFileBinding(documentId: DocumentId): Promise<LocalFileBindingMetadata | null>
  getLocalFileSyncStatus(documentId: DocumentId): Promise<DocumentSyncWriteStatus>
  subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void): () => void
}

export function isLocalFileSyncDocumentRepository(
  repository: DocumentRepository | null | undefined,
): repository is LocalFileSyncDocumentRepository {
  return Boolean(repository && 'bindLocalFile' in repository)
}
