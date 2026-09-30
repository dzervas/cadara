// Seam: the dedicated sketch-derivation worker (`sketch-derivation.worker.ts`)
// against today's main-thread path. Both real worker modules run in-process
// behind structured-clone transports, so envelope validation, op handlers and
// response cloning are the production ones; only the OCC loader is redirected
// to the Node build (the workers' default loads the browser build).
// - main-thread path (no delegate): solver -> kernel adapter queries -> the
//   OCC kernel worker's queries (today's production composition);
// - g4 path: solver -> `SketchRegionDerivationWorkerPool` -> dedicated worker.
import { beforeAll, expect, test, vi } from "vitest";

import type { SketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import {
  addRectangle,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  SOLVER_SCHEMA_VERSION,
  type DeriveSketchRegionsRequest,
} from "@/contracts/solver/schema";
import type { DocumentId, RequestId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { SketchRegionDerivationWorkerPool } from "@/domain/modeling/occ/sketch-derivation-worker-client";
import {
  OccWorkerClient,
  type OccWorkerLike,
} from "@/domain/modeling/occ/worker-client";
import type {
  OccWorkerRequest,
  OccWorkerResponse,
} from "@/domain/modeling/occ/worker-protocol";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const occLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/domain/modeling/occ/runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/runtime")>();
  return {
    ...actual,
    // Both workers load OCC through this; the main thread never does.
    loadDefaultOpenCascadeFactory: async () => async () => {
      occLoads.count += 1;
      return actual.getDefaultOpenCascadeInstance();
    },
  };
});

const DOCUMENT_ID = "doc_arrangement" as DocumentId;

type MessageListener = (event: MessageEvent<unknown>) => void;

/**
 * A structured-clone transport to one in-process worker module. Each
 * `connect()` is one client-side `Worker` handle (the pool spawns one per
 * worker it starts); `terminate()` only detaches that handle here.
 */
function createInProcessWorkerTransport() {
  const toWorker: MessageListener[] = [];
  const toClient = new Set<MessageListener>();
  const deliver = (listeners: Iterable<MessageListener>, message: unknown) => {
    const data = structuredClone(message);
    setTimeout(() => {
      for (const listener of [...listeners]) listener({ data } as MessageEvent);
    }, 0);
  };
  const workerScope = {
    postMessage: (message: OccWorkerResponse) => deliver(toClient, message),
    addEventListener: (_type: "message", listener: MessageListener) => {
      toWorker.push(listener);
    },
  };
  let connections = 0;
  const connect = (): OccWorkerLike => {
    connections += 1;
    return {
      postMessage: (message: OccWorkerRequest) => deliver(toWorker, message),
      addEventListener: (type: string, listener: unknown) => {
        if (type === "message") toClient.add(listener as MessageListener);
      },
      removeEventListener: (type: string, listener: unknown) => {
        if (type === "message") toClient.delete(listener as MessageListener);
      },
    };
  };
  return { workerScope, connect, connections: () => connections };
}

async function importWorkerModule(path: string) {
  const transport = createInProcessWorkerTransport();
  vi.stubGlobal("self", transport.workerScope);
  await import(/* @vite-ignore */ path);
  vi.unstubAllGlobals();
  return transport;
}

/** Float bits, so +0/-0 and every ulp count (bitwise identity, not `toEqual`). */
function bitwiseEncoding(value: unknown) {
  const bits = new DataView(new ArrayBuffer(8));
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry !== "number") return entry;
    bits.setFloat64(0, entry);
    return `f64:${bits.getBigUint64(0).toString(16)}`;
  });
}

let mainThreadSolver: SketchConstraintSolverAdapter;
let workerSolver: SketchConstraintSolverAdapter;
let pool: SketchRegionDerivationWorkerPool;
let kernelWorkerClient: OccWorkerClient;
let derivationWorkerConnections: () => number;
let mainThreadOccLoads = 0;

