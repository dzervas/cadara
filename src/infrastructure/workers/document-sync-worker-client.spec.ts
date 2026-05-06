import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { createSeedAuthoredModelDocument } from '@/domain/modeling/modeling-test-fixtures'
import type {
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
  DocumentSyncWriteStatus,
} from '@/domain/modeling/document-sync-worker-protocol'
import type { LocalFileBindingRecord, LocalFileBindingStore } from '@/domain/modeling/local-file-binding-store'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'
import { DocumentSyncWorkerClient, type DocumentSyncWorkerLike } from '@/infrastructure/workers/document-sync-worker-client'
import { createDocumentSyncWorkerMessageHandler } from '@/infrastructure/workers/document-sync-worker-runtime'
import type { DocumentRepositoryUrlStore } from '@/infrastructure/persistence/document-repository-url-store'
import {
  createLocalAuthoredDocumentPayload,
  type LocalFileSystemFileHandle,
} from '@/lib/local-file-system-access'

test('src/infrastructure/workers/document-sync-worker-client.spec.ts', async () => {  async function testRequestOrderingAndStructuredFailures() {
    const worker = new FakeDocumentSyncWorker()
    const client = new DocumentSyncWorkerClient({ worker })
    const seed = await createSeedAuthoredModelDocument()

    const first = client.getWriteStatus({ documentId: seed.documentId })
    const second = client.getWriteStatus({ documentId: seed.documentId })
    const firstRequest = worker.posted[0]!
    const secondRequest = worker.posted[1]!

    worker.emit({
      kind: 'writeStatus',
      requestId: secondRequest.requestId,
      status: { kind: 'idle', documentId: seed.documentId, sequence: 2 },
    })
    worker.emit({
      kind: 'writeStatus',
      requestId: firstRequest.requestId,
      status: { kind: 'idle', documentId: seed.documentId, sequence: 1 },
    })

    expectTrue((await first).sequence === 1, 'First request should resolve from its own response even when responses arrive out of order.')
    expectTrue((await second).sequence === 2, 'Second request should resolve from its own response even when it arrives first.')

    const failed = client.getWriteStatus({ documentId: seed.documentId })
    const failedRequest = worker.posted[2]!
    worker.emit({
      kind: 'failure',
      requestId: failedRequest.requestId,
      error: {
        code: 'document-sync-worker-request-failed',
        message: 'worker exploded',
      },
    })

    let rejected = false
    try {
      await failed
    } catch (error: unknown) {
      rejected = error instanceof Error && error.message === 'worker exploded'
    }
    expectTrue(rejected, 'Structured worker failures should reject the matching request with the worker message.')
    client.dispose()
  }

  async function testSubscriptionDisposalAndStaleWriteStatusFiltering() {
    const worker = new FakeDocumentSyncWorker()
    const client = new DocumentSyncWorkerClient({ worker })
    const seed = await createSeedAuthoredModelDocument()
    const observedDocuments: AuthoredModelDocument[] = []

    const pendingSubscription = client.subscribe(seed.documentId, (event) => {
      observedDocuments.push(event.document)
    })
    const subscribeRequest = worker.posted[0]!
    expectTrue(subscribeRequest.kind === 'subscribe', 'Client should post a subscribe request.')
    worker.emit({
      kind: 'subscribed',
      requestId: subscribeRequest.requestId,
      subscriptionId: subscribeRequest.subscriptionId,
    })
    const unsubscribe = await pendingSubscription

    worker.emit({
      kind: 'documentChanged',
      subscriptionId: subscribeRequest.subscriptionId,
      event: {
        document: seed,
        status: { kind: 'restored', documentId: seed.documentId },
        metadata: { documentId: seed.documentId, heads: ['head_1'], source: 'peer' },
      },
    })
    expectTrue(observedDocuments.length === 1, 'Active subscriptions should receive worker document change events.')

    unsubscribe()
    expectTrue(worker.posted[1]?.kind === 'unsubscribe', 'Disposing a subscription should post an unsubscribe request.')
    worker.emit({
      kind: 'documentChanged',
      subscriptionId: subscribeRequest.subscriptionId,
      event: {
        document: seed,
        status: { kind: 'restored', documentId: seed.documentId },
        metadata: { documentId: seed.documentId, heads: ['head_2'], source: 'peer' },
      },
    })
    expectTrue(observedDocuments.length === 1, 'Disposed subscriptions should ignore later worker change events.')

    const statuses: DocumentSyncWriteStatus[] = []
    client.subscribeToWriteStatus((status) => statuses.push(status))
    worker.emit({ kind: 'writeStatusChanged', status: { kind: 'idle', documentId: seed.documentId, sequence: 2 } })
    worker.emit({ kind: 'writeStatusChanged', status: { kind: 'idle', documentId: seed.documentId, sequence: 1 } })
    worker.emit({ kind: 'writeStatusChanged', status: { kind: 'idle', documentId: seed.documentId, sequence: 3 } })
    expectTrue(
      statuses.map((status) => status.sequence).join(',') === '2,3',
      'Stale write status messages should be ignored by document id and sequence.',
    )
    client.dispose()
  }

  async function testWorkerRuntimeShell() {
    const seed = await createSeedAuthoredModelDocument()
    const repository = createMemoryDocumentRepository()
    const posted: DocumentSyncWorkerResponse[] = []
    const handle = createDocumentSyncWorkerMessageHandler({ repository }, (message) => posted.push(message))

    await handle({
      kind: 'load',
      requestId: 'request_document_sync_load' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      seedDocument: seed,
    })
    expectTrue(posted[0]?.kind === 'loaded', 'Worker shell should route repository load requests.')

    await handle({
      kind: 'subscribe',
      requestId: 'request_document_sync_subscribe' as DocumentSyncWorkerRequest['requestId'],
      subscriptionId: 'subscription_document_sync_test',
      documentId: seed.documentId,
    })
    expectTrue(posted[1]?.kind === 'subscribed', 'Worker shell should acknowledge repository subscriptions.')

    await handle({
      kind: 'unsubscribe',
      requestId: 'request_document_sync_unsubscribe' as DocumentSyncWorkerRequest['requestId'],
      subscriptionId: 'subscription_document_sync_test',
    })
    expectTrue(posted[2]?.kind === 'unsubscribed', 'Worker shell should acknowledge repository unsubscriptions.')

    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_mutate' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) => ({
          ...label,
          label: 'Worker Body',
        })),
      },
    })
    expectTrue(!posted.some((message) => message.kind === 'documentChanged'), 'Unsubscribed listeners should not receive later repository change events.')
    expectTrue(posted.some((message) => message.kind === 'mutated'), 'Worker shell should respond to repository mutations.')

    await handle({
      kind: 'normalize',
      requestId: 'request_document_sync_normalize' as DocumentSyncWorkerRequest['requestId'],
      document: seed,
      metadata: { documentId: seed.documentId, heads: ['head_normalized'], source: 'restore' },
    })
    expectTrue(posted.some((message) => message.kind === 'normalized'), 'Worker shell should own authored document normalization requests.')

    const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [seed.features[0]!.featureId] })
    const documentWithAsset = {
      ...seed,
      assets: {
        schemaVersion: 'geometry-asset-manifest/v1alpha1' as const,
        records: [asset.asset],
      },
    }
    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_asset_mutate' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: documentWithAsset,
    })
    expectTrue(
      posted.some((message) => message.kind === 'mutated' && message.requestId === 'request_document_sync_asset_mutate' && message.result.ok),
      'Worker shell should mutate documents with embedded geometry asset data.',
    )

    await handle({
      kind: 'getGeometryAssetRecord',
      requestId: 'request_document_sync_asset_record' as DocumentSyncWorkerRequest['requestId'],
      asset: asset.asset,
    })
    expectTrue(
      posted.some((message) => message.kind === 'geometryAssetRecord' && message.bytes?.byteLength === asset.bytes.byteLength),
      'Worker shell should proxy verified embedded asset bytes from the repository.',
    )
  }

  async function testWorkerRuntimeStorageResetAndBindingFailures() {
    const seed = await createSeedAuthoredModelDocument()
    const repository = createMemoryDocumentRepository()
    const urlStore = new MemoryDocumentRepositoryUrlStore()
    const failingBindingStore = new FailingLocalFileBindingStore()
    const posted: DocumentSyncWorkerResponse[] = []
    const handle = createDocumentSyncWorkerMessageHandler(
      { repository, repositoryUrlStore: urlStore, bindingStore: failingBindingStore },
      (message) => posted.push(message),
    )

    await handle({
      kind: 'load',
      requestId: 'request_document_sync_storage_load' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      storageKey: 'automerge:stored-url',
      seedDocument: seed,
    })
    expectTrue(
      urlStore.values.get(seed.documentId) === 'automerge:stored-url'
        && posted[0]?.kind === 'loaded',
      'Load should persist the provided repository storage key before delegating to the repository.',
    )

    await handle({
      kind: 'getWriteStatus',
      requestId: 'request_document_sync_idle_status' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
    })
    expectTrue(
      posted.some((message) => message.kind === 'writeStatus' && message.status.kind === 'idle' && message.status.sequence === 0),
      'Write-status requests should default to an idle status before any sync activity has occurred.',
    )

    await handle({
      kind: 'getGeometryAssetBytes',
      requestId: 'request_document_sync_asset_bytes_missing' as DocumentSyncWorkerRequest['requestId'],
      hash: 'sha256:missing' as DocumentSyncWorkerRequest['kind'] extends never ? never : never,
    })
    expectTrue(
      posted.some((message) => message.kind === 'geometryAssetBytes' && message.bytes === null),
      'Repositories without geometry-asset support should return null asset bytes cleanly.',
    )

    await handle({
      kind: 'restoreBinding',
      requestId: 'request_document_sync_restore_failure' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
    })
    expectTrue(
      posted.some((message) => message.kind === 'failure' && message.error.message === 'Persistent local file binding storage is unavailable.'),
      'Unsupported persistent binding storage should surface a structured worker failure during binding restore.',
    )

    const writableHandle = createWritableHandle({
      name: 'persist-unavailable.cadara',
      writes: [],
      permission: 'granted',
    })
    await handle({
      kind: 'bindFileHandle',
      requestId: 'request_document_sync_bind_persist_unavailable' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      handle: writableHandle.handle,
      metadata: {
        documentId: seed.documentId,
        fileName: 'persist-unavailable.cadara',
        storedAt: '2026-04-23T00:00:00.000Z',
      },
    })
    expectTrue(
      posted.some((message) => message.kind === 'fileHandleBound')
        && posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'persistent-binding-unavailable')
        && posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'synced'),
      'Unsupported binding persistence should still bind the handle, publish persistence-unavailable status, and keep sync active.',
    )

    failingBindingStore.failSave = true
    await handle({
      kind: 'bindFileHandle',
      requestId: 'request_document_sync_bind_failure' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      handle: writableHandle.handle,
      metadata: {
        documentId: seed.documentId,
        fileName: 'persist-failure.cadara',
        storedAt: '2026-04-23T00:01:00.000Z',
      },
    })
    expectTrue(
      posted.some((message) => message.kind === 'failure' && message.error.message === 'Local file binding could not be persisted.'),
      'Persisted binding failures should surface a structured worker failure.',
    )

    await handle({
      kind: 'reset',
      requestId: 'request_document_sync_storage_reset' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
    })
    expectTrue(
      urlStore.deleted.includes(seed.documentId)
        && posted.some((message) => message.kind === 'reset' && message.status.kind === 'reset'),
      'Reset should clear the stored repository url and return the repository reset status.',
    )
  }

  async function testWorkerRuntimeFileBindingAutosyncAndPermissionFailures() {
    const seed = await createSeedAuthoredModelDocument()
    const repository = createMemoryDocumentRepository()
    const bindingStore = new MemoryLocalFileBindingStore()
    const posted: DocumentSyncWorkerResponse[] = []
    const handle = createDocumentSyncWorkerMessageHandler(
      { repository, bindingStore },
      (message) => posted.push(message),
    )
    await handle({
      kind: 'load',
      requestId: 'request_document_sync_file_load' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      seedDocument: seed,
    })

    const writeGate = createDeferred<void>()
    const writableHandle = createWritableHandle({
      name: 'autosync.cadara',
      writes: [],
      writeGate,
      permission: 'granted',
    })
    await handle({
      kind: 'bindFileHandle',
      requestId: 'request_document_sync_file_bind' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      handle: writableHandle.handle,
      metadata: {
        documentId: seed.documentId,
        fileName: 'autosync.cadara',
        storedAt: '2026-04-22T00:00:00.000Z',
      },
    })
    expectTrue(bindingStore.saved.length === 1, 'Binding file handles should be persisted outside the authored document.')
    expectTrue(posted.some((message) => message.kind === 'fileHandleBound'), 'Binding a file handle should acknowledge the active sync target.')

    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_file_mutate_1' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: withBodyLabel(seed, 'Autosync One'),
    })
    await flushAsync()
    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_file_mutate_2' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: withBodyLabel(seed, 'Autosync Two'),
    })
    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_file_mutate_3' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: withBodyLabel(seed, 'Autosync Three'),
    })
    writeGate.resolve()
    await flushAsync()

    expectTrue(writableHandle.writes.length === 2, 'Rapid accepted changes should coalesce while a direct write is in flight.')
    expectTrue(writableHandle.writes[0]?.includes('Autosync One'), 'The in-flight write should complete the first accepted state.')
    expectTrue(writableHandle.writes[1]?.includes('Autosync Three'), 'The coalesced follow-up write should persist the latest accepted state.')
    expectTrue(
      posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'syncing')
        && posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'synced'),
      'Autosync writes should publish visible syncing and synced statuses.',
    )

    const deniedHandle = createWritableHandle({
      name: 'denied.cadara',
      writes: [],
      permission: 'denied',
    })
    await handle({
      kind: 'bindFileHandle',
      requestId: 'request_document_sync_file_bind_denied' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      handle: deniedHandle.handle,
      metadata: {
        documentId: seed.documentId,
        fileName: 'denied.cadara',
        storedAt: '2026-04-22T00:01:00.000Z',
      },
    })
    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_file_mutate_denied' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: withBodyLabel(seed, 'Permission Denied'),
    })
    await flushAsync()
    expectTrue(
      posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'permission-denied'),
      'Denied write permission should publish a permission-denied sync status without clearing repository state.',
    )

    const failingHandle = createFailingWritableHandle('failed.cadara')
    await handle({
      kind: 'bindFileHandle',
      requestId: 'request_document_sync_file_bind_failed' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      handle: failingHandle,
      metadata: {
        documentId: seed.documentId,
        fileName: 'failed.cadara',
        storedAt: '2026-04-22T00:02:00.000Z',
      },
    })
    await handle({
      kind: 'mutate',
      requestId: 'request_document_sync_file_mutate_failed' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      document: withBodyLabel(seed, 'Write Failed'),
    })
    await flushAsync()
    expectTrue(
      posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'failed'),
      'Direct write failures should publish a failed sync status without clearing repository state.',
    )

    await handle({
      kind: 'restoreBinding',
      requestId: 'request_document_sync_file_restore' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
    })
    expectTrue(
      posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'binding-restored')
        && posted.some((message) => message.kind === 'bindingRestored' && message.record?.metadata.fileName === 'failed.cadara'),
      'Restoring a persisted binding should publish binding-restored status before returning the restored record.',
    )

    await handle({
      kind: 'getWriteStatus',
      requestId: 'request_document_sync_file_status_after_restore' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
    })
    expectTrue(
      posted.some((message) => message.kind === 'writeStatus' && message.status.kind === 'binding-restored'),
      'The latest write status should report the restored binding after a successful binding restore.',
    )
    expectTrue(
      posted.some((message) => message.kind === 'bindingRestored' && message.record?.metadata.fileName === 'failed.cadara'),
      'Persisted local file bindings should restore through the worker binding store.',
    )
  }

  async function testWorkerRuntimeLoadReReadsBoundFilesystemFile() {
    const seed = await createSeedAuthoredModelDocument()
    const staleBrowserDocument = withBodyLabel(seed, 'Stale Browser State')
    const authoritativeFileDocument = withBodyLabel(seed, 'Authoritative File State')
    const repository = createMemoryDocumentRepository([staleBrowserDocument])
    const bindingStore = new MemoryLocalFileBindingStore()
    const posted: DocumentSyncWorkerResponse[] = []
    const writes: string[] = []
    await bindingStore.save({
      metadata: {
        documentId: seed.documentId,
        fileName: 'authoritative.cadara',
        storedAt: '2026-05-06T00:00:00.000Z',
      },
      handle: createWritableHandle({
        name: 'authoritative.cadara',
        writes,
        fileText: createLocalAuthoredDocumentPayload(authoritativeFileDocument),
        permission: 'granted',
      }).handle,
    })
    const handle = createDocumentSyncWorkerMessageHandler(
      { repository, bindingStore },
      (message) => posted.push(message),
    )

    await handle({
      kind: 'load',
      requestId: 'request_document_sync_file_backed_load' as DocumentSyncWorkerRequest['requestId'],
      documentId: seed.documentId,
      seedDocument: seed,
    })

    const loaded = posted.find((message): message is Extract<DocumentSyncWorkerResponse, { kind: 'loaded' }> =>
      message.kind === 'loaded' && message.requestId === 'request_document_sync_file_backed_load',
    )
    expectTrue(
      loaded?.result.ok === true && loaded.result.document.bodyLabels[0]?.label === 'Authoritative File State',
      'File-backed document loads should use the current linked filesystem file instead of stale browser repository state.',
    )
    expectTrue(
      repository.savedDocuments.at(-1)?.bodyLabels[0]?.label === 'Authoritative File State',
      'The repository should be refreshed from the bound file during initialization.',
    )
    expectTrue(writes.length === 0, 'Re-reading a bound filesystem file during load should not autosync-write back to the same file.')
    expectTrue(
      posted.some((message) => message.kind === 'writeStatusChanged' && message.status.kind === 'binding-restored'),
      'File-backed document loads should restore the persisted binding while initializing.',
    )
  }

  await testRequestOrderingAndStructuredFailures()
  await testSubscriptionDisposalAndStaleWriteStatusFiltering()
  await testWorkerRuntimeShell()
  await testWorkerRuntimeFileBindingAutosyncAndPermissionFailures()
  await testWorkerRuntimeLoadReReadsBoundFilesystemFile()
  await testWorkerRuntimeStorageResetAndBindingFailures()
})

