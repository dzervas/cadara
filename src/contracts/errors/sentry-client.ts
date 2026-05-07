import * as SentryBrowser from '@sentry/browser'
import type {
  BrowserOptions,
  CaptureContext,
  SeverityLevel,
} from '@sentry/browser'
import type {
  PerformanceSpan,
  PerformanceSpanAttributeValue,
  PerformanceSpanDescriptor,
  PerformanceTelemetry,
} from '@/contracts/performance/telemetry'
import {
  filterPerformanceSpanAttributes,
  noopPerformanceTelemetry,
} from '@/contracts/performance/telemetry'

export type { CaptureContext, SeverityLevel }

export const SENTRY_DSN = 'https://0a4eee874e00861be4c30cb81fe15ce1@o4511242392961024.ingest.de.sentry.io/4511333375148112'
const SENTRY_PERFORMANCE_TRACES_SAMPLE_RATE = 1
const SENTRY_ENVELOPE_VERSION = '7'
const SENTRY_BROWSER_CLIENT = 'sentry.javascript.browser/10.49.0'

export interface SentryBrowserBoundary {
  init(options?: BrowserOptions): unknown
  captureException(exception: unknown, captureContext?: CaptureContext): string
  captureMessage(message: string, captureContext?: CaptureContext | SeverityLevel): string
  startInactiveSpan?(options: {
    name: string
    op?: string
    attributes?: Record<string, string | number | boolean | undefined>
    forceTransaction?: boolean
  }): {
    setAttribute(key: string, value: string | number | boolean | undefined): unknown
    setAttributes(attributes: Record<string, string | number | boolean | undefined>): unknown
    setStatus?(status: { code: number; message?: string }): unknown
    end(): void
  }
}

interface ConsoleLike {
  error: (...args: unknown[]) => void
}

type FetchLike = (input: string, init?: RequestInit) => Promise<unknown>

interface SentryInitializationOptions {
  client?: SentryBrowserBoundary
  dsn?: string
  environment?: string
  release?: string | null
  dist?: string | null
  consoleLike?: ConsoleLike
  enabled?: boolean
  enablePerformanceTelemetry?: boolean
  tracesSampleRate?: number
  checkDsnReachability?: boolean
  fetchLike?: FetchLike
  onDsnBlocked?: () => void
}

const initializedClients = new WeakSet<SentryBrowserBoundary>()
const dsnBlockedSubscribers = new Set<() => void>()
let isSentryDsnBlocked = false

export const defaultSentryBrowserClient: SentryBrowserBoundary = SentryBrowser

export function initializeSentryErrorReporting(options: SentryInitializationOptions = {}) {
  if (options.checkDsnReachability) {
    startSentryDsnReachabilityCheck(options)
  }

  if (options.enabled === false) {
    return false
  }

  const client = options.client ?? defaultSentryBrowserClient

  if (initializedClients.has(client)) {
    return true
  }

  try {
    client.init({
      dsn: options.dsn ?? SENTRY_DSN,
      environment: options.environment ?? 'production',
      release: options.release ?? undefined,
      dist: options.dist ?? undefined,
      enableLogs: true,
      tracesSampleRate: options.enablePerformanceTelemetry
        ? options.tracesSampleRate ?? SENTRY_PERFORMANCE_TRACES_SAMPLE_RATE
        : undefined,
    })
    initializedClients.add(client)
    return true
  } catch (error) {
    options.consoleLike?.error('[app-error-reporter]', error)
    return false
  }
}

export function createSentryDsnTestUrl(dsn = SENTRY_DSN) {
  const dsnUrl = new URL(dsn)
  const projectId = dsnUrl.pathname.split('/').filter(Boolean).at(-1)

  if (!projectId) {
    throw new Error('Sentry DSN must include a project id.')
  }

  const params = new URLSearchParams({
    sentry_version: SENTRY_ENVELOPE_VERSION,
    sentry_key: dsnUrl.username,
    sentry_client: SENTRY_BROWSER_CLIENT,
  })

  return `${dsnUrl.origin}/api/${projectId}/envelope/?${params}`
}

