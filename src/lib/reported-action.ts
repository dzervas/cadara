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

interface ModelingResultRequirement {
  operation: string;
  fallbackMessage: string;
  context?: readonly AppErrorContextEntry[];
}

function modelingResultError(
  result: WorkbenchModelingMutationResult,
  input: ModelingResultRequirement,
) {
  return appErrorFromModelingResult({
    operation: input.operation,
    fallbackMessage: input.fallbackMessage,
    diagnostics: result.diagnostics,
    revisionState: result.revisionState,
    context: input.context,
  });
}

/**
 * An accepted revision with an error diagnostic is a failure here: for
 * callers that must stay atomic (the importer). Workbench edits use
 * `requireAcceptedRevision`.
 */
export function requireAcceptedModelingResult<
  T extends WorkbenchModelingMutationResult,
>(
  result: T,
  input: ModelingResultRequirement,
): AppResult<T> {
  const hasErrorDiagnostic = result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  return hasErrorDiagnostic
    ? err(modelingResultError(result, input))
    : requireAcceptedRevision(result, input);
}

/**
 * Whether the revision was accepted; its diagnostics do not decide it. An
 * accepted edit that leaves features failing has still happened (the caller
 * announces those features), while a rejected or conflicting one has not.
 */
export function requireAcceptedRevision<
  T extends WorkbenchModelingMutationResult,
>(
  result: T,
  input: ModelingResultRequirement,
): AppResult<T> {
  if (result.revisionState.kind === "accepted") {
    return ok(result);
  }

  return err(modelingResultError(result, input));
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
