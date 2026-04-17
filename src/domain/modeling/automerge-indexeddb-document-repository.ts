import { Repo } from '@automerge/automerge-repo'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'

import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'
import type {
  DocumentRepository,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'

interface AutomergeDocumentEnvelope {
  authoredDocument: AuthoredModelDocument
}

interface AutomergeHandleLike<T> {
  readonly url: AutomergeUrl
  readonly documentId: string
  whenReady(): Promise<void>
  doc(): T
  change(callback: (document: T) => void): void
  on(event: 'change', callback: () => void): void
}

interface AutomergeRepositoryLike {
  create<T>(initialValue?: T): AutomergeHandleLike<T>
  find<T>(id: AutomergeUrl): Promise<AutomergeHandleLike<T>>
  delete(id: AutomergeUrl): void
  flush?(documents?: string[]): Promise<void>
}

export interface DocumentRepositoryUrlStore {
  get(documentId: DocumentId): AutomergeUrl | null
  set(documentId: DocumentId, url: AutomergeUrl): void
  delete(documentId: DocumentId): void
}

export interface IndexedDbAutomergeDocumentRepositoryOptions {
  repo?: AutomergeRepositoryLike
  urlStore?: DocumentRepositoryUrlStore
  databaseName?: string
  storeName?: string
}

class MemoryDocumentRepositoryUrlStore implements DocumentRepositoryUrlStore {
  private readonly urls = new Map<DocumentId, AutomergeUrl>()

  get(documentId: DocumentId) {
    return this.urls.get(documentId) ?? null
  }

  set(documentId: DocumentId, url: AutomergeUrl) {
    this.urls.set(documentId, url)
  }

  delete(documentId: DocumentId) {
    this.urls.delete(documentId)
  }
}

export function createLocalStorageDocumentRepositoryUrlStore(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void },
  key = 'cad.documentRepository.automergeUrls.v1',
): DocumentRepositoryUrlStore {
  function read() {
    const serialized = storage.getItem(key)
    if (!serialized) {
      return {} as Record<string, string>
    }

    try {
      const parsed = JSON.parse(serialized) as unknown
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, string>
        : {}
    } catch {
      return {}
    }
  }

  function write(value: Record<string, string>) {
    storage.setItem(key, JSON.stringify(value))
  }

  return {
    get(documentId) {
      return (read()[documentId] ?? null) as AutomergeUrl | null
    },
    set(documentId, url) {
      write({ ...read(), [documentId]: url })
    },
    delete(documentId) {
      const next = read()
      delete next[documentId]
      if (Object.keys(next).length === 0) {
        storage.removeItem(key)
        return
      }
      write(next)
    },
  }
}

export class IndexedDbAutomergeDocumentRepository implements DocumentRepository {
  private readonly repo: AutomergeRepositoryLike
  private readonly urlStore: DocumentRepositoryUrlStore
  private readonly statuses = new Map<DocumentId, DocumentRepositoryRestoreStatus>()
  private readonly handles = new Map<DocumentId, AutomergeHandleLike<AutomergeDocumentEnvelope>>()
  private readonly listeners = new Map<DocumentId, Set<(document: AuthoredModelDocument, status: DocumentRepositoryRestoreStatus) => void>>()

  constructor(options: IndexedDbAutomergeDocumentRepositoryOptions = {}) {
    this.repo = options.repo ?? new Repo({
      storage: new IndexedDBStorageAdapter(options.databaseName ?? 'cad-authored-documents', options.storeName ?? 'documents'),
    }) as AutomergeRepositoryLike
    this.urlStore = options.urlStore ?? new MemoryDocumentRepositoryUrlStore()
  }

  async load(input: { documentId: DocumentId; seedDocument: AuthoredModelDocument }): Promise<DocumentRepositoryLoadResult> {
    try {
      const url = this.urlStore.get(input.documentId)
      if (!url) {
        return await this.createSeedDocument(input.documentId, input.seedDocument)
      }

      const handle = await this.repo.find<AutomergeDocumentEnvelope>(url)
      await handle.whenReady()
      this.handles.set(input.documentId, handle)
      this.installHandleListener(input.documentId, handle)
      const parsed = parseAuthoredModelDocument(structuredClone(handle.doc().authoredDocument))
      if (!parsed.ok) {
        return this.fail(input.documentId, parsed.diagnostic)
      }

      const status = { kind: 'restored' as const, documentId: input.documentId }
      this.statuses.set(input.documentId, status)
      return { ok: true, document: parsed.document, status }
    } catch (error: unknown) {
      return this.fail(input.documentId, createFailureDiagnostic('automerge-load-failed', error, 'Authored document could not be loaded.'))
    }
  }

