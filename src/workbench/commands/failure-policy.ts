import type {
  AppError,
  ErrorReportMetadata,
  ErrorReporter,
} from "@/contracts/errors";

export type WorkbenchFailureReportability = "expected" | "reportable";

export interface WorkbenchFailurePolicyInput {
  appError: AppError;
  reporter: ErrorReporter;
  metadata: ErrorReportMetadata;
  reportability: WorkbenchFailureReportability;
  userMessage?: string;
  notify?: (message: string) => void;
}

export function handleWorkbenchFailure(
  input: WorkbenchFailurePolicyInput,
): AppError {
  if (input.userMessage && input.notify) {
    input.notify(input.userMessage);
  }

  if (input.reportability === "reportable") {
    input.reporter.report(input.appError, input.metadata);
  }

  return input.appError;
}
