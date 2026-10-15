import { semanticSketchesCurrent } from "./semantic-sketch-currentness";
import { requireDurableRef } from "@/contracts/shared/references.runtime-schema";
import type { SemanticDiscovery, SemanticFeatureLifecycleCommand } from "@/contracts/semantic/schema";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import { createSemanticResult, semanticDiagnostic } from "@/application/semantic/session";
import { getAppErrorContextValue, isModelingMutationError, modelingMutationErrorToDiagnostic } from "@/core/editor/state-machine/error-mapping";

/** Lifecycle changes use production mutation/rebuild owners, never author-history replay. */
export function createSemanticFeatureLifecyclePort(input: {
  service: ModelingService;
  loop: EditorEventLoop;
  inspect(input: { commandId: string }): Promise<{ discovery: SemanticDiscovery; diagnostics: readonly ModelingDiagnostic[] }>;
}) {
  return async (command: SemanticFeatureLifecycleCommand) => {
    const before = await input.inspect({ commandId: `${command.commandId}:before` });
    const terminal = createSemanticResult(command, before.discovery.state);
    if (input.loop.getState().kind !== "idle") return { ...terminal, outcome: { kind: "rejected" as const, reasonCode: "editing-context" } };
    let receipt: DocumentRepositoryMutationResult | undefined;
    const transactionId = `transaction_${crypto.randomUUID()}`;
    function observeApplied() {
      const observed = receipt as DocumentRepositoryMutationResult | undefined;
      const applied = observed?.ok ? observed : observed?.appliedLive;
      if (!applied) return;
      const state = { ...before.discovery.state, revisionId: applied.document.revisionId, repositoryHeads: [...applied.metadata.heads] };
      terminal.completion.live = { kind: "applied", state };
      terminal.completion.persistence = { kind: observed!.ok ? "committed" : "failed", commandId: command.commandId, transactionId, state };
    }
    try {
      const common = {
        baseRevisionId: command.basis.revisionId,
        baseRepositoryHeads: command.basis.repositoryHeads,
        observePersistence: (value: DocumentRepositoryMutationResult) => { receipt = value; },
      };
      const response = command.operation === "timeline.reorder"
        ? await input.service.reorderDocumentHistory({ ...common, item: command.item, beforeItem: command.beforeItem })
        : command.operation === "feature.reorder"
        ? await input.service.reorderFeature({ ...common, featureId: command.featureId, beforeFeatureId: command.beforeFeatureId })
        : command.operation === "timeline.cursor.set"
        ? await input.service.setFeatureCursor({ ...common, cursor: command.cursor })
        : command.operation === "target.delete"
        ? await input.service.deleteTarget({ ...common, target: command.target })
        : command.operation === "body.rename"
        ? await input.service.renameBody({ ...common, bodyId: command.bodyId, bodyLabel: command.label })
        : command.operation === "feature.delete"
          ? await input.service.deleteFeature({ ...common, featureId: command.featureId })
          : await input.service.setFeatureSuppression({ ...common, featureId: command.featureId, suppressed: command.suppressed });
      observeApplied();
      if (response.isErr()) {
        terminal.diagnostics = [modelingMutationErrorToDiagnostic(response.error)];
        if (terminal.completion.live.kind === "applied") throw new Error(response.error.message);
        const after = await input.inspect({ commandId: `${command.commandId}:refused` });
        terminal.discovery = after.discovery;
        terminal.completion.live = { kind: "unchanged", state: after.discovery.state };
        terminal.completion.handoff = { kind: "current", state: after.discovery.state };
        if (after.discovery.state.revisionId !== before.discovery.state.revisionId || [...after.discovery.state.repositoryHeads].sort().join("\0") !== [...before.discovery.state.repositoryHeads].sort().join("\0")) throw new Error(response.error.message);
        terminal.outcome = isModelingMutationError(response.error)
          ? getAppErrorContextValue(response.error, "revisionState") === "conflict"
            ? { kind: "conflicted", actualBasis: { documentId: after.discovery.state.documentId, revisionId: after.discovery.state.revisionId, repositoryHeads: after.discovery.state.repositoryHeads } }
            : { kind: "rejected", reasonCode: String(getAppErrorContextValue(response.error, "reasonCode") ?? response.error.code) }
          : { kind: "failed", failures: ["execution"] };
        return terminal;
      }
      const result = response.value;
      terminal.diagnostics = result.diagnostics;
      terminal.changedTargets = result.changedTargets.map(requireDurableRef);
      const after = await input.inspect({ commandId: `${command.commandId}:after` });
      terminal.discovery = after.discovery;
      terminal.completion.handoff = { kind: "current", state: after.discovery.state };
      if (result.revisionState.kind !== "accepted") {
        const { documentId, revisionId, repositoryHeads } = after.discovery.state;
        terminal.outcome = result.revisionState.kind === "conflict" ? { kind: "conflicted", actualBasis: { documentId, revisionId, repositoryHeads } } : { kind: "rejected", reasonCode: result.revisionState.reasonCode };
        return terminal;
      }
      if (terminal.completion.live.kind !== "applied") {
        terminal.completion.live = { kind: "applied", state: after.discovery.state };
        terminal.completion.persistence = { kind: "failed", commandId: command.commandId, transactionId, state: after.discovery.state };
      }
      const state = terminal.completion.live.state;
      if (after.discovery.state.revisionId !== result.revisionId || state.revisionId !== result.revisionId || [...after.discovery.state.repositoryHeads].sort().join("\0") !== [...state.repositoryHeads].sort().join("\0")) throw new Error("Lifecycle handoff does not match its exact accepted mutation.");
      terminal.diagnostics = [...terminal.diagnostics, ...after.diagnostics];
      const observed = receipt as DocumentRepositoryMutationResult | undefined;
      if (!observed?.ok) terminal.diagnostics = [...terminal.diagnostics, semanticDiagnostic(new Error(observed && !observed.ok ? observed.status.diagnostic.message : "Accepted lifecycle change has no exact repository write receipt."))];
      const valid = result.rebuildResult.kind === "rebuilt" && result.rebuildResult.revisionId === state.revisionId && semanticSketchesCurrent(input.loop.getState().snapshot, state.revisionId) && !after.diagnostics.some(d => d.severity === "error") && (after.discovery.model?.bodies.every(b => b.bounds !== null) ?? true);
      terminal.completion.geometry = { kind: valid ? "current" : command.intent === "author-invalid" ? "invalid-editable" : "failed", state, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: result.rebuildResult.kind === "skipped" ? null : result.rebuildResult.revisionId };
      const failures = [...(!observed?.ok ? ["persistence" as const] : []), ...(!valid && command.intent !== "author-invalid" ? ["geometry" as const] : [])];
      terminal.outcome = failures.length ? { kind: "failed", failures } : valid ? { kind: "completed", change: "changed" } : { kind: "accepted-invalid" };
      return terminal;
    } catch (error) {
      observeApplied();
      terminal.diagnostics = [...terminal.diagnostics, semanticDiagnostic(error)];
      terminal.discovery = null;
      terminal.completion.handoff = { kind: "failed" };
      try {
        const after = await input.inspect({ commandId: `${command.commandId}:failed` });
        const state = after.discovery.state;
        const observed = receipt as DocumentRepositoryMutationResult | undefined;
        const applied = observed?.ok ? observed : observed?.appliedLive;
        if (applied && (state.revisionId !== applied.document.revisionId || [...state.repositoryHeads].sort().join("\0") !== [...applied.metadata.heads].sort().join("\0"))) throw new Error("Failed lifecycle handoff does not match its exact applied receipt.");
        terminal.discovery = after.discovery;
        terminal.completion.handoff = { kind: "current", state };
        if (state.revisionId !== before.discovery.state.revisionId || [...state.repositoryHeads].sort().join("\0") !== [...before.discovery.state.repositoryHeads].sort().join("\0")) {
          terminal.completion.live = { kind: "applied", state };
          terminal.completion.persistence = { kind: observed?.ok ? "committed" : "failed", commandId: command.commandId, transactionId, state };
          terminal.completion.geometry = { kind: "failed", state, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: null };
        }
      } catch (handoffError) { terminal.diagnostics = [...terminal.diagnostics, semanticDiagnostic(handoffError)]; }
      terminal.outcome = { kind: "failed", failures: ["execution", ...(terminal.completion.handoff.kind === "failed" ? ["handoff" as const] : []), ...(terminal.completion.persistence.kind === "failed" ? ["persistence" as const] : []), ...(terminal.completion.geometry.kind === "failed" ? ["geometry" as const] : [])] };
      return terminal;
    }
  };
}
