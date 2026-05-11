import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  type AuthoredModelDocumentSchemaVersion,
} from "@/contracts/shared/versioning";

export const DEFAULT_ACTIVE_DOCUMENT_TELEMETRY_BYTE_LIMIT = 120_000;

export interface ActiveDocumentTelemetryCounts {
  sketches: number;
  features: number;
  bodies: number;
  variables: number;
}

export interface ActiveDocumentTelemetryAssetDiagnostic {
  code: string;
  assetId: string;
  format: string;
  byteLength: number;
  hashPrefix: string;
  ownerFeatureIds: readonly string[];
}

export type ActiveDocumentTelemetryContext =
  | {
      availability: "loaded";
      documentId: string;
      revisionId: string;
      schemaVersion: AuthoredModelDocumentSchemaVersion;
      counts: ActiveDocumentTelemetryCounts;
      assetDiagnostics: readonly ActiveDocumentTelemetryAssetDiagnostic[];
      payloadStatus: "attached";
      document: AuthoredModelDocument;
    }
  | {
      availability: "loaded";
      documentId: string;
      revisionId: string;
      schemaVersion: AuthoredModelDocumentSchemaVersion;
      counts: ActiveDocumentTelemetryCounts;
      assetDiagnostics: readonly ActiveDocumentTelemetryAssetDiagnostic[];
      payloadStatus: "omitted-too-large" | "omitted-unserializable";
      omittedReason: string;
    }
  | {
      availability: "unavailable";
      reason: "not-loaded";
    };

export interface ErrorReporterTelemetryContextSnapshot {
  activeDocument: ActiveDocumentTelemetryContext;
}

interface ActiveDocumentTelemetryOptions {
  payloadByteLimit?: number;
}

let activeDocumentContext: ActiveDocumentTelemetryContext | null = null;

export function publishActiveDocumentTelemetryContext(
  context: ActiveDocumentTelemetryContext,
) {
  activeDocumentContext = context;
}

export function clearActiveDocumentTelemetryContext() {
  activeDocumentContext = null;
}

export function getErrorReporterTelemetryContext(): ErrorReporterTelemetryContextSnapshot {
  return {
    activeDocument: activeDocumentContext ?? {
      availability: "unavailable",
      reason: "not-loaded",
    },
  };
}

export function createActiveDocumentTelemetryContext(
  snapshot: WorkspaceSnapshot,
  options: ActiveDocumentTelemetryOptions = {},
): ActiveDocumentTelemetryContext {
  const documentId = snapshot.document.documentId;
  const revisionId = snapshot.document.revisionId;
  const counts = getActiveDocumentTelemetryCounts(snapshot);
  const assetDiagnostics = getActiveDocumentTelemetryAssetDiagnostics(snapshot);

  try {
    const document = createAuthoredModelDocumentFromSnapshot(snapshot);
    const serialized = JSON.stringify(document);
    const payloadByteLength = new TextEncoder().encode(serialized).byteLength;
    const payloadByteLimit =
      options.payloadByteLimit ?? DEFAULT_ACTIVE_DOCUMENT_TELEMETRY_BYTE_LIMIT;

    if (payloadByteLength > payloadByteLimit) {
      return {
        availability: "loaded",
        documentId,
        revisionId,
        schemaVersion: document.schemaVersion,
        counts,
        assetDiagnostics,
        payloadStatus: "omitted-too-large",
        omittedReason: `Authored document payload was ${payloadByteLength} bytes, over the ${payloadByteLimit} byte telemetry limit.`,
      };
    }

    return {
      availability: "loaded",
      documentId,
      revisionId,
      schemaVersion: document.schemaVersion,
      counts,
      assetDiagnostics,
      payloadStatus: "attached",
      document,
    };
  } catch (error) {
    return {
      availability: "loaded",
      documentId,
      revisionId,
      schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
      counts,
      assetDiagnostics,
      payloadStatus: "omitted-unserializable",
      omittedReason:
        error instanceof Error
          ? error.message
          : "Authored document payload could not be serialized.",
    };
  }
}

function getActiveDocumentTelemetryAssetDiagnostics(
  snapshot: WorkspaceSnapshot,
): ActiveDocumentTelemetryAssetDiagnostic[] {
  return snapshot.document.diagnostics.flatMap((diagnostic) => {
    if (diagnostic.detail?.kind !== "geometryAsset") {
      return [];
    }

    return [
      {
        code: diagnostic.detail.code,
        assetId: diagnostic.detail.assetId,
        format: diagnostic.detail.format,
        byteLength: diagnostic.detail.byteLength,
        hashPrefix: diagnostic.detail.hashPrefix,
        ownerFeatureIds: diagnostic.detail.ownerFeatureIds,
      },
    ];
  });
}

function getActiveDocumentTelemetryCounts(
  snapshot: WorkspaceSnapshot,
): ActiveDocumentTelemetryCounts {
  return {
    sketches: snapshot.document.sketches.length,
    features: snapshot.document.features.length,
    bodies: snapshot.document.bodies.length,
    variables: snapshot.document.variables.length,
  };
}
