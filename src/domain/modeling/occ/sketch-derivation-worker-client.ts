import type {
  DeriveSketchRegionsRequest,
  DeriveSketchRegionsResponse,
  QuerySketchEditIntersectionsRequest,
  QuerySketchEditIntersectionsResponse,
} from "@/contracts/solver/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import {
  OccWorkerClient,
  type OccWorkerLike,
} from "@/domain/modeling/occ/worker-client";
import {
  SketchRegionDerivationSupersededError,
  type SketchRegionDerivationDelegate,
} from "@/domain/solver/sketch-constraint-solver-adapter";

/** A region derivation or (T10g-1) an edit-intersection query. */
type DerivationRequest =
  | DeriveSketchRegionsRequest
  | QuerySketchEditIntersectionsRequest;

/** Runs one request on a lane's worker client. */
type DerivationCall = (client: OccWorkerClient) => Promise<unknown>;

interface DerivationSlot {
  documentId: DocumentId;
  client: OccWorkerClient;
  inFlight: {
    request: DerivationRequest;
    startedAt: number;
    supersede: (
      error:
        | SketchRegionDerivationSupersededError
        | SketchRegionDerivationDisposedError,
    ) => void;
  } | null;
}

interface WaitingRequest {
  request: DerivationRequest;
  call: DerivationCall;
  resolve: (response: unknown) => void;
  reject: (error: unknown) => void;
  cancelTimer: () => void;
}

/**
 * The g4-review respawn-thrash guard (T08b-g5): a running derivation younger
 * than this is not terminated by a newer request; the newer one waits until
 * the running one finishes or reaches this age (dev-server respawn ≈ 157 ms).
 */
export const SKETCH_REGION_DERIVATION_MINIMUM_SUPERSEDE_AGE_MS = 250;

/**
 * Live region derivation in dedicated, terminable workers (one per document).
 *
 * - A request for a document whose derivation is still running terminates
 *   that worker and starts a fresh one; the replaced caller rejects with
 *   `SketchRegionDerivationSupersededError`. A running derivation younger
 *   than `minimumSupersedeAgeMs` is first given until that age to finish
 *   (respawn thrash guard); a newer request arriving meanwhile supersedes
 *   the waiting one, so at most one request waits per document.
 * - An idle worker is reused (its query memo stays warm); idle workers of other
 *   documents are terminated when a request arrives, so at most the documents
 *   with a running derivation keep a worker.
 * - Any other rejection (worker failure message, transport error, clone
 *   failure) reaches the caller unchanged and retires that worker.
 * - Offset preview publications (U-G3, `derivationLane: "offsetPreview"`)
 *   run in their own lane (worker) per document, so a preview check and the
 *   live region derivation never supersede each other; each lane supersedes
 *   only its own requests. T10g-1: edit-intersection queries run in a third
 *   lane, `editQuery`, with its own worker, query memo and lazy OCC load
 *   (design review A-3).
 * - `dispose()` settles every request: a waiting one and a running one
 *   reject with `SketchRegionDerivationDisposedError`, and no timer stays
 *   scheduled.
 */
export class SketchRegionDerivationWorkerPool implements SketchRegionDerivationDelegate {
  private readonly createWorker: () => OccWorkerLike;
  private readonly minimumSupersedeAgeMs: number;
  private readonly now: () => number;
  private readonly schedule: (run: () => void, delayMs: number) => () => void;
  private readonly slots = new Map<string, DerivationSlot>();
  private readonly waiting = new Map<string, WaitingRequest>();

