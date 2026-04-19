import { useState, useSyncExternalStore } from 'react'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
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
    <div
      role="alert"
      className="fixed left-1/2 top-3 z-50 flex w-[min(720px,calc(100vw-24px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-amber-400/60 bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
    >
      <div className="min-w-0 flex-1 leading-5">{sentryAdBlockMessage}</div>
      <button
        aria-label="Dismiss ad-block notification"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--cad-border-strong)] text-[var(--cad-muted-foreground)] hover:bg-[var(--cad-surface)] hover:text-[var(--cad-foreground)]"
        type="button"
        onClick={() => setIsDismissed(true)}
      >
        <WorkbenchIcon name="close" size={12} />
      </button>
    </div>
  )
}
