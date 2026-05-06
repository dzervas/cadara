import { describe, expect, it } from 'bun:test'

import type { DocumentId } from '@/contracts/shared/ids'
import type { LocalFileSyncDocumentRepository } from '@/domain/modeling/document-repository'
import { createSeedAuthoredModelDocument } from '@/domain/modeling/modeling-test-fixtures'
import type { WorkbenchTab } from '@/domain/workspace/workbench-tabs'
import {
  exportWorkbenchDocument,
  openDocumentCopyAsTab,
  openLinkedDocumentAsTab,
  saveWorkbenchLocalFile,
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

function createCallbacks() {
  const errors: string[] = []
  const infos: string[] = []
  const reports: Array<{ source: string; message: string; error: unknown }> = []

  return {
    errors,
    infos,
    reports,
    callbacks: {
      reportDocumentFileActionFailure(source: string, message: string, error: unknown) {
        reports.push({ source, message, error })
      },
      showWorkbenchError(message: string) {
        errors.push(message)
      },
      showWorkbenchInfo(message: string) {
        infos.push(message)
      },
    },
  }
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

  it('saves the active document to a linked local file and binds future sync to that handle', async () => {
    const callbacks = createCallbacks()
    const savedHandle = createHandle('saved.cadara')
    const writes: string[] = []
    const savedBindings: Array<{ documentId: string; handleName: string }> = []

    const saveSucceeded = await saveWorkbenchLocalFile({
      modelingService: {
        currentDocumentId: 'doc_workspace',
        async exportCurrentDocument() {
          return { filename: 'saved.cadara', payload: '{"documentId":"doc_workspace"}' }
        },
        async bindLocalFile(input) {
          savedBindings.push({
            documentId: input.metadata.documentId,
            handleName: input.handle.name,
          })
          return { ok: true as const, diagnostics: [] }
        },
      } as never,
      io: {
        async showSaveLocalDocumentPicker() {
          return { ok: true as const, handle: savedHandle }
        },
        async ensureLocalFileWritePermission() {
          return true
        },
        async writeTextToLocalFileHandle(_handle, text) {
          writes.push(String(text))
          return { ok: true as const }
        },
      },
      ...callbacks.callbacks,
    })

    expect(saveSucceeded).toBe(true)
    expect(writes).toEqual(['{"documentId":"doc_workspace"}'])
    expect(savedBindings).toEqual([{ documentId: 'doc_workspace', handleName: 'saved.cadara' }])
    expect(callbacks.infos).toEqual(['Saved saved.cadara. Future changes will save to that file.'])
  })

  it('surfaces permission-denied linked saves without binding a new handle', async () => {
    const callbacks = createCallbacks()
    const savedHandle = createHandle('saved.cadara')
    let bindCalls = 0

    const saveSucceeded = await saveWorkbenchLocalFile({
      modelingService: {
        currentDocumentId: 'doc_workspace',
        async exportCurrentDocument() {
          return { filename: 'saved.cadara', payload: '{}' }
        },
        async bindLocalFile() {
          bindCalls += 1
          return { ok: true as const, diagnostics: [] }
        },
      } as never,
      io: {
        async showSaveLocalDocumentPicker() {
          return { ok: true as const, handle: savedHandle }
        },
        async ensureLocalFileWritePermission() {
          return true
        },
        async writeTextToLocalFileHandle() {
          return { ok: false as const, reason: 'permission-denied' as const }
        },
      },
      ...callbacks.callbacks,
    })

    expect(saveSucceeded).toBe(false)
    expect(callbacks.errors).toEqual(['Local file write permission was denied.'])
    expect(bindCalls).toBe(0)
  })

  it('downloads a document copy through the export helper', async () => {
    const callbacks = createCallbacks()
    const downloaded: string[] = []

    const exportSucceeded = await exportWorkbenchDocument({
      modelingService: {
        async exportCurrentDocument() {
          return { filename: 'exported.cadara', payload: '{"documentId":"doc_workspace"}' }
        },
      } as never,
      io: {
        downloadDocumentExportResult(result) {
          downloaded.push(result.filename)
        },
      },
      ...callbacks.callbacks,
    })

    expect(exportSucceeded).toBe(true)
    expect(downloaded).toEqual(['exported.cadara'])
    expect(callbacks.infos).toEqual(['Downloaded exported.cadara.'])
  })
})
