import { test } from 'bun:test'

import {
  requireAcceptedModelingResult,
  runWorkbenchAction,
} from '@/app/workbench/shared/workbench-action'
import { appErrorToModelingDiagnostic, createTestErrorReporter } from '@/contracts/errors'

test('src/app/workbench-action.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const reporter = createTestErrorReporter()
  let uiMessage: string | null = null
  const rejected = await runWorkbenchAction({
    operation: 'Update variable',
    reporter,
    action: async () => ({
      revisionState: { kind: 'rejected' as const, reasonCode: 'invalid-variable' },
      diagnostics: [{
        code: 'document-variable-unresolved-reference',
        severity: 'error' as const,
        message: 'Variable width references missing.',
        target: null,
        detail: null,
      }],
    }),
    mapSuccess: (result) => requireAcceptedModelingResult(result, {
      operation: 'Update variable',
      fallbackMessage: 'Update variable failed.',
    }),
    onError: (error) => {
      uiMessage = error.message
    },
  })

  assert(rejected.isErr(), 'Rejected modeling results should return an error result.')
  assert(uiMessage === 'Variable width references missing.', 'Rejected modeling diagnostics should update UI-facing error state.')
  assert(reporter.reports.length === 1, 'Rejected modeling results should be reported.')

  const thrownReporter = createTestErrorReporter()
  let thrownMessage = ''
  const thrown = await runWorkbenchAction({
    operation: 'Rename body',
    reporter: thrownReporter,
    action: async () => {
      throw new Error('IndexedDB is unavailable.')
    },
    mapSuccess: (result: never) => requireAcceptedModelingResult(result, {
      operation: 'Rename body',
      fallbackMessage: 'Rename body failed.',
    }),
    onError: (error) => {
      thrownMessage = error.message
    },
  })

  assert(thrown.isErr(), 'Rejected promises should return an error result.')
  assert(thrownMessage === 'IndexedDB is unavailable.', 'Rejected promises should preserve human messages.')
  assert(thrownReporter.reports[0]?.error.cause instanceof Error, 'Rejected promises should preserve causes.')

  const diagnostic = appErrorToModelingDiagnostic(rejected.error, {
    target: { kind: 'feature', featureId: 'feature_extrude-1' },
  })
  assert(diagnostic.message === uiMessage, 'UI diagnostics should render normalized messages.')
  assert(diagnostic.target?.kind === 'feature', 'AppError diagnostics should preserve diagnostic targets when provided.')
})
