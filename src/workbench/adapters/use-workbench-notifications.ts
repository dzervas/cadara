import { useCallback, useEffect, useState } from "react";

import {
  createAppError,
  errorContext,
  type ErrorReporter,
} from "@/contracts/errors";
import type { ModelingService } from "@/application/modeling/modeling-service";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";
import { subscribeBrowserOccWorkerFailure } from "@/infrastructure/occ/browser-kernel-runtime";
import { handleWorkbenchFailure } from "@/workbench/commands/failure-policy";

interface WorkbenchNotificationsInput {
  errorReporter: ErrorReporter;
  modelingService: Pick<
    ModelingService,
    "currentDocumentId" | "getHistoryRestoreState" | "subscribeToDocumentChanges"
  >;
}

export function useWorkbenchNotifications({
  errorReporter,
  modelingService,
}: WorkbenchNotificationsInput) {
  const [restoreNotice, setRestoreNotice] = useState<{
    owner: WorkbenchNotificationsInput["modelingService"];
    message: string | null;
  } | null>(null);
  // A restore notice belongs to the service/document that produced it.
  const restoreMessage = restoreNotice?.owner === modelingService
    ? restoreNotice.message
    : null;
  const setRestoreMessage = useCallback((message: string | null) => {
    setRestoreNotice((current) =>
      current?.owner === modelingService && current.message === message
        ? current
        : { owner: modelingService, message },
    );
  }, [modelingService]);
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

  useEffect(() => subscribeBrowserOccWorkerFailure((error) => {
    handleWorkbenchFailure({
      appError: createAppError({
        code: "app/operation-failed",
        message: error.message,
        cause: error,
      }),
      reporter: errorReporter,
      metadata: {
        source: "workbench.occ.worker",
        visibility: "user",
        dedupeKey: `occ-worker:${error.message}`,
      },
      reportability: "reportable",
      userMessage: error.message,
      notify: showWorkbenchError,
    });
  }), [errorReporter, showWorkbenchError]);

  useEffect(() => {
    let disposed = false;
    let readVersion = 0;
    let observedMessage: string | null | undefined;
    const updateRestoreMessage = (message: string | null) => {
      // Reobserving the same failure must not reopen a dismissed notice.
      if (observedMessage === message) return;
      observedMessage = message;
      setRestoreMessage(message);
    };

    // Restore failures describe current document state, not a permanent startup event.
    const readRestoreState = () => {
      const version = ++readVersion;
      void modelingService.getHistoryRestoreState().then((state) => {
        if (disposed || version !== readVersion) {
          return;
        }

        if (state.kind !== "failed") {
          updateRestoreMessage(null);
          return;
        }

        const diagnostic = state.diagnostics[0];
        const message =
          diagnostic?.message ?? "Operation history restore failed.";
        updateRestoreMessage(message);
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
      }, (error: unknown) => {
        if (disposed || version !== readVersion) return;
        const message = error instanceof Error
          ? error.message
          : "Modeling service initialization failed unexpectedly.";
        updateRestoreMessage(message);
        handleWorkbenchFailure({
          appError: createAppError({
            code: "workbench/action-failed",
            message,
            cause: error,
            context: [{ key: "documentId", value: modelingService.currentDocumentId }],
          }),
          reporter: errorReporter,
          metadata: {
            source: "workbench.modeling.initialize",
            visibility: "user",
            dedupeKey: `modeling-initialize:${modelingService.currentDocumentId}:${message}`,
          },
          reportability: "reportable",
        });
      });
    };
    const unsubscribe = modelingService.subscribeToDocumentChanges(readRestoreState);
    readRestoreState();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [errorReporter, modelingService, setRestoreMessage]);

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
