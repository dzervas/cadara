import { beforeEach, vi, test, expect } from "vitest";

import { createTestErrorReporter } from "@/contracts/errors";
import type { ModelingService } from "@/application/modeling/modeling-service";

import {
  createHookTestHarness,
  flushMicrotasks,
} from "./controller-test-harness";

const workerFailures = vi.hoisted(() => ({ listener: null as ((error: Error) => void) | null }));
vi.mock("@/infrastructure/occ/browser-kernel-runtime", () => ({
  subscribeBrowserOccWorkerFailure: (listener: (error: Error) => void) => {
    workerFailures.listener = listener;
    return () => { workerFailures.listener = null; };
  },
}));

const hookHarness = createHookTestHarness();
vi.mock("react", () => hookHarness.reactModule);

const { useWorkbenchNotifications } =
  await import("./use-workbench-notifications");

beforeEach(() => {
  hookHarness.reset();
});

type RestoreState = Awaited<ReturnType<ModelingService["getHistoryRestoreState"]>>;
type DocumentChangeListener = Parameters<ModelingService["subscribeToDocumentChanges"]>[0];
const restored: RestoreState = { kind: "restored", entriesReplayed: 0, diagnostics: [] };
const failedRestore = (message: string): RestoreState => ({
  kind: "failed",
  entriesReplayed: 0,
  diagnostics: [{ entryIndex: null, reasonCode: "automerge-document-missing", message }],
});

function restoreStateSource(read: () => Promise<RestoreState>) {
  const listeners = new Set<DocumentChangeListener>();
  const service = {
    currentDocumentId: "doc_restore_notification" as const,
    getHistoryRestoreState: read,
    subscribeToDocumentChanges(listener: DocumentChangeListener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    service,
    listeners,
    changed() {
      for (const listener of listeners) listener({
        documentId: service.currentDocumentId,
        metadata: { documentId: service.currentDocumentId, actorId: "peer", heads: [], source: "peer" },
      });
    },
  };
}

test("useWorkbenchNotifications maps info and error status messages to notification models", () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "document_notifications",
    subscribeToDocumentChanges() { return () => undefined; },
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

test("useWorkbenchNotifications reports restore failures once and exposes the history restore failure", async () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "document_restore_failed",
    subscribeToDocumentChanges() { return () => undefined; },
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
    controller.restoreFailure,
    "Failed history restore state should surface the first diagnostic message as a history failure.",
  ).toEqual({
    kind: "history",
    message: "History restore could not decode the saved timeline.",
  });
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
  ).toBeTruthy();
  expect(
    reporter.reports[0]?.error.context.some(
      (entry) => entry.key === "reasonCode" && entry.value === "restore-failed",
    ),
    "History restore reports should carry diagnostic context.",
  ).toBeTruthy();

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
    subscribeToDocumentChanges() { return () => undefined; },
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
  ).toBeTruthy();
  expect(
    reporter.reports.length,
    "Document file action failures should be forwarded to the error reporter once.",
  ).toBe(1);
  expect(
    reporter.reports[0]?.metadata.source ===
      "workbench.file.restoreLocalBinding" &&
      reporter.reports[0]?.metadata.visibility === "user",
    "Document file action failures should be reported with the original source and user visibility.",
  ).toBeTruthy();
  expect(
    reporter.reports[0]?.error.message === "Local file sync restore failed." &&
      reporter.reports[0]?.error.context[0]?.key === "reason" &&
      reporter.reports[0]?.error.context[0]?.value ===
        "IndexedDB quota exceeded.",
    "Document file action failures should preserve the user-visible message and the low-level reason context.",
  ).toBeTruthy();
});


