import type { NativeDocumentFileIO } from "@/application/semantic/document-port";
import {
  createSemanticResult,
  semanticDiagnostic,
} from "@/application/semantic/session";
import type {
  SemanticDiscovery,
  SemanticExportCommand,
} from "@/contracts/semantic/schema";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { ModelingService } from "@/domain/modeling/modeling-service";

/** Existing service/provider owns target, revision and native STEP execution. */
export function createSemanticExportPort(input: {
  service: ModelingService;
  files: NativeDocumentFileIO;
  inspect(input: { commandId: string }): Promise<{
    discovery: SemanticDiscovery;
    diagnostics: readonly ModelingDiagnostic[];
  }>;
}) {
  return async (command: SemanticExportCommand) => {
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
        outcome: {
          kind: "conflicted" as const,
          actualBasis: {
            documentId: state.documentId,
            revisionId: state.revisionId,
            repositoryHeads: state.repositoryHeads,
          },
        },
      };
    // Semantic callers get the same closed options as the existing STEP writer.
    if (
      !["AP203", "AP214", "AP242"].includes(command.options.schema) ||
      command.options.unit !== "millimeter"
    )
      return {
        ...terminal,
        outcome: {
          kind: "rejected" as const,
          reasonCode: "invalid-step-options",
        },
      };
    const targetLabel =
      before.discovery.references.find(
        (reference) =>
          reference.target.kind === "body" &&
          command.target.kind === "body" &&
          reference.target.bodyId === command.target.bodyId,
      )?.label ?? "STEP export";
    try {
      const result = await input.service.exportDocument({
        baseRevisionId: command.basis.revisionId,
        target: command.target,
        targetLabel,
        format: "step",
        options: command.options,
      });
      terminal.diagnostics = result.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        detail: null,
      }));
      if (!result.ok) {
        terminal.outcome = {
          kind: "rejected",
          reasonCode: result.diagnostics[0]?.code ?? "step-export-failed",
        };
        return terminal;
      }
      terminal.discovery = before.discovery;
      terminal.completion.handoff = { kind: "current", state };
      terminal.completion.geometry = {
        kind: "current",
        state,
        sketchBasis: null,
        solve: null,
        derivation: null,
        rebuildRevisionId: state.revisionId,
      };
      // Payload basis was certified by the provider, not by a later live snapshot.
      const text =
        typeof result.payload === "string"
          ? result.payload
          : new TextDecoder("utf8", { fatal: true }).decode(result.payload);
      let file: Awaited<ReturnType<NativeDocumentFileIO["write"]>>;
      try {
        file = await input.files.write(command.path, text);
      } catch (error) {
        // A rejected adapter promise gives no observed byte count; do not infer
        // that the file is untouched or erase the provider's geometry result.
        file = {
          kind: "failed",
          bytesWritten: 0,
          diagnostics: [semanticDiagnostic(error)],
        };
      }
      terminal.completion.file = {
        kind: file.kind,
        commandId: command.commandId,
        path: command.path,
        bytesWritten: file.bytesWritten,
        state,
      };
      terminal.diagnostics = [...terminal.diagnostics, ...file.diagnostics];
      terminal.outcome =
        file.kind === "written"
          ? { kind: "completed", change: "unchanged" }
          : { kind: "failed", failures: ["file"] };
      return terminal;
    } catch (error) {
      terminal.diagnostics = [
        ...terminal.diagnostics,
        semanticDiagnostic(error),
      ];
      terminal.outcome = { kind: "failed", failures: ["execution"] };
      return terminal;
    }
  };
}
