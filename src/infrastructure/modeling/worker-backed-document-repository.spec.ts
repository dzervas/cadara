import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import { createSeedAuthoredModelDocument } from '@/domain/modeling/modeling-test-fixtures'
import type { DocumentSyncWorkerRequest, DocumentSyncWorkerResponse } from '@/domain/modeling/document-sync-worker-protocol'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'
import { createWorkerBackedDocumentRepository } from '@/infrastructure/modeling/worker-backed-document-repository'
import type { DocumentRepositoryUrlStore } from '@/infrastructure/persistence/document-repository-url-store'
import { DocumentSyncWorkerClient, type DocumentSyncWorkerLike } from '@/infrastructure/workers/document-sync-worker-client'

test('src/infrastructure/modeling/worker-backed-document-repository.spec.ts', async () => {  async function testLoadMutatePeerUpdateAndDiagnostics() {
    const seed = await createSeedAuthoredModelDocument()
    const worker = new FakeDocumentSyncWorker()
    const client = new DocumentSyncWorkerClient({ worker })
    const urlStore = createMemoryUrlStore()
    urlStore.set(seed.documentId, 'automerge:stored-url' as Parameters<DocumentRepositoryUrlStore['set']>[1])
    const repository = createWorkerBackedDocumentRepository({ client, urlStore })

    const load = repository.load({ documentId: seed.documentId, seedDocument: seed })
    const loadRequest = worker.takePosted('load')
    expectTrue(loadRequest.storageKey === 'automerge:stored-url', 'Worker-backed loads should pass the stored Automerge URL to the worker.')
    const repositoryDiagnostics: ModelingDiagnostic[] = [{
      code: 'geometry-asset-missing',
      severity: 'error',
      message: 'Referenced geometry asset bytes are missing.',
      target: null,
      detail: null,
    }]
    worker.emit({
      kind: 'loaded',
      requestId: loadRequest.requestId,
      result: {
        ok: true,
        document: seed,
        diagnostics: repositoryDiagnostics,
        status: { kind: 'restored', documentId: seed.documentId },
        metadata: {
          documentId: seed.documentId,
          heads: ['head_load'],
          source: 'restore',
          storageKey: 'automerge:worker-url',
        },
      },
    })
    await flushAsync()
    const loadNormalizeRequest = worker.takePosted('normalize')
    const loadDiagnostics: ModelingDiagnostic[] = [{
      code: 'normalized-order',
      severity: 'warning',
      message: 'Normalized collaborative document order.',
      target: null,
      detail: null,
    }]
    worker.emit({
      kind: 'normalized',
      requestId: loadNormalizeRequest.requestId,
      result: {
        document: {
          ...seed,
          bodyLabels: seed.bodyLabels.map((label) => ({ ...label, label: 'Worker Loaded Body' })),
        },
        diagnostics: loadDiagnostics,
        metadata: {
          documentId: seed.documentId,
          heads: ['head_load'],
          source: 'restore',
          storageKey: 'automerge:worker-url',
        },
      },
    })
    const loaded = await load
    expectTrue(loaded.ok, 'Worker-backed repository load should resolve with worker-normalized documents.')
    expectTrue(
      loaded.ok && loaded.diagnostics?.map((diagnostic) => diagnostic.code).join(',') === 'geometry-asset-missing,normalized-order',
      'Worker-backed loads should preserve repository diagnostics and worker normalization diagnostics.',
    )
    expectTrue(urlStore.get(seed.documentId) === 'automerge:worker-url', 'Worker-returned Automerge URLs should be persisted by the main-thread URL store.')

    const mutation = repository.mutate({ documentId: seed.documentId, document: seed })
    const mutateRequest = worker.takePosted('mutate')
    worker.emit({
      kind: 'mutated',
      requestId: mutateRequest.requestId,
      result: {
        ok: true,
        document: seed,
        status: { kind: 'restored', documentId: seed.documentId },
        metadata: { documentId: seed.documentId, heads: ['head_mutate'], source: 'local' },
      },
    })
    await flushAsync()
    const mutateNormalizeRequest = worker.takePosted('normalize')
    worker.emit({
      kind: 'normalized',
      requestId: mutateNormalizeRequest.requestId,
      result: {
        document: seed,
        diagnostics: [],
        metadata: { documentId: seed.documentId, heads: ['head_mutate'], source: 'local' },
      },
    })
    const mutated = await mutation
    expectTrue(mutated.ok && mutated.metadata.source === 'local', 'Worker-backed mutations should preserve repository metadata.')

    const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [seed.features[0]!.featureId] })
    const documentWithAsset = {
      ...seed,
      assets: {
        schemaVersion: 'geometry-asset-manifest/v1alpha1' as const,
        records: [asset.asset],
      },
    }
    const assetMutation = repository.mutate({
      documentId: seed.documentId,
      document: documentWithAsset,
      assets: [asset],
    })
    const assetMutateRequest = worker.takePosted('mutate')
    expectTrue(
      assetMutateRequest.assets?.[0]?.bytes.byteLength === asset.bytes.byteLength,
      'Worker-backed asset mutations should send package blobs to the document sync worker.',
    )
    worker.emit({
      kind: 'mutated',
      requestId: assetMutateRequest.requestId,
      result: {
        ok: true,
        document: documentWithAsset,
        assetAvailability: [{
          assetId: asset.asset.assetId,
          hash: asset.asset.hash,
          byteLength: asset.asset.byteLength,
          format: asset.asset.format,
          available: true,
        }],
        status: { kind: 'restored', documentId: seed.documentId },
        metadata: { documentId: seed.documentId, heads: ['head_asset'], source: 'local' },
      },
    })
    await flushAsync()
    const assetMutateNormalizeRequest = worker.takePosted('normalize')
    worker.emit({
      kind: 'normalized',
      requestId: assetMutateNormalizeRequest.requestId,
      result: {
        document: documentWithAsset,
        diagnostics: [],
        metadata: { documentId: seed.documentId, heads: ['head_asset'], source: 'local' },
      },
    })
    const assetMutated = await assetMutation
    expectTrue(
      assetMutated.ok && assetMutated.assetAvailability?.[0]?.available,
      'Worker-backed asset mutations should preserve asset availability metadata.',
    )

    const recordBytes = repository.getGeometryAssetRecord(asset.asset)
    const recordRequest = worker.takePosted('getGeometryAssetRecord')
    expectTrue(recordRequest.asset.hash === asset.asset.hash, 'Worker-backed asset record reads should proxy through the worker.')
    worker.emit({ kind: 'geometryAssetRecord', requestId: recordRequest.requestId, bytes: asset.bytes })
    expectTrue((await recordBytes)?.byteLength === asset.bytes.byteLength, 'Worker-backed asset record reads should return worker bytes.')

    const hashBytes = repository.getGeometryAssetBytes(asset.asset.hash)
    const hashRequest = worker.takePosted('getGeometryAssetBytes')
    expectTrue(hashRequest.hash === asset.asset.hash, 'Worker-backed asset hash reads should proxy through the worker.')
    worker.emit({ kind: 'geometryAssetBytes', requestId: hashRequest.requestId, bytes: asset.bytes })
    expectTrue((await hashBytes)?.byteLength === asset.bytes.byteLength, 'Worker-backed asset hash reads should return worker bytes.')

    const observed: string[] = []
    const unsubscribe = repository.subscribe(seed.documentId, (event) => {
      observed.push(`${event.metadata.source}:${event.diagnostics?.length ?? 0}`)
    })
    const subscribeRequest = worker.takePosted('subscribe')
    worker.emit({
      kind: 'subscribed',
      requestId: subscribeRequest.requestId,
      subscriptionId: subscribeRequest.subscriptionId,
    })
    await flushAsync()
    worker.emit({
      kind: 'documentChanged',
      subscriptionId: subscribeRequest.subscriptionId,
      event: {
        document: seed,
        diagnostics: repositoryDiagnostics,
        status: { kind: 'restored', documentId: seed.documentId },
        metadata: { documentId: seed.documentId, heads: ['head_peer'], source: 'peer' },
      },
    })
    await flushAsync()
    const peerNormalizeRequest = worker.takePosted('normalize')
    worker.emit({
      kind: 'normalized',
      requestId: peerNormalizeRequest.requestId,
      result: {
        document: seed,
        diagnostics: [{
          code: 'invalid-peer-merge',
          severity: 'warning',
          message: 'Peer merge repaired a missing cursor.',
          target: null,
          detail: null,
        }],
        metadata: { documentId: seed.documentId, heads: ['head_peer'], source: 'peer' },
      },
    })
    await flushAsync()
    expectTrue(observed.join(',') === 'peer:2', 'Peer updates should keep repository diagnostics after worker normalization.')
    unsubscribe()
    client.dispose()
  }

  await testLoadMutatePeerUpdateAndDiagnostics()
})

function createMemoryUrlStore(): DocumentRepositoryUrlStore {
  const values = new Map<string, string>()
  return {
    get(documentId) {
      return (values.get(documentId) ?? null) as ReturnType<DocumentRepositoryUrlStore['get']>
    },
    set(documentId, url) {
      values.set(documentId, url)
    },
    delete(documentId) {
      values.delete(documentId)
    },
  }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

class FakeDocumentSyncWorker implements DocumentSyncWorkerLike {
  private readonly posted: DocumentSyncWorkerRequest[] = []
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

  takePosted<TKind extends DocumentSyncWorkerRequest['kind']>(kind: TKind) {
    const message = this.posted.shift()
    if (!message || message.kind !== kind) {
      throw new Error(`Expected posted ${kind} request.`)
    }

    return message as Extract<DocumentSyncWorkerRequest, { kind: TKind }>
  }

  emit(message: DocumentSyncWorkerResponse) {
    this.listener?.({ data: message } as MessageEvent<DocumentSyncWorkerResponse>)
  }
}
