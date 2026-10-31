import { useEffect, useRef, useState } from "react";
import { restoreTabFileAccess } from "@/application/workspace/restore-tab-file-access";
import type { DocumentId } from "@/contracts/shared/ids";
import type { DocumentSyncWriteStatus } from "@/contracts/modeling/document-sync-write-status";
import type { DocumentRepository } from "@/contracts/modeling/document-repository";
import { isLocalFileSyncDocumentRepository } from "@/core/modeling/document-repository";
import {
  fileTabStorageStatus,
  projectTabStorageStatus,
  tabFileFix,
  tabStorageBadge,
  type TabFileFix,
} from "@/core/workspace/workbench-tab-storage-status";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";
import type { WorkbenchTabsState } from "@/core/workspace/workbench-tabs";
import type { WorkbenchModelingServices } from "@/application/workspace/workbench-modeling-services";
import type { LocalFileBindingRecord } from "@/infrastructure/persistence/local-file-binding-store";
import type { DocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-client";
import { saveWorkbenchLocalFile } from "@/workbench/document/document-file-actions";
import { showSaveLocalDocumentPicker } from "@/lib/local-file-system-access";
import type { DocumentTabStorageFeedback } from "@/components/layout/document-tabs-bar";
import type { ProjectSync } from "./use-project-sync";

const TAB_FILE_FIX_LABELS: Record<TabFileFix["action"], string> = {
  loading: "Loading file access…",
  "retry-write": "Retry file sync",
  "restore-access": "Restore access",
  relink: "Re-link file…",
};

/** Ephemeral storage feedback is never persisted with tab identity/order. */
export function useTabStorageStatus({
  repository,
  client,
  services,
  tabs,
  sync,
  report,
}: {
  repository: DocumentRepository | null;
  client: DocumentSyncWorkerClient | null;
  services: WorkbenchModelingServices;
  tabs: WorkbenchTabsState;
  sync: ProjectSync;
  report: (error: unknown) => void;
}) {
  const latestFileStatuses = useRef(
    new Map<DocumentId, DocumentSyncWriteStatus>(),
  );
  const [fileStates, setFileStates] = useState<
    ReadonlyMap<DocumentId, DocumentSyncWriteStatus>
  >(new Map());
  const [records, setRecords] = useState<
    ReadonlyMap<DocumentId, LocalFileBindingRecord | null>
  >(new Map());
  const [deniedDocuments, setDeniedDocuments] = useState<
    ReadonlySet<DocumentId>
  >(new Set());
  useEffect(() => {
    if (!isLocalFileSyncDocumentRepository(repository)) return;
    let live = true;
    const unsubscribe = repository.subscribeToLocalFileSyncStatus((status) => {
      latestFileStatuses.current.set(status.documentId, status);
      setFileStates((previous) => {
        const previousStatus = previous.get(status.documentId);
        // Restoring a tab is not itself a fix; keep its recovery popover mounted
        // until permission is checked or a real write succeeds.
        if (
          status.kind === "binding-restored" &&
          previousStatus &&
          fileTabStorageStatus(previousStatus)?.kind === "error"
        )
          return previous;
        return new Map(previous).set(status.documentId, status);
      });
      if (
        status.kind === "idle" ||
        status.kind === "synced" ||
        status.kind === "syncing" ||
        status.kind === "persistent-binding-unavailable"
      )
        return;
      if (!client) return;
      void client
        .restoreBinding({ documentId: status.documentId, announce: false })
        .then(async (record) => {
          if (!live) return;
          setRecords((previous) =>
            new Map(previous).set(status.documentId, record),
          );
          if (
            status.kind === "binding-restored" &&
            record?.handle.queryPermission
          ) {
            const permission = await record.handle.queryPermission({
              mode: "readwrite",
            });
            if (
              live &&
              latestFileStatuses.current.get(status.documentId) === status
            )
              setFileStates((previous) => {
                if (previous.get(status.documentId)?.kind === "failed")
                  return previous;
                return new Map(previous).set(
                  status.documentId,
                  permission === "granted"
                    ? status
                    : {
                        ...status,
                        kind: "permission-required",
                      },
                );
              });
          }
        })
        .catch((error: unknown) => {
          if (live)
            setRecords((previous) =>
              new Map(previous).set(status.documentId, null),
            );
          report(error);
        });
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [repository, report, client]);

  const projectStatus = projectTabStorageStatus(
    sync.linked,
    sync.accountChecked ? sync.account !== null : null,
    sync.status,
    sync.uploadState,
  );
  const feedback: Partial<Record<DocumentId, DocumentTabStorageFeedback>> = {};
  for (const tab of tabs.tabs) {
    const fileState = fileStates.get(tab.documentId);
    const badge = tabStorageBadge(
      projectStatus,
      fileState ? fileTabStorageStatus(fileState) : null,
    );
    if (!badge) continue;
    const { fixes, ...status } = badge;
    if (fixes === "project") {
      feedback[tab.documentId] = {
        ...status,
        actionLabel: sync.linked ? "Retry sync" : "Retry upload",
        onFix: () => {
          void sync.retry().catch(report);
        },
        secondaryAction:
          !sync.linked && status.kind === "error"
            ? { label: "Keep local", onClick: sync.dismissUploadError }
            : undefined,
      };
      continue;
    }
    if (status.kind !== "error") {
      feedback[tab.documentId] = { ...status };
      continue;
    }
    const record = records.get(tab.documentId);
    const relink = () => {
      void saveWorkbenchLocalFile({
        modelingService: services.get(tab.documentId),
        io: {
          showSaveLocalDocumentPicker: () =>
            showSaveLocalDocumentPicker(globalThis, record?.handle),
        },
        showWorkbenchError: (message) => report(new Error(message)),
        showWorkbenchInfo: () => undefined,
        reportDocumentFileActionFailure: (_source, _message, error) =>
          report(error),
      });
    };
    const fix = tabFileFix(
      fileState?.kind,
      !records.has(tab.documentId)
        ? "loading"
        : !record
          ? "gone"
          : record.handle.requestPermission
            ? "restorable"
            : "held",
      deniedDocuments.has(tab.documentId),
    );
    const retryWrite = async () => {
      if (!client) throw new Error("File sync is unavailable.");
      await client.retryFileWrite({ documentId: tab.documentId });
    };
    const restoreAccess = (handle: LocalFileSystemFileHandle) => {
      // Call before awaiting anything: permission prompts require this click's user gesture.
      void restoreTabFileAccess(handle, retryWrite)
        .then((permission) => {
          if (permission !== "granted") {
            setDeniedDocuments((previous) =>
              new Set(previous).add(tab.documentId),
            );
            throw new Error(
              "Write access was denied; re-link the file to choose another target.",
            );
          }
        })
        .catch(report);
    };
    feedback[tab.documentId] = {
      ...status,
      actionLabel: TAB_FILE_FIX_LABELS[fix.action],
      onFix:
        fix.action === "loading"
          ? undefined
          : fix.action === "retry-write"
            ? () => void retryWrite().catch(report)
            : fix.action === "restore-access" && record
              ? () => restoreAccess(record.handle)
              : relink,
      secondaryAction: fix.secondary
        ? { label: TAB_FILE_FIX_LABELS.relink, onClick: relink }
        : undefined,
    };
  }
  return feedback;
}
