import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/local-file-sync-behavior.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const workbenchSource = readFileSync(join(process.cwd(), 'src/app/workbench/cad-workbench.tsx'), 'utf8')
  const fileActionsSource = readFileSync(join(process.cwd(), 'src/app/workbench/document/workbench-document-actions.ts'), 'utf8')
  const localSyncSource = readFileSync(join(process.cwd(), 'src/app/workbench/controllers/use-workbench-local-file-sync.ts'), 'utf8')
  const workerRuntimeSource = readFileSync(join(process.cwd(), 'src/domain/modeling/document-sync-worker-runtime.ts'), 'utf8')

  assert(
    fileActionsSource.includes('Local file sync requires the File System Access API.')
      && fileActionsSource.includes('brave://flags/#file-system-access-api')
      && fileActionsSource.includes('Open local file failed. Select a valid cadara JSON document.')
      && fileActionsSource.includes('ZIP-backed .cadara packages are no longer supported')
      && fileActionsSource.includes('Local file write permission was denied.')
      && fileActionsSource.includes('Local file sync target could not be bound.')
      && localSyncSource.includes('persistent-binding-unavailable'),
    'Workbench should surface visible local sync unavailable, invalid file, permission, bind, and persistence-unavailable states through the extracted controllers.',
  )
  assert(
    workbenchSource.includes('showBrowserStorageWarning')
      && workbenchSource.includes('TODO: Replace with the cloud-save capability flag when cloud persistence is implemented.'),
    'Workbench should keep the browser-storage warning wired to local file sync status with a cloud-save TODO.',
  )
  assert(
    !fileActionsSource.slice(
      fileActionsSource.indexOf('export async function importWorkbenchDocumentFile'),
      fileActionsSource.indexOf('export async function openWorkbenchLocalFile'),
    ).includes('bindLocalFile')
      && !fileActionsSource.slice(
        fileActionsSource.indexOf('export async function exportWorkbenchDocument'),
      ).includes('bindLocalFile'),
    'Import and Export should remain one-shot actions that do not create or replace local filesystem sync bindings.',
  )
  assert(
    workerRuntimeSource.includes('writeTextToLocalFileHandle')
      && workerRuntimeSource.includes('createLocalAuthoredDocumentPayload')
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
  assert(
    localSyncSource.includes('subscribeToLocalFileSyncStatus')
      && localSyncSource.includes('restoreLocalFileBinding')
      && localSyncSource.includes('showWorkbenchInfo')
      && localSyncSource.includes('showWorkbenchError'),
    'Workbench local sync controller should remain responsible for subscribing to sync state and surfacing status feedback.',
  )
})
