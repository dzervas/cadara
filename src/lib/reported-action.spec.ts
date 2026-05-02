import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createAppError,
  createTestErrorReporter,
  err,
  ok,
} from '@/contracts/errors'
import { runReportedAction } from '@/lib/reported-action'

test('runReportedAction maps plain values and AppResults without reporting success', async () => {
  const reporter = createTestErrorReporter()
  const handled: string[] = []

  const plain = await runReportedAction({
    operation: 'Create sketch',
    reporter,
    action: async () => 21,
    mapSuccess: (value) => ok(value * 2),
    onError: (error) => handled.push(error.message),
  })
  expectTrue(plain.isOk() && plain.value === 42, 'Plain successful actions should be wrapped and mapped through the success contract.')

  const appResult = await runReportedAction({
    operation: 'Create sketch',
    reporter,
    action: async () => ok(10),
    mapSuccess: (value) => ok(value + 5),
    onError: (error) => handled.push(error.message),
  })
  expectTrue(appResult.isOk() && appResult.value === 15, 'Successful AppResult actions should flow through mapSuccess unchanged.')

  expectTrue(reporter.reports.length === 0, 'Successful actions should not be reported.')
  expectTrue(handled.length === 0, 'Successful actions should not call the error callback.')
})

test('runReportedAction reports mapped failures and preserves caller metadata', async () => {
  const reporter = createTestErrorReporter()
  const handled: string[] = []
  const mappedError = createAppError({
    code: 'app/operation-failed',
    message: 'Mapped validation failed.',
  })

  const result = await runReportedAction({
    operation: 'Import document',
    reporter,
    metadata: {
      dedupeKey: 'caller-specified-key',
      externalTracking: { fingerprint: ['import', 'document'].join(':') as unknown as string },
    },
    action: async () => 'raw-payload',
    mapSuccess: () => err(mappedError),
    onError: (error) => handled.push(error.message),
  })

  expectTrue(result.isErr(), 'Mapped failures should resolve as AppError results.')
  expectTrue(
    reporter.reports[0]?.error === mappedError
      && reporter.reports[0]?.metadata.source === 'workbench'
      && reporter.reports[0]?.metadata.visibility === 'user'
      && reporter.reports[0]?.metadata.dedupeKey === 'caller-specified-key',
    'Mapped failures should be reported with workbench source, user visibility, and caller metadata.',
  )
  expectTrue(
    handled[0] === 'Mapped validation failed.',
    'Mapped failures should call onError with the normalized AppError.',
  )
})

test('runReportedAction normalizes thrown errors and derives dedupe keys from operation and message', async () => {
  const reporter = createTestErrorReporter()
  const handled: string[] = []

  const result = await runReportedAction({
    operation: 'Delete feature',
    context: [{ key: 'featureId', value: 'feature_1' }],
    reporter,
    action: async () => {
      throw new Error('Kernel exploded.')
    },
    mapSuccess: (value: never) => ok(value),
    onError: (error) => handled.push(error.message),
  })

  expectTrue(result.isErr(), 'Thrown failures should normalize into AppError results.')
  expectTrue(
    result.isErr()
      && result.error.code === 'workbench/action-failed'
      && result.error.message === 'Kernel exploded.'
      && result.error.context.some((entry) => entry.key === 'operation' && entry.value === 'Delete feature')
      && result.error.context.some((entry) => entry.key === 'featureId' && entry.value === 'feature_1'),
    'Thrown failures should normalize with workbench/action-failed and merged context entries.',
  )
  expectTrue(
    reporter.reports[0]?.metadata.dedupeKey === 'Delete feature:Kernel exploded.',
    'Thrown failures should derive a dedupe key from the operation and normalized error message when the caller does not provide one.',
  )
  expectTrue(handled[0] === 'Kernel exploded.', 'Thrown failures should be forwarded to onError.')
})

test('runReportedAction preserves reporter dedupe behavior while still notifying callers', async () => {
  const reporter = createTestErrorReporter()
  const handled: string[] = []
  const action = async () => err(createAppError({
    code: 'app/operation-failed',
    message: 'Selection is invalid.',
  }))

  const first = await runReportedAction({
    operation: 'Rename body',
    reporter,
    action,
    mapSuccess: (value: never) => ok(value),
    onError: (error) => handled.push(error.message),
  })
  const second = await runReportedAction({
    operation: 'Rename body',
    reporter,
    action,
    mapSuccess: (value: never) => ok(value),
    onError: (error) => handled.push(error.message),
  })

  expectTrue(first.isErr() && second.isErr(), 'Repeated AppResult failures should still resolve as failures.')
  expectTrue(
    reporter.reports.length === 1,
    'Reporter dedupe should suppress duplicate reports that share the same operation-derived key.',
  )
  expectTrue(
    handled.join(',') === 'Selection is invalid.,Selection is invalid.',
    'Caller error handlers should still run even when the reporter dedupes duplicate failures.',
  )
})
