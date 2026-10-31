import { beforeEach, expect, test, vi } from "vitest";
import { createTestErrorReporter } from "@/contracts/errors";
import type { ModelingHistoryRestoreState } from "@/application/modeling/modeling-service/types";
import {
  createHookTestHarness,
  flushMicrotasks,
} from "./controller-test-harness";

const hookHarness = createHookTestHarness();
vi.mock("react", () => hookHarness.reactModule);
vi.mock("@/infrastructure/occ/browser-kernel-runtime", () => ({
  subscribeBrowserOccWorkerFailure: () => () => undefined,
}));
const { useWorkbenchNotifications } =
  await import("./use-workbench-notifications");
const { OccKernelVersionRetiredError } =
  await import("@/infrastructure/occ/kernel-version-retired");

beforeEach(() => hookHarness.reset());

test.each([false, true])(
  "initialization rejection retains its cause and honors disposed=%s",
  async (disposed) => {
    const reporter = createTestErrorReporter();
    const error = new Error("Kernel initialization failed");
    let reject!: (error: unknown) => void;
    const pending = new Promise<ModelingHistoryRestoreState>(
      (_resolve, fail) => {
        reject = fail;
      },
    );
    const modelingService = {
      currentDocumentId: "doc_workspace" as const,
      subscribeToDocumentChanges() { return () => undefined; },
      getHistoryRestoreState: () => pending,
    };
    const useNotifications = () =>
      useWorkbenchNotifications({ errorReporter: reporter, modelingService });
    hookHarness.render(useNotifications);
    await hookHarness.flushEffects();
    if (disposed) hookHarness.cleanup();
    reject(error);
    await flushMicrotasks();
    const controller = hookHarness.render(useNotifications);
    if (disposed) {
      expect(controller.restoreFailure).toBeNull();
      expect(reporter.reports).toHaveLength(0);
    } else {
      // A thrown initialization says nothing about the stored history.
      expect(controller.restoreFailure).toEqual({
        kind: "initialization",
        message: error.message,
      });
      expect(reporter.reports).toHaveLength(1);
      expect(reporter.reports[0]?.error.cause).toBe(error);
      expect(reporter.reports[0]?.metadata.source).toBe(
        "workbench.modeling.initialize",
      );
    }
    hookHarness.cleanup();
  },
);

test("a retired kernel's initialization rejection shows and reports no restore failure", async () => {
  const reporter = createTestErrorReporter();
  const modelingService = {
    currentDocumentId: "doc_workspace" as const,
    subscribeToDocumentChanges() { return () => undefined; },
    getHistoryRestoreState: () =>
      Promise.reject(new OccKernelVersionRetiredError()),
  };
  const useNotifications = () =>
    useWorkbenchNotifications({ errorReporter: reporter, modelingService });
  hookHarness.render(useNotifications);
  await hookHarness.flushEffects();
  await flushMicrotasks();
  // The update notification's reload is the only outcome.
  expect(hookHarness.render(useNotifications).restoreFailure).toBeNull();
  expect(reporter.reports).toHaveLength(0);
  hookHarness.cleanup();
});
