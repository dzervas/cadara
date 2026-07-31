import { test, expect } from "vitest";

import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { GetDocumentSnapshotResponse } from "@/contracts/modeling/schema";
import { packWorkspaceSnapshotRenderMeshes } from "@/domain/modeling/occ/mesh-transport";
import {
  OccWorkerClient,
  type OccWorkerLike,
} from "@/domain/modeling/occ/worker-client";
import type {
  OccWorkerRequest,
  OccWorkerResponse,
} from "@/domain/modeling/occ/worker-protocol";
import { normalizeOccWorkerFailure } from "@/domain/modeling/occ/worker-protocol";

class FakeOccWorker implements OccWorkerLike {
  private messageListener:
    | ((event: MessageEvent<OccWorkerResponse>) => void)
    | null = null;
  private errorListener: ((event: Event) => void) | null = null;
  private messageErrorListener: ((event: Event) => void) | null = null;
  readonly posted: OccWorkerRequest[] = [];
  postMessageError: Error | null = null;
  terminateCalls = 0;

  postMessage(message: OccWorkerRequest): void {
    if (this.postMessageError) {
      throw this.postMessageError;
    }
    this.posted.push(message);
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<OccWorkerResponse>) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<OccWorkerResponse>) => void)
      | ((event: Event) => void),
  ): void {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent<OccWorkerResponse>) => void;
    } else if (type === "error") {
      this.errorListener = listener as (event: Event) => void;
    } else {
      this.messageErrorListener = listener as (event: Event) => void;
    }
  }

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<OccWorkerResponse>) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<OccWorkerResponse>) => void)
      | ((event: Event) => void),
  ): void {
    if (type === "message" && this.messageListener === listener) {
      this.messageListener = null;
    } else if (type === "error" && this.errorListener === listener) {
      this.errorListener = null;
    } else if (type === "messageerror" && this.messageErrorListener === listener) {
      this.messageErrorListener = null;
    }
  }

  terminate() {
    this.terminateCalls += 1;
  }

  emit(message: OccWorkerResponse) {
    this.messageListener?.({ data: message } as MessageEvent<OccWorkerResponse>);
  }

  emitTransportError(type: "error" | "messageerror") {
    const event = { type } as Event;
    if (type === "error") {
      this.errorListener?.(event);
    } else {
      this.messageErrorListener?.(event);
    }
  }
}