class FakeDocumentSyncWorker implements DocumentSyncWorkerLike {
  readonly posted: DocumentSyncWorkerRequest[] = []
  private listener: ((event: MessageEvent<DocumentSyncWorkerResponse>) => void) | null = null

  postMessage(message: DocumentSyncWorkerRequest) {
    this.posted.push(message)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void) {
    this.listener = listener
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void) {
    if (this.listener === listener) {
      this.listener = null
    }
  }

  emit(message: DocumentSyncWorkerResponse) {
    this.listener?.({ data: message } as MessageEvent<DocumentSyncWorkerResponse>)
  }
}

class MemoryLocalFileBindingStore implements LocalFileBindingStore {
  saved: LocalFileBindingRecord[] = []

  isSupported() {
    return true
  }

  async load(documentId: LocalFileBindingRecord['metadata']['documentId']) {
    return {
      ok: true as const,
      value: this.saved.find((record) => record.metadata.documentId === documentId) ?? null,
    }
  }

  async save(record: LocalFileBindingRecord) {
    this.saved = this.saved
      .filter((current) => current.metadata.documentId !== record.metadata.documentId)
      .concat(record)
    return { ok: true as const, value: record.metadata }
  }

  async clear(documentId: LocalFileBindingRecord['metadata']['documentId']) {
    this.saved = this.saved.filter((record) => record.metadata.documentId !== documentId)
    return { ok: true as const, value: null }
  }
}

