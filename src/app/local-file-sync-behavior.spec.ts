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
        currentDocumentId: 'document_local_sync' as never,
        async restoreLocalFileBinding() {
          return { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never
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
        currentDocumentId: 'document_local_sync' as never,
        async restoreLocalFileBinding() {
          return { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never
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
        currentDocumentId: 'document_local_sync' as never,
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
    currentDocumentId: 'document_local_sync' as never,
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
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
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
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'synced',
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'persistent-binding-unavailable',
    message: 'Persistent local bindings are unavailable in this browser.',
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
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
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
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
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))
  statusListener?.(makeStatus({
    kind: 'failed',
    message: 'Local file sync target could not be bound.',
    metadata: { documentId: 'document_local_sync', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
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

test('useWorkbenchLocalFileSync does not expose stale binding metadata after switching active documents', async () => {
  let firstStatusListener: ((status: DocumentSyncWriteStatus) => void) | null = null
  let secondStatusListener: ((status: DocumentSyncWriteStatus) => void) | null = null

  const firstModelingService = {
    currentDocumentId: 'document_filesystem' as never,
    async restoreLocalFileBinding() {
      return { documentId: 'document_filesystem', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never
    },
    subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void) {
      firstStatusListener = listener
      return () => {
        firstStatusListener = null
      }
    },
  }
  const secondModelingService = {
    currentDocumentId: 'document_browser' as never,
    async restoreLocalFileBinding() {
      return null
    },
    subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void) {
      secondStatusListener = listener
      return () => {
        secondStatusListener = null
      }
    },
  }

  let controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: firstModelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Successful restore should not report a document-file failure.')
      },
      showWorkbenchError(message) {
        throw new Error(`Successful restore should not show an error: ${message}`)
      },
      showWorkbenchInfo() {},
    }),
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: firstModelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Successful restore should not report a document-file failure.')
      },
      showWorkbenchError(message) {
        throw new Error(`Successful restore should not show an error: ${message}`)
      },
      showWorkbenchInfo() {},
    }),
  )

  expectTrue(
    controller.localFileBindingMetadata?.fileName === 'assembly.cadara',
    'The filesystem-backed document should expose its restored local-file binding.',
  )

  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: secondModelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Browser-only document restore should not report a document-file failure.')
      },
      showWorkbenchError(message) {
        throw new Error(`Browser-only document restore should not show an error: ${message}`)
      },
      showWorkbenchInfo() {},
    }),
  )

  expectTrue(
    controller.localFileBindingMetadata === null && controller.localFileSyncEnabled === false,
    'Switching to a browser-only document should not expose the previous document filesystem binding before async restore settles.',
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: secondModelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Browser-only document restore should not report a document-file failure.')
      },
      showWorkbenchError(message) {
        throw new Error(`Browser-only document restore should not show an error: ${message}`)
      },
      showWorkbenchInfo() {},
    }),
  )

  expectTrue(firstStatusListener === null, 'Switching modeling services should unsubscribe the previous document status listener.')

  secondStatusListener?.({
    documentId: 'document_filesystem',
    sequence: 2,
    kind: 'synced',
    metadata: { documentId: 'document_filesystem', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  })
  secondStatusListener?.({
    documentId: 'document_browser',
    sequence: 3,
    kind: 'idle',
  })
  controller = hookHarness.render(() =>
    useWorkbenchLocalFileSync({
      modelingService: secondModelingService,
      reportDocumentFileActionFailure() {
        throw new Error('Browser-only document restore should not report a document-file failure.')
      },
      showWorkbenchError(message) {
        throw new Error(`Browser-only document restore should not show an error: ${message}`)
      },
      showWorkbenchInfo() {},
    }),
  )

  firstStatusListener?.(makeStatus({
    kind: 'synced',
    metadata: { documentId: 'document_filesystem', fileName: 'assembly.cadara', handleKey: 'binding_1' } as never,
  }))

  expectTrue(
    controller.localFileBindingMetadata === null && controller.localFileSyncEnabled === false,
    'Stale sync events and idle browser-document status should keep the active browser-only document unbound.',
  )
})
