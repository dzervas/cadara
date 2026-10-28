// cadara-ku5k. Logic lane (docs/testing.md, worker seam): the OCC worker posts
// restoreProgress messages only for a restore whose caller asked for them
// (reportProgress); peer-sync and undo restores have no listener and post none.
import { expect, test, vi } from "vitest";

import type { AuthoredDocumentRestoreOptions } from "@/contracts/modeling/adapter";
import type { LoadingProgress } from "@/contracts/modeling/loading-status";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import type { OccWorkerRequest, OccWorkerResponse } from "./worker-protocol";

const progress: LoadingProgress = {
  stage: "rebuilding-features",
  completed: 0,
  total: 1,
  label: "Extrude 1",
};
const restoreOptions = vi.hoisted(() => [] as unknown[]);

vi.mock("@/infrastructure/occ/opencascade-kernel-adapter", () => ({
  OpenCascadeKernelAdapter: class {
    restoreAuthoredModelDocument = vi.fn(
      async (
        _document: unknown,
        _diagnostics: unknown,
        _assets: unknown,
        options: AuthoredDocumentRestoreOptions,
      ) => {
        restoreOptions.push(options);
        options.onProgress?.(progress);
      },
    );
    dispose = vi.fn();
  },
}));

test("restore progress is posted only when the request asks for it", async () => {
  const messages: OccWorkerResponse[] = [];
  let receive!: (event: { data: OccWorkerRequest }) => void;
  vi.stubGlobal("self", {
    postMessage(message: OccWorkerResponse) {
      messages.push(message);
    },
    addEventListener(_type: string, listener: typeof receive) {
      receive = listener;
    },
  });
  try {
    await import("./worker");
    const document = await createSeedAuthoredModelDocument();
    async function restore(
      requestId: `request_${string}`,
      options: { newRevision?: boolean; reportProgress?: boolean },
    ) {
      receive({
        data: {
          kind: "invoke",
          requestId,
          operation: { kind: "restoreAuthoredModelDocument", document, options },
        },
      });
      await vi.waitFor(() =>
        expect(
          messages.some(
            (message) =>
              message.kind === "invoked" && message.requestId === requestId,
          ),
        ).toBe(true),
      );
      return messages.filter(
        (message) =>
          message.kind === "restoreProgress" && message.requestId === requestId,
      );
    }

    expect(
      await restore("request_unwatched", { newRevision: true }),
      "A restore nobody watches posts no progress.",
    ).toEqual([]);
    expect(await restore("request_watched", { reportProgress: true })).toEqual([
      { kind: "restoreProgress", requestId: "request_watched", progress },
    ]);
    expect(restoreOptions[0]).toEqual({
      newRevision: true,
      onProgress: undefined,
    });
    expect(
      restoreOptions[1],
      "The transport flag stays in the worker.",
    ).not.toHaveProperty("reportProgress");
  } finally {
    vi.unstubAllGlobals();
  }
});
