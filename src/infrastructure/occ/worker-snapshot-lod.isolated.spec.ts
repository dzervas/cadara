// cadara-se2. Logic lane; seam: the OCC worker's message loop over a fake
// kernel adapter (the module mock is the only port into the worker). The
// post-open LOD refinement must run between the serial requests, one step at
// a time, so an authored mutation posted during it is answered before the
// refinement finishes instead of waiting behind the whole remesh, and a newer
// refinement of the same document, or the document's release, supersedes the
// older one.
// Red on base: there was no refinement operation; the tier change was one
// serial getDocumentSnapshot request that a rename queued behind.
import { expect, test, vi } from "vitest";

import type { OccWorkerRequest, OccWorkerResponse } from "./worker-protocol";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";

const kernel = vi.hoisted(() => ({
  log: [] as string[],
  steps: [] as Array<{ tierId: string; finish: (done: boolean) => void }>,
}));

vi.mock("@/infrastructure/occ/opencascade-kernel-adapter", () => ({
  OpenCascadeKernelAdapter: class {
    restoreAuthoredModelDocument = vi.fn(async () => {});
    dispose = vi.fn();
    renameBody = vi.fn(async (request: { bodyLabel: string }) => {
      kernel.log.push(`rename ${request.bodyLabel}`);
      return { renamed: request.bodyLabel };
    });
    refineSnapshotLodStep = vi.fn(
      (tierId: string) =>
        new Promise<boolean>((resolve) => {
          kernel.log.push(`step ${tierId}`);
          kernel.steps.push({ tierId, finish: resolve });
        }),
    );
  },
}));

test("cadara-se2: worker LOD refinement yields to requests between steps and a newer one supersedes it", async () => {
  const messages: OccWorkerResponse[] = [];
  let receive!: (event: { data: OccWorkerRequest }) => void;
  vi.stubGlobal("self", {
    postMessage(message: OccWorkerResponse) {
      messages.push(message);
      if (message.kind === "invoked") {
        kernel.log.push(`answered ${message.requestId}`);
      }
    },
    addEventListener(_type: string, listener: typeof receive) {
      receive = listener;
    },
  });
  try {
    await import("./worker");
    const document = await createSeedAuthoredModelDocument();
    const request = {
      contractVersion: "modeling-contract/v1alpha1",
      documentId: document.documentId,
    } as const;
    const send = (
      requestId: `request_${string}`,
      operation: Extract<OccWorkerRequest, { kind: "invoke" }>["operation"],
    ) => receive({ data: { kind: "invoke", requestId, operation } });
    const answer = (requestId: string) =>
      messages.find(
        (message) => "requestId" in message && message.requestId === requestId,
      );

    send("request_restore", { kind: "restoreAuthoredModelDocument", document });
    await vi.waitFor(() => expect(answer("request_restore")).toBeDefined());

    send("request_refine_fine", {
      kind: "refineSnapshotLod",
      request,
      lodTierId: "fine",
    });
    await vi.waitFor(() => expect(kernel.steps).toHaveLength(1));
    // Posted while the first refinement step runs.
    send("request_rename", {
      kind: "renameBody",
      request: {
        ...request,
        baseRevisionId: "rev_1",
        bodyId: "body_1",
        bodyLabel: "Renamed",
      },
    });
    kernel.steps[0]!.finish(false);
    await vi.waitFor(() => expect(kernel.steps).toHaveLength(2));
    expect(
      kernel.log,
      "The rename runs and is answered between refinement steps, not after the refinement.",
    ).toEqual([
      "answered request_restore",
      "step fine",
      "rename Renamed",
      "answered request_rename",
      "step fine",
    ]);
    expect(answer("request_refine_fine")).toBeUndefined();

    kernel.steps[1]!.finish(true);
    await vi.waitFor(() =>
      expect(answer("request_refine_fine")).toEqual({
        kind: "invoked",
        requestId: "request_refine_fine",
        operation: "refineSnapshotLod",
        payload: "completed",
      }),
    );

    send("request_refine_normal", {
      kind: "refineSnapshotLod",
      request,
      lodTierId: "normal",
    });
    await vi.waitFor(() => expect(kernel.steps).toHaveLength(3));
    send("request_refine_startup", {
      kind: "refineSnapshotLod",
      request,
      lodTierId: "startup",
    });
    kernel.steps[2]!.finish(false);
    await vi.waitFor(() =>
      expect(answer("request_refine_normal")).toMatchObject({
        payload: "superseded",
      }),
    );
    await vi.waitFor(() => expect(kernel.steps).toHaveLength(4));
    expect(
      kernel.steps.map((step) => step.tierId),
      "The superseded refinement stops; only the newest one keeps stepping.",
    ).toEqual(["fine", "fine", "normal", "startup"]);
    kernel.steps[3]!.finish(true);
    await vi.waitFor(() =>
      expect(answer("request_refine_startup")).toMatchObject({
        payload: "completed",
      }),
    );

    send("request_refine_released", {
      kind: "refineSnapshotLod",
      request,
      lodTierId: "fine",
    });
    await vi.waitFor(() => expect(kernel.steps).toHaveLength(5));
    // The release supersedes the refinement even when a later request
    // re-creates the document's adapter before the next step.
    send("request_release", {
      kind: "releaseDocument",
      documentId: document.documentId,
    });
    send("request_restore_again", {
      kind: "restoreAuthoredModelDocument",
      document,
    });
    kernel.steps[4]!.finish(false);
    await vi.waitFor(() =>
      expect(answer("request_refine_released")).toMatchObject({
        payload: "superseded",
      }),
    );
    expect(answer("request_restore_again")).toBeDefined();
    expect(kernel.steps).toHaveLength(5);
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);
