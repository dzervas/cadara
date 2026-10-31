import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createTestErrorReporter } from "@/contracts/errors";
import { createHookTestHarness } from "@/workbench/adapters/controller-test-harness";

const hookHarness = createHookTestHarness();
const reporter = createTestErrorReporter();
vi.mock("react", () => ({
  ...hookHarness.reactModule,
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
    getSnapshot(),
}));
vi.mock("@/hooks/use-error-reporter", () => ({
  useErrorReporter: () => reporter,
}));
// No project discovery: the row drives `report` directly.
vi.mock("@/infrastructure/persistence/workbench-project-bootstrap", () => ({
  createWorkbenchProjectBootstrap: () => ({
    persistenceEnabled: false,
    partReadiness: { dispose: () => undefined },
    openInitialProject: () => null,
    getRepository: () => Promise.reject(new Error("No repository.")),
    initialTabs: { tabs: [], activeDocumentId: null },
    initialFailure: null,
  }),
}));
const { useWorkbenchProject } = await import("./use-workbench-project");
const { browserOccKernelVersionRetired } =
  await import("@/infrastructure/occ/kernel-version-retired");

beforeEach(() => {
  hookHarness.reset();
  // The hook reads these to create its (mocked) bootstrap.
  vi.stubGlobal("window", { localStorage: {}, location: { search: "" } });
});
afterEach(() => vi.unstubAllGlobals());

// Lane: logic (isolated, the retired flag is module state). Seam: the
// project hook's failure report. A retired kernel fails part readiness with
// a message-only project error (no cause to recognise), so the hook itself
// withholds the report while the kernel is retired.
test("project failures are reported until the kernel is retired, then only shown", () => {
  const retiredMessage =
    "CADara was updated; this tab's geometry engine is no longer available.";
  hookHarness
    .render(() => useWorkbenchProject(false))
    .report(new Error("Project could not be saved."));
  expect(reporter.reports).toHaveLength(1);

  browserOccKernelVersionRetired.mark();
  hookHarness
    .render(() => useWorkbenchProject(false))
    .report(new Error(retiredMessage));
  expect(reporter.reports).toHaveLength(1);
  expect(hookHarness.render(() => useWorkbenchProject(false)).failure).toBe(
    retiredMessage,
  );
});