test("src/domain/modeling/occ/worker-client.spec.ts", async () => {
  async function testWarmupInvokesWorkerOperation() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });

    const promise = client.warmup({
      mainWasm: "/assets/opencascade.full.wasm",
    });
    const request = worker.posted[0];

    expect(
      request?.kind,
      "Warmup should post an invoke request to the OCC worker.",
    ).toBe("invoke");
    expect(
      request.requestId.startsWith("request_occ_warmup_"),
      "Worker request ids should satisfy the shared RequestId contract.",
    ).toBeTruthy();
    expect(
      request.operation.kind,
      "Warmup should use the worker warmup operation.",
    ).toBe("warmup");

    worker.emit({
      kind: "invoked",
      requestId: request.requestId,
      operation: "warmup",
    });

    await promise;
  }

  async function testSnapshotResponsesAreUnpacked() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });
    const meshRecord = {
      id: "renderable_occ_face_body_1_face_1",
      label: "Body face",
      ownerBodyId: "body_1",
      ownerFeatureId: "feature_1",
      binding: {
        pickId: "pick_occ_face_body_1_face_1",
        pickPriority: 20,
        target: { kind: "face", bodyId: "body_1", faceId: "face_1" },
        topology: "face",
        semanticClass: "bodyFace",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    } as RenderableEntityRecord;
    const snapshotResponse = {
      contractVersion: "modeling-contract/v1alpha1",
      snapshot: {
        document: { render: { records: [meshRecord] } },
        render: { records: [meshRecord] },
      },
    } as GetDocumentSnapshotResponse;

    const promise = client.getDocumentSnapshot(
      {
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_1",
      },
      "startup",
    );
    const request = worker.posted[0];
    expect(
      request?.kind === "invoke" &&
        request.operation.kind === "getDocumentSnapshot",
      "Snapshot queries should use the worker getDocumentSnapshot operation.",
    ).toBeTruthy();

    const packed = packWorkspaceSnapshotRenderMeshes(snapshotResponse.snapshot);
    worker.emit({
      kind: "invoked",
      requestId: request.requestId,
      operation: "getDocumentSnapshot",
      payload: {
        contractVersion: snapshotResponse.contractVersion,
        snapshot: packed.snapshot,
      },
    });

    const response = await promise;
    const geometry = response.snapshot.document.render.records[0]?.geometry;

    expect(
      geometry?.kind,
      "Worker snapshot responses should be unpacked back into public mesh records.",
    ).toBe("mesh");
  }

  async function testWarmupFailuresSurfaceToCaller() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });
    const promise = client.warmup();
    const request = worker.posted[0];

    expect(
      request?.kind,
      "Warmup failure tests should still use invoke requests.",
    ).toBe("invoke");

    worker.emit({
      kind: "failure",
      requestId: request.requestId,
      error: {
        code: "occ-worker-initialization-failed",
        message: "warmup failed",
      },
    });

    let failed = false;
    try {
      await promise;
    } catch (error) {
      failed = error instanceof Error && error.message === "warmup failed";
    }

    expect(
      failed,
      "Worker warmup failures must surface to the caller.",
    ).toBeTruthy();
  }

  async function testExportCapabilitiesCreateCloneSafeWorkerRequests() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });

    const capabilities = await client.getExportCapabilities(
      "doc_export_caps",
      "revision_1",
    );
    const promise = capabilities.mesh.tessellate(
      { kind: "body", bodyId: "body_export" as never },
      { chordTolerance: 0.05, angleToleranceRadians: 0.1 },
    );
    const request = worker.posted[0];

    expect(
      request?.kind === "invoke" &&
        request.operation.kind === "tessellateExportMesh" &&
        request.operation.documentId === "doc_export_caps" &&
        request.operation.baseRevisionId === "revision_1",
      "Export capability calls should carry document identity and data-only arguments into the OCC worker request.",
    ).toBeTruthy();
    expect(
      typeof capabilities.mesh.tessellate === "function" &&
        typeof capabilities.brep.writeStep === "function",
      "Worker export capabilities should be local proxy functions rather than worker-cloned functions.",
    ).toBeTruthy();
    expect(
      JSON.stringify(request.operation).includes("tessellateExportMesh") &&
        !JSON.stringify(request.operation).includes("function"),
      "Worker export requests should remain structured-clone-safe data payloads.",
    ).toBeTruthy();

    worker.emit({
      kind: "invoked",
      requestId: request.requestId,
      operation: "tessellateExportMesh",
      payload: [],
    });

    await promise;
  }


  async function testReleaseDocumentDoesNotTerminateTheSharedWorker() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });
    const promise = client.releaseDocument("doc_release");
    const request = worker.posted[0];

    expect(
      request?.kind === "invoke" &&
        request.operation.kind === "releaseDocument" &&
        request.operation.documentId === "doc_release",
      "Releasing a probe document should use the dedicated worker operation.",
    ).toBeTruthy();

    worker.emit({
      kind: "invoked",
      requestId: request.requestId,
      operation: "releaseDocument",
    });
    await promise;

    expect(
      worker.terminateCalls,
      "Releasing one document must retain the shared OCC worker runtime.",
    ).toBe(0);
  }

  async function testSynchronousKernelWorkHasNoClientRequestDeadline() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });
    const promise = client.warmup();
    const request = worker.posted[0];

    // Real baked-body materialization can take about 65 seconds. This
    // compressed delay proves the default client stays pending for synchronous
    // kernel work and still observes the eventual worker response.
    await new Promise((resolve) => setTimeout(resolve, 25));
    worker.emit({
      kind: "invoked",
      requestId: request.requestId,
      operation: "warmup",
    });

    await promise;
  }

  async function testConfigurableTimeoutAllowsLaterRequestsAfterLateResponses() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker, requestTimeoutMs: 10 });
    const timedOut = client.warmup();
    const timedOutRequest = worker.posted[0];

    await expect(timedOut).rejects.toThrow(
      "OCC worker request timed out after 10ms.",
    );
    worker.emit({
      kind: "invoked",
      requestId: timedOutRequest.requestId,
      operation: "warmup",
    });

    const next = client.warmup();
    const nextRequest = worker.posted[1];
    worker.emit({
      kind: "invoked",
      requestId: nextRequest.requestId,
      operation: "warmup",
    });
    await next;
    expect(
      worker.terminateCalls,
      "An individual request timeout must not terminate the shared worker.",
    ).toBe(0);
  }

  async function testTransportErrorsRejectAllPendingRequests() {
    for (const type of ["error", "messageerror"] as const) {
      const worker = new FakeOccWorker();
      const client = new OccWorkerClient({ worker });
      const first = client.warmup();
      const second = client.releaseDocument("doc_transport_failure");

      worker.emitTransportError(type);

      await expect(Promise.all([first, second])).rejects.toThrow(
        type === "error"
          ? "OCC worker transport failed."
          : "OCC worker message deserialization failed.",
      );
      await expect(client.warmup()).rejects.toThrow(
        type === "error"
          ? "OCC worker transport failed."
          : "OCC worker message deserialization failed.",
      );
      expect(
        worker.posted,
        "Terminal worker transport failures must prevent new postMessage calls.",
      ).toHaveLength(2);
    }
  }

  async function testPostMessageFailuresBecomeTerminalAndRejectAllRequests() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });
    const first = client.warmup();
    worker.postMessageError = new Error("DataCloneError");
    const second = client.releaseDocument("doc_post_failure");

    await expect(Promise.all([first, second])).rejects.toThrow(
      "OCC worker postMessage failed: DataCloneError",
    );
    worker.postMessageError = null;
    await expect(client.warmup()).rejects.toThrow(
      "OCC worker postMessage failed: DataCloneError",
    );
    expect(worker.posted).toHaveLength(1);
  }

  async function testDisposeRejectsPendingAndFutureRequests() {
    const worker = new FakeOccWorker();
    const client = new OccWorkerClient({ worker });
    const pending = client.warmup();

    client.dispose();
    client.dispose();

    await expect(pending).rejects.toThrow("OCC worker client disposed.");
    await expect(client.warmup()).rejects.toThrow("OCC worker client disposed.");
    expect(worker.terminateCalls).toBe(1);
  }

  function testWorkerFailureNormalizerPreservesUsefulMessages() {
    const validation = normalizeOccWorkerFailure(
      "request_occ_worker_invalid",
      "requestId must be a RequestId.",
    );
    const plainObject = normalizeOccWorkerFailure(
      "request_occ_worker_plain",
      { message: "DataCloneError: render snapshot is too large." },
    );

    expect(
      validation.error.message,
      "OCC worker failure normalization should preserve validation strings.",
    ).toBe("requestId must be a RequestId.");
    expect(
      plainObject.error.message,
      "OCC worker failure normalization should preserve message-bearing structured-clone failures.",
    ).toBe("DataCloneError: render snapshot is too large.");
  }

  await testWarmupInvokesWorkerOperation();
  await testSnapshotResponsesAreUnpacked();
  await testWarmupFailuresSurfaceToCaller();
  await testExportCapabilitiesCreateCloneSafeWorkerRequests();
  await testReleaseDocumentDoesNotTerminateTheSharedWorker();
  await testSynchronousKernelWorkHasNoClientRequestDeadline();
  await testConfigurableTimeoutAllowsLaterRequestsAfterLateResponses();
  await testTransportErrorsRejectAllPendingRequests();
  await testPostMessageFailuresBecomeTerminalAndRejectAllRequests();
  await testDisposeRejectsPendingAndFutureRequests();
  testWorkerFailureNormalizerPreservesUsefulMessages();
});
