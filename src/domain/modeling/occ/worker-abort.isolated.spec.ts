import { expect, test, vi } from "vitest";
import type { OccWorkerRequest, OccWorkerResponse } from "./worker-protocol";

vi.mock("@/domain/modeling/opencascade-kernel-adapter", () => ({ OpenCascadeKernelAdapter: class {} }));
vi.mock("@/application/solver/sketch-constraint-solver-adapter", () => ({ SketchConstraintSolverAdapter: class {} }));
vi.mock("@/domain/modeling/occ/neutral-curve-query", () => ({ createOpenCascadeNeutralCurveQueryCapability: () => ({}) }));

const initialize = vi.hoisted(() => ({ calls: 0, hasAbortHook: false }));
vi.mock("@/infrastructure/occ/runtime", () => ({
  loadDefaultOpenCascadeFactory: async () => async (settings: {
    module: { onAbort: (reason: unknown) => void };
  }) => {
    initialize.calls++;
    initialize.hasAbortHook = typeof settings.module.onAbort === "function";
    settings.module.onAbort("OOM");
    throw new WebAssembly.RuntimeError("Aborted(OOM)");
  },
}));

// The budget covers the in-test `import("./worker")`: Vite/Typia transform of
// the worker graph takes ~5.4 s alone, ~11.6 s inside `bun run test`, and
// 13-15+ s with a busy CPU; the abort path itself takes ~80 ms (cadara-74s).
test("initialization onAbort reports immediately and prevents queued work on the poisoned runtime", async () => {
  const responses: OccWorkerResponse[] = [];
  let receive: ((event: MessageEvent<OccWorkerRequest>) => void) | undefined;
  vi.stubGlobal("self", {
    postMessage: (message: OccWorkerResponse) => responses.push(message),
    addEventListener: (_type: string, listener: typeof receive) => { receive = listener; },
  });
  try {
    await import("./worker");
    for (const requestId of ["request_occ_first", "request_occ_second"] as const) {
      receive!(new MessageEvent<OccWorkerRequest>("message", { data: { kind: "invoke", requestId, operation: { kind: "warmup" } } }));
    }
    await vi.waitFor(() => expect(responses).toEqual([
      { kind: "fatal", error: { message: "OOM" } },
    ]));
    // Drain the queued continuation too: an abort must not reinitialize in-place.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(initialize.calls).toBe(1);
    expect(initialize.hasAbortHook).toBe(true);
    expect(responses).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);
