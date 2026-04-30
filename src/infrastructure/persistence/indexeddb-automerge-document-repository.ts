import { initializeBase64Wasm, Repo } from '@automerge/automerge-repo/slim'
import type { AutomergeUrl } from '@automerge/automerge-repo/slim'
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'

import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import type { DocumentId } from '@/contracts/shared/ids'
import type { GeometryAssetBlobInput, GeometryAssetHash, GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import {
  createLocalStorageDocumentRepositoryUrlStore,
  MemoryDocumentRepositoryUrlStore,
  type DocumentRepositoryUrlStore,
} from '@/infrastructure/persistence/document-repository-url-store'
import type {
  GeometryAssetDocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryChangeSource,
  DocumentRepositoryMetadata,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'
import {
  collectAssetAvailability,
  createIndexedDbGeometryAssetStore,
  filterGeometryAssetInputsForManifest,
  storeGeometryAssetInputsForManifest,
  type GeometryAssetStore,
} from '@/domain/modeling/geometry-asset-store'

interface AutomergeDocumentEnvelope {
  authoredDocument: AuthoredModelDocument
}

interface LocalPeerDocumentMessage {
  type: 'cad-authored-document-repository/document-updated'
  senderId: string
  documentId: DocumentId
  document: AuthoredModelDocument
  assets?: GeometryAssetBlobInput[]
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

export interface IndexedDbAutomergeDocumentRepositoryOptions {
  repo?: AutomergeRepositoryLike
  urlStore?: DocumentRepositoryUrlStore
  databaseName?: string
  storeName?: string
  assetStore?: GeometryAssetStore
  localPeerSync?: false | {
    channelName?: string
    peerWaitMs?: number
  }
}


export class IndexedDbAutomergeDocumentRepository implements GeometryAssetDocumentRepository {
  private repo: AutomergeRepositoryLike | null
  private readonly urlStore: DocumentRepositoryUrlStore
  private readonly databaseName?: string
  private readonly storeName?: string
  private readonly localPeerSync: IndexedDbAutomergeDocumentRepositoryOptions['localPeerSync']
  private readonly assetStore: GeometryAssetStore
  private readonly statuses = new Map<DocumentId, DocumentRepositoryRestoreStatus>()
  private readonly metadata = new Map<DocumentId, DocumentRepositoryMetadata>()
  private readonly handles = new Map<DocumentId, AutomergeHandleLike<AutomergeDocumentEnvelope>>()
  private readonly localPeerDocuments = new Map<DocumentId, AuthoredModelDocument>()
  private readonly installedListeners = new Set<string>()
  private readonly pendingLocalChanges = new Set<DocumentId>()
  private readonly pendingSeedEchoes = new Map<DocumentId, AuthoredModelDocument>()
  private readonly listeners = new Map<DocumentId, Set<(event: DocumentRepositoryChangeEvent) => void>>()
  private readonly localPeerId = `peer-${Math.random().toString(36).slice(2)}`
  private readonly localPeerDocumentChannel: BroadcastChannel | null
  private readonly prepareAutomerge: () => Promise<void>

  constructor(options: IndexedDbAutomergeDocumentRepositoryOptions = {}) {
    this.prepareAutomerge = options.repo ? async () => {} : ensureAutomergeWasmInitialized
    this.repo = options.repo ?? null
    this.urlStore = options.urlStore ?? new MemoryDocumentRepositoryUrlStore()
    this.databaseName = options.databaseName
    this.storeName = options.storeName
    this.assetStore = options.assetStore ?? createIndexedDbGeometryAssetStore({
      databaseName: `${options.databaseName ?? 'cad-authored-documents'}-geometry-assets`,
    })
    this.localPeerSync = options.localPeerSync
    this.localPeerDocumentChannel = createLocalPeerDocumentChannel(options.localPeerSync)
    this.localPeerDocumentChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.receiveLocalPeerDocumentMessage(event.data)
    })
  }

  async load(input: { documentId: DocumentId; seedDocument: AuthoredModelDocument }): Promise<DocumentRepositoryLoadResult> {
    try {
      const repo = await this.getRepo()
      const url = this.urlStore.get(input.documentId)
      if (!url) {
        return await this.createSeedDocument(input.documentId, input.seedDocument)
      }

      const handle = await repo.find<AutomergeDocumentEnvelope>(url)
      await handle.whenReady()
      this.handles.set(input.documentId, handle)
      this.installHandleListener(input.documentId, handle)
      const parsed = parseAuthoredModelDocument(structuredClone(handle.doc().authoredDocument))
      if (!parsed.ok) {
        return this.fail(input.documentId, parsed.diagnostic)
      }

      const status = { kind: 'restored' as const, documentId: input.documentId }
      const assets = await collectAssetAvailability(this.assetStore, parsed.document.assets.records)
      const metadata = this.createMetadata(input.documentId, handle, 'restore', assets.availability)
      this.statuses.set(input.documentId, status)
      this.metadata.set(input.documentId, metadata)
      return {
        ok: true,
        document: parsed.document,
        diagnostics: assets.diagnostics,
        assetAvailability: assets.availability,
        status,
        metadata,
      }
    } catch (error: unknown) {
      return this.fail(input.documentId, createFailureDiagnostic('automerge-load-failed', error, 'Authored document could not be loaded.'))
    }
  }

  async mutate(input: { documentId: DocumentId; document: AuthoredModelDocument; assets?: readonly GeometryAssetBlobInput[] }): Promise<DocumentRepositoryMutationResult> {
    const parsed = parseAuthoredModelDocument(structuredClone(input.document))
    if (!parsed.ok) {
      return this.fail(input.documentId, parsed.diagnostic)
    }

    const stored = await storeGeometryAssetInputsForManifest(this.assetStore, parsed.document.assets.records, input.assets ?? [])
    if (!stored.ok) {
      return this.fail(input.documentId, { reasonCode: stored.diagnostic.code, message: stored.diagnostic.message })
    }

    const assets = await collectAssetAvailability(this.assetStore, parsed.document.assets.records)
    if (assets.diagnostics.length > 0) {
      const diagnostic = assets.diagnostics[0]!
      return this.fail(input.documentId, { reasonCode: diagnostic.code, message: diagnostic.message })
    }

    try {
      const handle = await this.getHandle(input.documentId, parsed.document)
      this.pendingLocalChanges.add(input.documentId)
      handle.change((doc) => {
        doc.authoredDocument = structuredClone(parsed.document)
      })
      await this.flush(handle)
      const status = { kind: 'restored' as const, documentId: input.documentId }
      const metadata = this.createMetadata(input.documentId, handle, 'local', assets.availability)
      this.statuses.set(input.documentId, status)
      this.metadata.set(input.documentId, metadata)
      await this.broadcastLocalPeerDocument(input.documentId, parsed.document)
      return {
        ok: true,
        document: parsed.document,
        diagnostics: [],
        assetAvailability: assets.availability,
        status,
        metadata,
      }
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
      const repo = await this.getRepo()
      repo.delete(url)
    }
    this.handles.delete(documentId)
    this.localPeerDocuments.delete(documentId)
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

  async getGeometryAssetBytes(hash: GeometryAssetHash) {
    const asset = [
      ...[...this.handles.values()].map((handle) => handle.doc().authoredDocument),
      ...this.localPeerDocuments.values(),
    ]
      .flatMap((document) => document.assets.records)
      .find((record) => record.hash === hash)
    return asset ? this.getGeometryAssetRecord(asset) : null
  }

  async getGeometryAssetRecord(asset: GeometryAssetRecord) {
    const result = await this.assetStore.get(asset)
    return result.ok ? result.bytes : null
  }

  private async createSeedDocument(documentId: DocumentId, seedDocument: AuthoredModelDocument): Promise<DocumentRepositoryLoadResult> {
    const repo = await this.getRepo()
    const parsed = parseAuthoredModelDocument(structuredClone(seedDocument))
    if (!parsed.ok) {
      return this.fail(documentId, parsed.diagnostic)
    }

    const handle = repo.create<AutomergeDocumentEnvelope>({
      authoredDocument: structuredClone(parsed.document),
    })
    await handle.whenReady()
    this.handles.set(documentId, handle)
    this.urlStore.set(documentId, handle.url)
    await this.flush(handle)
    const status = { kind: 'seeded' as const, documentId }
    const assets = await collectAssetAvailability(this.assetStore, parsed.document.assets.records)
    const metadata = this.createMetadata(documentId, handle, 'seed', assets.availability)
    this.statuses.set(documentId, status)
    this.metadata.set(documentId, metadata)
    this.pendingSeedEchoes.set(documentId, structuredClone(parsed.document))
    this.installHandleListener(documentId, handle)
    this.notify(documentId, parsed.document, status, metadata, assets.diagnostics, assets.availability)
    return {
      ok: true,
      document: parsed.document,
      diagnostics: assets.diagnostics,
      assetAvailability: assets.availability,
      status,
      metadata,
    }
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

    const repo = await this.getRepo()
    const handle = await repo.find<AutomergeDocumentEnvelope>(url)
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
      void this.handleAutomergeChange(documentId, handle)
    }
    handle.on('change', callback)
  }

  private async handleAutomergeChange(documentId: DocumentId, handle: AutomergeHandleLike<AutomergeDocumentEnvelope>) {
      const parsed = parseAuthoredModelDocument(structuredClone(handle.doc().authoredDocument))
      if (!parsed.ok) {
        this.fail(documentId, parsed.diagnostic)
        return
      }

      const status = { kind: 'restored' as const, documentId }
      const source = this.pendingLocalChanges.has(documentId) ? 'local' : 'peer'
      this.pendingLocalChanges.delete(documentId)
      const assets = await collectAssetAvailability(this.assetStore, parsed.document.assets.records)
      const metadata = this.createMetadata(documentId, handle, source, assets.availability)
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
      this.notify(documentId, parsed.document, status, metadata, assets.diagnostics, assets.availability)
  }

  private async flush(handle: AutomergeHandleLike<AutomergeDocumentEnvelope>) {
    const repo = await this.getRepo()
    await repo.flush?.([handle.documentId])
  }

  private async getRepo() {
    if (this.repo) {
      return this.repo
    }

    await this.prepareAutomerge()
    this.repo = new Repo({
      storage: new IndexedDBStorageAdapter(this.databaseName ?? 'cad-authored-documents', this.storeName ?? 'documents'),
      network: createLocalPeerNetwork(this.localPeerSync),
    }) as AutomergeRepositoryLike
    return this.repo
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
    assetAvailability = [] as NonNullable<DocumentRepositoryMetadata['assetAvailability']>,
  ): DocumentRepositoryMetadata {
    const heads = handle.heads?.() ?? [`automerge:${handle.documentId}:${handle.doc().authoredDocument.revisionId}`]
    return {
      documentId,
      heads: [...heads].sort(),
      source,
      storageKey: handle.url,
      assetAvailability,
    }
  }

  private notify(
    documentId: DocumentId,
    document: AuthoredModelDocument,
    status: DocumentRepositoryRestoreStatus,
    metadata: DocumentRepositoryMetadata,
    diagnostics: DocumentRepositoryChangeEvent['diagnostics'] = [],
    assetAvailability: DocumentRepositoryChangeEvent['assetAvailability'] = [],
  ) {
    for (const listener of this.listeners.get(documentId) ?? []) {
      listener({
        document: structuredClone(document),
        diagnostics,
        assetAvailability,
        status,
        metadata,
      })
    }
  }

  private async broadcastLocalPeerDocument(documentId: DocumentId, document: AuthoredModelDocument) {
    if (!this.localPeerDocumentChannel) {
      return
    }

    const assets: GeometryAssetBlobInput[] = []
    for (const asset of document.assets.records) {
      const bytes = await this.getGeometryAssetRecord(asset)
      if (bytes) {
        assets.push({ asset, bytes })
      }
    }

    this.localPeerDocumentChannel?.postMessage({
      type: 'cad-authored-document-repository/document-updated',
      senderId: this.localPeerId,
      documentId,
      document: structuredClone(document),
      assets,
    } satisfies LocalPeerDocumentMessage)
  }

  private receiveLocalPeerDocumentMessage(data: unknown) {
    if (!isLocalPeerDocumentMessage(data) || data.senderId === this.localPeerId) {
      return
    }

    void this.handleLocalPeerDocumentMessage(data)
  }

  private async handleLocalPeerDocumentMessage(data: LocalPeerDocumentMessage) {
    const parsed = parseAuthoredModelDocument(structuredClone(data.document))
    if (!parsed.ok) {
      this.fail(data.documentId, parsed.diagnostic)
      return
    }

    const peerAssets = filterGeometryAssetInputsForManifest(
      parsed.document.assets.records,
      (data.assets ?? []).filter(isLocalPeerAssetBlob),
    )
    await storeGeometryAssetInputsForManifest(this.assetStore, parsed.document.assets.records, peerAssets)

    this.localPeerDocuments.set(data.documentId, structuredClone(parsed.document))
    const assets = await collectAssetAvailability(this.assetStore, parsed.document.assets.records)
    const status = { kind: 'restored' as const, documentId: data.documentId }
    const metadata: DocumentRepositoryMetadata = {
      documentId: data.documentId,
      heads: [`local-peer:${data.senderId}:${parsed.document.revisionId}`],
      source: 'peer',
      assetAvailability: assets.availability,
    }
    this.statuses.set(data.documentId, status)
    this.metadata.set(data.documentId, metadata)
    this.notify(data.documentId, parsed.document, status, metadata, assets.diagnostics, assets.availability)
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
    && (
      (value as { assets?: unknown }).assets === undefined
      || Array.isArray((value as { assets?: unknown }).assets)
    )
}

function isLocalPeerAssetBlob(value: unknown): value is GeometryAssetBlobInput {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { asset?: { hash?: unknown } }).asset?.hash === 'string'
    && (value as { bytes?: unknown }).bytes instanceof Uint8Array
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

export {
  createLocalStorageDocumentRepositoryUrlStore,
  MemoryDocumentRepositoryUrlStore,
}
export type { DocumentRepositoryUrlStore }
