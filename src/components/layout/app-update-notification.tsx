import { DISCORD_URL } from "@/components/layout/community-links";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import { useAppUpdate, type AppUpdatePhase } from "@/hooks/use-app-update";

export const APP_UPDATE_NOTIFICATION_TITLE =
  "A new version of CADara is available";

// This tab's geometry engine version is no longer published (a deploy
// replaced it), so the tab cannot model until it reloads.
export const APP_UPDATED_NOTIFICATION_TITLE = "CADara was updated";

// The changelog is posted to Discord #announcements (changelog-post skill);
// the public invite is used because channel deep links only work for members.
export const APP_UPDATE_WHATS_NEW_LABEL =
  "What's new · #announcements on Discord";

const reloadLabels: Record<AppUpdatePhase, string> = {
  idle: "Reload",
  saving: "Saving…",
  reloading: "Reloading…",
};

export function AppUpdateNotification({
  waitForLocalChanges,
}: {
  waitForLocalChanges: () => Promise<void>;
}) {
  const update = useAppUpdate(waitForLocalChanges);
  if (!update.needRefresh && !update.kernelVersionRetired) return null;
  return (
    <AppUpdateNotificationView
      version={update.version}
      phase={update.phase}
      kernelVersionRetired={update.kernelVersionRetired}
      onReload={() => void update.reload()}
    />
  );
}

export function AppUpdateNotificationView({
  version,
  phase,
  kernelVersionRetired = false,
  onReload,
}: {
  version: string | null;
  phase: AppUpdatePhase;
  kernelVersionRetired?: boolean;
  onReload: () => void;
}) {
  return (
    <WorkbenchNotification
      type={kernelVersionRetired ? "warning" : "info"}
      title={
        kernelVersionRetired
          ? APP_UPDATED_NOTIFICATION_TITLE
          : APP_UPDATE_NOTIFICATION_TITLE
      }
      message={
        kernelVersionRetired
          ? "This tab runs a previous version whose geometry engine is no longer available. Reload to continue; your changes are saved first."
          : version
            ? `${version}. Reload to update; your changes are saved first.`
            : "Reload to update; your changes are saved first."
      }
      action={{
        label: reloadLabels[phase],
        disabled: phase !== "idle",
        onClick: onReload,
      }}
      link={{ label: APP_UPDATE_WHATS_NEW_LABEL, href: DISCORD_URL }}
      placement={{ kind: "app-top-center" }}
      // Above the workbench's failure alerts (z-index 200): when a deploy
      // retired this tab's kernel, those alerts appear too, and Reload is the
      // only recovery.
      className="z-[201]"
    />
  );
}
