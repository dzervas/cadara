import { initializeBase64Wasm, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo/slim'
import type { AutomergeUrl } from '@automerge/automerge-repo/slim'
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'

import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import { parseAutomergeDocumentUrlStorePayload } from '@/contracts/modeling/document-repository.runtime-schema'
import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'
import type {
  DocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryChangeSource,
  DocumentRepositoryMetadata,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'

interface AutomergeDocumentEnvelope {
  authoredDocument: AuthoredModelDocument
}

interface LocalPeerDocumentMessage {
  type: 'cad-authored-document-repository/document-updated'
  senderId: string
  documentId: DocumentId
  document: AuthoredModelDocument
}

interface AutomergeHandleLike<T> {
  readonly url: AutomergeUrl
  readonly documentId: string
  whenReady(): Promise<void>
  doc(): T
  heads?(): readonly string[]
  change(callback: (document: T) => void): void
  on(event: 'change', callback: () => void): void
}

interface AutomergeRepositoryLike {
  create<T>(initialValue?: T): AutomergeHandleLike<T>
  find<T>(id: AutomergeUrl): Promise<AutomergeHandleLike<T>>
  delete(id: AutomergeUrl): void
  flush?(documents?: string[]): Promise<void>
}

let automergeWasmInitialization: Promise<void> | null = null

function ensureAutomergeWasmInitialized() {
  automergeWasmInitialization ??= initializeBase64Wasm(automergeWasmBase64).catch((error: unknown) => {
    automergeWasmInitialization = null
    throw error
  })
  return automergeWasmInitialization
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
  localPeerSync?: false | {
    channelName?: string
    peerWaitMs?: number
  }
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
      const validated = parseAutomergeDocumentUrlStorePayload(parsed, isValidAutomergeUrl)
      return validated.ok ? validated.urls : {}
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
  private readonly metadata = new Map<DocumentId, DocumentRepositoryMetadata>()
  private readonly handles = new Map<DocumentId, AutomergeHandleLike<AutomergeDocumentEnvelope>>()
  private readonly installedListeners = new Set<string>()
  private readonly pendingLocalChanges = new Set<DocumentId>()
  private readonly pendingSeedEchoes = new Map<DocumentId, AuthoredModelDocument>()
  private readonly listeners = new Map<DocumentId, Set<(event: DocumentRepositoryChangeEvent) => void>>()
  private readonly localPeerId = `peer-${Math.random().toString(36).slice(2)}`
  private readonly localPeerDocumentChannel: BroadcastChannel | null
  private readonly prepareAutomerge: () => Promise<void>

  constructor(options: IndexedDbAutomergeDocumentRepositoryOptions = {}) {
    this.prepareAutomerge = options.repo ? async () => {} : ensureAutomergeWasmInitialized
    this.repo = options.repo ?? new Repo({
      storage: new IndexedDBStorageAdapter(options.databaseName ?? 'cad-authored-documents', options.storeName ?? 'documents'),
      network: createLocalPeerNetwork(options.localPeerSync),
    }) as AutomergeRepositoryLike
    this.urlStore = options.urlStore ?? new MemoryDocumentRepositoryUrlStore()
    this.localPeerDocumentChannel = createLocalPeerDocumentChannel(options.localPeerSync)
    this.localPeerDocumentChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.receiveLocalPeerDocumentMessage(event.data)
    })
  }

  async load(input: { documentId: DocumentId; seedDocument: AuthoredModelDocument }): Promise<DocumentRepositoryLoadResult> {
    try {
      await this.prepareAutomerge()
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
      const metadata = this.createMetadata(input.documentId, handle, 'restore')
      this.statuses.set(input.documentId, status)
      this.metadata.set(input.documentId, metadata)
      return { ok: true, document: parsed.document, status, metadata }
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
      await this.prepareAutomerge()
      const handle = await this.getHandle(input.documentId, parsed.document)
      this.pendingLocalChanges.add(input.documentId)
      handle.change((doc) => {
        doc.authoredDocument = structuredClone(parsed.document)
      })
      await this.flush(handle)
      const status = { kind: 'restored' as const, documentId: input.documentId }
      const metadata = this.createMetadata(input.documentId, handle, 'local')
      this.statuses.set(input.documentId, status)
      this.metadata.set(input.documentId, metadata)
      this.broadcastLocalPeerDocument(input.documentId, parsed.document)
      return { ok: true, document: parsed.document, status, metadata }
    } catch (error: unknown) {
      this.pendingLocalChanges.delete(input.documentId)
      return this.fail(input.documentId, createFailureDiagnostic('automerge-write-failed', error, 'Authored document could not be written.'))
    }
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
    const url = this.urlStore.get(documentId)
    if (url) {
      this.repo.delete(url)
    }
    this.handles.delete(documentId)
    this.urlStore.delete(documentId)
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
    await this.flush(handle)
    const status = { kind: 'seeded' as const, documentId }
    const metadata = this.createMetadata(documentId, handle, 'seed')
    this.statuses.set(documentId, status)
    this.metadata.set(documentId, metadata)
    this.pendingSeedEchoes.set(documentId, structuredClone(parsed.document))
    this.installHandleListener(documentId, handle)
    this.notify(documentId, parsed.document, status, metadata)
    return { ok: true, document: parsed.document, status, metadata }
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
    const listenerKey = `${documentId}:${handle.documentId}`
    if (this.installedListeners.has(listenerKey)) {
      return
    }
    this.installedListeners.add(listenerKey)

    const callback = () => {
      const parsed = parseAuthoredModelDocument(structuredClone(handle.doc().authoredDocument))
      if (!parsed.ok) {
        this.fail(documentId, parsed.diagnostic)
        return
      }

      const status = { kind: 'restored' as const, documentId }
      const source = this.pendingLocalChanges.has(documentId) ? 'local' : 'peer'
      this.pendingLocalChanges.delete(documentId)
      const metadata = this.createMetadata(documentId, handle, source)
      const previousMetadata = this.metadata.get(documentId)
      if (
        source === 'peer'
        && previousMetadata?.source === 'seed'
        && (
          sameStringSet(previousMetadata.heads, metadata.heads)
          || documentsEqual(this.pendingSeedEchoes.get(documentId), parsed.document)
        )
      ) {
        return
      }
      this.pendingSeedEchoes.delete(documentId)
      this.statuses.set(documentId, status)
      this.metadata.set(documentId, metadata)
      this.notify(documentId, parsed.document, status, metadata)
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

  private createMetadata(
    documentId: DocumentId,
    handle: AutomergeHandleLike<AutomergeDocumentEnvelope>,
    source: DocumentRepositoryChangeSource,
  ): DocumentRepositoryMetadata {
    const heads = handle.heads?.() ?? [`automerge:${handle.documentId}:${handle.doc().authoredDocument.revisionId}`]
    return {
      documentId,
      heads: [...heads].sort(),
      source,
    }
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

  private broadcastLocalPeerDocument(documentId: DocumentId, document: AuthoredModelDocument) {
    this.localPeerDocumentChannel?.postMessage({
      type: 'cad-authored-document-repository/document-updated',
      senderId: this.localPeerId,
      documentId,
      document: structuredClone(document),
    } satisfies LocalPeerDocumentMessage)
  }

  private receiveLocalPeerDocumentMessage(data: unknown) {
    if (!isLocalPeerDocumentMessage(data) || data.senderId === this.localPeerId) {
      return
    }

    const parsed = parseAuthoredModelDocument(structuredClone(data.document))
    if (!parsed.ok) {
      this.fail(data.documentId, parsed.diagnostic)
      return
    }

    const status = { kind: 'restored' as const, documentId: data.documentId }
    const metadata: DocumentRepositoryMetadata = {
      documentId: data.documentId,
      heads: [`local-peer:${data.senderId}:${parsed.document.revisionId}`],
      source: 'peer',
    }
    this.statuses.set(data.documentId, status)
    this.metadata.set(data.documentId, metadata)
    this.notify(data.documentId, parsed.document, status, metadata)
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

function createLocalPeerNetwork(
  options: IndexedDbAutomergeDocumentRepositoryOptions['localPeerSync'],
) {
  if (!options || typeof BroadcastChannel === 'undefined') {
    return []
  }

  return [
    new BroadcastChannelNetworkAdapter({
      channelName: options?.channelName ?? 'cad-authored-documents',
      peerWaitMs: options?.peerWaitMs ?? 100,
    }),
  ]
}

function createLocalPeerDocumentChannel(
  options: IndexedDbAutomergeDocumentRepositoryOptions['localPeerSync'],
) {
  if (!options || typeof BroadcastChannel === 'undefined') {
    return null
  }

  const channelName = options.channelName ?? 'cad-authored-documents'
  return new BroadcastChannel(`${channelName}:documents`)
}

function isLocalPeerDocumentMessage(value: unknown): value is LocalPeerDocumentMessage {
  return typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'cad-authored-document-repository/document-updated'
    && typeof (value as { senderId?: unknown }).senderId === 'string'
    && typeof (value as { documentId?: unknown }).documentId === 'string'
    && typeof (value as { document?: unknown }).document === 'object'
    && (value as { document?: unknown }).document !== null
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false
  }

  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

function documentsEqual(left: AuthoredModelDocument | undefined, right: AuthoredModelDocument) {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right)
}
