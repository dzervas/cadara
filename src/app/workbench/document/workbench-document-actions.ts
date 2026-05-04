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
  replaceAfterDocumentFileAction: (message: string, options?: { fitView?: boolean }) => Promise<void>
  reportDocumentFileActionFailure: (source: string, message: string, error: unknown) => void
  showWorkbenchError: (message: string) => void
  showWorkbenchInfo: (message: string) => void
}

interface WorkbenchDocumentActionIo {
  downloadDocumentExportResult: typeof downloadDocumentExportResult
  ensureLocalFileWritePermission: typeof ensureLocalFileWritePermission
  readCadaraDocumentFile: typeof readCadaraDocumentFile
  readLocalCadaraDocument: typeof readLocalCadaraDocument
  showOpenLocalDocumentPicker: typeof showOpenLocalDocumentPicker
  showSaveLocalDocumentPicker: typeof showSaveLocalDocumentPicker
  writeTextToLocalFileHandle: typeof writeTextToLocalFileHandle
}

const defaultWorkbenchDocumentActionIo: WorkbenchDocumentActionIo = {
  downloadDocumentExportResult,
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
  showSaveLocalDocumentPicker,
  writeTextToLocalFileHandle,
}

export async function createNewWorkbenchDocument(input: {
  modelingService: Pick<ModelingService, 'createNewDocument'>
} & Pick<WorkbenchDocumentActionCallbacks, 'replaceAfterDocumentFileAction' | 'reportDocumentFileActionFailure' | 'showWorkbenchError'>) {
  try {
    const result = await input.modelingService.createNewDocument()
    if (!result.ok) {
      input.showWorkbenchError(result.diagnostics[0]?.message ?? 'New document could not be created.')
      return
    }

    await input.replaceAfterDocumentFileAction('Created a new document.')
  } catch (error) {
    input.reportDocumentFileActionFailure('workbench.file.new', 'New document failed.', error)
  }
}

export async function importWorkbenchDocumentFile(input: {
  file: File
  modelingService: Pick<ModelingService, 'importDocument'>
  io?: Partial<WorkbenchDocumentActionIo>
} & Pick<WorkbenchDocumentActionCallbacks, 'replaceAfterDocumentFileAction' | 'reportDocumentFileActionFailure' | 'showWorkbenchError'>) {
  const io = { ...defaultWorkbenchDocumentActionIo, ...input.io }
  let payload: unknown

  try {
    payload = await io.readCadaraDocumentFile(input.file)
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
      ? 'Open failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
      : 'Open failed. Select a valid cadara JSON document.'
    input.showWorkbenchError(message)
    return
  }

  try {
    const result = await input.modelingService.importDocument({ document: payload })
    if (!result.ok) {
      input.showWorkbenchError(result.diagnostics[0]?.message ?? 'Open failed.')
      return
    }

    await input.replaceAfterDocumentFileAction(`Opened ${input.file.name}.`)
  } catch (error) {
    input.reportDocumentFileActionFailure('workbench.file.openCopy', 'Open failed.', error)
  }
}

