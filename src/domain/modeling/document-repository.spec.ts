import { test } from 'bun:test'

import { createAuthoredModelDocumentFromSnapshot } from '@/contracts/modeling/authored-document'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { IndexedDbAutomergeDocumentRepository, type DocumentRepositoryUrlStore } from '@/domain/modeling/automerge-indexeddb-document-repository'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/modeling/document-repository.spec.ts', async () => {
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

  async function testMemoryRepositoryLoadsMutatesSubscribesAndResets() {
    const seed = await createSeedDocument()
    const repository = createMemoryDocumentRepository()
    const loaded = await repository.load({ documentId: seed.documentId, seedDocument: seed })
    assert(loaded.ok, 'Memory repository should create a missing document from the seed document.')
    assert(loaded.status.kind === 'seeded', 'Missing memory documents should report seeded status.')

    let observed: AuthoredModelDocument | null = null
    const unsubscribe = repository.subscribe(seed.documentId, (document) => {
      observed = document
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
    assert(mutated.ok, 'Memory repository should accept plain authored document mutations.')
    assert(observed?.bodyLabels.some((label) => label.label === 'Repository Body'), 'Subscribers should receive plain authored documents.')
    unsubscribe()

    const reset = await repository.reset(seed.documentId)
    assert(reset.kind === 'reset', 'Repository reset should report reset status.')
    const reloaded = await repository.load({ documentId: seed.documentId, seedDocument: seed })
    assert(reloaded.ok && reloaded.status.kind === 'seeded', 'Repository should recreate a seeded document after reset.')
  }

  async function testIndexedDbRepositoryUsesInternalHandleAndReportsFailures() {
    const seed = await createSeedDocument()
    const urlStore = createMemoryUrlStore()
    const repo = createFakeAutomergeRepo()
    const repository = new IndexedDbAutomergeDocumentRepository({ repo, urlStore })

    const loaded = await repository.load({ documentId: seed.documentId, seedDocument: seed })
    assert(loaded.ok && loaded.status.kind === 'seeded', 'IndexedDB repository should seed missing Automerge documents.')
    assert(repo.createdCount === 1, 'IndexedDB repository should create an internal Automerge handle for missing documents.')
    assert(urlStore.get(seed.documentId) !== null, 'IndexedDB repository should persist the app document to Automerge URL mapping.')

    const restored = await new IndexedDbAutomergeDocumentRepository({ repo, urlStore }).load({
      documentId: seed.documentId,
      seedDocument: {
        ...seed,
        bodyLabels: [],
      },
    })
    assert(restored.ok && restored.status.kind === 'restored', 'A new repository instance should restore through the stored Automerge URL.')
    assert(restored.ok && restored.document.bodyLabels.length === seed.bodyLabels.length, 'Refresh restore should use the stored authored document.')

    const unsupported = await repository.mutate({
      documentId: seed.documentId,
      document: {
        ...seed,
        schemaVersion: 'authored-model-document/v9' as AuthoredModelDocument['schemaVersion'],
      },
    })
    assert(!unsupported.ok, 'Unsupported authored schemas should fail without replacing existing data.')
    assert(unsupported.status.diagnostic.reasonCode === 'unsupported-schema-version', 'Unsupported schema failures should be explicit.')

    repo.failNextFind = true
    const findFailed = await new IndexedDbAutomergeDocumentRepository({ repo, urlStore }).load({
      documentId: seed.documentId,
      seedDocument: seed,
    })
    assert(!findFailed.ok, 'DocHandle load failures should be reported.')
    assert(findFailed.status.diagnostic.reasonCode === 'automerge-load-failed', 'DocHandle load failures should keep a repository diagnostic.')

    repo.failNextChange = true
    const writeFailed = await repository.mutate({
      documentId: seed.documentId,
      document: seed,
    })
    assert(!writeFailed.ok, 'DocHandle write failures should be reported.')
    assert(writeFailed.status.diagnostic.reasonCode === 'automerge-write-failed', 'Write failures should keep a repository diagnostic.')

    const reset = await repository.reset(seed.documentId)
    assert(reset.kind === 'reset', 'IndexedDB repository reset should clear the mapped document.')
    assert(urlStore.get(seed.documentId) === null, 'Reset should remove the stored Automerge URL mapping.')
  }

  await testMemoryRepositoryLoadsMutatesSubscribesAndResets()
  await testIndexedDbRepositoryUsesInternalHandleAndReportsFailures()
})

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
    async flush() {},
  }
}

class FakeAutomergeHandle<T> {
  readonly url: string
  readonly documentId: string
  private value: T
  private readonly listeners = new Set<() => void>()
  private readonly shouldFailChange: () => boolean

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

  change(callback: (document: T) => void) {
    if (this.shouldFailChange()) {
      throw new Error('DocHandle change failed.')
    }

    callback(this.value)
    for (const listener of this.listeners) {
      listener()
    }
  }

  on(_event: 'change', callback: () => void) {
    this.listeners.add(callback)
  }
}
