import { snapshotRepresentsRepositoryDocument } from "@/contracts/modeling/repository-basis";
import type {
  NativeDocumentFileIO,
  SemanticDocumentPort,
  SemanticDocumentMutation,
} from "@/application/semantic/document-port";
import { semanticDiagnostic } from "@/application/semantic/session";
import type { SemanticState } from "@/contracts/semantic/schema";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";

/** Native format and retained assets belong to the service; only disk IO belongs here. */
export function createNativeDocumentFiles(input: {
  service: ModelingService;
  files: NativeDocumentFileIO;
  sketchActions: SketchAuthoredActions;
  state(
    revisionId: SemanticState["revisionId"],
    heads: readonly string[],
    freshContext: boolean,
  ): SemanticState;
}): NonNullable<SemanticDocumentPort["nativeFiles"]> {
  const { service, files, sketchActions, state } = input;
  async function mutate(
    commandId: string,
    currentState: SemanticState,
    freshContext: boolean,
    apply: (
      observe: (receipt: DocumentRepositoryMutationResult) => void,
    ) => ReturnType<ModelingService["importDocument"]>,
  ): Promise<SemanticDocumentMutation> {
    let receipt: DocumentRepositoryMutationResult | null = null;
    let failure: "execution" | undefined;
    let rejected: string | undefined;
    let completedUnchanged = false;
    let liveRevisionId: SemanticState["revisionId"] | undefined;
    let diagnostics: SemanticDocumentMutation["diagnostics"] = [];
    try {
      const result = await apply((observed) => {
        receipt = observed;
      });
      diagnostics = result.diagnostics;
      if (!result.ok) rejected = "native-document-invalid";
      else {
        completedUnchanged = true;
        liveRevisionId = result.revisionId;
      }
    } catch (error) {
      failure = "execution";
      diagnostics = [semanticDiagnostic(error)];
    }
    const observed = receipt as DocumentRepositoryMutationResult | null;
    const applied = observed?.ok ? observed : observed?.appliedLive;
    if (!applied && observed && !observed.ok)
      return {
        state: null,
        failure: "persistence",
        persistence: {
          kind: "failed",
          commandId,
          transactionId: `transaction_${crypto.randomUUID()}`,
          state: currentState,
        },
        diagnostics,
      };
    if (!applied && completedUnchanged)
      return {
        state: null,
        persistence: { kind: "not-required" },
        diagnostics,
      };
    if (!applied)
      return {
        state: null,
        persistence: { kind: "not-required" },
        diagnostics,
        ...(failure
          ? { failure }
          : { rejected: rejected ?? "native-document-unchanged" }),
      };
    if (freshContext) sketchActions.reset();
    const accepted = state(liveRevisionId ?? applied.document.revisionId, applied.metadata.heads, freshContext);
    return {
      state: accepted,
      persistence: {
        kind: observed?.ok ? "committed" : "failed",
        commandId,
        transactionId: `transaction_${crypto.randomUUID()}`,
        state: accepted,
      },
      diagnostics,
      ...(failure ? { failure } : {}),
    };
  }
  return {
    async open({ commandId, path, currentState }) {
      let text: string;
      try {
        text = await files.read(path);
      } catch (error) {
        return {
          state: null,
          failure: "file",
          persistence: { kind: "not-required" },
          diagnostics: [semanticDiagnostic(error)],
        };
      }
      let document: unknown;
      try {
        document = JSON.parse(text);
      } catch (error) {
        return {
          state: null,
          rejected: "native-document-invalid",
          persistence: { kind: "not-required" },
          diagnostics: [semanticDiagnostic(error)],
        };
      }
      return mutate(commandId, currentState, true, (observe) =>
        service.importDocument({ document, observe }),
      );
    },
    async rename({ commandId, label, currentState }) {
      return mutate(commandId, currentState, false, (observe) =>
        service.renameDocument({ name: label, observe }),
      );
    },
    async save({ commandId, path, state: basis }) {
      let receipt: DocumentRepositoryMutationResult | null = null;
      let exported: Awaited<
        ReturnType<ModelingService["exportCurrentDocument"]>
      >;
      const transactionId = `transaction_${crypto.randomUUID()}`;
      let snapshot: Awaited<ReturnType<ModelingService["getCurrentDocumentSnapshot"]>>;
      try {
        exported = await service.exportCurrentDocument({
          observe: (observed) => {
            receipt = observed;
          },
        });
        snapshot = await service.getCurrentDocumentSnapshot();
        if (typeof exported.payload !== "string")
          throw new Error("Native document export must be JSON text.");
      } catch (error) {
        const observed = receipt as DocumentRepositoryMutationResult | null;
        return {
          file: { kind: "not-required" },
          persistence: observed
            ? {
                kind: observed.ok ? "committed" : "failed",
                commandId,
                transactionId,
                state: basis,
              }
            : { kind: "not-required" },
          ...(observed && !observed.ok
            ? {}
            : { failure: "execution" as const }),
          diagnostics: [semanticDiagnostic(error)],
        };
      }
      const observed = receipt as DocumentRepositoryMutationResult | null;
      if (
        !observed?.ok ||
        snapshot.document.revisionId !== basis.revisionId ||
        !snapshotRepresentsRepositoryDocument(snapshot, observed) ||
        JSON.stringify([...observed.metadata.heads].sort()) !==
          JSON.stringify([...basis.repositoryHeads].sort())
      ) {
        return {
          file: { kind: "not-required" },
          persistence: {
            kind: "failed",
            commandId,
            transactionId,
            state: basis,
          },
          diagnostics: [
            semanticDiagnostic(
              new Error(
                "Native save payload does not match the accepted repository basis.",
              ),
            ),
          ],
        };
      }
      const persistence = {
        kind: "committed" as const,
        commandId,
        transactionId,
        state: basis,
      };
      let written: Awaited<ReturnType<NativeDocumentFileIO["write"]>>;
      try {
        written = await files.write(path, exported.payload as string);
      } catch (error) {
        // No bytes were observed through a rejected port promise; this does not
        // certify an untouched file or erase the committed repository receipt.
        written = {
          kind: "failed",
          bytesWritten: 0,
          diagnostics: [semanticDiagnostic(error)],
        };
      }
      return {
        file: {
          kind: written.kind,
          commandId,
          state: basis,
          path,
          bytesWritten: written.bytesWritten,
        },
        persistence,
        diagnostics: [
          ...exported.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            detail: null,
          })),
          ...written.diagnostics,
        ],
      };
    },
  };
}
