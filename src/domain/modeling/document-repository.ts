import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'

export type DocumentRepositoryChangeSource = 'local' | 'peer' | 'restore' | 'seed' | 'reset'

export interface DocumentRepositoryMetadata {
  documentId: DocumentId
  heads: readonly string[]
  source: DocumentRepositoryChangeSource
}

export type DocumentRepositoryRestoreStatus =
  | { kind: 'pending'; documentId: DocumentId }
  | { kind: 'seeded'; documentId: DocumentId }
  | { kind: 'restored'; documentId: DocumentId }
  | { kind: 'reset'; documentId: DocumentId }
  | { kind: 'failed'; documentId: DocumentId; diagnostic: AuthoredModelDocumentDiagnostic }

export type DocumentRepositoryLoadResult =
  | { ok: true; document: AuthoredModelDocument; status: DocumentRepositoryRestoreStatus; metadata: DocumentRepositoryMetadata }
  | { ok: false; status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }> }

export type DocumentRepositoryMutationResult =
  | { ok: true; document: AuthoredModelDocument; status: DocumentRepositoryRestoreStatus; metadata: DocumentRepositoryMetadata }
  | { ok: false; status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }> }

export interface DocumentRepositoryChangeEvent {
  document: AuthoredModelDocument
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
