import { beforeEach, mock, test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createTestErrorReporter } from '@/contracts/errors'

import {
  createHookTestHarness,
  flushMicrotasks,
} from './workbench/controllers/controller-test-harness'

const hookHarness = createHookTestHarness()
const actualReactModule = await import('react')
mock.module('react', () => hookHarness.reactModule)

const { useWorkbenchNotifications } = await import('./workbench/controllers/use-workbench-notifications')
mock.module('react', () => actualReactModule)

beforeEach(() => {
  hookHarness.reset()
})

test('useWorkbenchNotifications maps info and error status messages to notification models', () => {
  const reporter = createTestErrorReporter()
  const modelingService = {
    currentDocumentId: 'document_notifications',
    async getHistoryRestoreState() {
      return { kind: 'idle' as const }
    },
  }

  let controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  controller.showWorkbenchInfo('Imported bracket.step.')
  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  expectTrue(controller.workbenchStatusNotification?.type === 'info', 'Info notifications should use the info presentation.')
  expectTrue(
    controller.workbenchStatusNotification?.title === 'Workbench action'
      && controller.workbenchStatusNotification.message === 'Imported bracket.step.',
    'Info notifications should keep the shared workbench title and the supplied message.',
  )

  controller.showWorkbenchError('Import failed.')
  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  expectTrue(controller.workbenchStatusNotification?.type === 'error', 'Error notifications should use the error presentation.')
  expectTrue(
    controller.workbenchStatusNotification?.title === 'Workbench action failed'
      && controller.workbenchStatusNotification.message === 'Import failed.',
    'Error notifications should keep the shared failure title and the supplied message.',
  )
  expectTrue(reporter.reports.length === 0, 'Rendering an error notification should not imply telemetry reporting.')
})

test('useWorkbenchNotifications reports restore failures once and exposes restoreMessage', async () => {
  const reporter = createTestErrorReporter()
  const modelingService = {
    currentDocumentId: 'document_restore_failed',
    async getHistoryRestoreState() {
      return {
        diagnostics: [{
          entryIndex: 4,
          message: 'History restore could not decode the saved timeline.',
          reasonCode: 'restore-failed',
        }],
        entriesReplayed: 3,
        kind: 'failed' as const,
      }
    },
  }

  let controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()

  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  expectTrue(
    controller.restoreMessage === 'History restore could not decode the saved timeline.',
    'Failed history restore state should surface the first diagnostic message through restoreMessage.',
  )
  expectTrue(reporter.reports.length === 1, 'Failed history restore state should be reported once.')
  expectTrue(
    reporter.reports[0]?.metadata.source === 'workbench.history.restore'
      && reporter.reports[0]?.metadata.dedupeKey === 'history-restore:document_restore_failed:3:restore-failed:4:History restore could not decode the saved timeline.',
    'History restore reporting should include source metadata and a stable document/diagnostic dedupe key.',
  )
  expectTrue(
    reporter.reports[0]?.error.context.some((entry) => entry.key === 'documentId' && entry.value === 'document_restore_failed')
      && reporter.reports[0]?.error.context.some((entry) => entry.key === 'reasonCode' && entry.value === 'restore-failed'),
    'History restore reports should carry document and diagnostic context.',
  )

  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()

  expectTrue(reporter.reports.length === 1, 'Repeated restore failure observation should be deduped for one app session.')
})

test('useWorkbenchNotifications reports document file action failures and mirrors the user-facing error', () => {
  const reporter = createTestErrorReporter()
  const modelingService = {
    currentDocumentId: 'document_file_failure',
    async getHistoryRestoreState() {
      return { kind: 'idle' as const }
    },
  }
  const failure = new Error('IndexedDB quota exceeded.')

  let controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  controller.reportDocumentFileActionFailure(
    'workbench.file.restoreLocalBinding',
    'Local file sync restore failed.',
    failure,
  )

  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  )

  expectTrue(
    controller.workbenchStatusNotification?.type === 'error'
      && controller.workbenchStatusNotification.title === 'Workbench action failed'
      && controller.workbenchStatusNotification.message === 'Local file sync restore failed.',
    'Document file action failures should surface the same visible error through the notification seam.',
  )
  expectTrue(reporter.reports.length === 1, 'Document file action failures should be forwarded to the error reporter once.')
  expectTrue(
    reporter.reports[0]?.metadata.source === 'workbench.file.restoreLocalBinding'
      && reporter.reports[0]?.metadata.visibility === 'user',
    'Document file action failures should be reported with the original source and user visibility.',
  )
  expectTrue(
    reporter.reports[0]?.error.message === 'Local file sync restore failed.'
      && reporter.reports[0]?.error.context[0]?.key === 'reason'
      && reporter.reports[0]?.error.context[0]?.value === 'IndexedDB quota exceeded.',
    'Document file action failures should preserve the user-visible message and the low-level reason context.',
  )
})
