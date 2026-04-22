import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

import { createAuthoredModelDocumentFromSnapshot } from '@/contracts/modeling/authored-document'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { DocumentRepositoryUrlStore } from '@/domain/modeling/automerge-indexeddb-document-repository'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { DocumentSyncWorkerClient, type DocumentSyncWorkerLike } from '@/domain/modeling/document-sync-worker-client'
import type { DocumentSyncWorkerRequest, DocumentSyncWorkerResponse } from '@/domain/modeling/document-sync-worker-protocol'
import { createWorkerBackedDocumentRepository } from '@/domain/modeling/worker-backed-document-repository'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/modeling/worker-backed-document-repository.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function createSeedDocument() {
    const adapter = new MockKernelAdapter()
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    return createAuthoredModelDocumentFromSnapshot(snapshot)
  }

  async function testLoadMutatePeerUpdateAndDiagnostics() {
    const seed = await createSeedDocument()
    const worker = new FakeDocumentSyncWorker()
    const client = new DocumentSyncWorkerClient({ worker })
    const urlStore = createMemoryUrlStore()
    urlStore.set(seed.documentId, 'automerge:stored-url' as Parameters<DocumentRepositoryUrlStore['set']>[1])
    const repository = createWorkerBackedDocumentRepository({ client, urlStore })

    const load = repository.load({ documentId: seed.documentId, seedDocument: seed })
    const loadRequest = worker.takePosted('load')
    assert(loadRequest.storageKey === 'automerge:stored-url', 'Worker-backed loads should pass the stored Automerge URL to the worker.')
    worker.emit({
      kind: 'loaded',
      requestId: loadRequest.requestId,
      result: {
        ok: true,
        document: seed,
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
    assert(loaded.ok, 'Worker-backed repository load should resolve with worker-normalized documents.')
    assert(loaded.ok && loaded.diagnostics?.[0]?.code === 'normalized-order', 'Worker normalization diagnostics should remain attached to load results.')
    assert(urlStore.get(seed.documentId) === 'automerge:worker-url', 'Worker-returned Automerge URLs should be persisted by the main-thread URL store.')

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
    assert(mutated.ok && mutated.metadata.source === 'local', 'Worker-backed mutations should preserve repository metadata.')

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
    assert(observed.join(',') === 'peer:1', 'Peer updates should be normalized in the worker before repository listeners are notified.')
    unsubscribe()
    client.dispose()
  }

  function testModelingServiceDoesNotImportMainThreadCollaborativeNormalization() {
    const source = readFileSync(join(process.cwd(), 'src/domain/modeling/modeling-service.ts'), 'utf8')
    assert(
      !source.includes('normalizeCollaborativeAuthoredModelDocument'),
      'Modeling service should consume worker-normalized authored documents instead of importing main-thread collaborative normalization.',
    )
  }

  await testLoadMutatePeerUpdateAndDiagnostics()
  testModelingServiceDoesNotImportMainThreadCollaborativeNormalization()
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
