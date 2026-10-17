import {
  HistoryOperationError,
  createAuthoredHistoryOperation,
  type HistoryCompensationReceipt,
} from "@/application/history/authored-history";
import { createDurableHistoryService } from "@/application/history/durable-history";
import {
  createSemanticResult,
  semanticDiagnostic,
} from "@/application/semantic/session";
import type {
  SemanticDiscovery,
  SemanticHistoryCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import type { DocumentRepository } from "@/domain/modeling/document-repository";
import type { ModelingService } from "@/domain/modeling/modeling-service";

export function createSemanticHistoryPort(input: {
  repository: DocumentRepository;
  service: ModelingService;
  loop: EditorEventLoop;
  sketch(command: SemanticHistoryCommand): Promise<SemanticResult>;
  inspect(input: {
    commandId: string;
  }): Promise<{
    discovery: SemanticDiscovery;
    diagnostics: readonly ModelingDiagnostic[];
  }>;
}) {
  const documentHistory = createDurableHistoryService({
    documentRepository: input.repository,
    modelingService: input.service,
  });
  return async (command: SemanticHistoryCommand): Promise<SemanticResult> => {
    const before = await input.inspect({
      commandId: `${command.commandId}:before`,
    });
    const state = before.discovery.state;
    const terminal = createSemanticResult(command, state);
    if (
      command.basis.documentId !== state.documentId ||
      command.basis.revisionId !== state.revisionId ||
      [...command.basis.repositoryHeads].sort().join("\0") !==
        [...state.repositoryHeads].sort().join("\0")
    )
      return {
        ...terminal,
        outcome: { kind: "conflicted", actualBasis: state },
      };
    if (
      (command.draft === null) !== (state.draft === null) ||
      (command.draft &&
        (command.draft.commandSessionId !== state.draft?.commandSessionId ||
          command.draft.generation !== state.draft.generation))
    )
      return {
        ...terminal,
        outcome: { kind: "rejected", reasonCode: "editing-context" },
      };
    if (command.operation === "history.inspect" && state.draft)
      return input.sketch(command);
    let privateResult: SemanticResult | undefined;
    let compensation: HistoryCompensationReceipt | undefined;
    function retainCompensation(receipt: HistoryCompensationReceipt) {
      compensation = receipt;
      const accepted =
        receipt.document && receipt.metadata
          ? {
              ...state,
              revisionId: receipt.liveRevisionId ?? receipt.document.revisionId,
              repositoryHeads: [...receipt.metadata.heads],
            }
          : state;
      terminal.completion.live = {
        kind: receipt.document ? "applied" : "unchanged",
        state: accepted,
      };
      terminal.completion.persistence = {
        kind: receipt.kind,
        commandId: command.commandId,
        transactionId: `history_${command.commandId}`,
        state: accepted,
      };
    }
    async function refresh(changed: boolean) {
      const current = await input.inspect({
        commandId: `${command.commandId}:after`,
      });
      if (
        compensation?.document &&
        ((compensation.liveRevisionId ?? compensation.document.revisionId) !==
          current.discovery.state.revisionId ||
          [...compensation.metadata!.heads].sort().join("\0") !==
            [...current.discovery.state.repositoryHeads].sort().join("\0"))
      )
        throw new Error(
          "History inspection does not match the exact compensation.",
        );
      terminal.discovery = current.discovery;
      terminal.diagnostics = current.diagnostics;
      terminal.completion.live = {
        kind: changed ? "applied" : "unchanged",
        state: current.discovery.state,
      };
      terminal.completion.handoff = {
        kind: "current",
        state: current.discovery.state,
      };
      terminal.completion.geometry = {
        kind: current.diagnostics.some((d) => d.severity === "error")
          ? command.operation === "history.inspect"
            ? "invalid-editable"
            : "failed"
          : "current",
        state: current.discovery.state,
        sketchBasis: null,
        solve: null,
        derivation: null,
        rebuildRevisionId: current.discovery.state.revisionId,
      };
      // The committed receipt was captured before inspection; no global tail inference.
      const failures = [
        ...(terminal.completion.geometry.kind === "failed"
          ? ["geometry" as const]
          : []),
        ...(terminal.completion.persistence.kind === "failed"
          ? ["persistence" as const]
          : []),
      ];
      terminal.outcome = failures.length
        ? { kind: "failed", failures }
        : { kind: "completed", change: changed ? "changed" : "unchanged" };
    }
    const operation = createAuthoredHistoryOperation({
      documentHistory,
      getContext: () => {
        const editor = input.loop.getState();
        return editor.kind === "editingSketch"
          ? { kind: "sketch" }
          : editor.snapshot
            ? {
                kind: "document",
                documentId: editor.snapshot.document.documentId,
                revisionId: editor.snapshot.document.revisionId,
              }
            : null;
      },
      privateHistory: async () => {
        privateResult = await input.sketch(command);
      },
      handoff: async (snapshot, commandId) => {
        const events = await input.loop.dispatchAndSettle(commandId, {
          type: "document.replaced",
          snapshot,
        });
        if (events.some((e) => e.type.endsWith("Failed")))
          throw new Error("History editor handoff failed.");
      },
    });
    try {
      const result =
        command.operation === "history.inspect"
          ? null
          : await operation.execute({
              commandId: command.commandId,
              direction: command.operation === "history.undo" ? "undo" : "redo",
              actionSequence: command.actionSequence,
            });
      if (privateResult) return privateResult;
      if (!result && command.operation !== "history.inspect")
        return {
          ...terminal,
          outcome: { kind: "unavailable", capability: command.operation },
        };
      if (result?.context === "document" && result.compensation)
        retainCompensation(result.compensation);
      await refresh(!!result);
      return terminal;
    } catch (error) {
      if (
        error instanceof HistoryOperationError &&
        error.compensation?.document === null
      ) {
        const reason = error.compensation.failureReason;
        if (
          reason &&
          [
            "identity-mismatch",
            "context-missing",
            "expected-state-changed",
            "dependent-record-changed",
            "later-action-overlap",
            "action-not-found",
          ].includes(reason)
        )
          return {
            ...terminal,
            outcome:
              reason === "action-not-found"
                ? { kind: "rejected", reasonCode: reason }
                : { kind: "conflicted", actualBasis: state },
            diagnostics: [semanticDiagnostic(error)],
          };
      }
      if (error instanceof HistoryOperationError && error.compensation) {
        retainCompensation(error.compensation);
        if (error.compensation.kind === "failed" && error.snapshot) {
          try {
            await refresh(!!error.compensation.document);
            terminal.diagnostics = [
              ...terminal.diagnostics,
              semanticDiagnostic(error),
            ];
            return terminal;
          } catch (handoffError) {
            terminal.diagnostics = [
              ...terminal.diagnostics,
              semanticDiagnostic(handoffError),
            ];
          }
        }
      }
      return {
        ...terminal,
        outcome: {
          kind: "failed",
          failures: [
            "execution",
            "handoff",
            ...(terminal.completion.persistence.kind === "failed"
              ? ["persistence" as const]
              : []),
          ],
        },
        completion: { ...terminal.completion, handoff: { kind: "failed" } },
        diagnostics: [...terminal.diagnostics, semanticDiagnostic(error)],
      };
    }
  };
}
