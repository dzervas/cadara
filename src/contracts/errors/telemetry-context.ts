import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  type AuthoredModelDocumentSchemaVersion,
} from '@/contracts/shared/versioning'

export const DEFAULT_ACTIVE_DOCUMENT_TELEMETRY_BYTE_LIMIT = 120_000

export interface ActiveDocumentTelemetryCounts {
  sketches: number
  features: number
  bodies: number
  variables: number
}

export type ActiveDocumentTelemetryContext =
  | {
      availability: 'loaded'
      documentId: string
      revisionId: string
      schemaVersion: AuthoredModelDocumentSchemaVersion
      counts: ActiveDocumentTelemetryCounts
      payloadStatus: 'attached'
      document: AuthoredModelDocument
    }
  | {
      availability: 'loaded'
      documentId: string
      revisionId: string
      schemaVersion: AuthoredModelDocumentSchemaVersion
      counts: ActiveDocumentTelemetryCounts
      payloadStatus: 'omitted-too-large' | 'omitted-unserializable'
      omittedReason: string
    }
  | {
      availability: 'unavailable'
      reason: 'not-loaded'
    }

export interface ErrorReporterTelemetryContextSnapshot {
  activeDocument: ActiveDocumentTelemetryContext
}

interface ActiveDocumentTelemetryOptions {
  payloadByteLimit?: number
}

let activeDocumentContext: ActiveDocumentTelemetryContext | null = null

export function publishActiveDocumentTelemetryContext(context: ActiveDocumentTelemetryContext) {
  activeDocumentContext = context
}

export function clearActiveDocumentTelemetryContext() {
  activeDocumentContext = null
}

export function getErrorReporterTelemetryContext(): ErrorReporterTelemetryContextSnapshot {
  return {
    activeDocument: activeDocumentContext ?? {
      availability: 'unavailable',
      reason: 'not-loaded',
    },
  }
}

export function createActiveDocumentTelemetryContext(
  snapshot: DocumentSnapshot,
  options: ActiveDocumentTelemetryOptions = {},
): ActiveDocumentTelemetryContext {
  const documentId = snapshot.document.documentId
  const revisionId = snapshot.document.revisionId
  const counts = getActiveDocumentTelemetryCounts(snapshot)

  try {
    const document = createAuthoredModelDocumentFromSnapshot(snapshot)
    const serialized = JSON.stringify(document)
    const payloadByteLength = new TextEncoder().encode(serialized).byteLength
    const payloadByteLimit = options.payloadByteLimit ?? DEFAULT_ACTIVE_DOCUMENT_TELEMETRY_BYTE_LIMIT

    if (payloadByteLength > payloadByteLimit) {
      return {
        availability: 'loaded',
        documentId,
        revisionId,
        schemaVersion: document.schemaVersion,
        counts,
        payloadStatus: 'omitted-too-large',
        omittedReason: `Authored document payload was ${payloadByteLength} bytes, over the ${payloadByteLimit} byte telemetry limit.`,
      }
    }

    return {
      availability: 'loaded',
      documentId,
      revisionId,
      schemaVersion: document.schemaVersion,
      counts,
      payloadStatus: 'attached',
      document,
    }
  } catch (error) {
    return {
      availability: 'loaded',
      documentId,
      revisionId,
      schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
      counts,
      payloadStatus: 'omitted-unserializable',
      omittedReason: error instanceof Error ? error.message : 'Authored document payload could not be serialized.',
    }
  }
}

function getActiveDocumentTelemetryCounts(snapshot: DocumentSnapshot): ActiveDocumentTelemetryCounts {
  return {
    sketches: snapshot.document.sketches.length,
    features: snapshot.document.features.length,
    bodies: snapshot.document.bodies.length,
    variables: snapshot.document.variables.length,
  }
}
