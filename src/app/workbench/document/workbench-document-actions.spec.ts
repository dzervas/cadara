import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createNewWorkbenchDocument,
  exportWorkbenchDocument,
  importWorkbenchDocumentFile,
  openWorkbenchLocalFile,
  saveWorkbenchLocalFile,
} from '@/app/workbench/document/workbench-document-actions'
import type { LocalFileSystemFileHandle } from '@/lib/local-file-system-access'

function createCallbacks() {
  const errors: string[] = []
  const infos: string[] = []
  const replacements: Array<{ message: string; fitView?: boolean }> = []
  const reports: Array<{ source: string; message: string; error: unknown }> = []

  return {
    errors,
    infos,
    replacements,
    reports,
    callbacks: {
      async replaceAfterDocumentFileAction(message: string, options?: { fitView?: boolean }) {
        replacements.push({ message, fitView: options?.fitView })
      },
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

function createHandle(name: string): LocalFileSystemFileHandle {
  return {
    name,
    async getFile() {
      return new File([JSON.stringify({ documentId: 'doc_workspace' })], name)
    },
    async createWritable() {
      return {
        async write() {},
        async close() {},
      }
    },
  }
}

test('workbench document actions cover creation, import/open/save branches, and export wiring', async () => {
  const newCallbacks = createCallbacks()
  await createNewWorkbenchDocument({
    modelingService: {
      async createNewDocument() {
        return { ok: true as const, diagnostics: [] }
      },
    } as never,
    ...newCallbacks.callbacks,
  })
  expectTrue(
    newCallbacks.replacements[0]?.message === 'Created a new document.',
    'New document creation should replace the workbench document after a successful create result.',
  )

  const rejectedNewCallbacks = createCallbacks()
  await createNewWorkbenchDocument({
    modelingService: {
      async createNewDocument() {
        return {
          ok: false as const,
          diagnostics: [{ message: 'New document could not be created.' }],
        }
      },
    } as never,
    ...rejectedNewCallbacks.callbacks,
  })
  expectTrue(
    rejectedNewCallbacks.errors[0] === 'New document could not be created.',
    'Rejected document creation should surface the first diagnostic message.',
  )

  const importCallbacks = createCallbacks()
  await importWorkbenchDocumentFile({
    file: new File([], 'fixture.cadara'),
    modelingService: {
      async importDocument() {
        return { ok: true as const, diagnostics: [] }
      },
    } as never,
    io: {
      async readCadaraDocumentFile() {
        return { documentId: 'doc_imported' }
      },
    },
    ...importCallbacks.callbacks,
  })
  expectTrue(
    importCallbacks.replacements[0]?.message === 'Opened fixture.cadara.',
    'Successful copy-open actions should replace the active workbench document.',
  )

  const zipImportCallbacks = createCallbacks()
  await importWorkbenchDocumentFile({
    file: new File([], 'fixture.cadara'),
    modelingService: {} as never,
    io: {
      async readCadaraDocumentFile() {
        throw new Error('ZIP-backed .cadara packages are unsupported.')
      },
    },
    ...zipImportCallbacks.callbacks,
  })
  expectTrue(
    zipImportCallbacks.errors[0]?.includes('ZIP-backed .cadara packages are no longer supported'),
    'ZIP-backed copy-open failures should surface the explicit unsupported-package guidance.',
  )

  const unsupportedOpenCallbacks = createCallbacks()
  await openWorkbenchLocalFile({
    modelingService: {} as never,
    io: {
      async showOpenLocalDocumentPicker() {
        return { ok: false as const, reason: 'unsupported' as const, support: { supported: false as const, reason: 'missing-open-picker' as const } }
      },
    },
    ...unsupportedOpenCallbacks.callbacks,
  })
  expectTrue(
    unsupportedOpenCallbacks.errors[0] === 'Linked file saving is unavailable in the current browser.',
    'Unsupported linked-open environments should surface the linked-file fallback guidance.',
  )

  const openCallbacks = createCallbacks()
  const openedHandle = createHandle('workspace.cadara')
  const boundHandles: string[] = []
  await openWorkbenchLocalFile({
    modelingService: {
      currentDocumentId: 'doc_workspace',
      async importDocument() {
        return { ok: true as const, diagnostics: [] }
      },
      async bindLocalFile(input) {
        boundHandles.push(input.handle.name)
        return { ok: true as const, diagnostics: [] }
      },
    } as never,
    io: {
      async showOpenLocalDocumentPicker() {
        return { ok: true as const, handle: openedHandle }
      },
      async ensureLocalFileWritePermission() {
        return true
      },
      async readLocalCadaraDocument() {
        return { documentId: 'doc_workspace' }
      },
    },
    ...openCallbacks.callbacks,
  })
  expectTrue(
    boundHandles[0] === 'workspace.cadara'
      && openCallbacks.replacements[0]?.message === 'Opened workspace.cadara. Future changes will save to that file.',
    'Successful linked-open actions should import the file, bind it for sync, and replace the workbench document.',
  )

  const saveCallbacks = createCallbacks()
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
    ...saveCallbacks.callbacks,
  })
  expectTrue(
    saveSucceeded
      && writes[0] === '{"documentId":"doc_workspace"}'
      && JSON.stringify(savedBindings) === JSON.stringify([{ documentId: 'doc_workspace', handleName: 'saved.cadara' }])
      && saveCallbacks.infos[0] === 'Saved saved.cadara. Future changes will save to that file.',
    'Successful linked-save actions should write the exported payload, bind the handle to the active document, and announce sync activation.',
  )

  const deniedSaveCallbacks = createCallbacks()
  const deniedSaveSucceeded = await saveWorkbenchLocalFile({
    modelingService: {
      currentDocumentId: 'doc_workspace',
      async exportCurrentDocument() {
        return { filename: 'saved.cadara', payload: '{}' }
      },
      async bindLocalFile() {
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
    ...deniedSaveCallbacks.callbacks,
  })
  expectTrue(
    !deniedSaveSucceeded && deniedSaveCallbacks.errors[0] === 'Local file write permission was denied.',
    'Permission-denied saves should surface the user-facing write-permission error.',
  )

  const exportCallbacks = createCallbacks()
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
    ...exportCallbacks.callbacks,
  })
  expectTrue(
    exportSucceeded
      && downloaded[0] === 'exported.cadara'
      && exportCallbacks.infos[0] === 'Downloaded exported.cadara.',
    'Document download should delegate to the download helper and surface the downloaded filename.',
  )
})
