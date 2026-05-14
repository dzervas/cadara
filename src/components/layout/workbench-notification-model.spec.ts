import { test, expect } from "vitest";

import {
  getWorkbenchNotificationAutoDismissMs,
  scheduleWorkbenchNotificationAutoDismiss,
  type WorkbenchNotificationType,
} from "@/components/layout/workbench-notification-model";

test("src/components/layout/workbench-notification-model.spec.ts", () => {
  expect(
    getWorkbenchNotificationAutoDismissMs("info"),
    "Info notifications should dismiss after 5 seconds.",
  ).toBe(5_000);
  expect(
    getWorkbenchNotificationAutoDismissMs("warning"),
    "Warning notifications should dismiss after 15 seconds.",
  ).toBe(15_000);
  expect(
    getWorkbenchNotificationAutoDismissMs("error"),
    "Error notifications should not auto-dismiss.",
  ).toBe(null);

  const scheduled: Array<{
    callback: () => void;
    delay: number;
    handle: string;
  }> = [];
  const cleared: unknown[] = [];
  const timerHost = {
    setTimeout(callback: () => void, delay: number) {
      const handle = `timer-${scheduled.length}`;
      scheduled.push({ callback, delay, handle });
      return handle;
    },
    clearTimeout(handle: unknown) {
      cleared.push(handle);
    },
  };
  let dismissCount = 0;

  const cleanupInfo = scheduleWorkbenchNotificationAutoDismiss(
    "info",
    () => {
      dismissCount += 1;
    },
    timerHost,
  );
  expect(cleanupInfo, "Info notifications should schedule a timer.").toBeTruthy();
  expect(scheduled[0]?.delay, "Info timer should use the 5 second delay.").toBe(5_000);
  scheduled[0]?.callback();
  expect(dismissCount, "Info timer callback should dismiss the notification.").toBe(1);
  cleanupInfo();
  expect(cleared[0], "Manual cleanup should clear the pending info timer.").toBe("timer-0");

  const cleanupWarning = scheduleWorkbenchNotificationAutoDismiss(
    "warning",
    () => {
      dismissCount += 1;
    },
    timerHost,
  );
  expect(cleanupWarning, "Warning notifications should schedule a timer.").toBeTruthy();
  expect(scheduled[1]?.delay, "Warning timer should use the 15 second delay.").toBe(15_000);

  const cleanupError = scheduleWorkbenchNotificationAutoDismiss(
    "error",
    () => {
      dismissCount += 1;
    },
    timerHost,
  );
  expect(cleanupError, "Error notifications should not schedule an auto-dismiss timer.").toBe(null);
  expect(scheduled.length, "Error notifications should leave timer state unchanged.").toBe(2);
});

test("workbench notification auto-dismiss model accepts only supported types", () => {
  function assertDelay(
    type: WorkbenchNotificationType,
    expected: number | null,
  ) {
    if (getWorkbenchNotificationAutoDismissMs(type) !== expected) {
      throw new Error(`${type} notification delay changed unexpectedly.`);
    }
  }

  assertDelay("info", 5_000);
  assertDelay("warning", 15_000);
  assertDelay("error", null);
});
