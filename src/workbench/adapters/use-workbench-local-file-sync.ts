import { useEffect, useRef, useState } from "react";

import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { LocalFileBindingMetadata } from "@/domain/modeling/local-file-binding-store";
import type { DocumentSyncWriteStatus } from "@/domain/modeling/document-sync-worker-protocol";

function isLocalFileSyncEnabledStatus(status: DocumentSyncWriteStatus) {
  return (
    status.kind === "binding-restored" ||
    status.kind === "syncing" ||
    status.kind === "synced" ||
    status.kind === "persistent-binding-unavailable"
  );
}

interface WorkbenchLocalFileSyncInput {
  modelingService: Pick<
    ModelingService,
    | "currentDocumentId"
    | "restoreLocalFileBinding"
    | "subscribeToLocalFileSyncStatus"
  >;
  reportDocumentFileActionFailure: (
    source: string,
    message: string,
    error: unknown,
  ) => void;
  showWorkbenchError: (message: string) => void;
  showWorkbenchInfo: (message: string) => void;
}

export function useWorkbenchLocalFileSync({
  modelingService,
  reportDocumentFileActionFailure,
  showWorkbenchError,
  showWorkbenchInfo,
}: WorkbenchLocalFileSyncInput) {
  const [localFileSyncEnabled, setLocalFileSyncEnabled] = useState(false);
  const [localFileBindingMetadata, setLocalFileBindingMetadata] =
    useState<LocalFileBindingMetadata | null>(null);
  const bindingRestoreAnnouncedRef = useRef(false);
  const activeDocumentId = modelingService.currentDocumentId;
  const activeLocalFileBindingMetadata =
    localFileBindingMetadata?.documentId === activeDocumentId
      ? localFileBindingMetadata
      : null;

  useEffect(() => {
    return modelingService.subscribeToLocalFileSyncStatus((status) => {
      if (status.documentId !== activeDocumentId) {
        return;
      }

      setLocalFileSyncEnabled(isLocalFileSyncEnabledStatus(status));

      switch (status.kind) {
        case "binding-restored":
          bindingRestoreAnnouncedRef.current = true;
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchInfo(
            `Restored local file sync for ${status.metadata.fileName}.`,
          );
          return;
        case "syncing":
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchInfo(`Syncing ${status.metadata.fileName}.`);
          return;
        case "synced":
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchInfo(`Synced ${status.metadata.fileName}.`);
          return;
        case "persistent-binding-unavailable":
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchInfo(status.message);
          return;
        case "permission-required":
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchError(
            `Local file sync needs write permission for ${status.metadata.fileName}.`,
          );
          return;
        case "permission-denied":
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchError(status.message);
          return;
        case "failed":
          setLocalFileBindingMetadata(status.metadata);
          showWorkbenchError(status.message);
          return;
        case "idle":
          setLocalFileBindingMetadata(null);
          return;
      }
    });
  }, [
    activeDocumentId,
    modelingService,
    showWorkbenchError,
    showWorkbenchInfo,
  ]);

  useEffect(() => {
    let disposed = false;

    void modelingService
      .restoreLocalFileBinding()
      .then((metadata) => {
        if (!disposed && !metadata) {
          setLocalFileBindingMetadata(null);
          setLocalFileSyncEnabled(false);
        }
        if (!disposed && metadata) {
          setLocalFileBindingMetadata(metadata);
        }
        if (!disposed && metadata && !bindingRestoreAnnouncedRef.current) {
          showWorkbenchInfo(
            `Restored local file sync for ${metadata.fileName}.`,
          );
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          reportDocumentFileActionFailure(
            "workbench.file.restoreLocalBinding",
            "Local file sync restore failed.",
            error,
          );
        }
      });

    return () => {
      disposed = true;
      bindingRestoreAnnouncedRef.current = false;
    };
  }, [modelingService, reportDocumentFileActionFailure, showWorkbenchInfo]);

  return {
    localFileSyncEnabled:
      localFileSyncEnabled && activeLocalFileBindingMetadata !== null,
    localFileBindingMetadata: activeLocalFileBindingMetadata,
  };
}
