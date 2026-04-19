import * as SentryBrowser from '@sentry/browser'
import type {
  BrowserOptions,
  CaptureContext,
  SeverityLevel,
} from '@sentry/browser'

export type { CaptureContext, SeverityLevel }

export const BUGSINK_DSN = 'https://0f8f70678fa14347ad0d762e7db3c74c@errors.dzerv.art/1'
const SENTRY_ENVELOPE_VERSION = '7'
const SENTRY_BROWSER_CLIENT = 'sentry.javascript.browser/10.49.0'

export interface SentryBrowserBoundary {
  init(options?: BrowserOptions): unknown
  captureException(exception: unknown, captureContext?: CaptureContext): string
  captureMessage(message: string, captureContext?: CaptureContext | SeverityLevel): string
}

interface ConsoleLike {
  error: (...args: unknown[]) => void
}

type FetchLike = (input: string, init?: RequestInit) => Promise<unknown>

interface SentryInitializationOptions {
  client?: SentryBrowserBoundary
  dsn?: string
  environment?: string
  consoleLike?: ConsoleLike
  enabled?: boolean
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
      dsn: options.dsn ?? BUGSINK_DSN,
      environment: options.environment ?? 'production',
    })
    initializedClients.add(client)
    return true
  } catch (error) {
    options.consoleLike?.error('[app-error-reporter]', error)
    return false
  }
}

export function createSentryDsnTestUrl(dsn = BUGSINK_DSN) {
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
