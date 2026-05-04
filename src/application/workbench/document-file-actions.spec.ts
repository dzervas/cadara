import { describe, expect, it } from 'bun:test'

import type { DocumentId } from '@/contracts/shared/ids'
import type { LocalFileSyncDocumentRepository } from '@/domain/modeling/document-repository'
import { createSeedAuthoredModelDocument } from '@/domain/modeling/modeling-test-fixtures'
import type { WorkbenchTab } from '@/domain/workspace/workbench-tabs'
import {
  openDocumentCopyAsTab,
  openLinkedDocumentAsTab,
} from '@/application/workbench/document-file-actions'
import type { LocalFileSystemFileHandle } from '@/lib/local-file-system-access'

function createHandle(name: string): LocalFileSystemFileHandle {
  return {
    name,
    async getFile() {
      return new File(['{}'], name)
    },
    async createWritable() {
      return {
        async write() {},
        async close() {},
      }
    },
  }
}

function createRepository() {
  const mutations: Array<{ documentId: DocumentId; documentName: string }> = []
  const bindings: Array<{ documentId: DocumentId; handleName: string }> = []
  const resets: DocumentId[] = []

  const repository = {
    async mutate(input) {
      mutations.push({
        documentId: input.documentId,
        documentName: input.document.name,
      })
      return {
        ok: true as const,
        document: input.document,
        status: { kind: 'restored' as const, documentId: input.documentId },
        metadata: {
          documentId: input.documentId,
          heads: [],
          source: 'local' as const,
        },
      }
    },
    async bindLocalFile(input) {
      bindings.push({
        documentId: input.documentId,
        handleName: input.handle.name,
      })
      return { ok: true as const, metadata: input.metadata }
    },
    async reset(documentId: DocumentId) {
      resets.push(documentId)
      return { kind: 'reset' as const, documentId }
    },
  } as LocalFileSyncDocumentRepository

  return { bindings, mutations, repository, resets }
}

describe('document file actions', () => {
  it('opens a document copy as a new browser-backed active tab without binding the previous document', async () => {
    const document = await createSeedAuthoredModelDocument()
    const { bindings, mutations, repository } = createRepository()
    const openedTabs: WorkbenchTab[] = []

    const result = await openDocumentCopyAsTab({
      file: new File([], 'copy.cadara'),
      repository,
      createDocumentId: () => 'doc_copy' as DocumentId,
      openTab: (tab) => openedTabs.push(tab),
      io: {
        async readCadaraDocumentFile() {
          return {
            ...document,
            name: 'Copy source',
          }
        },
      },
    })

    expect(result).toEqual({
      status: 'success',
      documentId: 'doc_copy',
      message: 'Opened copy.cadara.',
    })
    expect(mutations).toEqual([{ documentId: 'doc_copy', documentName: 'Copy source' }])
    expect(openedTabs).toEqual([
      {
        documentId: 'doc_copy',
        title: 'Copy source',
        storageKind: 'browser',
        storageDescriptor: null,
      },
    ])
    expect(bindings).toEqual([])
  })

  it('opens a linked document as a new filesystem-backed active tab bound to that new identity', async () => {
    const document = await createSeedAuthoredModelDocument()
    const { bindings, mutations, repository } = createRepository()
    const openedTabs: WorkbenchTab[] = []
    const handle = createHandle('linked.cadara')

    const result = await openLinkedDocumentAsTab({
      repository,
      createDocumentId: () => 'doc_linked' as DocumentId,
      openTab: (tab) => openedTabs.push(tab),
      io: {
        async showOpenLocalDocumentPicker() {
          return { ok: true as const, handle }
        },
        async ensureLocalFileWritePermission() {
          return true
        },
        async readLocalCadaraDocument() {
          return {
            ...document,
            name: 'Linked source',
          }
        },
      },
    })

    expect(result).toEqual({
      status: 'success',
      documentId: 'doc_linked',
      message: 'Opened linked.cadara. Future changes will save to that file.',
    })
    expect(mutations).toEqual([{ documentId: 'doc_linked', documentName: 'Linked source' }])
    expect(bindings).toEqual([{ documentId: 'doc_linked', handleName: 'linked.cadara' }])
    expect(openedTabs).toEqual([
      {
        documentId: 'doc_linked',
        title: 'Linked source',
        storageKind: 'filesystem',
        storageDescriptor: 'linked.cadara',
      },
    ])
  })

  it('rejects invalid linked documents without opening tabs or creating filesystem bindings', async () => {
    const { bindings, mutations, repository } = createRepository()
    const openedTabs: WorkbenchTab[] = []

    const result = await openLinkedDocumentAsTab({
      repository,
      createDocumentId: () => 'doc_invalid' as DocumentId,
      openTab: (tab) => openedTabs.push(tab),
      io: {
        async showOpenLocalDocumentPicker() {
          return { ok: true as const, handle: createHandle('invalid.cadara') }
        },
        async ensureLocalFileWritePermission() {
          return true
        },
        async readLocalCadaraDocument() {
          return { documentId: 'doc_invalid' }
        },
      },
    })

    expect(result.status).toBe('user-error')
    expect(openedTabs).toEqual([])
    expect(mutations).toEqual([])
    expect(bindings).toEqual([])
  })

  it('keeps direct-file failures scoped to the linked choice', async () => {
    const { bindings, mutations, repository } = createRepository()
    const openedTabs: WorkbenchTab[] = []

    const unsupported = await openLinkedDocumentAsTab({
      repository,
      createDocumentId: () => 'doc_unsupported' as DocumentId,
      openTab: (tab) => openedTabs.push(tab),
      io: {
        async showOpenLocalDocumentPicker() {
          return {
            ok: false as const,
            reason: 'unsupported' as const,
            support: { supported: false as const, reason: 'missing-open-picker' as const },
          }
        },
      },
    })

    expect(unsupported).toEqual({
      status: 'user-error',
      message: 'Linked file saving is unavailable in the current browser.',
    })
    expect(openedTabs).toEqual([])
    expect(mutations).toEqual([])
    expect(bindings).toEqual([])
  })
})
