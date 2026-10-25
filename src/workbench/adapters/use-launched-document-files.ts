import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeUnknownError, type ErrorReporter } from "@/contracts/errors";
import type { DocumentId } from "@/contracts/shared/ids";
import type { DocumentRepository } from "@/contracts/modeling/document-repository";
import type { ModelingService } from "@/application/modeling/modeling-service";
import type { WorkbenchTab } from "@/core/workspace/workbench-tabs";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";
import {
  allowSavingToLaunchedFile,
  openLaunchedDocumentFileAsTab,
} from "@/workbench/document/document-file-actions";

/** Chromium's `window.launchQueue` (manifest `file_handlers`). */
interface LaunchQueue {
  setConsumer(
    consumer: (params: {
      files: readonly (LocalFileSystemFileHandle | { kind: "directory" })[];
    }) => void,
  ): void;
}

/** What the user is told about one launched file. */
export type LaunchedDocumentFileNotice =
  | {
      kind: "offer-saving";
      id: string;
      documentId: DocumentId;
      handle: LocalFileSystemFileHandle;
      allowing: boolean;
    }
  | { kind: "kept-in-browser"; id: string; fileName: string }
  | {
      kind: "result";
      id: string;
      type: "info" | "error";
      fileName: string;
      message: string;
    };

export const LAUNCHED_FILE_KEPT_MESSAGE =
  "Changes are kept in CADara. Use Save As to write them to a file.";

export function getLaunchedDocumentFileNotification(
  notice: LaunchedDocumentFileNotice,
  actions: { allowSaving: () => void; dismiss: () => void },
): WorkbenchNotificationModel {
  switch (notice.kind) {
    case "offer-saving":
      return {
        type: "info",
        title: notice.handle.name,
        message: `${notice.handle.name} opened from your computer. Allow CADara to save changes back to this file?`,
        action: {
          label: "Allow saving",
          disabled: notice.allowing,
          onClick: actions.allowSaving,
        },
        persistent: true,
        onDismiss: actions.dismiss,
      };
    case "kept-in-browser":
      return {
        type: "info",
        title: notice.fileName,
        message: LAUNCHED_FILE_KEPT_MESSAGE,
        onDismiss: actions.dismiss,
      };
    case "result":
      return {
        type: notice.type,
        title: notice.fileName,
        message: notice.message,
        onDismiss: actions.dismiss,
      };
  }
}

/**
 * Opens the .cadara files the operating system launches the
 * installed app with (`launchQueue`), each in a new tab. A file the app may
 * already write opens linked; any other opens as a browser copy at once and
 * keeps a notification offering "Allow saving" (the click grants write
 * access and links the tab to the file); declining or dismissing it keeps
 * the browser copy. An offer whose tab was closed is withdrawn: its document
 * no longer belongs to the project, so nothing may be written from it.
 */
