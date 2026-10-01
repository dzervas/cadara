// Seam: `SketchRegionDerivationWorkerPool`, the main-thread side of the
// dedicated sketch-derivation worker: request posting, supersession by
// terminate-and-respawn, worker reuse, and error surfacing, over fake workers.
import { expect, test } from "vitest";

import {
  addRectangle,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  SOLVER_SCHEMA_VERSION,
  type DeriveSketchRegionsRequest,
  type DeriveSketchRegionsResponse,
} from "@/contracts/solver/schema";
import type { DocumentId, RequestId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  SketchRegionDerivationDisposedError,
  SketchRegionDerivationWorkerPool,
} from "@/domain/modeling/occ/sketch-derivation-worker-client";
import type { OccWorkerLike } from "@/domain/modeling/occ/worker-client";
import {
  normalizeOccWorkerFailure,
  validateOccWorkerRequestEnvelope,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from "@/domain/modeling/occ/worker-protocol";
import { SketchRegionDerivationSupersededError } from "@/domain/solver/sketch-constraint-solver-adapter";

class FakeDerivationWorker implements OccWorkerLike {
  readonly posted: OccWorkerRequest[] = [];
  terminated = false;
  postMessageError: Error | null = null;
  private listener: ((event: MessageEvent<OccWorkerResponse>) => void) | null =
    null;

  postMessage(message: OccWorkerRequest) {
    if (this.postMessageError) throw this.postMessageError;
    this.posted.push(message);
  }
  addEventListener(type: string, listener: unknown) {
    if (type === "message")
      this.listener = listener as (
        event: MessageEvent<OccWorkerResponse>,
      ) => void;
  }
  removeEventListener(type: string, listener: unknown) {
    if (type === "message" && this.listener === listener) this.listener = null;
  }
  terminate() {
    this.terminated = true;
  }
  respond(payload: DeriveSketchRegionsResponse, index = 0) {
    this.listener?.({
      data: {
        kind: "invoked",
        requestId: this.posted[index]!.requestId,
        operation: "deriveSketchRegions",
        payload,
      },
    } as MessageEvent<OccWorkerResponse>);
  }
  fail(message: string, index = 0) {
    this.listener?.({
      data: normalizeOccWorkerFailure(
        this.posted[index]!.requestId,
        new Error(message),
      ),
    } as MessageEvent<OccWorkerResponse>);
  }
}

function makePool(firstWorkerPostMessageError: Error | null = null) {
  const workers: FakeDerivationWorker[] = [];
  const pool = new SketchRegionDerivationWorkerPool({
    createWorker: () => {
      const worker = new FakeDerivationWorker();
      if (workers.length === 0)
        worker.postMessageError = firstWorkerPostMessageError;
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

function makeRequest(
  requestId: string,
  documentId = "doc_derivation",
): DeriveSketchRegionsRequest {
  const sketch = makeSketchFixture();
  addRectangle(sketch, "r", [0, 0, 10, 5]);
  const input = sketch.build();
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: requestId as RequestId,
    documentId: documentId as DocumentId,
    revisionId: input.revisionId as DeriveSketchRegionsRequest["revisionId"],
    sketchId: input.sketchId as DeriveSketchRegionsRequest["sketchId"],
    definition: input.definition,
    solvedSnapshot: input.solvedSnapshot,
    projectedReferences: [...input.projectedReferences],
    modelingTolerance: input.modelingTolerance,
  };
}

function responseFor(request: DeriveSketchRegionsRequest) {
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: request.requestId,
    documentId: request.documentId,
    revisionId: request.revisionId,
    sketchId: request.sketchId,
    regions: [],
    diagnostics: [],
  } as DeriveSketchRegionsResponse;
}

test("a request posts unchanged to a spawned worker and resolves with its response", async () => {
  const { pool, workers } = makePool();
  const request = makeRequest("request_live_1");
  const promise = pool.deriveSketchRegions(request);
  expect(workers, "The first request spawns one worker.").toHaveLength(1);
  const posted = workers[0]!.posted[0]!;
  expect(
    posted.kind === "invoke" && posted.operation,
    "The request is posted unchanged as the deriveSketchRegions operation.",
  ).toEqual({ kind: "deriveSketchRegions", request });
  const validation = validateOccWorkerRequestEnvelope(structuredClone(posted));
  expect(
    validation.success ? [] : validation.errors,
    "The worker's envelope validation accepts the structured-cloned request.",
  ).toEqual([]);
  const response = responseFor(request);
  workers[0]!.respond(response);
  expect(await promise).toBe(response);

  const second = pool.deriveSketchRegions(makeRequest("request_live_2"));
  expect(
    workers,
    "An idle worker is reused for the next request.",
  ).toHaveLength(1);
  workers[0]!.respond(responseFor(makeRequest("request_live_2")), 1);
  await second;
  expect(workers[0]!.terminated).toBe(false);
});

test("a newer request for the same document terminates the running worker and rejects the superseded caller with the typed cancellation", async () => {
  const { pool, workers } = makePool();
  const first = makeRequest("request_live_old");
  const newer = makeRequest("request_live_new");
  const superseded = pool.deriveSketchRegions(first);
  const latest = pool.deriveSketchRegions(newer);

  const error = await superseded.catch((reason: unknown) => reason);
  expect(
    error,
    "The superseded caller rejects with SketchRegionDerivationSupersededError.",
  ).toBeInstanceOf(SketchRegionDerivationSupersededError);
  expect(error).toMatchObject({
    requestId: "request_live_old",
    supersededBy: "request_live_new",
  });
  expect(
    workers,
    "A fresh worker is spawned for the newer request.",
  ).toHaveLength(2);
  expect(workers[0]!.terminated, "The running worker is terminated.").toBe(
    true,
  );
  expect(
    workers[1]!.posted[0]!.kind === "invoke" &&
      workers[1]!.posted[0]!.operation,
  ).toEqual({
    kind: "deriveSketchRegions",
    request: newer,
  });

  workers[0]!.respond(responseFor(first));
  const response = responseFor(newer);
  workers[1]!.respond(response);
  expect(
    await latest,
    "A late message from the terminated worker never resolves anyone; the newer request gets its own result.",
  ).toBe(response);
});

test("a request for another document retires idle workers but never a running one", async () => {
  const { pool, workers } = makePool();
  const a = makeRequest("request_doc_a", "doc_a");
  const aDone = pool.deriveSketchRegions(a);
  workers[0]!.respond(responseFor(a));
  await aDone;

  const bRunning = pool.deriveSketchRegions(
    makeRequest("request_doc_b", "doc_b"),
  );
  expect(
    workers[0]!.terminated,
    "Document a's idle worker is terminated.",
  ).toBe(true);
  const c = makeRequest("request_doc_c", "doc_c");
  const cDone = pool.deriveSketchRegions(c);
  expect(
    workers[1]!.terminated,
    "Document b's running derivation is not superseded by another document.",
  ).toBe(false);
  workers[2]!.respond(responseFor(c));
  await cDone;
  workers[1]!.respond(responseFor(makeRequest("request_doc_b", "doc_b")));
  await bRunning;
});

test("worker failures reach the caller unchanged and the next request gets a fresh worker", async () => {
  const { pool, workers } = makePool();
  const failing = pool.deriveSketchRegions(makeRequest("request_fails"));
  workers[0]!.fail("Region derivation exploded.");
  const error = await failing.catch((reason: unknown) => reason);
  expect(
    error,
    "A worker failure is a real error, not a cancellation.",
  ).not.toBeInstanceOf(SketchRegionDerivationSupersededError);
  expect((error as Error).message).toBe("Region derivation exploded.");
  expect(workers[0]!.terminated, "The failed worker is retired.").toBe(true);

  const next = makeRequest("request_after_failure");
  const recovered = pool.deriveSketchRegions(next);
  expect(workers).toHaveLength(2);
  workers[1]!.respond(responseFor(next));
  await recovered;

  const cloneFailing = makePool(new Error("DataCloneError"));
  await expect(
    cloneFailing.pool.deriveSketchRegions(makeRequest("request_unclonable")),
    "A non-serializable request rejects the caller instead of being dropped.",
  ).rejects.toThrow("OCC worker postMessage failed: DataCloneError");
  const again = cloneFailing.pool.deriveSketchRegions(makeRequest("request_x"));
  cloneFailing.workers[1]!.respond(responseFor(makeRequest("request_x")));
  await again;
  expect(cloneFailing.workers[0]!.terminated).toBe(true);
});

test("T08b-g5 respawn guard: a young derivation is given the minimum age before a newer request supersedes it, and only one request waits", async () => {
  const workers: FakeDerivationWorker[] = [];
  let clock = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const pool = new SketchRegionDerivationWorkerPool({
    createWorker: () => {
      const worker = new FakeDerivationWorker();
      workers.push(worker);
      return worker;
    },
    minimumSupersedeAgeMs: 250,
    now: () => clock,
    schedule: (run, delayMs) => {
      const timer = { at: clock + delayMs, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.filter((item) => item.at <= clock))
      if (!timer.cancelled) {
        timer.cancelled = true;
        timer.run();
      }
  };

  const first = makeRequest("request_young_1");
  const firstDone = pool.deriveSketchRegions(first);
  advance(100);
  const second = pool.deriveSketchRegions(makeRequest("request_young_2"));
  expect(
    workers[0]!.terminated,
    "A derivation younger than the guard is not terminated.",
  ).toBe(false);
  const third = makeRequest("request_young_3");
  const thirdDone = pool.deriveSketchRegions(third);
  await expect(
    second,
    "A newer waiting request supersedes the waiting one, so at most one waits.",
  ).rejects.toBeInstanceOf(SketchRegionDerivationSupersededError);

  advance(150);
  expect(
    workers[0]!.terminated,
    "At the guard age the running derivation is superseded.",
  ).toBe(true);
  await expect(firstDone).rejects.toBeInstanceOf(
    SketchRegionDerivationSupersededError,
  );
  expect(workers).toHaveLength(2);
  workers[1]!.respond(responseFor(third));
  await expect(thirdDone).resolves.toMatchObject({
    requestId: third.requestId,
  });

  // A young derivation that finishes first releases the waiting request on
  // the same warm worker: no respawn.
  const fourth = makeRequest("request_young_4");
  const fourthDone = pool.deriveSketchRegions(fourth);
  const fifth = makeRequest("request_young_5");
  const fifthDone = pool.deriveSketchRegions(fifth);
  workers[1]!.respond(responseFor(fourth), 1);
  await fourthDone;
  await Promise.resolve();
  expect(
    workers,
    "No respawn when the young derivation finishes.",
  ).toHaveLength(2);
  workers[1]!.respond(responseFor(fifth), 2);
  await expect(fifthDone).resolves.toMatchObject({
    requestId: fifth.requestId,
  });
});

test("T08b-g5 U-G3: an offset preview publication runs in its own lane and never supersedes the live derivation", async () => {
  const { pool, workers } = makePool();
  const live = makeRequest("request_sketch-region-derivation-1");
  const liveDone = pool.deriveSketchRegions(live);
  const preview: DeriveSketchRegionsRequest = {
    ...makeRequest("request_sketch-offset-preview-publication-2"),
    derivationLane: "offsetPreview",
  };
  const previewDone = pool.deriveSketchRegions(preview);
  expect(workers).toHaveLength(2);
  expect(
    workers[0]!.terminated,
    "The preview check must not terminate the live derivation.",
  ).toBe(false);
  workers[1]!.respond(responseFor(preview));
  workers[0]!.respond(responseFor(live));
  await expect(previewDone).resolves.toMatchObject({
    requestId: preview.requestId,
  });
  await expect(liveDone).resolves.toMatchObject({ requestId: live.requestId });
});

test("T08b-g5b (g5a review A3): the lane is the request's explicit derivationLane, never inferred from the request id", async () => {
  const { pool, workers } = makePool();
  const live = makeRequest("request_live_1");
  const liveDone = pool.deriveSketchRegions(live);
  // A preview-scoped request id without the lane field is a live request.
  const unlabelled = makeRequest("request_sketch-offset-preview-publication-2");
  const unlabelledDone = pool.deriveSketchRegions(unlabelled);
  await expect(
    liveDone,
    "Without derivationLane the request is in the live lane and supersedes the live derivation, whatever its request id says.",
  ).rejects.toBeInstanceOf(SketchRegionDerivationSupersededError);
  expect(workers[0]!.terminated).toBe(true);
  workers[1]!.respond(responseFor(unlabelled));
  await unlabelledDone;

  const preview: DeriveSketchRegionsRequest = {
    ...makeRequest("request_any_id"),
    derivationLane: "offsetPreview",
  };
  const previewDone = pool.deriveSketchRegions(preview);
  expect(
    workers,
    "An explicitly labelled preview spawns its own lane's worker even with an unscoped request id.",
  ).toHaveLength(3);
  expect(workers[1]!.terminated).toBe(false);
  workers[2]!.respond(responseFor(preview));
  await previewDone;
});

test("T08b-g5b (g5a review A3, g4 A4): dispose settles the running and the waiting request of every lane and cancels the respawn timer", async () => {
  const workers: FakeDerivationWorker[] = [];
  const timers: { cancelled: boolean }[] = [];
  const pool = new SketchRegionDerivationWorkerPool({
    createWorker: () => {
      const worker = new FakeDerivationWorker();
      workers.push(worker);
      return worker;
    },
    minimumSupersedeAgeMs: 250,
    now: () => 0,
    schedule: () => {
      const timer = { cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const running = pool.deriveSketchRegions(makeRequest("request_running"));
  const waiting = pool.deriveSketchRegions(makeRequest("request_waiting"));
  const preview = pool.deriveSketchRegions({
    ...makeRequest("request_preview"),
    derivationLane: "offsetPreview",
  });
  pool.dispose();
  for (const [promise, requestId] of [
    [running, "request_running"],
    [waiting, "request_waiting"],
    [preview, "request_preview"],
  ] as const) {
    const error = await promise.catch((reason: unknown) => reason);
    expect(
      error,
      `Disposal rejects ${requestId} with the typed disposal error instead of leaving it unsettled.`,
    ).toBeInstanceOf(SketchRegionDerivationDisposedError);
    expect(error).toMatchObject({ requestId });
  }
  expect(
    timers.every((timer) => timer.cancelled),
    "No respawn timer stays scheduled after disposal.",
  ).toBe(true);
  expect(
    workers.every((worker) => worker.terminated),
    "Every lane's worker is terminated.",
  ).toBe(true);
  // A late worker message after disposal resolves no one.
  workers[0]!.respond(responseFor(makeRequest("request_running")));
});