export async function openWorkbenchLocalFile(input: {
  modelingService: Pick<ModelingService, 'bindLocalFile' | 'currentDocumentId' | 'importDocument'>
  io?: Partial<WorkbenchDocumentActionIo>
} & Pick<WorkbenchDocumentActionCallbacks, 'replaceAfterDocumentFileAction' | 'reportDocumentFileActionFailure' | 'showWorkbenchError'>) {
  const io = { ...defaultWorkbenchDocumentActionIo, ...input.io }
  const pickerResult = await io.showOpenLocalDocumentPicker()
  if (!pickerResult.ok) {
    if (pickerResult.reason === 'cancelled') {
      return
    }
    if (pickerResult.reason === 'unsupported') {
      input.showWorkbenchError('Linked file saving is unavailable in the current browser.')
      return
    }

    input.reportDocumentFileActionFailure('workbench.file.openLinked', 'Open linked document failed.', pickerResult.error)
    return
  }

  if (!await io.ensureLocalFileWritePermission(pickerResult.handle)) {
    input.showWorkbenchError('Local file write permission was denied.')
    return
  }

  let payload: unknown
  try {
    payload = await io.readLocalCadaraDocument(pickerResult.handle)
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
      ? 'Open failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
      : 'Open failed. Select a valid cadara JSON document.'
    input.reportDocumentFileActionFailure('workbench.file.openLinked', message, error)
    return
  }

  try {
    const result = await input.modelingService.importDocument({ document: payload })
    if (!result.ok) {
      input.showWorkbenchError(result.diagnostics[0]?.message ?? 'Open failed.')
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

    await input.replaceAfterDocumentFileAction(`Opened ${pickerResult.handle.name}. Future changes will save to that file.`)
  } catch (error: unknown) {
    input.reportDocumentFileActionFailure('workbench.file.openLinked', 'Open linked document failed.', error)
  }
}

export async function saveWorkbenchLocalFile(input: {
  modelingService: Pick<ModelingService, 'bindLocalFile' | 'currentDocumentId' | 'exportCurrentDocument'>
  io?: Partial<WorkbenchDocumentActionIo>
} & Pick<WorkbenchDocumentActionCallbacks, 'reportDocumentFileActionFailure' | 'showWorkbenchError' | 'showWorkbenchInfo'>): Promise<boolean> {
  const io = { ...defaultWorkbenchDocumentActionIo, ...input.io }
  const pickerResult = await io.showSaveLocalDocumentPicker()
  if (!pickerResult.ok) {
    if (pickerResult.reason === 'cancelled') {
      return false
    }
    if (pickerResult.reason === 'unsupported') {
      input.showWorkbenchError('Linked file saving is unavailable in the current browser.')
      return false
    }

    input.reportDocumentFileActionFailure('workbench.file.saveLinked', 'Save linked document failed.', pickerResult.error)
    return false
  }

  try {
    if (!await io.ensureLocalFileWritePermission(pickerResult.handle)) {
      input.showWorkbenchError('Local file write permission was denied.')
      return false
    }

    const result = await input.modelingService.exportCurrentDocument()
    const writeResult = await io.writeTextToLocalFileHandle(pickerResult.handle, result.payload)
    if (!writeResult.ok) {
      if (writeResult.reason === 'permission-denied') {
        input.showWorkbenchError('Local file write permission was denied.')
        return false
      }

      input.reportDocumentFileActionFailure('workbench.file.saveLinked', 'Save linked document failed.', writeResult.error)
      return false
    }

    const binding = await input.modelingService.bindLocalFile({
      handle: pickerResult.handle,
      metadata: createLocalFileBindingMetadata(input.modelingService.currentDocumentId, pickerResult.handle),
    })
    if (!binding.ok) {
      input.showWorkbenchError(binding.diagnostics[0]?.message ?? 'Local file sync target could not be bound.')
      return false
    }

    input.showWorkbenchInfo(`Saved ${pickerResult.handle.name}. Future changes will save to that file.`)
    return true
  } catch (error: unknown) {
    input.reportDocumentFileActionFailure('workbench.file.saveLinked', 'Save linked document failed.', error)
    return false
  }
}

export async function exportWorkbenchDocument(input: {
  modelingService: Pick<ModelingService, 'exportCurrentDocument'>
  io?: Partial<WorkbenchDocumentActionIo>
} & Pick<WorkbenchDocumentActionCallbacks, 'reportDocumentFileActionFailure' | 'showWorkbenchInfo'>): Promise<boolean> {
  const io = { ...defaultWorkbenchDocumentActionIo, ...input.io }
  try {
    const result = await input.modelingService.exportCurrentDocument()
    io.downloadDocumentExportResult(result)
    input.showWorkbenchInfo(`Downloaded ${result.filename}.`)
    return true
  } catch (error) {
    input.reportDocumentFileActionFailure('workbench.file.downloadCopy', 'Download failed.', error)
    return false
  }
}
