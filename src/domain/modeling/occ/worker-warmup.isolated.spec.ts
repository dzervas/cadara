import { expect, test, vi } from "vitest";
import type { OccWorkerRequest, OccWorkerResponse } from "../../../infrastructure/occ/worker-protocol";

const native = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<object>>(),
  preloadAdapter: vi.fn(async () => undefined),
}));
vi.mock("@/infrastructure/occ/runtime", () => ({
  loadDefaultOpenCascadeFactory: async () => native.initialize,
}));
vi.mock("@/domain/modeling/opencascade-kernel-adapter", () => ({
  OpenCascadeKernelAdapter: class {
    preloadRuntime = native.preloadAdapter;
  },
}));
vi.mock("@/application/solver/sketch-constraint-solver-adapter", () => ({
  SketchConstraintSolverAdapter: class {},
}));
vi.mock("@/infrastructure/occ/neutral-curve-query", () => ({
  createOpenCascadeNeutralCurveQueryCapability: () => ({}),
}));

// The worker module's dynamic import includes a cold Typia transform; the
// behavioral portion uses no native kernel or timing/readiness thresholds.
test("worker warmup initializes once, queues immediate observers, and retains the instance for later requests", async () => {
  let finishInitialization!: (instance: object) => void;
  native.initialize.mockReturnValue(
    new Promise((resolve) => {
      finishInitialization = resolve;
    }),
  );
  const responses: OccWorkerResponse[] = [];
  let receive!: (event: MessageEvent<OccWorkerRequest>) => void;
  vi.stubGlobal("self", {
    postMessage: (response: OccWorkerResponse) => responses.push(response),
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
  });
  try {
    await import("./worker");
    const warmup = (suffix: string) =>
      receive(
        new MessageEvent<OccWorkerRequest>("message", {
          data: {
            kind: "invoke",
            requestId: `request_occ_${suffix}`,
            operation: { kind: "warmup" },
          },
        }),
      );
    warmup("startup");
    warmup("immediate");
    await vi.waitFor(() => expect(native.initialize).toHaveBeenCalledTimes(1));
    expect(responses).toHaveLength(0);
    finishInitialization({});
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    warmup("later");
    await vi.waitFor(() => expect(responses).toHaveLength(3));
    expect(responses).toEqual(
      ["startup", "immediate", "later"].map((suffix) => ({
        kind: "invoked",
        requestId: `request_occ_${suffix}`,
        operation: "warmup",
      })),
    );
    expect(native.initialize).toHaveBeenCalledTimes(1);
    expect(native.preloadAdapter).toHaveBeenCalledTimes(3);
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);
