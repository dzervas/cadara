import { test, expect } from "vitest";

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
