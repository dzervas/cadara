import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  getWorkbenchNotificationAutoDismissMs,
  scheduleWorkbenchNotificationAutoDismiss,
  type WorkbenchNotificationType,
} from '@/components/layout/workbench-notification-model'

test('src/components/layout/workbench-notification-model.spec.ts', () => {  expectTrue(getWorkbenchNotificationAutoDismissMs('info') === 5_000, 'Info notifications should dismiss after 5 seconds.')
  expectTrue(
    getWorkbenchNotificationAutoDismissMs('warning') === 15_000,
    'Warning notifications should dismiss after 15 seconds.',
  )
  expectTrue(getWorkbenchNotificationAutoDismissMs('error') === null, 'Error notifications should not auto-dismiss.')

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
  expectTrue(cleanupInfo, 'Info notifications should schedule a timer.')
  expectTrue(scheduled[0]?.delay === 5_000, 'Info timer should use the 5 second delay.')
  scheduled[0]?.callback()
  expectTrue(dismissCount === 1, 'Info timer callback should dismiss the notification.')
  cleanupInfo()
  expectTrue(cleared[0] === 'timer-0', 'Manual cleanup should clear the pending info timer.')

  const cleanupWarning = scheduleWorkbenchNotificationAutoDismiss('warning', () => {
    dismissCount += 1
  }, timerHost)
  expectTrue(cleanupWarning, 'Warning notifications should schedule a timer.')
  expectTrue(scheduled[1]?.delay === 15_000, 'Warning timer should use the 15 second delay.')

  const cleanupError = scheduleWorkbenchNotificationAutoDismiss('error', () => {
    dismissCount += 1
  }, timerHost)
  expectTrue(cleanupError === null, 'Error notifications should not schedule an auto-dismiss timer.')
  expectTrue(scheduled.length === 2, 'Error notifications should leave timer state unchanged.')
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
