import { expect, test, vi } from "vitest";

import type { OccWorkerRequest, OccWorkerResponse } from "./worker-protocol";
import { createSeedAuthoredModelDocument } from "@/domain/modeling/modeling-test-fixtures";

const owners = vi.hoisted(
  () =>
    [] as Array<{
      restoreAuthoredModelDocument: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }>,
);

vi.mock("@/domain/modeling/opencascade-kernel-adapter", () => ({
  OpenCascadeKernelAdapter: class {
    restoreAuthoredModelDocument = vi.fn(async () => {});
    dispose = vi.fn();
    constructor() {
      owners.push(this);
    }
  },
}));

test("explicit worker document release disposes native ownership before removing the adapter", async () => {
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
    async function invoke(
      operation: Extract<OccWorkerRequest, { kind: "invoke" }>["operation"],
    ) {
      const requestId = `request_release_${messages.length}` as const;
      receive({ data: { kind: "invoke", requestId, operation } });
      await vi.waitFor(() =>
        expect(
          messages.some(
            (message) =>
              "requestId" in message && message.requestId === requestId,
          ),
        ).toBe(true),
      );
      expect(messages.at(-1)?.kind).toBe("invoked");
    }
    await invoke({ kind: "restoreAuthoredModelDocument", document });
    expect(owners).toHaveLength(1);
    await invoke({ kind: "releaseDocument", documentId: document.documentId });
    expect(owners[0]!.dispose).toHaveBeenCalledTimes(1);
    await invoke({ kind: "releaseDocument", documentId: document.documentId });
    expect(owners[0]!.dispose).toHaveBeenCalledTimes(1);
    await invoke({ kind: "restoreAuthoredModelDocument", document });
    expect(owners).toHaveLength(2);
    expect(owners[1]!.restoreAuthoredModelDocument).toHaveBeenCalledTimes(1);
    expect(owners[1]!.dispose).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
