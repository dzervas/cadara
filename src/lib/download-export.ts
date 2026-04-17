import type { DocumentExportSuccessResult } from '@/contracts/modeling/export'

interface DownloadAnchor {
  href: string
  download: string
  click: () => void
  remove?: () => void
}

interface DownloadDocument {
  body?: {
    appendChild: (element: DownloadAnchor) => void
  }
  createElement: (tagName: 'a') => DownloadAnchor
}

interface DownloadUrlApi {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

export interface BrowserDownloadEnvironment {
  document: DownloadDocument
  URL: DownloadUrlApi
}

function getBrowserDownloadEnvironment(): BrowserDownloadEnvironment {
  if (!globalThis.document) {
    throw new Error('Browser document is not available for export download.')
  }

  return {
    document: globalThis.document,
    URL: globalThis.URL,
  }
}

export function downloadDocumentExportResult(
  result: DocumentExportSuccessResult,
  environment: BrowserDownloadEnvironment = getBrowserDownloadEnvironment(),
) {
  const blob = new Blob([result.payload], { type: result.mimeType })
  const url = environment.URL.createObjectURL(blob)
  const anchor = environment.document.createElement('a')

  anchor.href = url
  anchor.download = result.filename
  environment.document.body?.appendChild(anchor)
  anchor.click()
  anchor.remove?.()
  environment.URL.revokeObjectURL(url)
}
