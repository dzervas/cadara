import { useEffect, useRef, useState } from "react";

import { normalizeUnknownError, type ErrorReporter } from "@/contracts/errors";
import type { LocalSaveStatusSource } from "@/application/workspace/local-save-guard";
import {
  checkStorageDurability,
  watchFirstSuccessfulLocalSave,
  type StorageDurabilityWarning,
} from "@/application/workspace/storage-durability";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";

const EXPORT_ADVICE =
  "Keep copies of important documents: use Save As > Download a copy in the file menu.";

/**
 * Requests persistent browser storage once per session, when
 * the app runs as an installed app (display-mode standalone) or else after
 * the first successful local save, and returns the warning to show when the
 * browser declines or space is low. Production builds only: the dev server
 * (and its E2E lane, where Chromium always declines) never asks.
 */
export function useStorageDurabilityWarning({
  source,
  errorReporter,
}: {
  source: LocalSaveStatusSource;
  errorReporter: ErrorReporter;
}): WorkbenchNotificationModel | null {
  const [warning, setWarning] = useState<StorageDurabilityWarning | null>(null);
  const checkedRef = useRef(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !navigator.storage?.persist) return;
    const check = () => {
      if (checkedRef.current) return;
      checkedRef.current = true;
      checkStorageDurability(navigator.storage, window.localStorage).then(
        (result) => {
          if (result) setWarning(result);
        },
        (error: unknown) =>
          errorReporter.report(
            normalizeUnknownError(error, {
              code: "app/operation-failed",
              fallbackMessage: "Persistent browser storage check failed.",
            }),
            { source: "storage-durability", visibility: "developer" },
          ),
      );
    };
    if (window.matchMedia("(display-mode: standalone)").matches) {
      check();
      return;
    }
    return watchFirstSuccessfulLocalSave(source, check);
  }, [errorReporter, source]);

  return warning
    ? getStorageDurabilityNotification(warning, () => setWarning(null))
    : null;
}

export function getStorageDurabilityNotification(
  warning: StorageDurabilityWarning,
  dismiss: () => void,
): WorkbenchNotificationModel {
  return {
    type: "warning",
    title:
      warning === "not-persisted"
        ? "Browser storage is not guaranteed"
        : "Browser storage is almost full",
    message:
      warning === "not-persisted"
        ? `The browser may delete CADara's documents when the disk runs low on space. ${EXPORT_ADVICE}`
        : `Little browser storage is left, so new changes may fail to save. ${EXPORT_ADVICE}`,
    persistent: true,
    onDismiss: dismiss,
  };
}