export function useLaunchedDocumentFiles({
  authorizeOpen,
  openDocumentIds,
  repository,
  createDocumentId,
  openTab,
  getModelingService,
  errorReporter,
}: {
  /** Opening adds a part to the project, like Open…; false skips the file. */
  authorizeOpen: () => boolean;
  /** The documents of the open tabs. */
  openDocumentIds: readonly DocumentId[];
  repository: DocumentRepository | null;
  createDocumentId: () => DocumentId;
  openTab: (tab: WorkbenchTab) => void;
  getModelingService: (documentId: DocumentId) => ModelingService;
  errorReporter: ErrorReporter;
}): (WorkbenchNotificationModel & { id: string })[] {
  const [notices, setNotices] = useState<LaunchedDocumentFileNotice[]>([]);
  const replaceNotice = useCallback(
    (id: string, next: LaunchedDocumentFileNotice | null) =>
      setNotices((current) =>
        current.flatMap((notice) =>
          notice.id !== id ? [notice] : next ? [next] : [],
        ),
      ),
    [],
  );
  const reportUnexpected = useCallback(
    (operation: string, error: unknown) =>
      errorReporter.report(
        normalizeUnknownError(error, {
          code: "app/operation-failed",
          fallbackMessage: "The file from your computer could not be opened.",
          context: [{ key: "operation", value: operation }],
        }),
        { source: "workbench.file.launch", visibility: "user" },
      ),
    [errorReporter],
  );

  useEffect(() => {
    const launchQueue = (window as { launchQueue?: LaunchQueue }).launchQueue;
    if (!launchQueue) return;
    launchQueue.setConsumer(({ files }) => {
      void (async () => {
        for (const handle of files) {
          if (handle.kind === "directory" || !authorizeOpen()) continue;
          try {
            const { linked, result } = await openLaunchedDocumentFileAsTab({
              repository,
              handle,
              createDocumentId,
              openTab,
            });
            const id = crypto.randomUUID();
            if (result.status === "unexpected-error") {
              reportUnexpected(result.source, result.error);
            } else if (result.status === "success" && !linked) {
              const { documentId } = result;
              setNotices((current) => [
                ...current,
                {
                  kind: "offer-saving",
                  id,
                  documentId,
                  handle,
                  allowing: false,
                },
              ]);
            } else if (result.status !== "cancelled") {
              setNotices((current) => [
                ...current,
                {
                  kind: "result",
                  id,
                  type: result.status === "success" ? "info" : "error",
                  fileName: handle.name,
                  message: result.message,
                },
              ]);
            }
          } catch (error: unknown) {
            reportUnexpected("launchQueue.open", error);
          }
        }
      })();
    });
  }, [authorizeOpen, createDocumentId, openTab, reportUnexpected, repository]);

  const allowSaving = useCallback(
    (notice: Extract<LaunchedDocumentFileNotice, { kind: "offer-saving" }>) => {
      if (!openDocumentIds.includes(notice.documentId)) return;
      replaceNotice(notice.id, { ...notice, allowing: true });
      allowSavingToLaunchedFile({
        handle: notice.handle,
        modelingService: getModelingService(notice.documentId),
      }).then(
        (outcome) => {
          switch (outcome.status) {
            case "linked":
              replaceNotice(notice.id, {
                kind: "result",
                id: notice.id,
                type: "info",
                fileName: notice.handle.name,
                message: outcome.message,
              });
              return;
            case "kept":
              replaceNotice(notice.id, {
                kind: "kept-in-browser",
                id: notice.id,
                fileName: notice.handle.name,
              });
              return;
            case "bind-failed":
              replaceNotice(notice.id, {
                kind: "result",
                id: notice.id,
                type: "error",
                fileName: notice.handle.name,
                message: outcome.message,
              });
              return;
            case "write-failed":
              replaceNotice(notice.id, null);
              reportUnexpected("launchQueue.allowSaving", outcome.error);
              return;
          }
        },
        (error: unknown) => {
          replaceNotice(notice.id, null);
          reportUnexpected("launchQueue.allowSaving", error);
        },
      );
    },
    [getModelingService, openDocumentIds, replaceNotice, reportUnexpected],
  );

  return useMemo(
    () =>
      notices
        .filter(
          (notice) =>
            notice.kind !== "offer-saving" ||
            openDocumentIds.includes(notice.documentId),
        )
        .map((notice) => ({
          id: notice.id,
          ...getLaunchedDocumentFileNotification(notice, {
            allowSaving: () => {
              if (notice.kind === "offer-saving") allowSaving(notice);
            },
            dismiss: () =>
              replaceNotice(
                notice.id,
                notice.kind === "offer-saving"
                  ? {
                      kind: "kept-in-browser",
                      id: notice.id,
                      fileName: notice.handle.name,
                    }
                  : null,
              ),
          }),
        })),
    [allowSaving, notices, openDocumentIds, replaceNotice],
  );
}
