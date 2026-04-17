import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'
import type {
  DocumentRepository,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'

export class MemoryDocumentRepository implements DocumentRepository {
  readonly savedDocuments: AuthoredModelDocument[] = []
  private readonly documents = new Map<DocumentId, AuthoredModelDocument>()
  private readonly statuses = new Map<DocumentId, DocumentRepositoryRestoreStatus>()
  private readonly listeners = new Map<DocumentId, Set<(document: AuthoredModelDocument, status: DocumentRepositoryRestoreStatus) => void>>()

  constructor(initialDocuments: AuthoredModelDocument[] = []) {
    for (const document of initialDocuments) {
      this.documents.set(document.documentId, structuredClone(document))
      this.statuses.set(document.documentId, { kind: 'restored', documentId: document.documentId })
    }
  }

  async load(input: { documentId: DocumentId; seedDocument: AuthoredModelDocument }): Promise<DocumentRepositoryLoadResult> {
    const existing = this.documents.get(input.documentId)
    if (existing) {
      const result = parseAuthoredModelDocument(structuredClone(existing))
      if (!result.ok) {
        return this.fail(input.documentId, result.diagnostic)
      }

      const status = { kind: 'restored' as const, documentId: input.documentId }
      this.statuses.set(input.documentId, status)
      return { ok: true, document: result.document, status }
    }

    const result = parseAuthoredModelDocument(structuredClone(input.seedDocument))
    if (!result.ok) {
      return this.fail(input.documentId, result.diagnostic)
    }

    this.documents.set(input.documentId, structuredClone(result.document))
    const status = { kind: 'seeded' as const, documentId: input.documentId }
    this.statuses.set(input.documentId, status)
    this.notify(input.documentId, result.document, status)
    return { ok: true, document: result.document, status }
  }

  async mutate(input: { documentId: DocumentId; document: AuthoredModelDocument }): Promise<DocumentRepositoryMutationResult> {
    const result = parseAuthoredModelDocument(structuredClone(input.document))
    if (!result.ok) {
      return this.fail(input.documentId, result.diagnostic)
    }

    this.documents.set(input.documentId, structuredClone(result.document))
    this.savedDocuments.push(structuredClone(result.document))
    const status = { kind: 'restored' as const, documentId: input.documentId }
    this.statuses.set(input.documentId, status)
    this.notify(input.documentId, result.document, status)
    return { ok: true, document: result.document, status }
  }

  subscribe(
    documentId: DocumentId,
    listener: (document: AuthoredModelDocument, status: DocumentRepositoryRestoreStatus) => void,
  ) {
    const listeners = this.listeners.get(documentId) ?? new Set()
    listeners.add(listener)
    this.listeners.set(documentId, listeners)

    return () => {
      listeners.delete(listener)
    }
  }

  async reset(documentId: DocumentId): Promise<DocumentRepositoryRestoreStatus> {
    this.documents.delete(documentId)
    const status = { kind: 'reset' as const, documentId }
    this.statuses.set(documentId, status)
    return status
  }

  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus {
    return this.statuses.get(documentId) ?? { kind: 'pending', documentId }
  }

  private fail(
    documentId: DocumentId,
    diagnostic: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }>['diagnostic'],
  ): Extract<DocumentRepositoryLoadResult, { ok: false }> {
    const status = { kind: 'failed' as const, documentId, diagnostic }
    this.statuses.set(documentId, status)
    return { ok: false, status }
  }

  private notify(documentId: DocumentId, document: AuthoredModelDocument, status: DocumentRepositoryRestoreStatus) {
    for (const listener of this.listeners.get(documentId) ?? []) {
      listener(structuredClone(document), status)
    }
  }
}

export function createMemoryDocumentRepository(initialDocuments?: AuthoredModelDocument[]) {
  return new MemoryDocumentRepository(initialDocuments)
}