  async mutate(input: { documentId: DocumentId; document: AuthoredModelDocument }): Promise<DocumentRepositoryMutationResult> {
    const parsed = parseAuthoredModelDocument(structuredClone(input.document))
    if (!parsed.ok) {
      return this.fail(input.documentId, parsed.diagnostic)
    }

    try {
      const handle = await this.getHandle(input.documentId, parsed.document)
      handle.change((doc) => {
        doc.authoredDocument = structuredClone(parsed.document)
      })
      await this.flush(handle)
      const status = { kind: 'restored' as const, documentId: input.documentId }
      this.statuses.set(input.documentId, status)
      this.notify(input.documentId, parsed.document, status)
      return { ok: true, document: parsed.document, status }
    } catch (error: unknown) {
      return this.fail(input.documentId, createFailureDiagnostic('automerge-write-failed', error, 'Authored document could not be written.'))
    }
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
    const url = this.urlStore.get(documentId)
    if (url) {
      this.repo.delete(url)
    }
    this.handles.delete(documentId)
    this.urlStore.delete(documentId)
    const status = { kind: 'reset' as const, documentId }
    this.statuses.set(documentId, status)
    return status
  }

  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus {
    return this.statuses.get(documentId) ?? { kind: 'pending', documentId }
  }

  private async createSeedDocument(documentId: DocumentId, seedDocument: AuthoredModelDocument): Promise<DocumentRepositoryLoadResult> {
    const parsed = parseAuthoredModelDocument(structuredClone(seedDocument))
    if (!parsed.ok) {
      return this.fail(documentId, parsed.diagnostic)
    }

    const handle = this.repo.create<AutomergeDocumentEnvelope>({
      authoredDocument: structuredClone(parsed.document),
    })
    await handle.whenReady()
    this.handles.set(documentId, handle)
    this.urlStore.set(documentId, handle.url)
    this.installHandleListener(documentId, handle)
    await this.flush(handle)
    const status = { kind: 'seeded' as const, documentId }
    this.statuses.set(documentId, status)
    this.notify(documentId, parsed.document, status)
    return { ok: true, document: parsed.document, status }
  }

  private async getHandle(documentId: DocumentId, seedDocument: AuthoredModelDocument) {
    const existing = this.handles.get(documentId)
    if (existing) {
      return existing
    }

    const url = this.urlStore.get(documentId)
    if (!url) {
      const seeded = await this.createSeedDocument(documentId, seedDocument)
      if (!seeded.ok) {
        throw new Error(seeded.status.diagnostic.message)
      }
      return this.handles.get(documentId)!
    }

    const handle = await this.repo.find<AutomergeDocumentEnvelope>(url)
    await handle.whenReady()
    this.handles.set(documentId, handle)
    this.installHandleListener(documentId, handle)
    return handle
  }

  private installHandleListener(documentId: DocumentId, handle: AutomergeHandleLike<AutomergeDocumentEnvelope>) {
    const callback = () => {
      const parsed = parseAuthoredModelDocument(structuredClone(handle.doc().authoredDocument))
      if (!parsed.ok) {
        this.fail(documentId, parsed.diagnostic)
        return
      }

      const status = { kind: 'restored' as const, documentId }
      this.statuses.set(documentId, status)
      this.notify(documentId, parsed.document, status)
    }
    handle.on('change', callback)
  }

  private async flush(handle: AutomergeHandleLike<AutomergeDocumentEnvelope>) {
    await this.repo.flush?.([handle.documentId])
  }

  private fail(
    documentId: DocumentId,
    diagnostic: AuthoredModelDocumentDiagnostic,
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

function createFailureDiagnostic(reasonCode: string, error: unknown, fallbackMessage: string): AuthoredModelDocumentDiagnostic {
  return {
    reasonCode,
    message: error instanceof Error ? error.message : fallbackMessage,
  }
}

export function createIndexedDbAutomergeDocumentRepository(options?: IndexedDbAutomergeDocumentRepositoryOptions) {
  return new IndexedDbAutomergeDocumentRepository(options)
}
