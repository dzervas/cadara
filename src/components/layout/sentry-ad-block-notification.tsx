import { useState, useSyncExternalStore } from "react";

import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import {
  getSentryDsnBlockedSnapshot,
  subscribeToSentryDsnBlocked,
} from "@/contracts/errors/sentry-client";

const sentryAdBlockMessage =
  "Error reporting is blocked by an ad blocker. CADara uses Sentry to surface crashes; no advertising or third-party tracking. Allow this domain in your blocker to enable reporting.";

export function SentryAdBlockNotification() {
  const isBlocked = useSyncExternalStore(
    subscribeToSentryDsnBlocked,
    getSentryDsnBlockedSnapshot,
    () => false,
  );
  const [isDismissed, setIsDismissed] = useState(false);

  if (!isBlocked || isDismissed) {
    return null;
  }

  return (
    <SentryAdBlockNotificationView onDismiss={() => setIsDismissed(true)} />
  );
}

export function SentryAdBlockNotificationView({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <WorkbenchNotification
      type="warning"
      title="Error reporting blocked"
      message={sentryAdBlockMessage}
      onDismiss={onDismiss}
      dismissLabel="Dismiss ad-block notification"
      placement={{ kind: "app-top-center" }}
      className="z-50 max-w-none"
    />
  );
}
