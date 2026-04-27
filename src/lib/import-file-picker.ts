import {
  getLocalFileSystemOpenSupport,
  type LocalFilePickerResult,
  type LocalFileSystemOpenPickerOptions,
  type LocalFileSystemPickerEnvironment,
} from '@/lib/local-file-system-access'

export interface AcceptedImportFileType {
  extension: string
  mediaType?: string
}

export interface ImportFilePickerConfiguration {
  openPickerOptions: LocalFileSystemOpenPickerOptions
  inputAccept: string
}

export interface ImportFilePickerEnvironment extends LocalFileSystemPickerEnvironment {
  document?: Document
}

export type ImportFilePickerResult =
  | { ok: true; files: readonly File[] }
  | Extract<LocalFilePickerResult, { ok: false }>

export function buildImportFilePickerConfiguration(
  acceptedFileTypes: readonly AcceptedImportFileType[],
  options: {
    multiple?: boolean
  } = {},
): ImportFilePickerConfiguration {
  const normalized = normalizeAcceptedFileTypes(acceptedFileTypes)
  const accept = normalized.reduce<Record<string, string[]>>((result, entry) => {
    const mediaType = entry.mediaType ?? 'application/octet-stream'
    const extensions = result[mediaType] ?? []
    if (!extensions.includes(`.${entry.extension}`)) {
      extensions.push(`.${entry.extension}`)
    }
    result[mediaType] = extensions
    return result
  }, {})

  const inputAccept = [
    ...new Set(normalized.flatMap((entry) => [
      ...(entry.mediaType ? [entry.mediaType] : []),
      `.${entry.extension}`,
    ])),
  ].join(',')

  return {
    openPickerOptions: {
      multiple: (options.multiple ?? false) as false,
      excludeAcceptAllOption: false,
      types: [{
        description: 'Supported import files',
        accept,
      }],
    },
    inputAccept,
  }
}

export async function showOpenImportFilePicker(input: {
  acceptedFileTypes: readonly AcceptedImportFileType[]
  multiple?: boolean
  environment?: ImportFilePickerEnvironment
}): Promise<ImportFilePickerResult> {
  const environment: ImportFilePickerEnvironment = input.environment ?? (globalThis as unknown as ImportFilePickerEnvironment)
  const config = buildImportFilePickerConfiguration(input.acceptedFileTypes, { multiple: input.multiple })
  const support = getLocalFileSystemOpenSupport(environment)

  if (support.supported) {
    try {
      const handles = await environment.showOpenFilePicker!(config.openPickerOptions)
      if (handles.length === 0) {
        return { ok: false, reason: 'cancelled' }
      }

      return { ok: true, files: await Promise.all(handles.map((handle) => handle.getFile())) }
    } catch (error: unknown) {
      return isAbortError(error)
        ? { ok: false, reason: 'cancelled' }
        : { ok: false, reason: 'failed', error }
    }
  }

  if (!environment.document) {
    return { ok: false, reason: 'unsupported', support }
  }

  return new Promise<ImportFilePickerResult>((resolve) => {
    const inputElement = environment.document!.createElement('input')
    inputElement.type = 'file'
    inputElement.accept = config.inputAccept
    inputElement.multiple = input.multiple ?? false
    inputElement.style.display = 'none'

    const cleanup = () => {
      inputElement.removeEventListener('change', handleChange)
      inputElement.removeEventListener('cancel', handleCancel)
      inputElement.remove()
    }

    const handleChange = () => {
      const files = inputElement.files ? [...inputElement.files] : []
      cleanup()
      resolve(files.length > 0 ? { ok: true, files } : { ok: false, reason: 'cancelled' })
    }

    const handleCancel = () => {
      cleanup()
      resolve({ ok: false, reason: 'cancelled' })
    }

    inputElement.addEventListener('change', handleChange, { once: true })
    inputElement.addEventListener('cancel', handleCancel, { once: true })
    environment.document!.body.appendChild(inputElement)
    inputElement.click()
  })
}

function normalizeAcceptedFileTypes(
  acceptedFileTypes: readonly AcceptedImportFileType[],
) {
  const deduped = new Map<string, AcceptedImportFileType>()

  for (const entry of acceptedFileTypes) {
    const extension = entry.extension.trim().replace(/^\./, '').toLowerCase()
    const mediaType = entry.mediaType?.trim().toLowerCase()

    if (!extension) {
      continue
    }

    const key = `${extension}:${mediaType ?? ''}`
    if (!deduped.has(key)) {
      deduped.set(key, { extension, ...(mediaType ? { mediaType } : {}) })
    }
  }

  return [...deduped.values()]
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
