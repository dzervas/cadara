import { beforeEach, mock, test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { DocumentSyncWriteStatus } from '@/domain/modeling/document-sync-worker-protocol'

import {
  createHookTestHarness,
  flushMicrotasks,
} from './workbench/controllers/controller-test-harness'

const hookHarness = createHookTestHarness()
const actualReactModule = await import('react')
mock.module('react', () => hookHarness.reactModule)

const { useWorkbenchLocalFileSync } = await import('./workbench/controllers/use-workbench-local-file-sync')
mock.module('react', () => actualReactModule)

beforeEach(() => {
  hookHarness.reset()
})

function makeStatus(
  status: Omit<DocumentSyncWriteStatus, 'documentId' | 'sequence'>,
): DocumentSyncWriteStatus {
  return {
    documentId: 'document_local_sync',
    sequence: 1,
    ...status,
  } as DocumentSyncWriteStatus
}

test('useWorkbenchLocalFileSync restores a binding on mount and reports restore failures', async () => {
  const infos: string[] = []
  const failures: unknown[] = []

  let controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: {
        async restoreLocalFileBinding() {
          return { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never
        },
        subscribeToLocalFileSyncStatus() {
          return () => undefined
        },
      },
      reportDocumentFileActionFailure(source, message, error) {
        failures.push({ error, message, source })
      },
      showWorkbenchError(message) {
        throw new Error(`Successful restore should not show an error: ${message}`)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
    }),
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()

  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: {
        async restoreLocalFileBinding() {
          return { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never
        },
        subscribeToLocalFileSyncStatus() {
          return () => undefined
        },
      },
      reportDocumentFileActionFailure(source, message, error) {
        failures.push({ error, message, source })
      },
      showWorkbenchError(message) {
        throw new Error(`Successful restore should not show an error: ${message}`)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
    }),
  )

  expectTrue(
    JSON.stringify(infos) === JSON.stringify(['Restored local file sync for assembly.cadara.']),
    'Restoring a saved local-file binding should surface a user-facing confirmation on mount.',
  )
  expectTrue(controller.localFileSyncEnabled === false, 'A one-time restore message should not toggle sync-enabled state by itself.')
  expectTrue(failures.length === 0, 'Successful restore should not report a document-file action failure.')

  const restoreFailure = new Error('Local file binding store is unavailable.')
  hookHarness.reset()
  hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: {
        async restoreLocalFileBinding() {
          throw restoreFailure
        },
        subscribeToLocalFileSyncStatus() {
          return () => undefined
        },
      },
      reportDocumentFileActionFailure(source, message, error) {
        failures.push({ error, message, source })
      },
      showWorkbenchError() {
        throw new Error('Restore failures should route through the shared document-file failure reporter.')
      },
      showWorkbenchInfo() {
        throw new Error('Restore failures should not show a success message.')
      },
    }),
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()

  expectTrue(
    JSON.stringify(failures) === JSON.stringify([{
      error: restoreFailure,
      message: 'Local file sync restore failed.',
      source: 'workbench.file.restoreLocalBinding',
    }]),
    'Restore failures should be forwarded through the shared document-file failure reporting seam.',
  )
})

test('useWorkbenchLocalFileSync maps worker status updates to visible messages and enabled state', async () => {
  const infos: string[] = []
  const errors: string[] = []
  let statusListener: ((status: DocumentSyncWriteStatus) => void) | null = null

  const modelingService = {
    async restoreLocalFileBinding() {
      return null
    },
    subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void) {
      statusListener = listener
      return () => {
        statusListener = null
      }
    },
  }

  let controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Live status updates should not use the restore failure seam.')
      },
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
    }),
  )

  await hookHarness.flushEffects()
  expectTrue(statusListener instanceof Function, 'The controller should subscribe to local-file sync status updates on mount.')

  statusListener?.(makeStatus({
    kind: 'binding-restored',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Live status updates should not use the restore failure seam.')
      },
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
    }),
  )
  expectTrue(controller.localFileSyncEnabled, 'Binding restoration should mark local-file sync as enabled.')

  statusListener?.(makeStatus({
    kind: 'syncing',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'synced',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'persistent-binding-unavailable',
    message: 'Persistent local bindings are unavailable in this browser.',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Live status updates should not use the restore failure seam.')
      },
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
    }),
  )

  expectTrue(
    JSON.stringify(infos) === JSON.stringify([
      'Restored local file sync for assembly.cadara.',
      'Syncing assembly.cadara.',
      'Synced assembly.cadara.',
      'Persistent local bindings are unavailable in this browser.',
    ]),
    'Enabled sync states should surface the expected user-facing information messages.',
  )
  expectTrue(controller.localFileSyncEnabled, 'Persistent-binding warnings should still keep sync marked as enabled.')

  statusListener?.(makeStatus({
    kind: 'permission-required',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Live status updates should not use the restore failure seam.')
      },
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
    }),
  )
  expectTrue(!controller.localFileSyncEnabled, 'Permission-required status should disable local-file sync until access is granted.')

  statusListener?.(makeStatus({
    kind: 'permission-denied',
    message: 'Local file write permission was denied.',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'failed',
    message: 'Local file sync target could not be bound.',
    metadata: { fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'idle',
  }))

  expectTrue(
    JSON.stringify(errors) === JSON.stringify([
      'Local file sync needs write permission for assembly.cadara.',
      'Local file write permission was denied.',
      'Local file sync target could not be bound.',
    ]),
    'Permission and failure statuses should map to the expected workbench error messages.',
  )
})
