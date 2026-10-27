import { createModelingServiceEditorEffectRuntime } from "@/application/editor/effect-registry";
import type { EditorEffectRuntime } from "@/core/editor/state-machine";
import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import type { ModelingService } from "@/domain/modeling/modeling-service";
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

export function createAppEditorEffectRuntime(
  modelingService: ModelingService,
  dependencies: AppEditorEffectRuntimeDependencies = {},
): EditorEffectRuntime {
  const baseRuntime = createModelingServiceEditorEffectRuntime(modelingService);
  const pickReferenceImagePayloadImpl =
    dependencies.pickReferenceImagePayload ?? pickReferenceImagePayload;

  return {
    ...baseRuntime,
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
