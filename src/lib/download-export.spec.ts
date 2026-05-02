import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { DocumentExportSuccessResult } from '@/contracts/modeling/export'
import { downloadDocumentExportResult, type BrowserDownloadEnvironment } from '@/lib/download-export'

test('src/lib/download-export.spec.ts', () => {  const clicked: string[] = []
  const appended: string[] = []
  const revoked: string[] = []
  let capturedBlob: Blob | null = null

  const environment: BrowserDownloadEnvironment = {
    document: {
      body: {
        appendChild: (element) => {
          appended.push(element.download)
        },
      },
      createElement: () => ({
        href: '',
        download: '',
        click() {
          clicked.push(this.download)
        },
        remove() {
          appended.push('removed')
        },
      }),
    },
    URL: {
      createObjectURL: (blob) => {
        capturedBlob = blob
        return 'blob:export'
      },
      revokeObjectURL: (url) => {
        revoked.push(url)
      },
    },
  }

  const result: DocumentExportSuccessResult = {
    ok: true,
    format: 'step',
    filename: 'part-1.step',
    extension: 'step',
    mimeType: 'model/step',
    payload: 'STEP payload',
    diagnostics: [],
  }

  downloadDocumentExportResult(result, environment)

  expectTrue(clicked.length === 1, 'Successful exports should trigger one download click.')
  expectTrue(clicked[0] === 'part-1.step', 'Download should use the returned filename.')
  expectTrue(capturedBlob?.type === 'model/step', 'Download should use the returned MIME type.')
  expectTrue(appended.includes('part-1.step'), 'Download anchor should be attached before clicking.')
  expectTrue(revoked[0] === 'blob:export', 'Download object URL should be revoked after clicking.')
})
