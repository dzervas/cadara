import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { ErrorReporter } from "@/contracts/errors";
import {
  LocalSaveGuard,
  type LocalSaveGuardSource,
  type LocalSaveNotice,
  type PendingLocalWrites,
} from "@/application/workspace/local-save-guard";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";

export const LOCAL_SAVE_PENDING_MESSAGE =
  "Your latest change is still being saved. It's safe to leave once this message disappears.";

/** cadara-8p7o: the page-leave guard and its notification for every open tab. */
export function useWorkbenchLocalSaveGuard({
  source,
  errorReporter,
  pendingWrites,
}: {
  source: LocalSaveGuardSource;
  errorReporter: ErrorReporter;
  pendingWrites?: PendingLocalWrites;
}): WorkbenchNotificationModel | null {
  const guard = useMemo(
    () =>
      new LocalSaveGuard({
        source,
        pendingWrites,
        reporter: errorReporter,
        target: window,
      }),
    [errorReporter, source, pendingWrites],
  );
  useEffect(() => guard.start(), [guard]);
  const subscribe = useCallback(
    (listener: () => void) => guard.subscribeToNotice(listener),
    [guard],
  );
  const notice = useSyncExternalStore(subscribe, () => guard.getNotice());
  return getLocalSaveNotification(notice, () => guard.dismissUnsavedNotice());
}

function getLocalSaveNotification(
  notice: LocalSaveNotice,
  dismiss: () => void,
): WorkbenchNotificationModel | null {
  switch (notice.kind) {
    case "none":
      return null;
    case "saving-after-leave-attempt":
      // No dismiss: it disappears exactly when leaving becomes safe.
      return {
        type: "info",
        title: "Saving your latest change",
        message: LOCAL_SAVE_PENDING_MESSAGE,
      };
    case "unsaved":
      return {
        type: "error",
        title: "Your latest change could not be saved",
        message: `${notice.failure.message} ${
          notice.leaveBlocked
            ? "Leaving now will lose it."
            : "It exists in this tab only."
        } To keep it, use Save As > Download a copy in the file menu.`,
        onDismiss: dismiss,
      };
  }
}
