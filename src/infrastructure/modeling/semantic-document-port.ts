import { createSemanticSketchPort } from "./semantic-sketch-port";
import { createNativeDocumentFiles } from "./native-document-files";
import type {
  NativeDocumentFileIO,
  SemanticDocumentPort,
} from "@/application/semantic/document-port";
import { semanticDiagnostic } from "@/application/semantic/session";
import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import type { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";
import type {
  SemanticDiscovery,
  SemanticState,
} from "@/contracts/semantic/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  DocumentRepository,
  DocumentRepositoryMutationResult,
} from "@/domain/modeling/document-repository";
import type { ModelingService } from "@/domain/modeling/modeling-service";

/** Concrete adapter for the shared production modeling/editor owners. */
export function createSemanticDocumentPort(input: {
  documentId: DocumentId;
  nativeFileIO: NativeDocumentFileIO;
  repository: DocumentRepository;
  service: ModelingService;
  loop: EditorEventLoop;
  sketchActions: SketchAuthoredActions;
  sketchPublications: ReturnType<typeof import("./sketch-publication-receipts").createSketchPublicationReceipts>;
  resetRuntime(): void;
}): SemanticDocumentPort {
  const { documentId, repository, service, loop, sketchActions, resetRuntime } =
    input;
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
  let replacementPending = false;
  async function inspect(input: { commandId: string }) {
    const snapshot = await service.getCurrentDocumentSnapshot();
    const events = loop.getState().kind === "editingSketch" && !replacementPending ? [] : await loop.dispatchAndSettle(input.commandId, {
      type: "document.replaced",
      snapshot,
    });
    const failed = events.find((event) => event.type.endsWith("Failed"));
    if (failed) throw new Error(JSON.stringify(failed));
    if ((loop.getState().kind === "editingSketch" ? loop.getState().snapshot?.document.revisionId !== snapshot.document.revisionId : loop.getState().snapshot !== snapshot) || !snapshot.provenance)
      throw new Error("Authoritative editor snapshot handoff failed.");
    replacementPending = false;
    const discovery: SemanticDiscovery = {
      state: state(
        snapshot.document.revisionId,
        snapshot.provenance.repositoryHeads,
      ),
      document: { label: snapshot.document.name, settings: snapshot.document.settings },
      references: snapshot.presentation.entities.map((entity) => ({
        label: entity.label,
        target: entity.target,
      })),
      history: await repository.getDurableHistoryAvailability(documentId),
    };
    return { discovery: sketches.discovery(discovery), diagnostics: snapshot.document.diagnostics };
  }
  const sketches = createSemanticSketchPort({ loop, inspect, service, publications: input.sketchPublications });
  let released = false;
  return {
    async initialize() {
      // This existing observation is an initialization judgment, never a write receipt.
      const initialized = await service.getHistoryRestoreState();
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
          diagnostics: [semanticDiagnostic(new Error(JSON.stringify(failed)))],
        };
      return {
        kind: "ready",
        discovery: (await inspect({ commandId: "initial-handoff" })).discovery,
      };
    },
    async create(input) {
      const transactionId = `transaction_${crypto.randomUUID()}`;
      let transaction: DocumentRepositoryMutationResult | null = null;
      let diagnostics: ReturnType<typeof semanticDiagnostic>[] = [];
      let executionFailed = false;
      try {
        const mutation = await service.createNewDocument({
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
      // The exact write result, not a fulfilled global persistence tail or restore status.
      const observed = transaction as DocumentRepositoryMutationResult | null;
      const applied = observed?.ok ? observed : observed?.appliedLive;
      if (!observed || !applied)
        return {
          state: null,
          ...(executionFailed ? { failure: "execution" as const } : {}),
          persistence: { kind: "not-required" },
          diagnostics,
        };
      sketchActions.reset();
      replacementPending = true;
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
    nativeFiles: createNativeDocumentFiles({
      service,
      sketchActions,
      state: (revisionId, heads) => {
        // Accepted native mutations replace the editor context, including a private draft.
        replacementPending = true;
        return state(revisionId, heads);
      },
      files: input.nativeFileIO,
    }),
    inspect,
    sketch: sketches.execute,
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
      resetRuntime();
    },
  };
}
