import type {
  CaptureContext,
  SeverityLevel,
} from '@/contracts/errors/sentry-client'

import type { AppError, AppErrorSeverity } from '@/contracts/errors/app-error'
import {
  createErrorReportRecord,
  type ErrorReportRecord,
  type ErrorReporter,
} from '@/contracts/errors/reporter'
import {
  SENTRY_DSN,
  defaultSentryBrowserClient,
  initializeSentryErrorReporting,
  shouldEnablePerformanceTelemetry,
  shouldEnableSentryErrorReporting,
  type SentryBrowserBoundary,
} from '@/contracts/errors/sentry-client'
import {
  getErrorReporterTelemetryContext,
  type ActiveDocumentTelemetryContext,
} from '@/contracts/errors/telemetry-context'

export {
  SENTRY_DSN,
  initializeSentryErrorReporting,
  shouldEnablePerformanceTelemetry,
  shouldEnableSentryErrorReporting,
  type SentryBrowserBoundary,
}

interface ConsoleLike {
  error: (...args: unknown[]) => void
}

interface SentryErrorReporterOptions {
  client?: SentryBrowserBoundary
  dsn?: string
  environment?: string
  release?: string | null
  dist?: string | null
  consoleLike?: ConsoleLike
}

export function createSentryErrorReporter(options: SentryErrorReporterOptions = {}): ErrorReporter {
  const client = options.client ?? defaultSentryBrowserClient
  const reportedDedupeKeys = new Set<string>()

  initializeSentryErrorReporting({ ...options, client })

  return {
    report(error, metadata) {
      if (metadata.dedupeKey && reportedDedupeKeys.has(metadata.dedupeKey)) {
        return null
      }

      if (metadata.dedupeKey) {
        reportedDedupeKeys.add(metadata.dedupeKey)
      }

      const record = createErrorReportRecord(error, metadata)

      try {
        const captureContext = createSentryCaptureContext(error, record.metadata)
        const cause = error.cause

        if (cause instanceof Error) {
          client.captureException(cause, captureContext)
        } else {
          client.captureMessage(error.message, captureContext)
        }
      } catch (reportingError) {
        options.consoleLike?.error('[app-error-reporter]', reportingError)
      }

      return record
    },
  }
}

function createSentryCaptureContext(
  error: AppError,
  metadata: ErrorReportRecord['metadata'],
): CaptureContext {
  const telemetryContext = getErrorReporterTelemetryContext()
  const activeDocument = telemetryContext.activeDocument
  const activeDocumentContext = createSentryActiveDocumentContext(activeDocument)
  const externalTags = metadata.externalTracking?.tags ?? {}
  const contextRecord = Object.fromEntries(error.context.map((entry) => [entry.key, entry.value]))
  const tags: Record<string, string> = {
    ...externalTags,
    'app.error_code': error.code,
    'app.error_severity': error.severity,
    'app.error_source': metadata.source,
    'app.error_visibility': metadata.visibility,
    'active_document.available': String(activeDocument.availability === 'loaded'),
  }

  if (error.requestId) {
    tags['app.request_id'] = error.requestId
  }

  if (error.target) {
    tags['app.target_kind'] = error.target.kind
  }

  if (activeDocument.availability === 'loaded') {
    tags['active_document.id'] = activeDocument.documentId
    tags['active_document.revision_id'] = activeDocument.revisionId
    tags['active_document.schema_version'] = activeDocument.schemaVersion
    tags['active_document.payload_status'] = activeDocument.payloadStatus
  }

  const captureContext: CaptureContext = {
    level: sentryLevelForSeverity(error.severity),
    tags,
    contexts: {
      app_error: {
        code: error.code,
        severity: error.severity,
        message: error.message,
        context: contextRecord,
        requestId: error.requestId ?? null,
        target: error.target ?? null,
        recoverable: error.recoverable ?? null,
      },
      report: {
        source: metadata.source,
        visibility: metadata.visibility,
        dedupeKey: metadata.dedupeKey ?? null,
        fingerprint: metadata.externalTracking?.fingerprint ?? null,
      },
      active_document: activeDocumentContext,
    },
    extra: {
      appErrorContext: error.context,
      activeDocumentPayload:
        activeDocument.availability === 'loaded' && activeDocument.payloadStatus === 'attached'
          ? activeDocument.document
          : null,
      causeStack: error.cause instanceof Error ? error.cause.stack ?? null : null,
    },
  }

  if (metadata.externalTracking?.fingerprint) {
    captureContext.fingerprint = [metadata.externalTracking.fingerprint]
  }

  return captureContext
}

function createSentryActiveDocumentContext(activeDocument: ActiveDocumentTelemetryContext) {
  if (activeDocument.availability === 'unavailable') {
    return activeDocument
  }

  return {
    availability: activeDocument.availability,
    documentId: activeDocument.documentId,
    revisionId: activeDocument.revisionId,
    schemaVersion: activeDocument.schemaVersion,
    counts: activeDocument.counts,
    payloadStatus: activeDocument.payloadStatus,
    omittedReason: activeDocument.payloadStatus === 'attached' ? null : activeDocument.omittedReason,
  }
}

function sentryLevelForSeverity(severity: AppErrorSeverity): SeverityLevel {
  if (severity === 'fatal') {
    return 'fatal'
  }

  if (severity === 'warning') {
    return 'warning'
  }

  if (severity === 'info') {
    return 'info'
  }

  return 'error'
}
