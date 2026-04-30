import { createLocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import { downloadDocumentExportResult } from '@/lib/download-export'
import {
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
  showSaveLocalDocumentPicker,
  writeTextToLocalFileHandle,
} from '@/lib/local-file-system-access'

interface WorkbenchDocumentActionCallbacks {
  refreshAfterDocumentFileAction: (message: string, options?: { fitView?: boolean }) => Promise<void>
  reportDocumentFileActionFailure: (source: string, message: string, error: unknown) => void
  showWorkbenchError: (message: string) => void
  showWorkbenchInfo: (message: string) => void
}

export async function createNewWorkbenchDocument(input: {
  modelingService: Pick<ModelingService, 'createNewDocument'>
} & Pick<WorkbenchDocumentActionCallbacks, 'refreshAfterDocumentFileAction' | 'reportDocumentFileActionFailure' | 'showWorkbenchError'>) {
  try {
    const result = await input.modelingService.createNewDocument()
    if (!result.ok) {
      input.showWorkbenchError(result.diagnostics[0]?.message ?? 'New document could not be created.')
      return
    }

    await input.refreshAfterDocumentFileAction('Created a new document.')
  } catch (error) {
    input.reportDocumentFileActionFailure('workbench.file.new', 'New document failed.', error)
  }
}

export async function importWorkbenchDocumentFile(input: {
  file: File
  modelingService: Pick<ModelingService, 'importDocument'>
} & Pick<WorkbenchDocumentActionCallbacks, 'refreshAfterDocumentFileAction' | 'reportDocumentFileActionFailure' | 'showWorkbenchError'>) {
  let payload: unknown

  try {
    payload = await readCadaraDocumentFile(input.file)
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
      ? 'Import failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
      : 'Import failed. Select a valid cadara JSON document.'
    input.showWorkbenchError(message)
    return
  }

  try {
    const result = await input.modelingService.importDocument({ document: payload })
    if (!result.ok) {
      input.showWorkbenchError(result.diagnostics[0]?.message ?? 'Import failed.')
      return
    }

    await input.refreshAfterDocumentFileAction(`Imported ${input.file.name}.`)
  } catch (error) {
    input.reportDocumentFileActionFailure('workbench.file.import', 'Import failed.', error)
  }
}

export async function openWorkbenchLocalFile(input: {
  modelingService: Pick<ModelingService, 'bindLocalFile' | 'currentDocumentId' | 'importDocument'>
} & Pick<WorkbenchDocumentActionCallbacks, 'refreshAfterDocumentFileAction' | 'reportDocumentFileActionFailure' | 'showWorkbenchError'>) {
  const pickerResult = await showOpenLocalDocumentPicker()
  if (!pickerResult.ok) {
    if (pickerResult.reason === 'cancelled') {
      return
    }
    if (pickerResult.reason === 'unsupported') {
      input.showWorkbenchError(
        'Local file sync requires the File System Access API. In Brave, enable brave://flags/#file-system-access-api and relaunch, or use Chrome/Edge.',
      )
      return
    }

    input.reportDocumentFileActionFailure('workbench.file.openLocal', 'Open local file failed.', pickerResult.error)
    return
  }

  if (!await ensureLocalFileWritePermission(pickerResult.handle)) {
    input.showWorkbenchError('Local file write permission was denied.')
    return
  }

  let payload: unknown
  try {
    payload = await readLocalCadaraDocument(pickerResult.handle)
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
      ? 'Open local file failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
      : 'Open local file failed. Select a valid cadara JSON document.'
    input.reportDocumentFileActionFailure('workbench.file.openLocal', message, error)
    return
  }

  try {
    const result = await input.modelingService.importDocument({ document: payload })
    if (!result.ok) {
      input.showWorkbenchError(result.diagnostics[0]?.message ?? 'Open local file failed.')
      return
    }

    const binding = await input.modelingService.bindLocalFile({
      handle: pickerResult.handle,
      metadata: createLocalFileBindingMetadata(input.modelingService.currentDocumentId, pickerResult.handle),
    })
    if (!binding.ok) {
      input.showWorkbenchError(binding.diagnostics[0]?.message ?? 'Local file sync target could not be bound.')
      return
    }

    await input.refreshAfterDocumentFileAction(`Opened ${pickerResult.handle.name}. Local file sync is active.`)
  } catch (error: unknown) {
    input.reportDocumentFileActionFailure('workbench.file.openLocal', 'Open local file failed.', error)
  }
}

export async function saveWorkbenchLocalFile(input: {
  modelingService: Pick<ModelingService, 'bindLocalFile' | 'currentDocumentId' | 'exportCurrentDocument'>
} & Pick<WorkbenchDocumentActionCallbacks, 'reportDocumentFileActionFailure' | 'showWorkbenchError' | 'showWorkbenchInfo'>) {
  const pickerResult = await showSaveLocalDocumentPicker()
  if (!pickerResult.ok) {
    if (pickerResult.reason === 'cancelled') {
      return
    }
    if (pickerResult.reason === 'unsupported') {
      input.showWorkbenchError(
        'Local file sync requires the File System Access API. In Brave, enable brave://flags/#file-system-access-api and relaunch, or use Chrome/Edge.',
      )
      return
    }

    input.reportDocumentFileActionFailure('workbench.file.saveLocal', 'Save local file failed.', pickerResult.error)
    return
  }

  try {
    if (!await ensureLocalFileWritePermission(pickerResult.handle)) {
      input.showWorkbenchError('Local file write permission was denied.')
      return
    }

    const result = await input.modelingService.exportCurrentDocument()
    const writeResult = await writeTextToLocalFileHandle(pickerResult.handle, result.payload)
    if (!writeResult.ok) {
      if (writeResult.reason === 'permission-denied') {
        input.showWorkbenchError('Local file write permission was denied.')
        return
      }

      input.reportDocumentFileActionFailure('workbench.file.saveLocal', 'Save local file failed.', writeResult.error)
      return
    }

    const binding = await input.modelingService.bindLocalFile({
      handle: pickerResult.handle,
      metadata: createLocalFileBindingMetadata(input.modelingService.currentDocumentId, pickerResult.handle),
    })
    if (!binding.ok) {
      input.showWorkbenchError(binding.diagnostics[0]?.message ?? 'Local file sync target could not be bound.')
      return
    }

    input.showWorkbenchInfo(`Saved ${pickerResult.handle.name}. Local file sync is active.`)
  } catch (error: unknown) {
    input.reportDocumentFileActionFailure('workbench.file.saveLocal', 'Save local file failed.', error)
  }
}

export async function exportWorkbenchDocument(input: {
  modelingService: Pick<ModelingService, 'exportCurrentDocument'>
} & Pick<WorkbenchDocumentActionCallbacks, 'reportDocumentFileActionFailure' | 'showWorkbenchInfo'>) {
  try {
    const result = await input.modelingService.exportCurrentDocument()
    downloadDocumentExportResult(result)
    input.showWorkbenchInfo(`Exported ${result.filename}.`)
  } catch (error) {
    input.reportDocumentFileActionFailure('workbench.file.export', 'Export failed.', error)
  }
}
