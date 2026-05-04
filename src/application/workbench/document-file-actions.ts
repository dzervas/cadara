import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import type { DocumentId } from '@/contracts/shared/ids'
import {
  type DocumentRepository,
  type LocalFileSyncDocumentRepository,
  isLocalFileSyncDocumentRepository,
} from '@/domain/modeling/document-repository'
import { createLocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type { WorkbenchTab } from '@/domain/workspace/workbench-tabs'
import {
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
  type LocalFileSystemFileHandle,
} from '@/lib/local-file-system-access'

export type WorkbenchDocumentActionResult =
  | { status: 'success'; documentId: DocumentId; message: string }
  | { status: 'cancelled' }
  | { status: 'user-error'; message: string }
  | { status: 'unexpected-error'; source: string; message: string; error: unknown }

interface WorkbenchDocumentFileActionIo {
  ensureLocalFileWritePermission: typeof ensureLocalFileWritePermission
  readCadaraDocumentFile: typeof readCadaraDocumentFile
  readLocalCadaraDocument: typeof readLocalCadaraDocument
  showOpenLocalDocumentPicker: typeof showOpenLocalDocumentPicker
}

const defaultIo: WorkbenchDocumentFileActionIo = {
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
}

export async function openDocumentCopyAsTab(input: {
  file: File
  repository: DocumentRepository | null
  createDocumentId: () => DocumentId
  openTab: (tab: WorkbenchTab) => void
  io?: Partial<WorkbenchDocumentFileActionIo>
}): Promise<WorkbenchDocumentActionResult> {
  if (!input.repository) {
    return {
      status: 'user-error',
      message: 'Document open requires the repository-backed workbench session.',
    }
  }

  const io = { ...defaultIo, ...input.io }
  let payload: unknown
  try {
    payload = await io.readCadaraDocumentFile(input.file)
  } catch (error: unknown) {
    return {
      status: 'user-error',
      message: error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
        ? 'Open failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
        : 'Open failed. Select a valid cadara JSON document.',
    }
  }

  const parsed = parseAuthoredModelDocument(structuredClone(payload))
  if (!parsed.ok) {
    return {
      status: 'user-error',
      message: parsed.diagnostic.message,
    }
  }

  const documentId = input.createDocumentId()
  const result = await input.repository.mutate({
    documentId,
    document: {
      ...parsed.document,
      documentId,
    },
  })
  if (!result.ok) {
    return {
      status: 'user-error',
      message: result.status.diagnostic.message,
    }
  }

  input.openTab({
    documentId,
    title: parsed.document.name,
    storageKind: 'browser',
    storageDescriptor: null,
  })
  return {
    status: 'success',
    documentId,
    message: `Opened ${input.file.name}.`,
  }
}

export async function openLinkedDocumentAsTab(input: {
  repository: DocumentRepository | null
  createDocumentId: () => DocumentId
  openTab: (tab: WorkbenchTab) => void
  io?: Partial<WorkbenchDocumentFileActionIo>
}): Promise<WorkbenchDocumentActionResult> {
  if (!isLocalFileSyncDocumentRepository(input.repository)) {
    return {
      status: 'user-error',
      message: 'Linked file saving requires the repository-backed workbench session.',
    }
  }

  const io = { ...defaultIo, ...input.io }
  const pickerResult = await io.showOpenLocalDocumentPicker()
  if (!pickerResult.ok) {
    if (pickerResult.reason === 'cancelled') {
      return { status: 'cancelled' }
    }
    if (pickerResult.reason === 'unsupported') {
      return {
        status: 'user-error',
        message: 'Linked file saving is unavailable in the current browser.',
      }
    }

    return {
      status: 'unexpected-error',
      source: 'workbench.file.openLinked',
      message: 'Open linked document failed.',
      error: pickerResult.error,
    }
  }

  if (!await io.ensureLocalFileWritePermission(pickerResult.handle)) {
    return {
      status: 'user-error',
      message: 'Local file write permission was denied.',
    }
  }

  return openLinkedDocumentHandleAsTab({
    repository: input.repository,
    handle: pickerResult.handle,
    createDocumentId: input.createDocumentId,
    openTab: input.openTab,
    io,
  })
}

async function openLinkedDocumentHandleAsTab(input: {
  repository: LocalFileSyncDocumentRepository
  handle: LocalFileSystemFileHandle
  createDocumentId: () => DocumentId
  openTab: (tab: WorkbenchTab) => void
  io: WorkbenchDocumentFileActionIo
}): Promise<WorkbenchDocumentActionResult> {
  let payload: unknown
  try {
    payload = await input.io.readLocalCadaraDocument(input.handle)
  } catch (error: unknown) {
    return {
      status: 'user-error',
      message: error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
        ? 'Open failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
        : 'Open failed. Select a valid cadara JSON document.',
    }
  }

  const parsed = parseAuthoredModelDocument(structuredClone(payload))
  if (!parsed.ok) {
    return {
      status: 'user-error',
      message: parsed.diagnostic.message,
    }
  }

  const documentId = input.createDocumentId()
  const mutateResult = await input.repository.mutate({
    documentId,
    document: {
      ...parsed.document,
      documentId,
    },
  })
  if (!mutateResult.ok) {
    return {
      status: 'user-error',
      message: mutateResult.status.diagnostic.message,
    }
  }

  const bindResult = await input.repository.bindLocalFile({
    documentId,
    handle: input.handle,
    metadata: createLocalFileBindingMetadata(documentId, input.handle),
  })
  if (!bindResult.ok) {
    await input.repository.reset(documentId)
    return {
      status: 'user-error',
      message: bindResult.message,
    }
  }

  input.openTab({
    documentId,
    title: parsed.document.name,
    storageKind: 'filesystem',
    storageDescriptor: input.handle.name,
  })
  return {
    status: 'success',
    documentId,
    message: `Opened ${input.handle.name}. Future changes will save to that file.`,
  }
}
