import { test, expect, vi } from "vitest";

import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import type { ModelingService } from "@/application/modeling/modeling-service";
import { createSeedDocumentSnapshot } from "@/application/modeling/modeling-test-fixtures";
import { createAppEditorEffectRuntime } from "./create-app-editor-effect-runtime";

function makeModelingService(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
): ModelingService {
  return {
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
  } as unknown as ModelingService;
}

test("create-app-editor-effect-runtime.ts routes reference-image replacement special-mode effects through the injected picker seam", async () => {
  const pickedImage: ReferenceImagePayload = {
    mediaType: "image/png",
    base64Data: "cG5n",
    pixelWidth: 320,
    pixelHeight: 200,
    fileName: "replacement.png",
  };
  const runtime = createAppEditorEffectRuntime(
    makeModelingService(await createSeedDocumentSnapshot()),
    {
      async pickReferenceImagePayload() {
        return pickedImage;
      },
    },
  );
  const result = await runtime.runSketchSpecialModeEffect?.({
    requestId: "request_special-mode-1",
    documentId: "doc_fixture",
    commandSessionId: "command_sketch-1",
    baseRevisionId: "rev_fixture",
    modeId: "reference-image-calibration",
    effectId: "replace-image",
    kind: "reference-image-replace-image",
    payload: {},
  });

  expect(
    result?.effectId === "replace-image" &&
      result.payload.image === pickedImage,
    "Reference-image replacement special-mode effects should resolve by attaching the picked image payload to the effect result.",
  ).toBeTruthy();
});

test("the browser runtime's frame wait resolves after a rendered frame, at once on a hidden page, and by timeout when frames stop", async () => {
  vi.useFakeTimers();
  const frameCallbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  const page = { visibilityState: "visible" as DocumentVisibilityState };
  vi.stubGlobal("document", page);
  try {
    const runtime = createAppEditorEffectRuntime(
      makeModelingService(await createSeedDocumentSnapshot()),
    );
    let resolved = false;
    const settle = (wait: Promise<void> | undefined) =>
      wait?.then(() => {
        resolved = true;
      });

    void settle(runtime.afterNextFrame?.());
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved, "a visible page waits for its frame").toBe(false);
    frameCallbacks.shift()!(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved, "the task after the rendered frame resolves it").toBe(
      true,
    );

    resolved = false;
    void settle(runtime.afterNextFrame?.());
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved, "a frame that never comes times out").toBe(true);

    page.visibilityState = "hidden";
    frameCallbacks.length = 0;
    resolved = false;
    void settle(runtime.afterNextFrame?.());
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved, "a hidden page renders no frames: no wait").toBe(true);
    expect(frameCallbacks).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
