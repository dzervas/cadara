import {
  createAppError,
  errorContext,
  type ErrorReporter,
} from "@/contracts/errors";
import {
  createBugReportDebugArtifact,
  createBugReportIssueDraft,
  createBugReportStateArchive,
  createFallbackBugReportIssueUrl,
  downloadBugReportDebugArtifact,
  type BugReportArtifactStatus,
  type BugReportPayloadResult,
} from "@/domain/bug-reporting/report";
import { handleWorkbenchFailure } from "@/workbench/commands/failure-policy";

interface WorkbenchBugReportActionContext {
  createPayload: () => BugReportPayloadResult;
  errorReporter: ErrorReporter;
  showWorkbenchError: (message: string) => void;
}

export function reportWorkbenchBug({
  createPayload,
  errorReporter,
  showWorkbenchError,
}: WorkbenchBugReportActionContext) {
  try {
    const result = createPayload();
    const artifact = createBugReportDebugArtifact(result);
    let artifactStatus: BugReportArtifactStatus = { kind: "not-needed" };

    if (artifact) {
      try {
        downloadBugReportDebugArtifact(artifact);
        artifactStatus = { kind: "downloaded", filename: artifact.filename };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Debug artifact could not be downloaded.";
        artifactStatus = {
          kind: "unavailable",
          filename: artifact.filename,
          reason: message,
        };
        handleWorkbenchFailure({
          appError: createAppError({
            code: "workbench/action-failed",
            message: "Bug-report debug artifact generation failed.",
            context: errorContext("reason", message),
            cause: error,
          }),
          reporter: errorReporter,
          metadata: {
            source: "workbench.reportBug",
            visibility: "developer",
            dedupeKey: `workbench.reportBug.artifact:${message}`,
          },
          reportability: "reportable",
        });
      }
    }

    const issueDraft = createBugReportIssueDraft(result, { artifactStatus });
    const opened = window.open(issueDraft.url, "_blank", "noopener,noreferrer");
    if (!opened) {
      showWorkbenchError(
        "GitHub bug report could not be opened. Check popup blocking for this site.",
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Bug-report payload generation failed.";
    handleWorkbenchFailure({
      appError: createAppError({
        code: "workbench/action-failed",
        message: "Bug-report generation failed.",
        context: errorContext("reason", message),
        cause: error,
      }),
      reporter: errorReporter,
      metadata: {
        source: "workbench.reportBug",
        visibility: "developer",
        dedupeKey: `workbench.reportBug.payload:${message}`,
      },
      reportability: "reportable",
    });

    const opened = window.open(
      createFallbackBugReportIssueUrl(error),
      "_blank",
      "noopener,noreferrer",
    );
    if (!opened) {
      showWorkbenchError(
        "GitHub bug report could not be opened. Check popup blocking for this site.",
      );
    }
  }
}

export async function downloadWorkbenchBugReportState({
  createPayload,
  errorReporter,
  showWorkbenchError,
  showWorkbenchInfo,
}: WorkbenchBugReportActionContext & {
  showWorkbenchInfo: (message: string) => void;
}) {
  try {
    const archive = await createBugReportStateArchive(createPayload(), {
      storage: window.localStorage,
      indexedDB: window.indexedDB,
    });

    downloadBugReportDebugArtifact(archive);
    showWorkbenchInfo(`Downloaded ${archive.filename}.`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Debug state archive could not be downloaded.";
    handleWorkbenchFailure({
      appError: createAppError({
        code: "workbench/action-failed",
        message: "Debug state archive generation failed.",
        context: errorContext("reason", message),
        cause: error,
      }),
      reporter: errorReporter,
      metadata: {
        source: "workbench.downloadBugReportState",
        visibility: "developer",
        dedupeKey: `workbench.downloadBugReportState:${message}`,
      },
      reportability: "reportable",
      userMessage: "Debug state download failed.",
      notify: showWorkbenchError,
    });
  }
}
