import { createModelingServiceEditorEffectRuntime } from "@/application/editor/effect-registry";
import type { EditorEffectRuntime } from "@/core/editor/state-machine";
import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { supportedReferenceImageFileTypes } from "@/domain/reference-image/raster";
import {
  readReferenceImagePayload,
  runSketchImageImportFlow,
} from "@/domain/reference-image/import-flow";
import { showOpenImportFilePicker } from "@/lib/import-file-picker";

export interface AppEditorEffectRuntimeDependencies {
  pickReferenceImagePayload?: () => Promise<ReferenceImagePayload | null>;
  runSketchImageImportFlow?: typeof runSketchImageImportFlow;
  openSketchSessionFromSelection?: typeof openSketchSessionFromSelection;
  buildSelectionTargetCatalog?: typeof buildSelectionTargetCatalog;
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
  const runSketchImageImportFlowImpl =
    dependencies.runSketchImageImportFlow ?? runSketchImageImportFlow;
  const openSketchSessionFromSelectionImpl =
    dependencies.openSketchSessionFromSelection ??
    openSketchSessionFromSelection;
  const buildSelectionTargetCatalogImpl =
    dependencies.buildSelectionTargetCatalog ?? buildSelectionTargetCatalog;

  return {
    ...baseRuntime,
    async importSketchReferenceImages(
      input: Parameters<
        NonNullable<EditorEffectRuntime["importSketchReferenceImages"]>
      >[0],
    ) {
      const snapshot = await modelingService.getCurrentDocumentSnapshot();
      const result = await runSketchImageImportFlowImpl({
        requestId: input.requestId,
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        session: input.session,
        snapshot,
        modelingService,
        payloads: input.payloads,
      });

      if (result.kind === "cancelled") {
        return {
          status: "cancelled",
          revisionId: input.baseRevisionId,
        };
      }

      if (result.kind === "failed") {
        throw result.error ?? new Error(result.message);
      }

      const session = openSketchSessionFromSelectionImpl(
        [
          {
            kind: "sketch",
            sketchId: result.sketchId,
          },
        ],
        result.snapshot,
      );
      if (!session) {
        throw new Error(
          `Sketch ${result.sketchId} could not be reopened after importing reference images.`,
        );
      }

      return {
        status: "committed",
        revisionId: result.snapshot.document.revisionId,
        snapshot: result.snapshot,
        selectionCatalog: buildSelectionTargetCatalogImpl(result.snapshot),
        session,
        importedCount: result.payloads.length,
      };
    },
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