class FailingLocalFileBindingStore implements LocalFileBindingStore {
  failSave = false

  isSupported() {
    return true
  }

  async load() {
    return { ok: false as const, reason: 'unsupported-storage' as const }
  }

  async save(_record: LocalFileBindingRecord) {
    return this.failSave
      ? { ok: false as const, reason: 'failed' as const }
      : { ok: false as const, reason: 'unsupported-storage' as const }
  }

  async clear() {
    return { ok: true as const, value: null }
  }
}

class MemoryDocumentRepositoryUrlStore implements DocumentRepositoryUrlStore {
  values = new Map<string, string>()
  deleted: string[] = []

  get(documentId: string) {
    return this.values.get(documentId) ?? null
  }

  set(documentId: string, url: string) {
    this.values.set(documentId, url)
  }

  delete(documentId: string) {
    this.deleted.push(documentId)
    this.values.delete(documentId)
  }
}

function withBodyLabel(seed: AuthoredModelDocument, label: string) {
  return {
    ...seed,
    bodyLabels: seed.bodyLabels.map((bodyLabel) => ({
      ...bodyLabel,
      label,
    })),
  }
}

function createWritableHandle(options: {
  name: string
  writes: string[]
  fileText?: string
  permission: 'granted' | 'denied'
  writeGate?: Deferred<void>
}) {
  const writes = options.writes
  let firstWrite = true
  const handle: LocalFileSystemFileHandle = {
    name: options.name,
    async getFile() {
      return new File([options.fileText ?? ''], options.name)
    },
    async createWritable() {
      return {
        async write(data) {
          writes.push(String(data))
          if (firstWrite && options.writeGate) {
            firstWrite = false
            await options.writeGate.promise
          }
        },
        close() {},
      }
    },
    async queryPermission() {
      return options.permission === 'granted' ? 'granted' : 'prompt'
    },
    async requestPermission() {
      return options.permission
    },
  }
  return { handle, writes }
}

function createFailingWritableHandle(name: string): LocalFileSystemFileHandle {
  return {
    name,
    async getFile() {
      return new File([], name)
    },
    async createWritable() {
      return {
        write() {
          throw new Error('disk full')
        },
        close() {},
      }
    },
    async queryPermission() {
      return 'granted'
    },
    async requestPermission() {
      return 'granted'
    },
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
