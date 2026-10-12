import { fileURLToPath } from "node:url";
import {
  createSemanticSessionFactory,
  semanticDiagnostic,
} from "@/application/semantic/session";
import type { SemanticDocumentPort } from "@/application/semantic/document-port";
import type {
  SemanticDiscovery,
  SemanticState,
} from "@/contracts/semantic/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createStoreGeometryAssetResolver } from "@/infrastructure/modeling/geometry-asset-resolver";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
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
      function state(
        revisionId: SemanticState["revisionId"],
        heads: readonly string[],
      ): SemanticState {
        return {
          documentId,
          revisionId,
          repositoryHeads: [...heads],
          editingContext: { kind: "document" },
          draft: null,
        };
      }
      async function inspect(input: { commandId: string }) {
        const snapshot = await service.getCurrentDocumentSnapshot();
        const events = await loop.dispatchAndSettle(input.commandId, {
          type: "document.replaced",
          snapshot,
        });
        const failed = events.find((event) => event.type.endsWith("Failed"));
        if (failed) throw new Error(JSON.stringify(failed));
        if (loop.getState().snapshot !== snapshot || !snapshot.provenance) {
          throw new Error("Authoritative editor snapshot handoff failed.");
        }
        const current = state(
          snapshot.document.revisionId,
          snapshot.provenance.repositoryHeads,
        );
        const discovery: SemanticDiscovery = {
          state: current,
          document: { label: snapshot.document.name },
          references: snapshot.presentation.entities.map((entity) => ({
            label: entity.label,
            target: entity.target,
          })),
          history: await repository.getDurableHistoryAvailability(documentId),
        };
        return { discovery, diagnostics: snapshot.document.diagnostics };
      }
      let released = false;
      return {
        async initialize() {
          const initialized = await service.initialize();
          if (initialized.kind === "failed")
            return {
              kind: "failed",
              diagnostics: initialized.diagnostics.map((d) =>
                semanticDiagnostic(new Error(d.message)),
              ),
            };
          const events = await loop.startAndSettle("initialization");
          const failed = events.find((event) => event.type.endsWith("Failed"));
          if (failed)
            return {
              kind: "failed",
              diagnostics: [
                semanticDiagnostic(new Error(JSON.stringify(failed))),
              ],
            };
          return {
            kind: "ready",
            discovery: (await inspect({ commandId: "initial-handoff" }))
              .discovery,
          };
        },
        async create(input) {
          const transactionId = `transaction_${crypto.randomUUID()}`;
          let transaction: DocumentRepositoryMutationResult | null = null;
          let diagnostics: ReturnType<typeof semanticDiagnostic>[] = [];
          let executionFailed = false;
          try {
            const mutation = await service.createDocumentTransaction({
              name: input.label,
              observe: (receipt) => {
                transaction = receipt;
              },
            });
            diagnostics = mutation.diagnostics;
          } catch (error) {
            executionFailed = true;
            diagnostics = [semanticDiagnostic(error)];
          }
          // This is the exact write result, not a fulfilled global persistence tail.
          const observed =
            transaction as DocumentRepositoryMutationResult | null;
          const applied = observed?.ok ? observed : observed?.appliedLive;
          if (!observed || !applied)
            return {
              state: null,
              ...(executionFailed ? { failure: "execution" as const } : {}),
              persistence: { kind: "not-required" },
              diagnostics,
            };
          sketchActions.reset();
          const acceptedState = state(
            applied.document.revisionId,
            applied.metadata.heads,
          );
          return {
            state: acceptedState,
            ...(executionFailed ? { failure: "execution" as const } : {}),
            persistence: {
              kind: observed.ok ? "committed" : "failed",
              commandId: input.commandId,
              transactionId,
              state: acceptedState,
            },
            diagnostics,
          };
        },
        inspect,
        async drain() {
          await loop.drain();
          await service.waitForPersistence();
        },
        async release() {
          if (released) return;
          released = true;
          await loop.drain();
          loop.stop();
          service.dispose(); // Service is the sole owner of the adapter.
          sketchActions.reset();
          loader.reset();
        },
      };
    },
  );
}
