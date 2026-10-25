import { DISCORD_URL } from "@/components/layout/community-links";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import { useAppUpdate, type AppUpdatePhase } from "@/hooks/use-app-update";

export const APP_UPDATE_NOTIFICATION_TITLE =
  "A new version of CADara is available";

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
  if (!update.needRefresh) return null;
  return (
    <AppUpdateNotificationView
      version={update.version}
      phase={update.phase}
      onReload={() => void update.reload()}
    />
  );
}

export function AppUpdateNotificationView({
  version,
  phase,
  onReload,
}: {
  version: string | null;
  phase: AppUpdatePhase;
  onReload: () => void;
}) {
  return (
    <WorkbenchNotification
      type="info"
      title={APP_UPDATE_NOTIFICATION_TITLE}
      message={
        version
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
      className="z-50"
    />
  );
}
