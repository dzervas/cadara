import { test } from 'bun:test'
import { z } from 'zod'

import {
  appErrorFromModelingDiagnostic,
  appErrorFromZodError,
  appErrorToModelingDiagnostic,
  createAppError,
  createConsoleErrorReporter,
  createTestErrorReporter,
  normalizeUnknownError,
} from '@/contracts/errors'

test('src/contracts/errors/app-error.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const cause = new Error('Kernel refused the operation.')
  const normalized = normalizeUnknownError(cause, {
    fallbackMessage: 'Fallback message.',
    requestId: 'request_preview-1',
    context: [{ key: 'operation', value: 'Preview feature' }],
  })

  assert(normalized.message === cause.message, 'Normalization should preserve Error messages.')
  assert(normalized.cause === cause, 'Normalization should preserve the original cause.')
  assert(normalized.requestId === 'request_preview-1', 'Normalization should preserve request ids.')
  assert(
    normalized.context.some((entry) => entry.key === 'operation' && entry.value === 'Preview feature'),
    'Normalization should preserve structured context.',
  )

  const nonError = normalizeUnknownError('bad value', {
    fallbackMessage: 'Non-Error throw fell back.',
  })
  assert(nonError.message === 'Non-Error throw fell back.', 'Non-Error throws should use fallback messages.')
  assert(nonError.cause === 'bad value', 'Non-Error throws should still be retained as causes.')

  const malformedMarkedValue = { [Symbol.for('cadara.appError')]: true, message: 'Malformed app error.' }
  const malformed = normalizeUnknownError(malformedMarkedValue, {
    fallbackMessage: 'Malformed marker fell back.',
  })
  assert(malformed.message === 'Malformed marker fell back.', 'Malformed marked objects should not escape normalization.')
  assert(malformed.cause === malformedMarkedValue, 'Malformed marked objects should still be retained as causes.')

  const zodResult = z.object({ width: z.number() }).safeParse({ width: 'wide' })
  assert(!zodResult.success, 'Fixture should produce a zod error.')
  const zodError = appErrorFromZodError(zodResult.error, { operation: 'Parse dimensions' })
  assert(zodError.code === 'app/validation-failed', 'Zod failures should get validation codes.')
  assert(zodError.message.length > 0, 'Zod failures should expose a human message.')

  const diagnosticError = appErrorFromModelingDiagnostic(
    {
      code: 'document-variable-unresolved-reference',
      severity: 'error',
      message: 'Variable x references missing.',
      target: null,
      detail: null,
    },
    { operation: 'Update variable' },
  )
  assert(diagnosticError.message === 'Variable x references missing.', 'Diagnostic messages should be preserved.')
  assert(
    diagnosticError.context.some((entry) => entry.key === 'diagnosticCode'),
    'Diagnostic codes should be preserved as structured context.',
  )

  const modelingDiagnostic = appErrorToModelingDiagnostic(createAppError({
    code: 'workbench/action-failed',
    severity: 'fatal',
    message: 'Render subtree crashed.',
  }))
  assert(modelingDiagnostic.severity === 'error', 'Fatal app errors should become error diagnostics.')

  const testReporter = createTestErrorReporter()
  const report = testReporter.report(normalized, {
    source: 'unit',
    visibility: 'user',
    dedupeKey: 'same-error',
  })
  const duplicate = testReporter.report(normalized, {
    source: 'unit',
    visibility: 'user',
    dedupeKey: 'same-error',
  })
  assert(report !== null, 'Test reporter should keep the first deduped report.')
  assert(duplicate === null, 'Test reporter should suppress duplicate dedupe keys.')
  assert(testReporter.reports.length === 1, 'Test reporter should store reports.')

  const consoleRecords: unknown[][] = []
  const consoleReporter = createConsoleErrorReporter({
    error: (...args: unknown[]) => {
      consoleRecords.push(args)
    },
  })
  consoleReporter.report(normalized, { source: 'unit' })
  assert(String(consoleRecords[0]?.[0]) === '[app-error]', 'Console reporter should emit actionable records.')
})
