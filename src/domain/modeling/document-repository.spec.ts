import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createAuthoredModelDocumentFromSnapshot } from '@/contracts/modeling/authored-document'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import {
  createLocalStorageDocumentRepositoryUrlStore,
  IndexedDbAutomergeDocumentRepository,
  type DocumentRepositoryUrlStore,
} from '@/infrastructure/persistence/indexeddb-automerge-document-repository'
import { createMemoryLocalDurableHistoryStore } from '@/domain/modeling/local-durable-history-store'
import { createMemoryGeometryAssetStore } from '@/domain/modeling/geometry-asset-store'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createNewSketchSession } from '@/domain/editor/sketch-session'
import { persistSketchDraftSession } from '@/domain/editor/sketch-session/persistence'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/domain/modeling/document-repository.spec.ts', async () => {  async function createSeedDocument() {
    const adapter = new MockKernelAdapter()
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    return createAuthoredModelDocumentFromSnapshot(snapshot)
  }

  async function testMemoryRepositoryLoadsMutatesSubscribesAndResets() {
    const seed = await createSeedDocument()
    const repository = createMemoryDocumentRepository()
    const loaded = await repository.load({ documentId: seed.documentId, seedDocument: seed })
    expectTrue(loaded.ok, 'Memory repository should create a missing document from the seed document.')
    expectTrue(loaded.status.kind === 'seeded', 'Missing memory documents should report seeded status.')

    let observed: AuthoredModelDocument | null = null
    let observedHeads: readonly string[] = []
    const unsubscribe = repository.subscribe(seed.documentId, (event) => {
      observed = event.document
      observedHeads = event.metadata.heads
    })
    const mutated = await repository.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) =>
          label.bodyId === 'body_part-1' ? { ...label, label: 'Repository Body' } : label,
        ),
      },
    })
    expectTrue(mutated.ok, 'Memory repository should accept plain authored document mutations.')
    expectTrue(observed?.bodyLabels.some((label) => label.label === 'Repository Body'), 'Subscribers should receive plain authored documents.')
    expectTrue(observedHeads[0] === `memory:${mutated.document.revisionId}`, 'Memory repository changes should include head metadata.')
    unsubscribe()
    observed = null
    await repository.mutate({ documentId: seed.documentId, document: seed })
    expectTrue(observed === null, 'Unsubscribed memory repository listeners should not receive later changes.')

    const reset = await repository.reset(seed.documentId)
    expectTrue(reset.kind === 'reset', 'Repository reset should report reset status.')
    const reloaded = await repository.load({ documentId: seed.documentId, seedDocument: seed })
    expectTrue(reloaded.ok && reloaded.status.kind === 'seeded', 'Repository should recreate a seeded document after reset.')
  }

  async function testRepositoryAssetMutationsAreAtomic() {
    const seed = await createSeedDocument()
    const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [seed.features[0]!.featureId] })
    const documentWithAsset: AuthoredModelDocument = {
      ...seed,
      assets: {
        schemaVersion: 'geometry-asset-manifest/v1alpha1',
        records: [asset.asset],
      },
    }
    const repository = createMemoryDocumentRepository()
    await repository.load({ documentId: seed.documentId, seedDocument: seed })

    const unrelatedAsset = await createDeterministicGeometryAsset({
      assetId: 'asset_unreferenced_geometry',
      ownerFeatureIds: [seed.features[0]!.featureId],
      seed: 23,
    })
    const invalidAssetBatch = await repository.mutate({
      documentId: seed.documentId,
      document: documentWithAsset,
      assets: [asset, unrelatedAsset],
    })
    expectTrue(!invalidAssetBatch.ok, 'Asset mutations with blobs outside the authored manifest should fail.')

    const embeddedAsset = await repository.mutate({ documentId: seed.documentId, document: documentWithAsset })
    expectTrue(embeddedAsset.ok, 'Asset-referencing mutations should commit when required bytes are embedded in JSON.')

    const storedAsset = await repository.mutate({
      documentId: seed.documentId,
      document: documentWithAsset,
      assets: [asset],
    })
    expectTrue(storedAsset.ok, 'Asset-referencing mutations should commit after required blobs are stored.')
    expectTrue(
      storedAsset.ok && storedAsset.assetAvailability?.every((entry) => entry.available),
      'Committed asset mutations should report asset availability metadata.',
    )
    expectTrue(
      await repository.getGeometryAssetRecord(asset.asset) !== null,
      'Repository asset resolver should return stored immutable blob bytes.',
    )
  }

  async function testPeerAssetTransferStoresBlobs() {
    const seed = await createSeedDocument()
    const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [seed.features[0]!.featureId] })
    const documentWithAsset: AuthoredModelDocument = {
      ...seed,
      assets: {
        schemaVersion: 'geometry-asset-manifest/v1alpha1',
        records: [asset.asset],
      },
    }
    const peer = new IndexedDbAutomergeDocumentRepository({
      repo: createFakeAutomergeRepo(),
      urlStore: createMemoryUrlStore(),
      assetStore: createMemoryGeometryAssetStore(),
      localPeerSync: false,
    })
    const observed: string[] = []
    peer.subscribe(seed.documentId, (event) => {
      observed.push(`${event.metadata.source}:${event.assetAvailability?.[0]?.available}`)
    })

    await (peer as unknown as {
      handleLocalPeerDocumentMessage(data: unknown): Promise<void>
    }).handleLocalPeerDocumentMessage({
      type: 'cad-authored-document-repository/document-updated',
      senderId: 'peer_source',
      documentId: seed.documentId,
      document: documentWithAsset,
      assets: [asset],
    })

    expectTrue(observed.includes('peer:true'), 'Peer asset transfer should notify with available verified blob metadata.')
    expectTrue(await peer.getGeometryAssetRecord(asset.asset) !== null, 'Peer asset transfer should store received blob bytes.')
    expectTrue(await peer.getGeometryAssetBytes(asset.asset.hash) !== null, 'Peer asset transfer should make blobs resolvable by hash for restore paths.')
  }

  async function testIndexedDbRepositoryUsesInternalHandleAndReportsFailures() {
    const seed = await createSeedDocument()
    const urlStore = createMemoryUrlStore()
    const repo = createFakeAutomergeRepo()
    const repository = new IndexedDbAutomergeDocumentRepository({ repo, urlStore })

    const seedEvents: string[] = []
    repository.subscribe(seed.documentId, (event) => {
      seedEvents.push(event.metadata.source)
    })
    const loaded = await repository.load({ documentId: seed.documentId, seedDocument: seed })
    expectTrue(loaded.ok && loaded.status.kind === 'seeded', 'IndexedDB repository should seed missing Automerge documents.')
    expectTrue(loaded.ok && loaded.metadata.heads.length > 0, 'Seeded Automerge documents should expose causal heads.')
    expectTrue(seedEvents.every((source) => source !== 'peer'), 'Seeded Automerge documents should not emit peer-originated changes.')
    expectTrue(repo.createdCount === 1, 'IndexedDB repository should create an internal Automerge handle for missing documents.')
    expectTrue(urlStore.get(seed.documentId) !== null, 'IndexedDB repository should persist the app document to Automerge URL mapping.')

    const restored = await new IndexedDbAutomergeDocumentRepository({ repo, urlStore }).load({
      documentId: seed.documentId,
      seedDocument: {
        ...seed,
        bodyLabels: [],
      },
    })
    expectTrue(restored.ok && restored.status.kind === 'restored', 'A new repository instance should restore through the stored Automerge URL.')
    expectTrue(restored.ok && restored.metadata.source === 'restore', 'Restored Automerge documents should identify restore as the change source.')
    expectTrue(restored.ok && restored.document.bodyLabels.length === seed.bodyLabels.length, 'Refresh restore should use the stored authored document.')

    const events: string[] = []
    const unsubscribe = repository.subscribe(seed.documentId, (event) => {
      events.push(`${event.metadata.source}:${event.metadata.heads.join('|')}`)
    })
    repo.pushPeerChange(urlStore.get(seed.documentId)!, {
      authoredDocument: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) =>
          label.bodyId === 'body_part-1' ? { ...label, label: 'Peer Body' } : label,
        ),
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expectTrue(events.some((event) => event.startsWith('peer:')), 'Peer-originated handle changes should notify subscribers.')
    unsubscribe()
    const eventCount = events.length
    repo.pushPeerChange(urlStore.get(seed.documentId)!, { authoredDocument: seed })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expectTrue(events.length === eventCount, 'Unsubscribed Automerge repository listeners should not receive later peer changes.')

    const unsupported = await repository.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        schemaVersion: 'authored-model-document/v9' as AuthoredModelDocument['schemaVersion'],
      },
    })
    expectTrue(!unsupported.ok, 'Unsupported authored schemas should fail without replacing existing data.')
    expectTrue(unsupported.status.diagnostic.reasonCode === 'unsupported-schema-version', 'Unsupported schema failures should be explicit.')

    repo.failNextFind = true
    const findFailed = await new IndexedDbAutomergeDocumentRepository({ repo, urlStore }).load({
      documentId: seed.documentId,
      seedDocument: seed,
    })
    expectTrue(!findFailed.ok, 'DocHandle load failures should be reported.')
    expectTrue(findFailed.status.diagnostic.reasonCode === 'automerge-load-failed', 'DocHandle load failures should keep a repository diagnostic.')

    repo.failNextChange = true
    const writeFailed = await repository.mutate({
      documentId: seed.documentId,
      document: seed,
    })
    expectTrue(!writeFailed.ok, 'DocHandle write failures should be reported.')
    expectTrue(writeFailed.status.diagnostic.reasonCode === 'automerge-write-failed', 'Write failures should keep a repository diagnostic.')

    const reset = await repository.reset(seed.documentId)
    expectTrue(reset.kind === 'reset', 'IndexedDB repository reset should clear the mapped document.')
    expectTrue(urlStore.get(seed.documentId) === null, 'Reset should remove the stored Automerge URL mapping.')
  }

  async function testDocumentRepositoriesPersistDurableUndoRedoLocally() {
    const seed = await createSeedDocument()
    const repository = createMemoryDocumentRepository()
    await repository.load({ documentId: seed.documentId, seedDocument: seed })

    const mutated = await repository.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) =>
          label.bodyId === 'body_part-1' ? { ...label, label: 'Durable Undo Body' } : label,
        ),
      },
    })
    expectTrue(mutated.ok, 'Durable history fixtures require the initial repository mutation to succeed.')

    const afterMutation = await repository.getDurableHistoryAvailability(seed.documentId)
    expectTrue(afterMutation.canUndo && !afterMutation.canRedo, 'Accepted local mutations should create one durable undo step.')

    const undone = await repository.undoDurableHistory(seed.documentId)
    expectTrue(
      undone?.ok && undone.document.bodyLabels.every((label) => label.label !== 'Durable Undo Body'),
      'Undo should restore the prior authored document snapshot through the repository seam.',
    )
    const afterUndo = await repository.getDurableHistoryAvailability(seed.documentId)
    expectTrue(!afterUndo.canUndo && afterUndo.canRedo, 'Undo should move durable history availability onto redo.')

    const redone = await repository.redoDurableHistory(seed.documentId)
    expectTrue(
      redone?.ok && redone.document.bodyLabels.some((label) => label.label === 'Durable Undo Body'),
      'Redo should reapply the durable authored document snapshot through the repository seam.',
    )

    await repository.receivePeerDocument({
      ...seed,
      revisionId: 'rev_peer_override' as AuthoredModelDocument['revisionId'],
    })
    const afterPeer = await repository.getDurableHistoryAvailability(seed.documentId)
    expectTrue(
      !afterPeer.canUndo && !afterPeer.canRedo,
      'Peer-authored repository changes should not arrive as locally undoable durable history.',
    )
  }

  async function testIndexedDbRepositoryRestoresDurableHistoryAcrossRefresh() {
    const seed = await createSeedDocument()
    const urlStore = createMemoryUrlStore()
    const repo = createFakeAutomergeRepo()
    const localDurableHistoryStore = createMemoryLocalDurableHistoryStore()
    const repository = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore,
      localDurableHistoryStore,
    })

    await repository.load({ documentId: seed.documentId, seedDocument: seed })
    const mutated = await repository.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) =>
          label.bodyId === 'body_part-1' ? { ...label, label: 'Restored Durable Undo Body' } : label,
        ),
      },
    })
    expectTrue(mutated.ok, 'Refresh durable-history coverage needs an accepted repository mutation.')

    const refreshedRepository = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore,
      localDurableHistoryStore,
    })
    await refreshedRepository.load({ documentId: seed.documentId, seedDocument: seed })
    const restoredAvailability = await refreshedRepository.getDurableHistoryAvailability(seed.documentId)
    expectTrue(
      restoredAvailability.canUndo && !restoredAvailability.canRedo,
      'Refreshing the same local repository should restore durable undo availability from repository-local storage.',
    )
  }

  async function testIndexedDbRepositoryScopesDurableHistoryPerLocalSession() {
    const seed = await createSeedDocument()
    const urlStore = createMemoryUrlStore()
    const repo = createFakeAutomergeRepo()
    const localDurableHistoryStore = createMemoryLocalDurableHistoryStore()
    const sessionA = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore,
      localDurableHistoryStore,
      historyScope: 'session-a',
    })
    await sessionA.load({ documentId: seed.documentId, seedDocument: seed })
    const mutated = await sessionA.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) =>
          label.bodyId === 'body_part-1' ? { ...label, label: 'Scoped Durable Undo Body' } : label,
        ),
      },
    })
    expectTrue(mutated.ok, 'Session-scoped durable history coverage needs an accepted repository mutation.')

    const refreshedSessionA = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore,
      localDurableHistoryStore,
      historyScope: 'session-a',
    })
    await refreshedSessionA.load({ documentId: seed.documentId, seedDocument: seed })
    const sessionAAvailability = await refreshedSessionA.getDurableHistoryAvailability(seed.documentId)
    expectTrue(
      sessionAAvailability.canUndo && !sessionAAvailability.canRedo,
      'Refreshing the same local session should restore that session scoped durable undo state.',
    )

    const sessionB = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore,
      localDurableHistoryStore,
      historyScope: 'session-b',
    })
    await sessionB.load({ documentId: seed.documentId, seedDocument: seed })
    const sessionBAvailability = await sessionB.getDurableHistoryAvailability(seed.documentId)
    expectTrue(
      !sessionBAvailability.canUndo && !sessionBAvailability.canRedo,
      'A different local session should not inherit another session durable undo ledger.',
    )

    await sessionB.reset(seed.documentId)
    const sessionAAfterReset = await refreshedSessionA.getDurableHistoryAvailability(seed.documentId)
    expectTrue(
      sessionAAfterReset.canUndo && !sessionAAfterReset.canRedo,
      'Resetting a different local session should not clear the original session durable undo ledger.',
    )
  }

  async function testIndexedDbUndoFailureKeepsDurableHistoryAvailability() {
    const seed = await createSeedDocument()
    const urlStore = createMemoryUrlStore()
    const repo = createFakeAutomergeRepo()
    const localDurableHistoryStore = createMemoryLocalDurableHistoryStore()
    const repository = new IndexedDbAutomergeDocumentRepository({
      repo,
      urlStore,
      localDurableHistoryStore,
      historyScope: 'session-undo-failure',
    })

    await repository.load({ documentId: seed.documentId, seedDocument: seed })
    const mutated = await repository.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        bodyLabels: seed.bodyLabels.map((label) =>
          label.bodyId === 'body_part-1' ? { ...label, label: 'Undo Failure Body' } : label,
        ),
      },
    })
    expectTrue(mutated.ok, 'Undo failure coverage needs an accepted repository mutation.')

    repo.failNextChange = true
    const failedUndo = await repository.undoDurableHistory(seed.documentId)
    expectTrue(!failedUndo?.ok, 'Undo should surface repository write failures.')

    const availability = await repository.getDurableHistoryAvailability(seed.documentId)
    expectTrue(
      availability.canUndo && !availability.canRedo,
      'A failed durable undo should leave the undo and redo ledger unchanged.',
    )
  }

  async function testRepositoryPersistsLocalSketchDraftHistory() {
    const seed = await createSeedDocument()
    const repository = createMemoryDocumentRepository()
    await repository.load({ documentId: seed.documentId, seedDocument: seed })

    let sketchSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
    const initialDraft = persistSketchDraftSession(sketchSession)
    sketchSession = {
      ...sketchSession,
      sketchLabel: 'Sketch Draft Updated',
      sequence: sketchSession.sequence + 1,
    }
    const updatedDraft = persistSketchDraftSession(sketchSession)

    const initialAvailability = await repository.saveSketchDraftHistory(seed.documentId, 'draft:xy', initialDraft)
    expectTrue(
      !initialAvailability.canUndo && !initialAvailability.canRedo,
      'Seeding a draft session should not create undo history before the draft changes.',
    )

    const updatedAvailability = await repository.saveSketchDraftHistory(seed.documentId, 'draft:xy', updatedDraft)
    expectTrue(
      updatedAvailability.canUndo && !updatedAvailability.canRedo,
      'Updating a draft session should create repository-backed draft undo availability.',
    )

    const undone = await repository.undoSketchDraftHistory(seed.documentId, 'draft:xy')
    expectTrue(
      undone.session?.sketchLabel === initialDraft.sketchLabel,
      'Draft undo should restore the prior persisted sketch draft session.',
    )
    expectTrue(
      !undone.availability.canUndo && undone.availability.canRedo,
      'Draft undo should move local draft availability onto redo.',
    )

    const redone = await repository.redoSketchDraftHistory(seed.documentId, 'draft:xy')
    expectTrue(
      redone.session?.sketchLabel === updatedDraft.sketchLabel,
      'Draft redo should reapply the newer persisted sketch draft session.',
    )

    await repository.clearSketchDraftHistory(seed.documentId, 'draft:xy')
    const cleared = await repository.getSketchDraftHistory(seed.documentId, 'draft:xy')
    expectTrue(
      cleared.session === null && !cleared.availability.canUndo && !cleared.availability.canRedo,
      'Explicit draft clearing should remove repository-local sketch draft history.',
    )
  }

  function testLocalStorageUrlStoreValidatesPersistedPayloads() {
    const storage = createMemoryStorage()
    const urlStore = createLocalStorageDocumentRepositoryUrlStore(storage)
    const validUrl = 'automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu' as Parameters<DocumentRepositoryUrlStore['set']>[1]

    urlStore.set('doc_workspace', validUrl)
    expectTrue(urlStore.get('doc_workspace') === validUrl, 'Valid Automerge URLs should round-trip through localStorage.')

    storage.setItem('cad.documentRepository.automergeUrls.v1', JSON.stringify({
      doc_workspace: 'https://not-automerge',
    }))
    expectTrue(urlStore.get('doc_workspace') === null, 'Malformed persisted URLs should be rejected by runtime validation.')

    storage.setItem('cad.documentRepository.automergeUrls.v1', JSON.stringify({
      doc_workspace: 'automerge:invalidid',
    }))
    expectTrue(urlStore.get('doc_workspace') === null, 'Semantically invalid Automerge URLs should be rejected.')

    storage.setItem('cad.documentRepository.automergeUrls.v1', JSON.stringify({
      doc_workspace: 42,
    }))
    expectTrue(urlStore.get('doc_workspace') === null, 'Non-string persisted URLs should be rejected by runtime validation.')

    storage.setItem('cad.documentRepository.automergeUrls.v1', JSON.stringify(null))
    expectTrue(urlStore.get('doc_workspace') === null, 'Null persisted payloads should be rejected by runtime validation.')

    storage.setItem('cad.documentRepository.automergeUrls.v1', JSON.stringify([validUrl]))
    expectTrue(urlStore.get('doc_workspace') === null, 'Array persisted payloads should be rejected by runtime validation.')
  }

  await testMemoryRepositoryLoadsMutatesSubscribesAndResets()
  await testRepositoryAssetMutationsAreAtomic()
  await testPeerAssetTransferStoresBlobs()
  await testIndexedDbRepositoryUsesInternalHandleAndReportsFailures()
  await testDocumentRepositoriesPersistDurableUndoRedoLocally()
  await testIndexedDbRepositoryRestoresDurableHistoryAcrossRefresh()
  await testIndexedDbRepositoryScopesDurableHistoryPerLocalSession()
  await testIndexedDbUndoFailureKeepsDurableHistoryAvailability()
  await testRepositoryPersistsLocalSketchDraftHistory()
  testLocalStorageUrlStoreValidatesPersistedPayloads()
})

function createMemoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

function createMemoryUrlStore(): DocumentRepositoryUrlStore {
  const urls = new Map<string, string>()
  return {
    get(documentId) {
      return (urls.get(documentId) ?? null) as ReturnType<DocumentRepositoryUrlStore['get']>
    },
    set(documentId, url) {
      urls.set(documentId, url)
    },
    delete(documentId) {
      urls.delete(documentId)
    },
  }
}

function createFakeAutomergeRepo() {
  const handles = new Map<string, FakeAutomergeHandle<unknown>>()
  let count = 0

  return {
    createdCount: 0,
    failNextFind: false,
    failNextChange: false,
    create<T>(initialValue?: T) {
      count += 1
      this.createdCount += 1
      const handle = new FakeAutomergeHandle(`automerge:fake-${count}`, initialValue, () => this.failNextChange)
      handles.set(handle.url, handle as FakeAutomergeHandle<unknown>)
      return handle
    },
    async find<T>(url: string) {
      if (this.failNextFind) {
        this.failNextFind = false
        throw new Error('DocHandle unavailable.')
      }

      const handle = handles.get(url)
      if (!handle) {
        throw new Error('DocHandle missing.')
      }

      return handle as FakeAutomergeHandle<T>
    },
    delete(url: string) {
      handles.delete(url)
    },
    pushPeerChange<T>(url: string, value: T) {
      const handle = handles.get(url) as FakeAutomergeHandle<T> | undefined
      if (!handle) {
        throw new Error('DocHandle missing.')
      }
      handle.pushPeerChange(value)
    },
    async flush() {},
  }
}

class FakeAutomergeHandle<T> {
  readonly url: string
  readonly documentId: string
  private value: T
  private readonly listeners = new Set<() => void>()
  private readonly shouldFailChange: () => boolean
  private headSequence = 0

  constructor(url: string, initialValue: T | undefined, shouldFailChange: () => boolean) {
    this.url = url
    this.documentId = url.replace('automerge:', '')
    this.value = initialValue ?? ({} as T)
    this.shouldFailChange = shouldFailChange
  }

  async whenReady() {}

  doc() {
    return this.value
  }

  heads() {
    return [`head_${this.headSequence}`]
  }

  change(callback: (document: T) => void) {
    if (this.shouldFailChange()) {
      throw new Error('DocHandle change failed.')
    }

    callback(this.value)
    this.headSequence += 1
    for (const listener of this.listeners) {
      listener()
    }
  }

  pushPeerChange(value: T) {
    this.value = value
    this.headSequence += 1
    for (const listener of this.listeners) {
      listener()
    }
  }

  on(_event: 'change', callback: () => void) {
    this.listeners.add(callback)
  }
}
