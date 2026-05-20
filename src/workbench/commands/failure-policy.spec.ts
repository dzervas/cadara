import { test, expect } from "vitest";

import { createAppError, createTestErrorReporter } from "@/contracts/errors";

import { handleWorkbenchFailure } from "./failure-policy";

test("handleWorkbenchFailure keeps expected user-visible failures out of telemetry", () => {
  const reporter = createTestErrorReporter();
  const notifications: string[] = [];

  const error = createAppError({
    code: "modeling/diagnostic",
    message: "Variable width references missing.",
  });

  handleWorkbenchFailure({
    appError: error,
    reporter,
    metadata: {
      source: "workbench.variable.update",
      visibility: "user",
    },
    reportability: "expected",
    userMessage: error.message,
    notify: (message) => notifications.push(message),
  });

  expect(
    notifications.join(","),
    "Expected workbench failures should still notify through the UI seam.",
  ).toBe("Variable width references missing.");
  expect(
    reporter.reports.length,
    "Expected workbench failures should not be reported.",
  ).toBe(0);
});

test("handleWorkbenchFailure reports classified defects separately from notification rendering", () => {
  const reporter = createTestErrorReporter();
  const notifications: string[] = [];
  const cause = new Error("IndexedDB is unavailable.");
  const error = createAppError({
    code: "workbench/action-failed",
    message: "Open linked document failed.",
    cause,
  });

  handleWorkbenchFailure({
    appError: error,
    reporter,
    metadata: {
      source: "workbench.file.openLinked",
      visibility: "user",
      dedupeKey: "workbench.file.openLinked:IndexedDB is unavailable.",
    },
    reportability: "reportable",
    userMessage: "Open linked document failed.",
    notify: (message) => notifications.push(message),
  });

  expect(
    notifications[0],
    "Reportable failures may also show a user message.",
  ).toBe("Open linked document failed.");
  expect(
    reporter.reports[0]?.error === error &&
      reporter.reports[0]?.metadata.source === "workbench.file.openLinked" &&
      reporter.reports[0]?.metadata.dedupeKey ===
        "workbench.file.openLinked:IndexedDB is unavailable.",
    "Reportable workbench failures should forward app errors and source metadata through the reporter.",
  ).toBeTruthy();
});
