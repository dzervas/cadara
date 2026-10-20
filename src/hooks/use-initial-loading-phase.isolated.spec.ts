import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createLoadingStatus } from "@/contracts/modeling/loading-status";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { WorkbenchDocumentActionResult } from "@/workbench/document/document-file-actions";
import { createHookTestHarness } from "@/workbench/adapters/controller-test-harness";

const harness = createHookTestHarness();
const engine = createLoadingStatus("ready");
vi.mock("@/infrastructure/occ/browser-kernel-runtime", () => ({
  browserOccLoadingStatus: engine,
}));
vi.mock("react", () => ({
  ...harness.reactModule,
  // The existing controller harness rerenders explicitly. Preserve subscription
  // cleanup, reading the real source's current snapshot on each render.
  useSyncExternalStore(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => unknown,
  ) {
    harness.reactModule.useEffect(() => subscribe(() => {}), [subscribe]);
    return getSnapshot();
  },
}));
const { useInitialLoadingPhase } = await import("./use-initial-loading-phase");

beforeEach(() => {
  harness.reset();
  engine.set("ready");
});
afterEach(() => harness.cleanup());

function service(phase: "opening-document" | "ready") {
  return { initialLoadingStatus: createLoadingStatus(phase) } satisfies Pick<
    ModelingService,
    "initialLoadingStatus"
  >;
}
function pending() {
  let resolve!: (value: WorkbenchDocumentActionResult) => void;
  const promise = new Promise<WorkbenchDocumentActionResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("late mount and tab switch read the active service immediately, ignoring the previous tab", async () => {
  const first = service("opening-document");
  const next = service("ready");
  // Only this source is consumed; no full service fake is needed at the hook seam.
  const render = (source: ReturnType<typeof service>) =>
    harness.render(() => useInitialLoadingPhase(source));
  expect(render(first).phase).toBe("opening-document");
  await harness.flushEffects();
  const file = pending();
  const opening = render(first).openDocument(() => file.promise);
  expect(render(first).filePhase).toBe("opening-document");
  expect(render(next).phase).toBe("ready");
  await harness.flushEffects();
  first.initialLoadingStatus.set("failed");
  file.resolve({ status: "user-error", message: "invalid file" });
  await opening;
  expect(render(next).phase).toBe("ready");
});

test("file opening stays pending until the newest request settles and failures stop activity", async () => {
  const active = service("ready");
  const render = () => harness.render(() => useInitialLoadingPhase(active));
  const first = pending();
  const second = pending();
  const one = render().openDocument(() => first.promise);
  const two = render().openDocument(() => second.promise);
  first.resolve({ status: "cancelled" });
  await one;
  expect(render().filePhase).toBe("opening-document");
  second.resolve({ status: "user-error", message: "invalid file" });
  await two;
  expect(render().filePhase).toBe("failed");
  const error = new Error("read failed");
  await expect(
    render().openDocument(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(render().filePhase).toBe("failed");
  await render().openDocument(async () => ({ status: "cancelled" }));
  expect(render().phase).toBe("ready");
});
