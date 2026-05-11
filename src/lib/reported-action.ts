import type { ErrorReporter, ErrorReportMetadata } from "@/contracts/errors";
import {
  appErrorFromModelingResult,
  normalizeUnknownError,
  type AppError,
  type AppErrorContextEntry,
  type AppResult,
  err,
  ok,
} from "@/contracts/errors";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";

interface WorkbenchModelingMutationResult {
  revisionState:
    | { kind: "accepted" }
    | { kind: "conflict"; actualRevisionId: string }
    | { kind: "rejected"; reasonCode: string };
  diagnostics: readonly ModelingDiagnostic[];
}

type ReportedActionMappedFailurePolicy = "expected" | "reportable";

interface ReportedActionReportingPolicy {
  mappedFailure?: ReportedActionMappedFailurePolicy;
  thrownFailure?: ReportedActionMappedFailurePolicy;
}

export function requireAcceptedModelingResult<
  T extends WorkbenchModelingMutationResult,
>(
  result: T,
  input: {
    operation: string;
    fallbackMessage: string;
    context?: readonly AppErrorContextEntry[];
  },
): AppResult<T> {
  if (result.revisionState.kind === "accepted") {
    return ok(result);
  }

  return err(
    appErrorFromModelingResult({
      operation: input.operation,
      fallbackMessage: input.fallbackMessage,
      diagnostics: result.diagnostics,
      revisionState: result.revisionState,
      context: input.context,
    }),
  );
}

function isAppResult<T>(value: T | AppResult<T>): value is AppResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "isOk" in value &&
    typeof (value as { isOk?: unknown }).isOk === "function" &&
    "isErr" in value &&
    typeof (value as { isErr?: unknown }).isErr === "function"
  );
}

export function runReportedAction<TOutput, TSuccess>(input: {
  operation: string;
  context?: readonly AppErrorContextEntry[];
  reporter: ErrorReporter;
  metadata?: Omit<ErrorReportMetadata, "source">;
  reporting?: ReportedActionReportingPolicy;
  action: () => PromiseLike<AppResult<TOutput>>;
  mapSuccess: (output: TOutput) => AppResult<TSuccess>;
  onError: (error: AppError) => void;
}): Promise<AppResult<TSuccess>>;
export function runReportedAction<TOutput, TSuccess>(input: {
  operation: string;
  context?: readonly AppErrorContextEntry[];
  reporter: ErrorReporter;
  metadata?: Omit<ErrorReportMetadata, "source">;
  reporting?: ReportedActionReportingPolicy;
  action: () => PromiseLike<TOutput>;
  mapSuccess: (output: TOutput) => AppResult<TSuccess>;
  onError: (error: AppError) => void;
}): Promise<AppResult<TSuccess>>;
export async function runReportedAction<TOutput, TSuccess>(input: {
  operation: string;
  context?: readonly AppErrorContextEntry[];
  reporter: ErrorReporter;
  metadata?: Omit<ErrorReportMetadata, "source">;
  reporting?: ReportedActionReportingPolicy;
  action: () => PromiseLike<TOutput> | PromiseLike<AppResult<TOutput>>;
  mapSuccess: (output: TOutput) => AppResult<TSuccess>;
  onError: (error: AppError) => void;
}): Promise<AppResult<TSuccess>> {
  let mapped: AppResult<TSuccess>;
  let failureSource: "mapped" | "thrown" = "mapped";

  try {
    const actionOutput = await input.action();
    const actionResult = isAppResult(actionOutput)
      ? actionOutput
      : ok(actionOutput);
    mapped = actionResult.andThen(input.mapSuccess);
  } catch (error: unknown) {
    failureSource = "thrown";
    mapped = err(
      normalizeUnknownError(error, {
        code: "workbench/action-failed",
        fallbackMessage: `${input.operation} failed.`,
        context: [
          { key: "operation", value: input.operation },
          ...(input.context ?? []),
        ],
      }),
    );
  }

  if (mapped.isOk()) {
    return ok(mapped.value);
  }

  const reportability =
    failureSource === "thrown"
      ? (input.reporting?.thrownFailure ?? "reportable")
      : (input.reporting?.mappedFailure ?? "reportable");

  if (reportability === "reportable") {
    input.reporter.report(mapped.error, {
      source: "workbench",
      visibility: "user",
      dedupeKey: `${input.operation}:${mapped.error.requestId ?? mapped.error.message}`,
      ...input.metadata,
    });
  }

  input.onError(mapped.error);
  return mapped;
}
