import { test } from "bun:test";

import { createAppError, createTestErrorReporter } from "@/contracts/errors";
import { expectTrue } from "@/testing/expect.spec";

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

  expectTrue(
    notifications.join(",") === "Variable width references missing.",
    "Expected workbench failures should still notify through the UI seam.",
  );
  expectTrue(
    reporter.reports.length === 0,
    "Expected workbench failures should not be reported.",
  );
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

  expectTrue(
    notifications[0] === "Open linked document failed.",
    "Reportable failures may also show a user message.",
  );
  expectTrue(
    reporter.reports[0]?.error === error &&
      reporter.reports[0]?.metadata.source === "workbench.file.openLinked" &&
      reporter.reports[0]?.metadata.dedupeKey ===
        "workbench.file.openLinked:IndexedDB is unavailable.",
    "Reportable workbench failures should forward app errors and source metadata through the reporter.",
  );
});