  constructor(options: {
    createWorker: () => OccWorkerLike;
    minimumSupersedeAgeMs?: number;
    now?: () => number;
    schedule?: (run: () => void, delayMs: number) => () => void;
  }) {
    this.createWorker = options.createWorker;
    // Absent: supersede immediately (the browser runtime passes the guard).
    this.minimumSupersedeAgeMs = options.minimumSupersedeAgeMs ?? 0;
    this.now = options.now ?? (() => performance.now());
    this.schedule =
      options.schedule ??
      ((run, delayMs) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      });
  }

  deriveSketchRegions(
    request: DeriveSketchRegionsRequest,
  ): Promise<DeriveSketchRegionsResponse> {
    return this.submit(
      `${request.documentId}\u0000${request.derivationLane ?? "live"}`,
      request,
      (client) => client.deriveSketchRegions(request),
    ) as Promise<DeriveSketchRegionsResponse>;
  }

  querySketchEditIntersections(
    request: QuerySketchEditIntersectionsRequest,
  ): Promise<QuerySketchEditIntersectionsResponse> {
    return this.submit(
      `${request.documentId}\u0000editQuery`,
      request,
      (client) => client.querySketchEditIntersections(request),
    ) as Promise<QuerySketchEditIntersectionsResponse>;
  }

  /** One worker lane per document and request kind (carried explicitly by the request). */
  private submit(
    lane: string,
    request: DerivationRequest,
    call: DerivationCall,
  ): Promise<unknown> {
    const running = this.slots.get(lane)?.inFlight;
    const age = running ? this.now() - running.startedAt : 0;
    if (running && age < this.minimumSupersedeAgeMs) {
      return new Promise<unknown>((resolve, reject) => {
        const previous = this.waiting.get(lane);
        if (previous) {
          previous.cancelTimer();
          previous.reject(
            new SketchRegionDerivationSupersededError(
              previous.request,
              request,
            ),
          );
        }
        const entry: WaitingRequest = {
          request,
          call,
          resolve,
          reject,
          cancelTimer: () => {},
        };
        entry.cancelTimer = this.schedule(
          () => this.release(lane, entry),
          this.minimumSupersedeAgeMs - age,
        );
        this.waiting.set(lane, entry);
      });
    }
    return this.start(lane, request, call);
  }

  /** Starts a waiting request (timer fired, or the running derivation settled). */
  private release(lane: string, entry: WaitingRequest) {
    if (this.waiting.get(lane) !== entry) return;
    this.waiting.delete(lane);
    entry.cancelTimer();
    this.start(lane, entry.request, entry.call).then(
      entry.resolve,
      entry.reject,
    );
  }

  private start(
    lane: string,
    request: DerivationRequest,
    call: DerivationCall,
  ): Promise<unknown> {
    for (const [key, slot] of this.slots) {
      if (key === lane && slot.inFlight) {
        const superseded = slot.inFlight;
        slot.inFlight = null;
        superseded.supersede(
          new SketchRegionDerivationSupersededError(
            superseded.request,
            request,
          ),
        );
        this.retire(key, slot);
      } else if (slot.documentId !== request.documentId && !slot.inFlight) {
        this.retire(key, slot);
      }
    }

    let slot = this.slots.get(lane);
    if (!slot) {
      // No client deadline: a derivation ends by result, failure or supersession.
      slot = {
        documentId: request.documentId,
        client: new OccWorkerClient({
          worker: this.createWorker(),
          requestTimeoutMs: null,
        }),
        inFlight: null,
      };
      this.slots.set(lane, slot);
    }
    const current = slot;
    const settled = () => {
      const next = this.waiting.get(lane);
      if (next) this.release(lane, next);
    };

    return new Promise<unknown>((resolve, reject) => {
      const inFlight = {
        request,
        startedAt: this.now(),
        supersede: reject,
      };
      current.inFlight = inFlight;
      call(current.client).then(
        (response) => {
          const wasCurrent = current.inFlight === inFlight;
          if (wasCurrent) current.inFlight = null;
          resolve(response);
          if (wasCurrent) settled();
        },
        (error: unknown) => {
          // A superseded request is no longer current: its late rejection
          // must not release a request waiting behind its successor.
          const wasCurrent = current.inFlight === inFlight;
          if (wasCurrent) {
            current.inFlight = null;
            this.retire(lane, current);
          }
          // Settled already when superseded; otherwise the real failure.
          reject(error);
          if (wasCurrent) settled();
        },
      );
    });
  }

  dispose() {
    for (const [lane, entry] of this.waiting) {
      this.waiting.delete(lane);
      entry.cancelTimer();
      entry.reject(new SketchRegionDerivationDisposedError(entry.request));
    }
    for (const [key, slot] of this.slots) {
      const running = slot.inFlight;
      slot.inFlight = null;
      running?.supersede(
        new SketchRegionDerivationDisposedError(running.request),
      );
      this.retire(key, slot);
    }
  }

  private retire(key: string, slot: DerivationSlot) {
    if (this.slots.get(key) === slot) this.slots.delete(key);
    slot.client.dispose();
  }
}

/** A derivation still waiting or running when its pool was disposed. */
export class SketchRegionDerivationDisposedError extends Error {
  override readonly name = "SketchRegionDerivationDisposedError";
  readonly requestId: DeriveSketchRegionsRequest["requestId"];

  constructor(request: DerivationRequest) {
    super(
      `Sketch region derivation ${request.requestId} ended because its derivation worker pool was disposed.`,
    );
    this.requestId = request.requestId;
  }
}
