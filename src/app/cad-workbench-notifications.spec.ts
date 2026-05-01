import { beforeEach, mock, test } from 'bun:test'

import { createTestErrorReporter } from '@/contracts/errors'

import {
  createHookTestHarness,
  flushMicrotasks,
} from './workbench/controllers/controller-test-harness'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

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

  assert(controller.workbenchStatusNotification?.type === 'info', 'Info notifications should use the info presentation.')
  assert(
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

  assert(controller.workbenchStatusNotification?.type === 'error', 'Error notifications should use the error presentation.')
  assert(
    controller.workbenchStatusNotification?.title === 'Workbench action failed'
      && controller.workbenchStatusNotification.message === 'Import failed.',
    'Error notifications should keep the shared failure title and the supplied message.',
  )
})

test('useWorkbenchNotifications exposes restore failures through restoreMessage', async () => {
  const reporter = createTestErrorReporter()
  const modelingService = {
    async getHistoryRestoreState() {
      return {
        diagnostics: [{
          code: 'restore-failed',
          detail: null,
          message: 'History restore could not decode the saved timeline.',
          severity: 'error' as const,
          target: null,
        }],
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

  assert(
    controller.restoreMessage === 'History restore could not decode the saved timeline.',
    'Failed history restore state should surface the first diagnostic message through restoreMessage.',
  )
})

test('useWorkbenchNotifications reports document file action failures and mirrors the user-facing error', () => {
  const reporter = createTestErrorReporter()
  const modelingService = {
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

  assert(
    controller.workbenchStatusNotification?.type === 'error'
      && controller.workbenchStatusNotification.title === 'Workbench action failed'
      && controller.workbenchStatusNotification.message === 'Local file sync restore failed.',
    'Document file action failures should surface the same visible error through the notification seam.',
  )
  assert(reporter.reports.length === 1, 'Document file action failures should be forwarded to the error reporter once.')
  assert(
    reporter.reports[0]?.metadata.source === 'workbench.file.restoreLocalBinding'
      && reporter.reports[0]?.metadata.visibility === 'user',
    'Document file action failures should be reported with the original source and user visibility.',
  )
  assert(
    reporter.reports[0]?.error.message === 'Local file sync restore failed.'
      && reporter.reports[0]?.error.context[0]?.key === 'reason'
      && reporter.reports[0]?.error.context[0]?.value === 'IndexedDB quota exceeded.',
    'Document file action failures should preserve the user-visible message and the low-level reason context.',
  )
})