export async function checkSentryDsnReachability(options: {
  dsn?: string
  fetchLike?: FetchLike
} = {}) {
  const fetchLike = options.fetchLike ?? globalThis.fetch

  if (typeof fetchLike !== 'function') {
    return false
  }

  try {
    await fetchLike(createSentryDsnTestUrl(options.dsn), {
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      mode: 'no-cors',
    })
    return true
  } catch {
    return false
  }
}

export function getSentryDsnBlockedSnapshot() {
  return isSentryDsnBlocked
}

export function subscribeToSentryDsnBlocked(listener: () => void) {
  dsnBlockedSubscribers.add(listener)

  return () => {
    dsnBlockedSubscribers.delete(listener)
  }
}

function markSentryDsnBlocked() {
  if (isSentryDsnBlocked) {
    return
  }

  isSentryDsnBlocked = true

  for (const subscriber of dsnBlockedSubscribers) {
    subscriber()
  }
}

function startSentryDsnReachabilityCheck(options: SentryInitializationOptions) {
  void checkSentryDsnReachability({
    dsn: options.dsn,
    fetchLike: options.fetchLike,
  }).then((isReachable) => {
    if (!isReachable) {
      markSentryDsnBlocked()
      options.onDsnBlocked?.()
    }
  })
}

export function shouldEnableSentryErrorReporting(input: {
  isProduction: boolean
  search?: string | null
}) {
  if (input.isProduction) {
    return true
  }

  if (!input.search) {
    return false
  }

  return new URLSearchParams(input.search).get('cadEnableSentry') === '1'
}

export function shouldEnablePerformanceTelemetry(input: {
  isProduction: boolean
  search?: string | null
}) {
  if (input.isProduction) {
    return true
  }

  if (!input.search) {
    return false
  }

  const params = new URLSearchParams(input.search)
  return params.get('cadEnableSentry') === '1' && params.get('cadEnablePerfTelemetry') === '1'
}

export function createSentryPerformanceTelemetry(options: {
  enabled: boolean
  client?: SentryBrowserBoundary
}): PerformanceTelemetry {
  if (!options.enabled) {
    return noopPerformanceTelemetry
  }

  const client = options.client ?? defaultSentryBrowserClient
  if (typeof client.startInactiveSpan !== 'function') {
    return noopPerformanceTelemetry
  }

  return {
    startSpan(descriptor) {
      return createSentryPerformanceSpan(client, descriptor)
    },
  }
}

function createSentryPerformanceSpan(
  client: SentryBrowserBoundary,
  descriptor: PerformanceSpanDescriptor,
): PerformanceSpan {
  const span = client.startInactiveSpan?.({
    name: descriptor.name,
    op: descriptor.op,
    attributes: toSentrySpanAttributes(filterPerformanceSpanAttributes({
      ...descriptor.attributes,
      'cadara.seam': descriptor.attributes?.['cadara.seam'] ?? descriptor.op,
    })),
  })

  if (!span) {
    return noopPerformanceTelemetry.startSpan(descriptor)
  }

  return {
    setAttribute(name, value) {
      span.setAttribute(name, toSentrySpanAttributeValue(value))
    },
    setAttributes(attributes) {
      span.setAttributes(toSentrySpanAttributes(filterPerformanceSpanAttributes(attributes)))
    },
    end(attributes = {}) {
      const filtered = filterPerformanceSpanAttributes(attributes)
      span.setAttributes(toSentrySpanAttributes(filtered))
      const result = filtered['cadara.result']
      if (result && result !== 'success') {
        span.setStatus?.({ code: 2, message: String(result) })
      }
      span.end()
    },
  }
}

function toSentrySpanAttributes(attributes: Record<string, PerformanceSpanAttributeValue | undefined>) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter((entry): entry is [string, Exclude<PerformanceSpanAttributeValue, null | undefined>] => (
        entry[1] !== null && entry[1] !== undefined
      )),
  )
}

function toSentrySpanAttributeValue(value: PerformanceSpanAttributeValue | undefined) {
  return value === null ? undefined : value
}
