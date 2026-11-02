import { createModelingServiceEditorEffectRuntime } from "@/application/editor/effect-registry";
import type { EditorEffectRuntime } from "@/core/editor/state-machine";
import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import type { ModelingService } from "@/application/modeling/modeling-service";
import { supportedReferenceImageFileTypes } from "@/infrastructure/reference-image/raster";
import { readReferenceImagePayload } from "@/infrastructure/reference-image/import-flow";
import { showOpenImportFilePicker } from "@/lib/import-file-picker";

export interface AppEditorEffectRuntimeDependencies {
  pickReferenceImagePayload?: () => Promise<ReferenceImagePayload | null>;
}

async function pickReferenceImagePayload(): Promise<ReferenceImagePayload | null> {
  const pickerResult = await showOpenImportFilePicker({
    acceptedFileTypes: supportedReferenceImageFileTypes,
  });

  if (!pickerResult.ok) {
    if (pickerResult.reason === "failed") {
      throw new Error("Reference-image selection failed.");
    }
    return null;
  }

  const file = pickerResult.files[0];
  return file ? readReferenceImagePayload(file) : null;
}

async function runSketchSpecialModeAppEffect(input: {
  effectId: string;
  kind: string;
  pickReferenceImagePayload: () => Promise<ReferenceImagePayload | null>;
}): Promise<{
  effectId: string;
  payload: Record<string, unknown>;
}> {
  switch (input.kind) {
    case "reference-image-replace-image": {
      const image = await input.pickReferenceImagePayload();
      return {
        effectId: input.effectId,
        payload: image ? { image } : {},
      };
    }
    default:
      throw new Error(
        `No sketch special mode effect runtime is registered for ${input.kind}.`,
      );
  }
}

/**
 * Resolves in a task after the page renders its next frame. A hidden page
 * renders none, so it resolves at once there, and after a timeout if
 * rendering stops while waiting.
 */
function afterNextRenderedFrame(): Promise<void> {
  if (
    typeof globalThis.requestAnimationFrame !== "function" ||
    typeof document === "undefined" ||
    document.visibilityState === "hidden"
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const stalled = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      // Frame callbacks run before the frame renders; the next task after it.
      setTimeout(() => {
        clearTimeout(stalled);
        resolve();
      }, 0);
    });
  });
}

export function createAppEditorEffectRuntime(
  modelingService: ModelingService,
  dependencies: AppEditorEffectRuntimeDependencies = {},
): EditorEffectRuntime {
  const baseRuntime = createModelingServiceEditorEffectRuntime(modelingService);
  const pickReferenceImagePayloadImpl =
    dependencies.pickReferenceImagePayload ?? pickReferenceImagePayload;

  return {
    ...baseRuntime,
    afterNextFrame: afterNextRenderedFrame,
    async runSketchSpecialModeEffect(
      input: Parameters<
        NonNullable<EditorEffectRuntime["runSketchSpecialModeEffect"]>
      >[0],
    ) {
      return runSketchSpecialModeAppEffect({
        effectId: input.effectId,
        kind: input.kind,
        pickReferenceImagePayload: pickReferenceImagePayloadImpl,
      });
    },
  };
}