test("OCC abort is immediately reported and presented through the workbench error notification", async () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "doc_occ_abort" as const,
    subscribeToDocumentChanges() { return () => undefined; },
    async getHistoryRestoreState() { return { kind: "empty" as const, entriesReplayed: 0 as const, diagnostics: [] as [] }; },
  };
  const useNotifications = () => useWorkbenchNotifications({ errorReporter: reporter, modelingService });
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  const error = new Error("OpenCascade stopped: OOM. Reopen the document to continue.");
  workerFailures.listener!(error);
  const controller = hookHarness.render(useNotifications);
  expect(controller.workbenchStatusNotification).toEqual({
    type: "error",
    title: "Workbench action failed",
    message: error.message,
  });
  expect(reporter.reports).toHaveLength(1);
  expect(reporter.reports[0]?.error.cause).toBe(error);
  expect(reporter.reports[0]?.metadata.source).toBe("workbench.occ.worker");
});

test("successful document recovery clears only the obsolete restore notice", async () => {
  const reporter = createTestErrorReporter();
  let state = failedRestore("The stored copy is unavailable.");
  const source = restoreStateSource(async () => state);
  const useNotifications = () => useWorkbenchNotifications({ errorReporter: reporter, modelingService: source.service });
  let controller = hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  controller = hookHarness.render(useNotifications);
  expect(controller.restoreFailure?.message).toBe("The stored copy is unavailable.");
  controller.showWorkbenchError("An unrelated export failed.");
  source.changed();
  await flushMicrotasks();
  expect(reporter.reports).toHaveLength(1);
  expect(hookHarness.render(useNotifications).restoreFailure?.message).toBe("The stored copy is unavailable.");

  state = restored;
  source.changed();
  await flushMicrotasks();
  controller = hookHarness.render(useNotifications);
  expect(controller.restoreFailure).toBeNull();
  expect(controller.workbenchStatusNotification?.message).toBe("An unrelated export failed.");
  expect(reporter.reports).toHaveLength(1);
  hookHarness.cleanup();
  expect(source.listeners.size).toBe(0);
});

test("an older restore-state read cannot resurrect a recovered notice", async () => {
  const reporter = createTestErrorReporter();
  let completeOlderRead!: (state: RestoreState) => void;
  const olderRead = new Promise<RestoreState>((resolve) => { completeOlderRead = resolve; });
  let nextRead = Promise.resolve(failedRestore("Initial failure."));
  const source = restoreStateSource(() => nextRead);
  const useNotifications = () => useWorkbenchNotifications({ errorReporter: reporter, modelingService: source.service });
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  expect(hookHarness.render(useNotifications).restoreFailure?.message).toBe("Initial failure.");

  nextRead = olderRead;
  source.changed();
  nextRead = Promise.resolve(restored);
  source.changed();
  await flushMicrotasks();
  expect(hookHarness.render(useNotifications).restoreFailure).toBeNull();
  completeOlderRead(failedRestore("An obsolete failure."));
  await flushMicrotasks();
  expect(hookHarness.render(useNotifications).restoreFailure).toBeNull();
  expect(reporter.reports).toHaveLength(1);
});

test("switching document services clears the old notice and unsubscribes", async () => {
  const reporter = createTestErrorReporter();
  const first = restoreStateSource(async () => failedRestore("Old document failure."));
  let completeNewRead!: (state: RestoreState) => void;
  const newRead = new Promise<RestoreState>((resolve) => { completeNewRead = resolve; });
  const second = restoreStateSource(() => newRead);
  let current = first.service;
  const useNotifications = () => useWorkbenchNotifications({ errorReporter: reporter, modelingService: current });
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  expect(hookHarness.render(useNotifications).restoreFailure?.message).toBe("Old document failure.");

  current = second.service;
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  expect(hookHarness.render(useNotifications).restoreFailure).toBeNull();
  expect(first.listeners.size).toBe(0);
  expect(second.listeners.size).toBe(1);
  completeNewRead(restored);
  await flushMicrotasks();
  hookHarness.cleanup();
  expect(second.listeners.size).toBe(0);
});

