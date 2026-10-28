import { semanticSketchesCurrent } from "./semantic-sketch-currentness";
import type { SemanticDiscovery, SemanticVariableCommand, SemanticState } from "@/contracts/semantic/schema";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentRepositoryMutationResult } from "@/contracts/modeling/document-repository";
import type { ModelingService } from "@/application/modeling/modeling-service";
import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import { createSemanticResult, semanticDiagnostic } from "@/application/semantic/session";
import { getAppErrorContextValue, isModelingMutationError, modelingMutationErrorToDiagnostic } from "@/core/editor/state-machine/error-mapping";

/** Variable validation and dependent rebuild remain the shared production service's job. */
export function createSemanticVariablePort(input: {
  service: ModelingService;
  loop: EditorEventLoop;
  inspect(input: { commandId: string }): Promise<{ discovery: SemanticDiscovery; diagnostics: readonly ModelingDiagnostic[] }>;
}) {
  return async (command: SemanticVariableCommand) => {
    const before = await input.inspect({ commandId: `${command.commandId}:before` });
    const terminal = createSemanticResult(command, before.discovery.state);
    if (input.loop.getState().kind !== "idle") return { ...terminal, outcome: { kind: "rejected" as const, reasonCode: "editing-context" } };
    let receipt: DocumentRepositoryMutationResult | undefined;
    const transactionId = `transaction_${crypto.randomUUID()}`;
    function observeApplied() {
      const observed = receipt as DocumentRepositoryMutationResult | undefined;
      const applied = observed?.ok ? observed : observed?.appliedLive;
      if (!applied) return;
      const state: SemanticState = { ...before.discovery.state, revisionId: applied.document.revisionId, repositoryHeads: [...applied.metadata.heads] };
      terminal.completion.live = { kind: "applied", state };
      terminal.completion.persistence = { kind: observed!.ok ? "committed" : "failed", commandId: command.commandId, transactionId, state };
    }
    try {
      const common: Parameters<ModelingService["addDocumentVariable"]>[0] = {
        baseRevisionId: command.basis.revisionId,
        baseRepositoryHeads: command.basis.repositoryHeads,
        name: command.name,
        valueText: command.valueText,
        observePersistence: (value: DocumentRepositoryMutationResult) => { receipt = value; },
      };
      const response = command.operation === "variable.add"
        ? await input.service.addDocumentVariable(common)
        : await input.service.updateDocumentVariable({ ...common, variableId: command.variableId });
      observeApplied();
      if (response.isErr()) {
        terminal.diagnostics = [modelingMutationErrorToDiagnostic(response.error)];
        // A boundary error is a refusal only if the exact transaction did not apply.
        if (terminal.completion.live.kind === "applied") throw new Error(response.error.message);
        const after = await input.inspect({ commandId: `${command.commandId}:refused` });
        terminal.discovery = after.discovery;
        terminal.completion.live = { kind: "unchanged", state: after.discovery.state };
        terminal.completion.handoff = { kind: "current", state: after.discovery.state };
        const changed = after.discovery.state.revisionId !== before.discovery.state.revisionId ||
          [...after.discovery.state.repositoryHeads].sort().join("\0") !== [...before.discovery.state.repositoryHeads].sort().join("\0");
        if (changed) {
          // A thrown repository write can leave the runtime applied without a receipt.
          // Observe that state, but never infer repository commitment or a completed rebuild.
          const state = after.discovery.state;
          terminal.completion.live = { kind: "applied", state };
          terminal.completion.persistence = { kind: "failed", commandId: command.commandId, transactionId, state };
          terminal.completion.geometry = { kind: "failed", state, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: null };
          terminal.outcome = { kind: "failed", failures: ["execution", "persistence", "geometry"] };
          return terminal;
        }
        terminal.outcome = isModelingMutationError(response.error)
          ? getAppErrorContextValue(response.error, "revisionState") === "conflict"
            ? { kind: "conflicted", actualBasis: { documentId: after.discovery.state.documentId, revisionId: after.discovery.state.revisionId, repositoryHeads: after.discovery.state.repositoryHeads } }
            : { kind: "rejected", reasonCode: String(getAppErrorContextValue(response.error, "reasonCode") ?? response.error.code) }
          : { kind: "failed", failures: ["execution"] };
        return terminal;
      }
      const result = response.value;
      terminal.diagnostics = result.diagnostics;
      if (result.revisionState.kind !== "accepted") {
        terminal.outcome = result.revisionState.kind === "conflict"
          ? { kind: "conflicted", actualBasis: { documentId: before.discovery.state.documentId, revisionId: result.revisionState.actualRevisionId, repositoryHeads: before.discovery.state.repositoryHeads } }
          : { kind: "rejected", reasonCode: result.revisionState.reasonCode };
        return terminal;
      }
      const after = await input.inspect({ commandId: `${command.commandId}:after` });
      const observed = receipt as DocumentRepositoryMutationResult | undefined;
      // Accepted live revision is still real when the exact repository receipt is absent.
      if (terminal.completion.live.kind !== "applied") {
        terminal.completion.live = { kind: "applied", state: { ...before.discovery.state, revisionId: result.revisionId } };
        terminal.completion.persistence = { kind: "failed", commandId: command.commandId, transactionId, state: terminal.completion.live.state };
      }
      const state = terminal.completion.live.state;
      if (after.discovery.state.revisionId !== state.revisionId || [...after.discovery.state.repositoryHeads].sort().join("\0") !== [...state.repositoryHeads].sort().join("\0")) throw new Error("Variable handoff does not match the exact accepted mutation.");
      terminal.discovery = after.discovery;
      terminal.completion.handoff = { kind: "current", state };
      terminal.diagnostics = [...terminal.diagnostics, ...after.diagnostics];
      if (!observed?.ok) terminal.diagnostics = [...terminal.diagnostics, semanticDiagnostic(new Error(observed && !observed.ok ? observed.status.diagnostic.message : "Accepted variable has no exact repository write receipt."))];
      const snapshot = input.loop.getState().snapshot;
      const sketchesCurrent = semanticSketchesCurrent(snapshot, state.revisionId);
      const valid = result.rebuildResult.kind === "rebuilt" && result.rebuildResult.revisionId === state.revisionId && sketchesCurrent && !after.diagnostics.some(d => d.severity === "error") && (after.discovery.model?.bodies.every(b => b.bounds !== null) ?? true);
      if (!valid) terminal.diagnostics = [...terminal.diagnostics, semanticDiagnostic(new Error("Variable rebuild did not establish current sketch and solid geometry."))];
      terminal.completion.geometry = { kind: valid ? "current" : command.intent === "author-invalid" ? "invalid-editable" : "failed", state, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: result.rebuildResult.kind === "skipped" ? null : result.rebuildResult.revisionId };
      const failures = [...(!observed?.ok ? ["persistence" as const] : []), ...(!valid && command.intent !== "author-invalid" ? ["geometry" as const] : [])];
      terminal.outcome = failures.length ? { kind: "failed", failures } : valid ? { kind: "completed", change: "changed" } : { kind: "accepted-invalid" };
      return terminal;
    } catch (error) {
      observeApplied();
      terminal.diagnostics = [...terminal.diagnostics, semanticDiagnostic(error)];
      terminal.discovery = null;
      terminal.completion.handoff = { kind: "failed" };
      terminal.outcome = { kind: "failed", failures: ["execution", "handoff", ...(terminal.completion.persistence.kind === "failed" ? ["persistence" as const] : []), ...(terminal.completion.geometry.kind === "failed" ? ["geometry" as const] : [])] };
      return terminal;
    }
  };
}
