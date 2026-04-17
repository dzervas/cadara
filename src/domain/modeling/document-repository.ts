import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'

export type DocumentRepositoryRestoreStatus =
  | { kind: 'pending'; documentId: DocumentId }
  | { kind: 'seeded'; documentId: DocumentId }
  | { kind: 'restored'; documentId: DocumentId }
  | { kind: 'reset'; documentId: DocumentId }
  | { kind: 'failed'; documentId: DocumentId; diagnostic: AuthoredModelDocumentDiagnostic }

export type DocumentRepositoryLoadResult =
  | { ok: true; document: AuthoredModelDocument; status: DocumentRepositoryRestoreStatus }
  | { ok: false; status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }> }

export type DocumentRepositoryMutationResult =
  | { ok: true; document: AuthoredModelDocument; status: DocumentRepositoryRestoreStatus }
  | { ok: false; status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }> }

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
    listener: (document: AuthoredModelDocument, status: DocumentRepositoryRestoreStatus) => void,
  ): () => void
  reset(documentId: DocumentId): Promise<DocumentRepositoryRestoreStatus>
  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus
}
