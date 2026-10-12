import { createSemanticDocumentPort } from "@/infrastructure/modeling/semantic-document-port";
import { fileURLToPath } from "node:url";
import { createSemanticSessionFactory } from "@/application/semantic/session";
import type { SemanticDocumentPort } from "@/application/semantic/document-port";
import type { DocumentId } from "@/contracts/shared/ids";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createStoreGeometryAssetResolver } from "@/infrastructure/modeling/geometry-asset-resolver";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { loadFilesystemOpenCascadeFactory } from "@/infrastructure/occ/filesystem-kernel-runtime";
import { createOpenCascadeInstanceLoader } from "@/infrastructure/occ/runtime";
import { assertOpenCascadeNativeTopologyKernelCapabilities } from "@/domain/modeling/occ/runtime";
import { createEditorEventLoop } from "@/application/editor/editor-event-loop";
import { createModelingServiceEditorEffectRuntime } from "@/application/editor/effect-registry";
import { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";
import { defaultEditorExtensionDependencies } from "@/core/editor/state-machine";
import { createConsoleErrorReporter } from "@/contracts/errors";

/** Source default is module-relative; distribution can inject its adjacent occ directory. */
export function createHeadlessSessionFactory(
  options: { assetDirectory?: string } = {},
) {
  return createSemanticSessionFactory(
    async (): Promise<SemanticDocumentPort> => {
      const documentId = `doc_${crypto.randomUUID()}` as DocumentId;
      const assets = createMemoryGeometryAssetStore();
      const repository = new MemoryDocumentRepository([], assets);
      const loader = createOpenCascadeInstanceLoader(async () => {
        const initialize = await loadFilesystemOpenCascadeFactory(
          options.assetDirectory ??
            fileURLToPath(new URL("../../public/", import.meta.url)),
        );
        return async (settings) => {
          const oc = await initialize(settings);
          assertOpenCascadeNativeTopologyKernelCapabilities(oc);
          return oc;
        };
      });
      let solver: SketchConstraintSolverAdapter;
      const adapter = new OpenCascadeKernelAdapter({
        documentId,
        tolerances: createDocumentSolverTolerances(OCC_KERNEL_SETTINGS),
        initialSnapshotRequiresRuntime: true,
        getOpenCascadeInstance: () => loader.getInstance(),
        assetResolver: {
          ...createStoreGeometryAssetResolver(assets),
          getGeometryAssetBytes: (hash) =>
            repository.getGeometryAssetBytes(hash),
        },
        createSolverAdapter: () => solver,
      });
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
        });
      } catch (error) {
        adapter.dispose();
        throw error;
      }
      let loop: ReturnType<typeof createEditorEventLoop>;
      const sketchActions = new SketchAuthoredActions();
      try {
        loop = createEditorEventLoop(
          createModelingServiceEditorEffectRuntime(service),
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
        documentId,
        repository,
        service,
        loop,
        sketchActions,
        resetRuntime: () => loader.reset(),
      });
    },
  );
}
