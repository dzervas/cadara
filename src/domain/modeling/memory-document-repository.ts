import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'
import type {
  DocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryMetadata,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'

export class MemoryDocumentRepository implements DocumentRepository {
  readonly savedDocuments: AuthoredModelDocument[] = []
  private readonly documents = new Map<DocumentId, AuthoredModelDocument>()
  private readonly statuses = new Map<DocumentId, DocumentRepositoryRestoreStatus>()
  private readonly metadata = new Map<DocumentId, DocumentRepositoryMetadata>()
  private readonly listeners = new Map<DocumentId, Set<(event: DocumentRepositoryChangeEvent) => void>>()

  constructor(initialDocuments: AuthoredModelDocument[] = []) {
    for (const document of initialDocuments) {
      this.documents.set(document.documentId, structuredClone(document))
      this.statuses.set(document.documentId, { kind: 'restored', documentId: document.documentId })
      this.metadata.set(document.documentId, createMemoryMetadata(document.documentId, document, 'restore'))
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
      const metadata = createMemoryMetadata(input.documentId, result.document, 'restore')
      this.statuses.set(input.documentId, status)
      this.metadata.set(input.documentId, metadata)
      return { ok: true, document: result.document, status, metadata }
    }

    const result = parseAuthoredModelDocument(structuredClone(input.seedDocument))
    if (!result.ok) {
      return this.fail(input.documentId, result.diagnostic)
    }

    this.documents.set(input.documentId, structuredClone(result.document))
    const status = { kind: 'seeded' as const, documentId: input.documentId }
    const metadata = createMemoryMetadata(input.documentId, result.document, 'seed')
    this.statuses.set(input.documentId, status)
    this.metadata.set(input.documentId, metadata)
    this.notify(input.documentId, result.document, status, metadata)
    return { ok: true, document: result.document, status, metadata }
  }

  async mutate(input: { documentId: DocumentId; document: AuthoredModelDocument }): Promise<DocumentRepositoryMutationResult> {
    const result = parseAuthoredModelDocument(structuredClone(input.document))
    if (!result.ok) {
      return this.fail(input.documentId, result.diagnostic)
    }

    this.documents.set(input.documentId, structuredClone(result.document))
    this.savedDocuments.push(structuredClone(result.document))
    const status = { kind: 'restored' as const, documentId: input.documentId }
    const metadata = createMemoryMetadata(input.documentId, result.document, 'local')
    this.statuses.set(input.documentId, status)
    this.metadata.set(input.documentId, metadata)
    this.notify(input.documentId, result.document, status, metadata)
    return { ok: true, document: result.document, status, metadata }
  }

  receivePeerDocument(document: AuthoredModelDocument): DocumentRepositoryMutationResult {
    const result = parseAuthoredModelDocument(structuredClone(document))
    if (!result.ok) {
      return this.fail(document.documentId, result.diagnostic)
    }

    this.documents.set(document.documentId, structuredClone(result.document))
    const status = { kind: 'restored' as const, documentId: document.documentId }
    const metadata = createMemoryMetadata(document.documentId, result.document, 'peer')
    this.statuses.set(document.documentId, status)
    this.metadata.set(document.documentId, metadata)
    this.notify(document.documentId, result.document, status, metadata)
    return { ok: true, document: result.document, status, metadata }
  }

  subscribe(
    documentId: DocumentId,
    listener: (event: DocumentRepositoryChangeEvent) => void,
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
    this.metadata.set(documentId, { documentId, heads: [], source: 'reset' })
    return status
  }

  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus {
    return this.statuses.get(documentId) ?? { kind: 'pending', documentId }
  }

  getMetadata(documentId: DocumentId): DocumentRepositoryMetadata {
    return this.metadata.get(documentId) ?? { documentId, heads: [], source: 'restore' }
  }

  private fail(
    documentId: DocumentId,
    diagnostic: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }>['diagnostic'],
  ): Extract<DocumentRepositoryLoadResult, { ok: false }> {
    const status = { kind: 'failed' as const, documentId, diagnostic }
    this.statuses.set(documentId, status)
    return { ok: false, status }
  }

  private notify(
    documentId: DocumentId,
    document: AuthoredModelDocument,
    status: DocumentRepositoryRestoreStatus,
    metadata: DocumentRepositoryMetadata,
  ) {
    for (const listener of this.listeners.get(documentId) ?? []) {
      listener({
        document: structuredClone(document),
        status,
        metadata,
      })
    }
  }
}

export function createMemoryDocumentRepository(initialDocuments?: AuthoredModelDocument[]) {
  return new MemoryDocumentRepository(initialDocuments)
}

function createMemoryMetadata(
  documentId: DocumentId,
  document: AuthoredModelDocument,
  source: DocumentRepositoryMetadata['source'],
): DocumentRepositoryMetadata {
  return {
    documentId,
    heads: [`memory:${document.revisionId}`],
    source,
  }
}