beforeAll(async () => {
  const kernelWorker = await importWorkerModule("@/domain/modeling/occ/worker");
  const derivationWorker = await importWorkerModule(
    "@/domain/modeling/occ/sketch-derivation.worker",
  );
  derivationWorkerConnections = derivationWorker.connections;
  // Runtime startup only (4.7-8.8 s per file, ledger open problem 2).
  await getDefaultOpenCascadeInstance();

  kernelWorkerClient = new OccWorkerClient({ worker: kernelWorker.connect() });
  const kernelAdapter = new OpenCascadeKernelAdapter({
    documentId: DOCUMENT_ID,
    createSolverAdapter: () => {
      throw new Error(
        "A worker-backed adapter never builds a main-thread solver for live regions.",
      );
    },
    workerSnapshotClient: kernelWorkerClient,
    getOpenCascadeInstance: async () => {
      mainThreadOccLoads += 1;
      throw new Error("Main-thread OCC must not load.");
    },
  });
  pool = new SketchRegionDerivationWorkerPool({
    createWorker: derivationWorker.connect,
  });
  mainThreadSolver = new SketchConstraintSolverAdapter({
    documentId: DOCUMENT_ID,
    revisionId: null,
    neutralCurveQueries: kernelAdapter,
  });
  workerSolver = new SketchConstraintSolverAdapter({
    documentId: DOCUMENT_ID,
    revisionId: null,
    neutralCurveQueries: kernelAdapter,
    regionDerivation: pool,
  });
}, 60_000);

function regionRequest(
  build: (sketch: SketchFixture) => void,
  options: { modelingTolerance?: number } = {},
): DeriveSketchRegionsRequest {
  const sketch = makeSketchFixture();
  build(sketch);
  const input = sketch.build(options);
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_worker_regions" as RequestId,
    documentId: DOCUMENT_ID,
    revisionId: input.revisionId as DeriveSketchRegionsRequest["revisionId"],
    sketchId: input.sketchId as DeriveSketchRegionsRequest["sketchId"],
    definition: input.definition,
    solvedSnapshot: input.solvedSnapshot,
    projectedReferences: [...input.projectedReferences],
    modelingTolerance: input.modelingTolerance,
  };
}

/** The T09e timing fixtures (minus the 4 s figure-eight, measured in the g4 probe) plus diagnostic rows. */
/**
 * label, builder, regions, OCC loads the dedicated worker makes while deriving
 * it (1 only for the first fixture whose queries need OCC).
 */
const fixtures: [string, (sketch: SketchFixture) => void, number, number][] = [
  ["rectangle", (s) => addRectangle(s, "r", [0, 0, 10, 5]), 1, 0],
  [
    "rectangle + inner circle",
    (s) => {
      addRectangle(s, "r", [0, 0, 10, 5]);
      s.point("c", 5, 2.5);
      s.circle("c1", "c", 1);
    },
    2,
    0,
  ],
  [
    "rounded rectangle",
    (s) => {
      const points: [string, number, number][] = [
        ["a", 1, 0],
        ["b", 9, 0],
        ["c", 10, 1],
        ["d", 10, 5],
        ["e", 9, 6],
        ["f", 1, 6],
        ["g", 0, 5],
        ["h", 0, 1],
        ["k1", 9, 1],
        ["k2", 9, 5],
        ["k3", 1, 5],
        ["k4", 1, 1],
      ];
      for (const [name, x, y] of points) s.point(name, x, y);
      s.line("l1", "a", "b");
      s.arc("a1", "k1", "b", "c");
      s.line("l2", "c", "d");
      s.arc("a2", "k2", "d", "e");
      s.line("l3", "e", "f");
      s.arc("a3", "k3", "f", "g");
      s.line("l4", "g", "h");
      s.arc("a4", "k4", "h", "a");
    },
    1,
    0,
  ],
  [
    "rectangle with crossing circle",
    (s) => {
      addRectangle(s, "r", [0, 0, 10, 5]);
      s.point("c", 10, 2.5);
      s.circle("c1", "c", 1);
    },
    3,
    0,
  ],
  [
    // The Node OCC build lacks the custom native query binding, so this pair
    // is `region-query-unsupported` on both paths (0 regions); it proves the
    // OCC-backed query ran in the worker (the browser run covers real regions).
    "two overlapping full circles (OCC pair query)",
    (s) => {
      s.point("p", 0, 0);
      s.point("q", 1, 0);
      s.circle("c", "p", 1);
      s.circle("d", "q", 1);
    },
    0,
    1,
  ],
  [
    "closed 4-point spline",
    (s) => {
      s.point("p0", 0, 0);
      s.point("p1", 4, 0.5);
      s.point("p2", 4.5, 3);
      s.point("p3", 0.5, 3.5);
      s.spline("loop", ["p0", "p1", "p2", "p3"], "smooth");
    },
    1,
    0,
  ],
  [
    "gap inside tolerance (profile-open-segment diagnostics)",
    (s) => addRectangle(s, "r", [0, 0, 10, 5], "coincident", 5e-4),
    0,
    0,
  ],
];

