import { useCallback, useEffect, useState } from "react";

import {
  createAppError,
  errorContext,
  type ErrorReporter,
} from "@/contracts/errors";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";
import { handleWorkbenchFailure } from "@/app/workbench/failure-policy";

interface WorkbenchNotificationsInput {
  errorReporter: ErrorReporter;
  modelingService: Pick<
    ModelingService,
    "currentDocumentId" | "getHistoryRestoreState"
  >;
}

export function useWorkbenchNotifications({
  errorReporter,
  modelingService,
}: WorkbenchNotificationsInput) {
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [workbenchStatusNotification, setWorkbenchStatusNotification] =
    useState<WorkbenchNotificationModel | null>(null);

  const showWorkbenchInfo = useCallback((message: string) => {
    setWorkbenchStatusNotification({
      type: "info",
      title: "Workbench action",
      message,
    });
  }, []);

  const showWorkbenchError = useCallback((message: string) => {
    setWorkbenchStatusNotification({
      type: "error",
      title: "Workbench action failed",
      message,
    });
  }, []);

  const reportDocumentFileActionFailure = useCallback(
    (source: string, message: string, error: unknown) => {
      handleWorkbenchFailure({
        appError: createAppError({
          code: "workbench/action-failed",
          message,
          context: errorContext(
            "reason",
            error instanceof Error ? error.message : "Unknown failure",
          ),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source,
          visibility: "user",
          dedupeKey: `${source}:${message}:${
            error instanceof Error ? error.message : "unknown"
          }`,
        },
        reportability: "reportable",
        userMessage: message,
        notify: showWorkbenchError,
      });
    },
    [errorReporter, showWorkbenchError],
  );

  useEffect(() => {
    let disposed = false;

    void modelingService.getHistoryRestoreState().then((state) => {
      if (disposed) {
        return;
      }

      if (state.kind !== "failed") {
        setRestoreMessage(null);
        return;
      }

      const diagnostic = state.diagnostics[0];
      const message =
        diagnostic?.message ?? "Operation history restore failed.";
      setRestoreMessage(message);
      handleWorkbenchFailure({
        appError: createAppError({
          code: "workbench/action-failed",
          message,
          context: [
            { key: "documentId", value: modelingService.currentDocumentId },
            { key: "entriesReplayed", value: state.entriesReplayed },
            ...errorContext("reasonCode", diagnostic?.reasonCode),
            ...errorContext("entryIndex", diagnostic?.entryIndex),
            ...errorContext("diagnosticMessage", diagnostic?.message),
            ...errorContext("diagnosticCount", state.diagnostics.length),
          ],
        }),
        reporter: errorReporter,
        metadata: {
          source: "workbench.history.restore",
          visibility: "user",
          dedupeKey: [
            "history-restore",
            modelingService.currentDocumentId,
            state.entriesReplayed,
            diagnostic?.reasonCode ?? "unknown",
            diagnostic?.entryIndex ?? "none",
            diagnostic?.message ?? "no-message",
          ].join(":"),
        },
        reportability: "reportable",
      });
    });

    return () => {
      disposed = true;
    };
  }, [errorReporter, modelingService]);

  return {
    reportDocumentFileActionFailure,
    restoreMessage,
    setRestoreMessage,
    setWorkbenchStatusNotification,
    showWorkbenchError,
    showWorkbenchInfo,
    workbenchStatusNotification,
  };
}
