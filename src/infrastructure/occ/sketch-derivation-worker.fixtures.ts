import type {
  DeriveSketchRegionsResponse,
  QuerySketchEditIntersectionsResponse,
  QuerySketchSnapIntersectionsResponse,
} from "@/contracts/solver/schema";
import type { OccWorkerLike } from "@/infrastructure/occ/worker-client";
import {
  normalizeOccWorkerFailure,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from "@/infrastructure/occ/worker-protocol";

export class FakeDerivationWorker implements OccWorkerLike {
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
  respond(
    payload:
      | DeriveSketchRegionsResponse
      | QuerySketchEditIntersectionsResponse
      | QuerySketchSnapIntersectionsResponse,
    index = 0,
  ) {
    const posted = this.posted[index]!;
    this.listener?.({
      data: {
        kind: "invoked",
        requestId: posted.requestId,
        operation:
          posted.kind === "invoke"
            ? posted.operation.kind
            : "deriveSketchRegions",
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
