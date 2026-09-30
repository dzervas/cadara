import type {
  DeriveSketchRegionsRequest,
  DeriveSketchRegionsResponse,
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

interface DerivationSlot {
  client: OccWorkerClient;
  inFlight: {
    request: DeriveSketchRegionsRequest;
    supersede: (error: SketchRegionDerivationSupersededError) => void;
  } | null;
}

/**
 * Live region derivation in dedicated, terminable workers (one per document).
 *
 * - A request for a document whose derivation is still running terminates
 *   that worker and starts a fresh one; the replaced caller rejects with
 *   `SketchRegionDerivationSupersededError`.
 * - An idle worker is reused (its query memo stays warm); idle workers of other
 *   documents are terminated when a request arrives, so at most the documents
 *   with a running derivation keep a worker.
 * - Any other rejection (worker failure message, transport error, clone
 *   failure) reaches the caller unchanged and retires that worker.
 */
export class SketchRegionDerivationWorkerPool implements SketchRegionDerivationDelegate {
  private readonly createWorker: () => OccWorkerLike;
  private readonly slots = new Map<DocumentId, DerivationSlot>();

  constructor(options: { createWorker: () => OccWorkerLike }) {
    this.createWorker = options.createWorker;
  }

  deriveSketchRegions(
    request: DeriveSketchRegionsRequest,
  ): Promise<DeriveSketchRegionsResponse> {
    for (const [documentId, slot] of this.slots) {
      if (documentId === request.documentId && slot.inFlight) {
        const superseded = slot.inFlight;
        slot.inFlight = null;
        superseded.supersede(
          new SketchRegionDerivationSupersededError(
            superseded.request,
            request,
          ),
        );
        this.retire(documentId, slot);
      } else if (documentId !== request.documentId && !slot.inFlight) {
        this.retire(documentId, slot);
      }
    }

    let slot = this.slots.get(request.documentId);
    if (!slot) {
      // No client deadline: a derivation ends by result, failure or supersession.
      slot = {
        client: new OccWorkerClient({
          worker: this.createWorker(),
          requestTimeoutMs: null,
        }),
        inFlight: null,
      };
      this.slots.set(request.documentId, slot);
    }
    const current = slot;

    return new Promise<DeriveSketchRegionsResponse>((resolve, reject) => {
      const inFlight = { request, supersede: reject };
      current.inFlight = inFlight;
      current.client.deriveSketchRegions(request).then(
        (response) => {
          if (current.inFlight === inFlight) current.inFlight = null;
          resolve(response);
        },
        (error: unknown) => {
          if (current.inFlight === inFlight) {
            current.inFlight = null;
            this.retire(request.documentId, current);
          }
          // Settled already when superseded; otherwise the real failure.
          reject(error);
        },
      );
    });
  }

  dispose() {
    for (const [documentId, slot] of this.slots) this.retire(documentId, slot);
  }

  private retire(documentId: DocumentId, slot: DerivationSlot) {
    if (this.slots.get(documentId) === slot) this.slots.delete(documentId);
    slot.client.dispose();
  }
}