test("a dismissed unchanged restore failure stays dismissed until its condition changes", async () => {
  const reporter = createTestErrorReporter();
  const failure = failedRestore("A known failure.");
  let state = failure;
  const source = restoreStateSource(async () => state);
  const useNotifications = () => useWorkbenchNotifications({ errorReporter: reporter, modelingService: source.service });
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  hookHarness.render(useNotifications).setRestoreFailure(null);
  source.changed();
  await flushMicrotasks();
  expect(hookHarness.render(useNotifications).restoreFailure).toBeNull();
  state = restored;
  source.changed();
  await flushMicrotasks();
  state = failure;
  source.changed();
  await flushMicrotasks();
  expect(hookHarness.render(useNotifications).restoreFailure?.message).toBe("A known failure.");
  expect(reporter.reports).toHaveLength(1);
});

test("a prior service result arriving before effect cleanup cannot label the new document", async () => {
  const reporter = createTestErrorReporter();
  let completeOldRead!: (state: RestoreState) => void;
  const oldRead = new Promise<RestoreState>((resolve) => { completeOldRead = resolve; });
  let nextRead = Promise.resolve(failedRestore("First document failure."));
  const first = restoreStateSource(() => nextRead);
  const second = restoreStateSource(async () => restored);
  let current = first.service;
  const useNotifications = () => useWorkbenchNotifications({ errorReporter: reporter, modelingService: current });
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  nextRead = oldRead;
  first.changed();
  current = second.service;
  hookHarness.render(useNotifications);
  completeOldRead(failedRestore("An old service result."));
  await flushMicrotasks();
  expect(hookHarness.render(useNotifications).restoreFailure).toBeNull();
  await hookHarness.flushEffects();
  expect(first.listeners.size).toBe(0);
  expect(second.listeners.size).toBe(1);
});

test("a feature's status error clears once the document stops reporting it; an untied error stays", () => {
  const reporter = createTestErrorReporter();
  const documentId = "doc_feature_errors" as const;
  const modelingService = {
    currentDocumentId: documentId,
    subscribeToDocumentChanges() { return () => undefined; },
    async getHistoryRestoreState() { return restored; },
  };
  const filletError = {
    code: "feature-reference-missing",
    severity: "error" as const,
    message: "Fillet 1 edge selection is incorrect.",
    featureId: "feature_fillet-1" as const,
    target: null,
    detail: null,
  };
  let diagnostics: (typeof filletError)[] = [];
  const useNotifications = () =>
    useWorkbenchNotifications({
      currentDocument: { documentId, diagnostics },
      errorReporter: reporter,
      modelingService,
    });
  // A state update made during render shows on the next render.
  const renderSettled = () => {
    hookHarness.render(useNotifications);
    return hookHarness.render(useNotifications);
  };

  for (const [label, featureId] of [
    ["tied", filletError.featureId],
    ["untied", undefined],
  ] as const) {
    diagnostics = [];
    renderSettled().showWorkbenchError(filletError.message, featureId);
    expect(
      renderSettled().workbenchStatusNotification?.message,
      `${label}: shown before the snapshot that carries its error`,
    ).toBe(filletError.message);

    diagnostics = [filletError];
    expect(
      renderSettled().workbenchStatusNotification?.message,
      `${label}: kept while the document reports the error`,
    ).toBe(filletError.message);

    // Undo restored what the fillet was built on.
    diagnostics = [];
    expect(
      renderSettled().workbenchStatusNotification?.message ?? null,
      `${label}: after the document stops reporting the error`,
    ).toBe(label === "tied" ? null : filletError.message);
    renderSettled().setWorkbenchStatusNotification(null);
  }

  renderSettled().showWorkbenchError("Name cannot be empty.");
  diagnostics = [filletError];
  renderSettled();
  diagnostics = [];
  expect(
    renderSettled().workbenchStatusNotification?.message,
    "An error not tied to a feature survives document changes.",
  ).toBe("Name cannot be empty.");
});
