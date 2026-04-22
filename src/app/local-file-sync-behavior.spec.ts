import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/local-file-sync-behavior.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const workbenchSource = readFileSync(join(process.cwd(), 'src/app/cad-workbench.tsx'), 'utf8')
  const workerRuntimeSource = readFileSync(join(process.cwd(), 'src/domain/modeling/document-sync-worker-runtime.ts'), 'utf8')
  const importHandler = workbenchSource.slice(
    workbenchSource.indexOf('const handleImportDocument'),
    workbenchSource.indexOf('const handleOpenLocalFile'),
  )
  const exportHandler = workbenchSource.slice(
    workbenchSource.indexOf('const handleExportDocument'),
    workbenchSource.indexOf('return ('),
  )

  assert(
    workbenchSource.includes('Local file sync requires the File System Access API.')
      && workbenchSource.includes('brave://flags/#file-system-access-api')
      && workbenchSource.includes('Open local file failed. Select a valid cadara JSON document.')
      && workbenchSource.includes('Local file write permission was denied.')
      && workbenchSource.includes('Local file sync target could not be bound.')
      && workbenchSource.includes('persistent-binding-unavailable'),
    'Workbench should surface visible local sync unavailable, invalid file, permission, bind, and persistence-unavailable states.',
  )
  assert(
    workbenchSource.includes('showBrowserStorageWarning')
      && workbenchSource.includes('TODO: Replace with the cloud-save capability flag when cloud persistence is implemented.'),
    'Workbench should keep the browser-storage warning wired to local file sync status with a cloud-save TODO.',
  )
  assert(
    !importHandler.includes('bindLocalFile') && !exportHandler.includes('bindLocalFile'),
    'Import and Export should remain one-shot actions that do not create or replace local filesystem sync bindings.',
  )
  assert(
    workerRuntimeSource.includes('writeTextToLocalFileHandle')
      && workerRuntimeSource.includes('serializeLocalAuthoredDocument')
      && !workerRuntimeSource.includes('downloadDocumentExportResult')
      && !workerRuntimeSource.includes('showSaveFilePicker')
      && !workerRuntimeSource.includes('showOpenFilePicker'),
    'Worker autosync should write the retained file handle directly without download/export or repeated picker code paths.',
  )
  assert(
    workerRuntimeSource.includes("'permission-denied'")
      && workerRuntimeSource.includes("'failed'")
      && workerRuntimeSource.includes('pendingWrites'),
    'Worker autosync should expose failed/permission states and keep coalescing pending writes explicitly.',
  )
})
