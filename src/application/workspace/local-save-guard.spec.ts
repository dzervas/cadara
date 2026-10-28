// Logic lane (cadara-8p7o); seam: `LocalSaveGuard` over a fake status source,
// a fake page target and a recording error reporter. It owns the beforeunload
// registration, the notice after a blocked leave and the failure report.
import { expect, test } from "vitest";

import type { AppError, ErrorReportMetadata } from "@/contracts/errors";
import type {
  LocalSaveFailure,
  LocalSaveStatus,
} from "@/application/modeling/modeling-service";
import {
  LocalSaveGuard,
  type LeaveAttemptEvent,
} from "@/application/workspace/local-save-guard";

function createGuardFixture() {
  let status: LocalSaveStatus = { saving: false, failure: null };
  const statusListeners = new Set<() => void>();
  const leaveListeners = new Set<(event: LeaveAttemptEvent) => void>();
  const reports: Array<{ error: AppError; metadata: ErrorReportMetadata }> = [];
  const guard = new LocalSaveGuard({
    source: {
      getLocalSaveStatus: () => status,
      getLocalSaveFailures: () => (status.failure ? [status.failure] : []),
      subscribeToLocalSaveStatus(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    },
    reporter: {
      report(error, metadata) {
        reports.push({ error, metadata });
        return null;
      },
    },
    target: {
      addEventListener: (_type, listener) => leaveListeners.add(listener),
      removeEventListener: (_type, listener) => leaveListeners.delete(listener),
    },
  });
  return {
    guard,
    reports,
    leaveListeners,
    setStatus(next: LocalSaveStatus) {
      status = next;
      for (const listener of statusListeners) listener();
    },
    attemptLeave() {
      const event = {
        prevented: false,
        returnValue: undefined as unknown,
        preventDefault() {
          this.prevented = true;
        },
      };
      for (const listener of leaveListeners) listener(event);
      return event;
    },
  };
}

const repositoryFailure: LocalSaveFailure = {
  documentId: "doc_workspace",
  target: "repository",
  reasonCode: "repository-write-exception",
  message: "quota exceeded",
};

test("the leave guard is registered only while saving and asks before leaving", () => {
  const f = createGuardFixture();
  const stop = f.guard.start();
  expect(f.leaveListeners.size, "idle registers nothing (bfcache)").toBe(0);
  expect(f.attemptLeave().prevented).toBe(false);

  f.setStatus({ saving: true, failure: null });
  expect(f.leaveListeners.size).toBe(1);
  expect(f.guard.getNotice(), "no notice before a leave attempt").toEqual({ kind: "none" });
  const event = f.attemptLeave();
  expect(event.prevented, "the browser's leave dialog is requested").toBe(true);
  expect(event.returnValue, "older Chromium needs a returnValue").toBe(true);
  expect(f.guard.getNotice()).toEqual({ kind: "saving-after-leave-attempt" });

  f.setStatus({ saving: false, failure: null });
  expect(f.leaveListeners.size, "idle removes the guard").toBe(0);
  expect(f.guard.getNotice(), "the notice hides when the save finishes").toEqual({ kind: "none" });

  f.setStatus({ saving: true, failure: null });
  expect(f.guard.getNotice(), "a new save shows nothing until a new leave attempt").toEqual({
    kind: "none",
  });
  stop();
  expect(f.leaveListeners.size, "stop removes the guard").toBe(0);
  expect(f.reports).toEqual([]);
});

test("a repository failure keeps the guard, shows the unsaved notice and is reported once", () => {
  const f = createGuardFixture();
  f.guard.start();
  f.setStatus({ saving: true, failure: null });
  f.attemptLeave();
  f.setStatus({ saving: false, failure: repositoryFailure });
  f.setStatus({ saving: true, failure: repositoryFailure });
  f.setStatus({ saving: false, failure: repositoryFailure });

  expect(f.leaveListeners.size, "leaving would lose the change: still guarded").toBe(1);
  expect(f.guard.getNotice()).toEqual({
    kind: "unsaved",
    failure: repositoryFailure,
    leaveBlocked: true,
  });
  expect(f.reports, "one report per failure").toHaveLength(1);
  const [{ error, metadata }] = f.reports as [(typeof f.reports)[number]];
  expect(error.code).toBe("persistence/background-write-failed");
  expect(Object.fromEntries(error.context.map(({ key, value }) => [key, value]))).toEqual({
    documentId: "doc_workspace",
    target: "repository",
    reasonCode: "repository-write-exception",
    diagnosticMessage: "quota exceeded",
    leaveBlocked: true,
  });
  expect(metadata.source).toBe("document.persistence");
  expect(metadata.attachActiveDocumentPayload, "decision: no document content").toBe(false);

  f.guard.dismissUnsavedNotice();
  expect(f.guard.getNotice()).toEqual({ kind: "none" });
  f.attemptLeave();
  expect(f.guard.getNotice(), "a later leave attempt shows it again").toMatchObject({
    kind: "unsaved",
    leaveBlocked: true,
  });
});

test("a local file failure is reported but neither guards leaving nor shows a notice", () => {
  const f = createGuardFixture();
  f.guard.start();
  const failure: LocalSaveFailure = {
    ...repositoryFailure,
    target: "local-file",
    reasonCode: "local-file-failed",
    message: "disk full",
  };
  f.setStatus({ saving: false, failure });
  expect(f.leaveListeners.size, "browser storage holds the change").toBe(0);
  expect(f.guard.getNotice(), "the local file sync shows its own error").toEqual({ kind: "none" });
  expect(f.reports.map(({ error }) => error.context.find(({ key }) => key === "target")?.value)).toEqual([
    "local-file",
  ]);
  expect(f.reports[0]!.error.context.find(({ key }) => key === "leaveBlocked")?.value).toBe(false);
});

test("a repository failure without a leave attempt shows the error and reports leaveBlocked false", () => {
  const f = createGuardFixture();
  f.guard.start();
  f.setStatus({ saving: true, failure: null });
  f.setStatus({ saving: false, failure: repositoryFailure });
  expect(f.guard.getNotice()).toEqual({
    kind: "unsaved",
    failure: repositoryFailure,
    leaveBlocked: false,
  });
  expect(f.reports).toHaveLength(1);
  expect(f.reports[0]!.error.context.find(({ key }) => key === "leaveBlocked")?.value).toBe(false);
});
