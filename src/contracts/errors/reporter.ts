import type { AppError } from "@/contracts/errors/app-error";

export type ErrorReportVisibility = "user" | "developer" | "silent";

export interface ErrorReportMetadata {
  source: string;
  visibility?: ErrorReportVisibility;
  dedupeKey?: string;
  externalTracking?: {
    fingerprint?: string;
    tags?: Record<string, string>;
  };
}

export interface ErrorReportRecord {
  error: AppError;
  metadata: Required<Pick<ErrorReportMetadata, "source" | "visibility">> &
    Omit<ErrorReportMetadata, "source" | "visibility">;
}

export interface ErrorReporter {
  report(
    error: AppError,
    metadata: ErrorReportMetadata,
  ): ErrorReportRecord | null;
}

interface ConsoleLike {
  error: (...args: unknown[]) => void;
}

export function createConsoleErrorReporter(
  consoleLike: ConsoleLike = console,
): ErrorReporter {
  const reportedDedupeKeys = new Set<string>();

  return {
    report(error, metadata) {
      if (metadata.dedupeKey && reportedDedupeKeys.has(metadata.dedupeKey)) {
        return null;
      }

      if (metadata.dedupeKey) {
        reportedDedupeKeys.add(metadata.dedupeKey);
      }

      const record = createErrorReportRecord(error, metadata);

      if (record.metadata.visibility !== "silent") {
        consoleLike.error("[app-error]", {
          code: error.code,
          severity: error.severity,
          message: error.message,
          context: error.context,
          source: record.metadata.source,
          requestId: error.requestId,
          target: error.target,
        });
      }

      return record;
    },
  };
}

export function createTestErrorReporter(): ErrorReporter & {
  reports: ErrorReportRecord[];
} {
  const reports: ErrorReportRecord[] = [];
  const reportedDedupeKeys = new Set<string>();

  return {
    reports,
    report(error, metadata) {
      if (metadata.dedupeKey && reportedDedupeKeys.has(metadata.dedupeKey)) {
        return null;
      }

      if (metadata.dedupeKey) {
        reportedDedupeKeys.add(metadata.dedupeKey);
      }

      const record = createErrorReportRecord(error, metadata);
      reports.push(record);
      return record;
    },
  };
}

export function createCompositeErrorReporter(
  reporters: readonly ErrorReporter[],
): ErrorReporter {
  return {
    report(error, metadata) {
      let firstRecord: ErrorReportRecord | null = null;

      for (const reporter of reporters) {
        const record = reporter.report(error, metadata);
        firstRecord ??= record;
      }

      return firstRecord;
    },
  };
}

export function createErrorReportRecord(
  error: AppError,
  metadata: ErrorReportMetadata,
): ErrorReportRecord {
  return {
    error,
    metadata: {
      ...metadata,
      source: metadata.source,
      visibility: metadata.visibility ?? "developer",
    },
  };
}
