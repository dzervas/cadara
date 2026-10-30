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
      expect(controller.restoreMessage).toBeNull();
      expect(reporter.reports).toHaveLength(0);
    } else {
      expect(controller.restoreMessage).toBe(error.message);
      expect(reporter.reports).toHaveLength(1);
      expect(reporter.reports[0]?.error.cause).toBe(error);
      expect(reporter.reports[0]?.metadata.source).toBe(
        "workbench.modeling.initialize",
      );
    }
    hookHarness.cleanup();
  },
);
