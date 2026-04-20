import { useState, useSyncExternalStore } from 'react'

import { WorkbenchNotification } from '@/components/layout/workbench-notification'
import {
  getSentryDsnBlockedSnapshot,
  subscribeToSentryDsnBlocked,
} from '@/contracts/errors/sentry-client'

const sentryAdBlockMessage =
  "Please disable the ad-block on this page, it's used to gather errors and crashes - there are absolutely 0 ads and no big-corp is gathering your precious data, I swear. Thank you - the dev"

export function SentryAdBlockNotification() {
  const isBlocked = useSyncExternalStore(
    subscribeToSentryDsnBlocked,
    getSentryDsnBlockedSnapshot,
    () => false,
  )
  const [isDismissed, setIsDismissed] = useState(false)

  if (!isBlocked || isDismissed) {
    return null
  }

  return (
    <SentryAdBlockNotificationView onDismiss={() => setIsDismissed(true)} />
  )
}

export function SentryAdBlockNotificationView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <WorkbenchNotification
      type="warning"
      title="Error reporting blocked"
      message={sentryAdBlockMessage}
      onDismiss={onDismiss}
      dismissLabel="Dismiss ad-block notification"
      placement={{ kind: 'app-top-center' }}
      className="z-50 max-w-none"
    />
  )
}
