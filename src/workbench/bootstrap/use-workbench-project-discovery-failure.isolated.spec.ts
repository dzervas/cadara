import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createTestErrorReporter } from "@/contracts/errors";
import {
  createHookTestHarness,
  flushMicrotasks,
} from "@/workbench/adapters/controller-test-harness";

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
// Discovery rejects as LocalProjectRepository reports it: by message only.
const discovery = {
  partFailures: new Map<string, unknown>(),
  message: "",
};
vi.mock("@/infrastructure/persistence/workbench-project-bootstrap", () => ({
  createWorkbenchProjectBootstrap: () => ({
    persistenceEnabled: true,
    partReadiness: {
      dispose: () => undefined,
      failureOf: (docId: string) => discovery.partFailures.get(docId) ?? null,
    },
    openInitialProject: () => Promise.reject(new Error(discovery.message)),
    getRepository: () => Promise.reject(new Error("No repository.")),
    initialTabs: { tabs: [], activeDocumentId: "doc_active" },
    initialFailure: null,
  }),
}));
const { useWorkbenchProject } = await import("./use-workbench-project");
const { markModelingServiceInitializationFailure } = await import(
  "@/application/modeling/modeling-service/initialization-failure"
);

beforeEach(() => {
  hookHarness.reset();
  reporter.reports.length = 0;
  discovery.partFailures.clear();
  vi.stubGlobal("window", { localStorage: {}, location: { search: "" } });
});
afterEach(() => vi.unstubAllGlobals());

async function discover() {
  hookHarness.render(() => useWorkbenchProject(true));
  await hookHarness.flushEffects();
  await flushMicrotasks();
  return hookHarness.render(() => useWorkbenchProject(true));
}

// Lane: logic (isolated, React is the hook harness). Seam: the project hook's
// initial discovery failure. Creating the first project needs its parts'
// documents open; when the active part's initialization threw, that
// document's own "could not be opened" notice is the outcome, so the project
// shows and reports nothing. Any other discovery failure stays the project's.
test("a discovery that failed on the active part's initialization is left to that document", async () => {
  const engineFailure = new Error("Failed to download the geometry engine");
  markModelingServiceInitializationFailure(engineFailure);
  discovery.partFailures.set("doc_active", engineFailure);
  discovery.message = engineFailure.message;
  const project = await discover();
  expect(project.failure).toBeNull();
  expect(project.busy).toBe(false);
  expect(reporter.reports).toHaveLength(0);
});

// Only the active part's notice is on screen: a background part that failed
// to start would otherwise fail discovery with nothing shown or reported.
test("a discovery that failed on a background part's initialization is the project's", async () => {
  const engineFailure = new Error("Background part failed to start");
  markModelingServiceInitializationFailure(engineFailure);
  discovery.partFailures.set("doc_background", engineFailure);
  discovery.message = engineFailure.message;
  const project = await discover();
  expect(project.failure).toBe(engineFailure.message);
  expect(reporter.reports).toHaveLength(1);
});

test("any other discovery failure is shown and reported as the project's", async () => {
  discovery.message = "Invalid local project catalog.";
  const project = await discover();
  expect(project.failure).toBe("Invalid local project catalog.");
  expect(project.busy).toBe(false);
  expect(reporter.reports).toHaveLength(1);
});
