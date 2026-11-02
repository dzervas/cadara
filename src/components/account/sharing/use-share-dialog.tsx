import { useState } from "react";
import type { ProjectAccessPort } from "@/application/account/project-access-port";
import type { Account } from "@/contracts/account/account";
import { ShareDialog, type ShareDialogTarget } from "./share-dialog";

/**
 * Opens the Share dialog for an account project from anywhere a menu lives:
 * render `shareDialog` once and call `openShareDialog` with the project.
 */
export function useShareDialog({
  port,
  account,
  onLeft,
}: {
  port: ProjectAccessPort;
  account: Account | null;
  onLeft?: (target: ShareDialogTarget) => void;
}) {
  const [target, setTarget] = useState<ShareDialogTarget | null>(null);
  return {
    openShareDialog: setTarget,
    shareDialog: (
      <ShareDialog
        port={port}
        account={account}
        target={target}
        onClose={() => setTarget(null)}
        onLeft={onLeft}
      />
    ),
  };
}
