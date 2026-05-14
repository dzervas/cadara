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
  private listener: ((event: MessageEvent<OccWorkerResponse>) => void) | null =
    null;
  readonly posted: OccWorkerRequest[] = [];

  postMessage(message: OccWorkerRequest): void {
    this.posted.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<OccWorkerResponse>) => void,
  ): void {
    this.listener = listener;
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<OccWorkerResponse>) => void,
  ): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  emit(message: OccWorkerResponse) {
    this.listener?.({ data: message } as MessageEvent<OccWorkerResponse>);
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

  function testWorkerFailureNormalizerPreservesValidationMessages() {
    const failure = normalizeOccWorkerFailure(
      "request_occ_worker_invalid",
      "requestId must be a RequestId.",
    );

    expect(
      failure.error.message,
      "OCC worker failure normalization should preserve validation strings.",
    ).toBe("requestId must be a RequestId.");
  }

  await testWarmupInvokesWorkerOperation();
  await testSnapshotResponsesAreUnpacked();
  await testWarmupFailuresSurfaceToCaller();
  await testExportCapabilitiesCreateCloneSafeWorkerRequests();
  testWorkerFailureNormalizerPreservesValidationMessages();
});