for (const [label, build, regionCount, workerOccLoads] of fixtures) {
  test(`dedicated-worker deriveSketchRegions is bitwise identical to the main-thread path: ${label}`, async () => {
    const request = regionRequest(build);
    const mainThread = await mainThreadSolver.deriveSketchRegions(request);
    const loadsBefore = occLoads.count;
    const worker = await workerSolver.deriveSketchRegions(request);
    expect(
      occLoads.count - loadsBefore,
      `${label}: OCC loads in the dedicated worker (lazy: only when a query needs it).`,
    ).toBe(workerOccLoads);
    const workerAgain = await workerSolver.deriveSketchRegions(request);

    expect(
      mainThread.regions,
      `${label}: the fixture derives its expected regions on the main-thread path.`,
    ).toHaveLength(regionCount);
    expect(
      bitwiseEncoding(worker),
      `${label}: the worker response equals the main-thread response bit for bit.`,
    ).toBe(bitwiseEncoding(mainThread));
    expect(worker, `${label}: and structurally.`).toStrictEqual(mainThread);
    expect(
      bitwiseEncoding(workerAgain),
      `${label}: a repeated worker derivation (warm query memo) is unchanged.`,
    ).toBe(bitwiseEncoding(mainThread));
    expect(mainThreadOccLoads, "Main-thread OCC never loads.").toBe(0);
  });
}

test("OCC loaded once per worker, never on the main thread; the pool reused one worker", () => {
  expect(
    occLoads.count,
    "The kernel worker (today's queries) and the dedicated worker each loaded OCC once.",
  ).toBe(2);
  expect(mainThreadOccLoads, "Main-thread OCC never loads.").toBe(0);
  expect(
    derivationWorkerConnections(),
    "Sequential requests for one document reuse one dedicated worker.",
  ).toBe(1);
});

test("the dedicated worker recomputes per request: an edit after a derivation derives the edited geometry", async () => {
  const before = regionRequest((s) => addRectangle(s, "r", [0, 0, 10, 5]));
  const after = regionRequest((s) => addRectangle(s, "r", [0, 0, 12, 5]));
  const beforeWorker = await workerSolver.deriveSketchRegions(before);
  const afterWorker = await workerSolver.deriveSketchRegions(after);
  const afterMainThread = await mainThreadSolver.deriveSketchRegions(after);
  expect(
    bitwiseEncoding(afterWorker),
    "The edited sketch's worker result equals its main-thread result.",
  ).toBe(bitwiseEncoding(afterMainThread));
  expect(
    bitwiseEncoding(afterWorker.regions),
    "The document's kept worker solver does not serve the pre-edit regions.",
  ).not.toBe(bitwiseEncoding(beforeWorker.regions));
});

test("dedicated-worker failures reject the caller with the worker's message", async () => {
  const request = regionRequest((s) => addRectangle(s, "r", [0, 0, 10, 5]));
  await expect(
    pool.deriveSketchRegions({ ...request, modelingTolerance: -1 }),
    "The worker's own tolerance check rejects (the pool forwards unchecked).",
  ).rejects.toThrow("modelingTolerance");
  await expect(
    pool.deriveSketchRegions({
      ...request,
      definition: { ...request.definition, cachedRegions: [] } as never,
    }),
    "The worker's envelope validation rejects a request outside the contract.",
  ).rejects.toThrow();
  expect(
    (await workerSolver.deriveSketchRegions(request)).regions,
    "Later requests still succeed (on a fresh worker after each failure).",
  ).toHaveLength(1);
});

test("the OCC kernel worker no longer answers deriveSketchRegions", async () => {
  const request = regionRequest((s) => addRectangle(s, "r", [0, 0, 10, 5]));
  await expect(
    kernelWorkerClient.deriveSketchRegions(request),
    "Live derivation never queues on the kernel worker; it rejects explicitly.",
  ).rejects.toThrow("dedicated sketch-derivation worker");
});
