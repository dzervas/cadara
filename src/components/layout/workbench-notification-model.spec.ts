import { test } from 'bun:test'

import {
  getWorkbenchNotificationAutoDismissMs,
  scheduleWorkbenchNotificationAutoDismiss,
  type WorkbenchNotificationType,
} from '@/components/layout/workbench-notification-model'

test('src/components/layout/workbench-notification-model.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(getWorkbenchNotificationAutoDismissMs('info') === 5_000, 'Info notifications should dismiss after 5 seconds.')
  assert(
    getWorkbenchNotificationAutoDismissMs('warning') === 15_000,
    'Warning notifications should dismiss after 15 seconds.',
  )
  assert(getWorkbenchNotificationAutoDismissMs('error') === null, 'Error notifications should not auto-dismiss.')

  const scheduled: Array<{ callback: () => void; delay: number; handle: string }> = []
  const cleared: unknown[] = []
  const timerHost = {
    setTimeout(callback: () => void, delay: number) {
      const handle = `timer-${scheduled.length}`
      scheduled.push({ callback, delay, handle })
      return handle
    },
    clearTimeout(handle: unknown) {
      cleared.push(handle)
    },
  }
  let dismissCount = 0

  const cleanupInfo = scheduleWorkbenchNotificationAutoDismiss('info', () => {
    dismissCount += 1
  }, timerHost)
  assert(cleanupInfo, 'Info notifications should schedule a timer.')
  assert(scheduled[0]?.delay === 5_000, 'Info timer should use the 5 second delay.')
  scheduled[0]?.callback()
  assert(dismissCount === 1, 'Info timer callback should dismiss the notification.')
  cleanupInfo()
  assert(cleared[0] === 'timer-0', 'Manual cleanup should clear the pending info timer.')

  const cleanupWarning = scheduleWorkbenchNotificationAutoDismiss('warning', () => {
    dismissCount += 1
  }, timerHost)
  assert(cleanupWarning, 'Warning notifications should schedule a timer.')
  assert(scheduled[1]?.delay === 15_000, 'Warning timer should use the 15 second delay.')

  const cleanupError = scheduleWorkbenchNotificationAutoDismiss('error', () => {
    dismissCount += 1
  }, timerHost)
  assert(cleanupError === null, 'Error notifications should not schedule an auto-dismiss timer.')
  assert(scheduled.length === 2, 'Error notifications should leave timer state unchanged.')
})

test('workbench notification auto-dismiss model accepts only supported types', () => {
  function assertDelay(type: WorkbenchNotificationType, expected: number | null) {
    if (getWorkbenchNotificationAutoDismissMs(type) !== expected) {
      throw new Error(`${type} notification delay changed unexpectedly.`)
    }
  }

  assertDelay('info', 5_000)
  assertDelay('warning', 15_000)
  assertDelay('error', null)
})
