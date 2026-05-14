import { beforeEach, vi, test, expect } from "vitest";

import { createTestErrorReporter } from "@/contracts/errors";

import {
  createHookTestHarness,
  flushMicrotasks,
} from "./workbench/controllers/controller-test-harness";

const hookHarness = createHookTestHarness();
vi.mock("react", () => hookHarness.reactModule);

const { useWorkbenchNotifications } =
  await import("./workbench/controllers/use-workbench-notifications");

beforeEach(() => {
  hookHarness.reset();
});

test("useWorkbenchNotifications maps info and error status messages to notification models", () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "document_notifications",
    async getHistoryRestoreState() {
      return { kind: "idle" as const };
    },
  };

  let controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  controller.showWorkbenchInfo("Imported bracket.step.");
  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  expect(
    controller.workbenchStatusNotification?.type,
    "Info notifications should use the info presentation.",
  ).toBe("info");
  expect(
    controller.workbenchStatusNotification?.title,
    "Info notifications should keep the shared workbench title",
  ).toBe("Workbench action");
  expect(
    controller.workbenchStatusNotification?.message,
    "Info notifications should keep the shared workbench supplied message.",
  ).toBe("Imported bracket.step.");

  controller.showWorkbenchError("Import failed.");
  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  expect(
    controller.workbenchStatusNotification?.type,
    "Error notifications should use the error presentation.",
  ).toBe("error");
  expect(
    controller.workbenchStatusNotification?.title,
    "Error notifications should keep the shared failure title.",
  ).toBe("Workbench action failed");
  expect(
    controller.workbenchStatusNotification?.message,
    "Error notifications should keep the shared failure message.",
  ).toBe("Import failed.");
  expect(
    reporter.reports.length,
    "Rendering an error notification should not imply telemetry reporting.",
  ).toBe(0);
});

test("useWorkbenchNotifications reports restore failures once and exposes restoreMessage", async () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "document_restore_failed",
    async getHistoryRestoreState() {
      return {
        diagnostics: [
          {
            entryIndex: 4,
            message: "History restore could not decode the saved timeline.",
            reasonCode: "restore-failed",
          },
        ],
        entriesReplayed: 3,
        kind: "failed" as const,
      };
    },
  };

  let controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  await hookHarness.flushEffects();
  await flushMicrotasks();

  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  expect(
    controller.restoreMessage,
    "Failed history restore state should surface the first diagnostic message through restoreMessage.",
  ).toBe("History restore could not decode the saved timeline.");
  expect(
    reporter.reports.length,
    "Failed history restore state should be reported once.",
  ).toBe(1);
  expect(
    reporter.reports[0]?.metadata.source,
    "History restore reporting should include source metadata.",
  ).toBe("workbench.history.restore");
  expect(
    reporter.reports[0]?.metadata.dedupeKey,
    "History restore reporting should include a stable document/diagnostic dedupe key.",
  ).toBe(
    "history-restore:document_restore_failed:3:restore-failed:4:History restore could not decode the saved timeline.",
  );
  expect(
    reporter.reports[0]?.error.context.some(
      (entry) =>
        entry.key === "documentId" && entry.value === "document_restore_failed",
    ),
    "History restore reports should carry document context.",
  ).toBe(true);
  expect(
    reporter.reports[0]?.error.context.some(
      (entry) => entry.key === "reasonCode" && entry.value === "restore-failed",
    ),
    "History restore reports should carry diagnostic context.",
  ).toBe(true);

  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  await hookHarness.flushEffects();
  await flushMicrotasks();

  expect(
    reporter.reports.length,
    "Repeated restore failure observation should be deduped for one app session.",
  ).toBe(1);
});

test("useWorkbenchNotifications reports document file action failures and mirrors the user-facing error", () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "document_file_failure",
    async getHistoryRestoreState() {
      return { kind: "idle" as const };
    },
  };
  const failure = new Error("IndexedDB quota exceeded.");

  let controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  controller.reportDocumentFileActionFailure(
    "workbench.file.restoreLocalBinding",
    "Local file sync restore failed.",
    failure,
  );

  controller = hookHarness.render(() =>
    useWorkbenchNotifications({
      errorReporter: reporter,
      modelingService,
    }),
  );

  expect(
    controller.workbenchStatusNotification?.type === "error" &&
      controller.workbenchStatusNotification.title ===
        "Workbench action failed" &&
      controller.workbenchStatusNotification.message ===
        "Local file sync restore failed.",
    "Document file action failures should surface the same visible error through the notification seam.",
  ).toBe(true);
  expect(
    reporter.reports.length,
    "Document file action failures should be forwarded to the error reporter once.",
  ).toBe(1);
  expect(
    reporter.reports[0]?.metadata.source ===
      "workbench.file.restoreLocalBinding" &&
      reporter.reports[0]?.metadata.visibility === "user",
    "Document file action failures should be reported with the original source and user visibility.",
  ).toBe(true);
  expect(
    reporter.reports[0]?.error.message === "Local file sync restore failed." &&
      reporter.reports[0]?.error.context[0]?.key === "reason" &&
      reporter.reports[0]?.error.context[0]?.value ===
        "IndexedDB quota exceeded.",
    "Document file action failures should preserve the user-visible message and the low-level reason context.",
  ).toBe(true);
});
