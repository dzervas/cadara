import type { ReactNode } from 'react'

export type WorkbenchNotificationType = 'info' | 'warning' | 'error'

export interface WorkbenchNotificationAction {
  label: string
  onClick: () => void
}

export type WorkbenchNotificationPlacement =
  | { kind: 'viewport'; top: number | string; right: number | string }
  | { kind: 'app-top-center' }

export interface WorkbenchNotificationModel {
  type: WorkbenchNotificationType
  title: string
  message: ReactNode
  action?: WorkbenchNotificationAction
  onDismiss?: () => void
  placement?: WorkbenchNotificationPlacement
}

export interface WorkbenchNotificationTimerHost {
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultTimerHost: WorkbenchNotificationTimerHost = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export function getWorkbenchNotificationAutoDismissMs(type: WorkbenchNotificationType) {
  if (type === 'info') {
    return 5_000
  }

  if (type === 'warning') {
    return 15_000
  }

  return null
}

export function scheduleWorkbenchNotificationAutoDismiss(
  type: WorkbenchNotificationType,
  onDismiss: () => void,
  timerHost: WorkbenchNotificationTimerHost = defaultTimerHost,
) {
  const delay = getWorkbenchNotificationAutoDismissMs(type)

  if (delay === null) {
    return null
  }

  const timeout = timerHost.setTimeout(onDismiss, delay)
  return () => timerHost.clearTimeout(timeout)
}
