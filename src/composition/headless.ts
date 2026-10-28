import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
import { createBuiltinExportProviderRegistry } from "@/application/export/builtin-provider-composition";
import { createSketchPublicationReceipts } from "@/infrastructure/modeling/sketch-publication-receipts";
import { createSemanticDocumentPort } from "@/infrastructure/modeling/semantic-document-port";
import { fileURLToPath } from "node:url";
import { createSemanticSessionFactory } from "@/application/semantic/session";
import { filesystemReferenceImageFiles } from "@/infrastructure/modeling/reference-image-file-io";
import { filesystemNativeDocumentIO } from "@/infrastructure/modeling/native-document-file-io";
import type {
  NativeDocumentFileIO,
  SemanticDocumentPort,
} from "@/application/semantic/document-port";
import type { DocumentId } from "@/contracts/shared/ids";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { headlessDocumentSettings } from "@/composition/headless-capabilities";
import { createStoreGeometryAssetResolver } from "@/infrastructure/modeling/geometry-asset-resolver";
import {
  createMemoryGeometryAssetStore,
  type GeometryAssetStore,
} from "@/core/modeling/geometry-asset-store";
import type { GeometryAssetDocumentRepository } from "@/contracts/modeling/document-repository";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
import { createModelingService } from "@/application/modeling/modeling-service";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { loadFilesystemOpenCascadeFactory } from "@/infrastructure/occ/filesystem-kernel-runtime";
import { createOpenCascadeInstanceLoader } from "@/infrastructure/occ/runtime";
import { assertOpenCascadeNativeTopologyKernelCapabilities } from "@/infrastructure/occ/kernel-capabilities";
import { createEditorEventLoop } from "@/application/editor/editor-event-loop";
import { createModelingServiceEditorEffectRuntime } from "@/application/editor/effect-registry";
import { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";

import { createConsoleErrorReporter } from "@/contracts/errors";
import type { ModelCheckpointStore } from "@/infrastructure/persistence/model-checkpoint-store";
import { fingerprintModelCheckpointRuntime } from "@/infrastructure/modeling/model-checkpoint-file-store";
import { dirname } from "node:path";

// Replaced by the CLI bundler, never read from the caller's environment or cwd.
declare const CADARA_CLI_PACKAGED: boolean;
const defaultAssetDirectory = fileURLToPath(
  new URL(
    typeof CADARA_CLI_PACKAGED !== "undefined" && CADARA_CLI_PACKAGED
      ? "./occ/"
      : "../../public/",
    import.meta.url,
  ),
);

/**
 * cadara-3sq.6: the model checkpoint compatibility digest of this runtime, or
 * null for a source checkout, whose evaluator code is not one fingerprintable
 * bundle (its opens are never cached).
 */
export function fingerprintHeadlessRuntime() {
  if (typeof CADARA_CLI_PACKAGED === "undefined" || !CADARA_CLI_PACKAGED) {
    return Promise.resolve(null);
  }
  return fingerprintModelCheckpointRuntime({
    assetDirectory: defaultAssetDirectory,
    // The bundle is flat: this chunk sits beside main.js, sdk.js and every other chunk.
    codeDirectory: dirname(fileURLToPath(import.meta.url)),
  });
}

/** Both source and release defaults are module-relative. */
export function createHeadlessSessionFactory(
  options: {
    assetDirectory?: string;
    nativeFileIO?: NativeDocumentFileIO;
    referenceImageFiles?: import("@/application/semantic/reference-image-files").ReferenceImageFiles;
    createRepository?: (
      assets: GeometryAssetStore,
    ) => GeometryAssetDocumentRepository;
    /** cadara-3sq.6: evaluated checkpoints for complete native document opens. */
    modelCheckpoints?: ModelCheckpointStore;
  } = {},
) {
  return createSemanticSessionFactory(
    async (): Promise<SemanticDocumentPort> => {
      const documentId = `doc_${crypto.randomUUID()}` as DocumentId;
      const assets = createMemoryGeometryAssetStore();
      const repository =
        options.createRepository?.(assets) ??
        new MemoryDocumentRepository([], assets);
      const loader = createOpenCascadeInstanceLoader(async () => {
        const initialize = await loadFilesystemOpenCascadeFactory(
          options.assetDirectory ?? defaultAssetDirectory,
        );
        return async (settings) => {
          // Native progress is diagnostic output, never the command result channel.
          const oc = await initialize({ ...settings, module: { ...settings?.module, print: console.error, printErr: console.error } });
          assertOpenCascadeNativeTopologyKernelCapabilities(oc);
          return oc;
        };
      });
      let solver: SketchConstraintSolverAdapter;
      const adapter = new OpenCascadeKernelAdapter({
        documentId,
        tolerances: createDocumentSolverTolerances(headlessDocumentSettings),
        initialSnapshotRequiresRuntime: true,
        getOpenCascadeInstance: () => loader.getInstance(),
        assetResolver: {
          ...createStoreGeometryAssetResolver(assets),
          getGeometryAssetBytes: (hash) =>
            repository.getGeometryAssetBytes(hash),
        },
        createSolverAdapter: () => solver,
        modelCheckpoints: options.modelCheckpoints,
      });
      const exportProviders = createBuiltinExportProviderRegistry();
      let service: ReturnType<typeof createModelingService>;
      try {
        solver = new SketchConstraintSolverAdapter({
          documentId,
          revisionId: null,
          neutralCurveQueries: adapter,
        });
        service = createModelingService(adapter, {
          currentDocumentId: documentId,
          sketchSolver: solver,
          documentRepository: repository,
          exportProviders,
        });
      } catch (error) {
        adapter.dispose();
        throw error;
      }
      let loop: ReturnType<typeof createEditorEventLoop>;
      const sketchActions = new SketchAuthoredActions();
      const sketchPublications = createSketchPublicationReceipts();
      try {
        loop = createEditorEventLoop(
          createModelingServiceEditorEffectRuntime(service, { observeSketchPublication: sketchPublications.observe, observeCursorPersistence: sketchPublications.observeCursor }),
          createConsoleErrorReporter(),
          undefined,
          defaultEditorExtensionDependencies,
          sketchActions,
        );
      } catch (error) {
        service.dispose();
        throw error;
      }
      return createSemanticDocumentPort({
        exportProviders,
        documentId,
        nativeFileIO: options.nativeFileIO ?? filesystemNativeDocumentIO,
        referenceImageFiles: options.referenceImageFiles ?? filesystemReferenceImageFiles,
        repository,
        service,
        loop,
        sketchActions,
        sketchPublications,
        resetRuntime: () => loader.reset(),
      });
    },
  );
}
