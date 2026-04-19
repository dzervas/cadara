import { test } from 'bun:test'

import { createAppError } from '@/contracts/errors'
import { createDefaultErrorReporter } from '@/contracts/errors/default-reporter'
import {
  checkSentryDsnReachability,
  createSentryDsnTestUrl,
} from '@/contracts/errors/sentry-client'
import {
  BUGSINK_DSN,
  createSentryErrorReporter,
  initializeSentryErrorReporting,
  shouldEnableSentryErrorReporting,
  type SentryBrowserBoundary,
} from '@/contracts/errors/sentry-reporter'
import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from '@/contracts/errors/telemetry-context'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

interface CapturedEvent {
  kind: 'exception' | 'message'
  value: unknown
  context: unknown
}

const expectedTestEnvelopeUrl =
  'https://example.test/api/42/envelope/?sentry_version=7&sentry_key=public&sentry_client=sentry.javascript.browser%2F10.49.0'

test('src/contracts/errors/sentry-reporter.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const initOptions: unknown[] = []
  const capturedEvents: CapturedEvent[] = []
  const client: SentryBrowserBoundary = {
    init(options) {
      initOptions.push(options)
    },
    captureException(exception, context) {
      capturedEvents.push({ kind: 'exception', value: exception, context })
      return 'event_exception'
    },
    captureMessage(message, context) {
      capturedEvents.push({ kind: 'message', value: message, context })
      return 'event_message'
    },
  }

  clearActiveDocumentTelemetryContext()
  const cause = new Error('Kernel stack source.')
  const reporter = createSentryErrorReporter({ client })
  const error = createAppError({
    code: 'workbench/action-failed',
    severity: 'fatal',
    message: 'Workbench action failed.',
    cause,
    requestId: 'request_action-1',
    context: [{ key: 'operation', value: 'Commit feature' }],
    target: { kind: 'feature', featureId: 'feature_extrude-1' },
    recoverable: false,
  })

  const record = reporter.report(error, {
    source: 'workbench-action',
    visibility: 'user',
    dedupeKey: 'same-action',
    externalTracking: {
      fingerprint: 'workbench-action-failed',
      tags: {
        command: 'extrude',
      },
    },
  })
  const duplicate = reporter.report(error, {
    source: 'workbench-action',
    dedupeKey: 'same-action',
  })

  assert(record !== null, 'Sentry reporter should return the first record.')
  assert(duplicate === null, 'Sentry reporter should preserve dedupe behavior.')
  assert(initOptions.length === 1, 'Sentry reporter should initialize the SDK once on creation.')
  assert((initOptions[0] as { dsn?: string }).dsn === BUGSINK_DSN, 'Sentry reporter should use the Bugsink DSN.')
  assert(initializeSentryErrorReporting({ client }), 'Repeated initialization should report the initialized client.')
  assert(initOptions.length === 1, 'Sentry reporter should not initialize the same SDK client twice.')
  assert(
    createSentryDsnTestUrl('https://public@example.test/sentry/42') === expectedTestEnvelopeUrl,
    'The Sentry DSN test URL should target the project envelope endpoint with Sentry query metadata.',
  )
  const checkedRequests: { input: string, init?: RequestInit }[] = []
  assert(
    await checkSentryDsnReachability({
      dsn: 'https://public@example.test/sentry/42',
      fetchLike(input, init) {
        checkedRequests.push({ input, init })
        return Promise.resolve()
      },
    }),
    'Reachability checks should pass when the browser request resolves.',
  )
  assert(
    checkedRequests[0]?.input === expectedTestEnvelopeUrl,
    'Reachability checks should request the derived Sentry envelope endpoint.',
  )
  assert(checkedRequests[0]?.init?.method === 'GET', 'Reachability checks should use a visible browser GET probe.')
  assert(
    !(await checkSentryDsnReachability({
      dsn: 'https://public@example.test/sentry/42',
      fetchLike() {
        return Promise.reject(new Error('blocked'))
      },
    })),
    'Reachability checks should fail when the browser blocks the request.',
  )
  assert(capturedEvents.length === 1, 'Dedupe should suppress duplicate SDK captures.')
  assert(capturedEvents[0]?.kind === 'exception', 'Error causes should be captured as exceptions to preserve stacks.')
  assert(capturedEvents[0]?.value === cause, 'The original Error cause should be sent to the SDK.')

  const captureContext = capturedEvents[0]?.context as {
    level?: string
    tags?: Record<string, string>
    contexts?: {
      app_error?: Record<string, unknown>
      report?: Record<string, unknown>
      active_document?: Record<string, unknown>
    }
    extra?: Record<string, unknown>
    fingerprint?: string[]
  }
  assert(captureContext.level === 'fatal', 'AppError severity should map to Sentry level.')
  assert(captureContext.tags?.['app.error_code'] === 'workbench/action-failed', 'Error code should be sent as a tag.')
  assert(captureContext.tags?.['app.error_source'] === 'workbench-action', 'Report source should be sent as a tag.')
  assert(captureContext.tags?.command === 'extrude', 'External tracking tags should be preserved.')
  assert(captureContext.tags?.['app.target_kind'] === 'feature', 'Target metadata should be represented compactly.')
  assert(captureContext.contexts?.app_error?.message === 'Workbench action failed.', 'AppError message should be preserved.')
  assert(captureContext.contexts?.report?.visibility === 'user', 'Report visibility should be included.')
  assert(captureContext.contexts?.active_document?.availability === 'unavailable', 'Missing document context should be explicit.')
  assert(captureContext.extra?.causeStack === cause.stack, 'Cause stack should be available as event extra.')
  assert(captureContext.fingerprint?.[0] === 'workbench-action-failed', 'External fingerprint should be passed through.')

  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
  })).snapshot
  publishActiveDocumentTelemetryContext(createActiveDocumentTelemetryContext(snapshot))

  reporter.report(createAppError({
    code: 'app/operation-failed',
    message: 'Non-exception failure.',
  }), {
    source: 'unit',
  })

  const loadedDocumentContext = capturedEvents[1]?.context as {
    tags?: Record<string, string>
    contexts?: {
      active_document?: Record<string, unknown>
    }
    extra?: Record<string, unknown>
  }
  const activeDocumentPayload = loadedDocumentContext.extra?.activeDocumentPayload as Record<string, unknown> | null
  assert(capturedEvents[1]?.kind === 'message', 'Errors without Error causes should be captured as messages.')
  assert(loadedDocumentContext.tags?.['active_document.id'] === snapshot.document.documentId, 'Document id should be tagged.')
  assert(
    loadedDocumentContext.tags?.['active_document.revision_id'] === snapshot.document.revisionId,
    'Revision id should be tagged.',
  )
  assert(loadedDocumentContext.contexts?.active_document?.payloadStatus === 'attached', 'Loaded documents should attach payloads.')
  assert(activeDocumentPayload !== null, 'Loaded document payload should be attached as event extra.')
  assert(!('render' in activeDocumentPayload), 'Telemetry payload should exclude render exports.')
  assert(!('presentation' in activeDocumentPayload), 'Telemetry payload should exclude presentation state.')
  assert(Array.isArray(activeDocumentPayload.sketches), 'Telemetry payload should include authored sketches.')

  const devConsoleRecords: unknown[][] = []
  const devReporter = createDefaultErrorReporter({
    isProduction: false,
    sentryClient: client,
    consoleLike: {
      error: (...args: unknown[]) => {
        devConsoleRecords.push(args)
      },
    },
  })
  devReporter.report(error, { source: 'unit' })
  assert(initOptions.length === 1, 'Non-production reporter selection should not initialize Sentry.')
  assert(devConsoleRecords.length === 1, 'Non-production reporter selection should keep local reporting.')

  const productionInitOptions: unknown[] = []
  const productionClient: SentryBrowserBoundary = {
    init(options) {
      productionInitOptions.push(options)
    },
    captureException() {
      return 'event_exception'
    },
    captureMessage() {
      return 'event_message'
    },
  }
  const productionReporter = createDefaultErrorReporter({
    isProduction: true,
    sentryClient: productionClient,
  })
  productionReporter.report(error, { source: 'unit-production' })
  assert(productionInitOptions.length === 1, 'Production reporter selection should initialize Sentry.')

  const disabledInitOptions: unknown[] = []
  const disabledClient: SentryBrowserBoundary = {
    init(options) {
      disabledInitOptions.push(options)
    },
    captureException() {
      return 'event_exception'
    },
    captureMessage() {
      return 'event_message'
    },
  }
  assert(
    !initializeSentryErrorReporting({ client: disabledClient, enabled: false }),
    'Disabled Sentry initialization should report that no client was initialized.',
  )
  assert(disabledInitOptions.length === 0, 'Disabled Sentry initialization should not call the SDK.')
  const disabledProbeUrls: string[] = []
  assert(
    !initializeSentryErrorReporting({
      client: disabledClient,
      enabled: false,
      dsn: 'https://public@example.test/sentry/42',
      checkDsnReachability: true,
      fetchLike(input) {
        disabledProbeUrls.push(input)
        return Promise.resolve()
      },
    }),
    'Disabled Sentry initialization should still leave SDK reporting disabled.',
  )
  await Promise.resolve()
  assert(
    disabledProbeUrls[0] === expectedTestEnvelopeUrl,
    'The DSN probe should still run when full Sentry reporting is disabled.',
  )
  assert(disabledInitOptions.length === 0, 'The dev probe should not initialize the SDK.')
  const probeInitOptions: unknown[] = []
  const probeUrls: string[] = []
  const probeClient: SentryBrowserBoundary = {
    init(options) {
      probeInitOptions.push(options)
    },
    captureException() {
      return 'event_exception'
    },
    captureMessage() {
      return 'event_message'
    },
  }
  assert(
    initializeSentryErrorReporting({
      client: probeClient,
      dsn: 'https://public@example.test/sentry/42',
      checkDsnReachability: true,
      fetchLike(input) {
        probeUrls.push(input)
        return Promise.resolve()
      },
    }),
    'Enabled Sentry initialization should start successfully when the SDK initializes.',
  )
  await Promise.resolve()
  assert(probeInitOptions.length === 1, 'The probe client should still initialize the SDK once.')
  assert(probeUrls[0] === expectedTestEnvelopeUrl, 'Sentry init should probe DSN reachability.')
  assert(
    shouldEnableSentryErrorReporting({ isProduction: true, search: null }),
    'Production builds should enable Sentry reporting.',
  )
  assert(
    !shouldEnableSentryErrorReporting({ isProduction: false, search: null }),
    'Non-production builds should keep Sentry disabled by default.',
  )
  assert(
    shouldEnableSentryErrorReporting({ isProduction: false, search: '?cadEnableSentry=1' }),
    'The development query opt-in should enable Sentry reporting.',
  )

  clearActiveDocumentTelemetryContext()
})
