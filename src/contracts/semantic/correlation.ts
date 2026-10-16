import type { SemanticCommand, SemanticCorrelation } from "./schema";

/** Both clients and application validation use the requested intent, never the returned envelope. */
export function semanticCommandCorrelation(
  command: SemanticCommand,
): SemanticCorrelation {
  return {
    commandId: command.commandId,
    family:
      (command.operation === "sketch.begin" || command.operation === "sketch.open")
        ? "sketch-open"
        : command.operation === "sketch.support.reassign"
          ? "model-mutate"
        : command.operation === "sketch.publish"
          ? "sketch-publish"
          : command.operation === "sketch.discard"
            ? "sketch-discard"
            : command.operation.startsWith("sketch.")
              ? "sketch-author"
              : command.operation.startsWith("history.")
                ? "history"
              : (command.operation.startsWith("timeline.") || command.operation === "target.delete" || command.operation === "body.rename" || command.operation.startsWith("feature.") || command.operation.startsWith("extrude.") || command.operation.startsWith("revolve.") || command.operation.startsWith("plane.") || command.operation.startsWith("fillet.") || command.operation.startsWith("chamfer.") || command.operation.startsWith("shell.") || command.operation.startsWith("thicken.") || command.operation.startsWith("hole.") || (command.operation.startsWith("sweep.") || command.operation.startsWith("loft.") || command.operation.startsWith("combine.") || command.operation.startsWith("split.") || command.operation.startsWith("deleteSolid.") || command.operation.startsWith("mirror.") || command.operation.startsWith("transform.") || command.operation.startsWith("linearPattern.") || command.operation.startsWith("circularPattern.")) || command.operation.startsWith("variable."))
                ? "model-mutate"
              : command.operation.startsWith("export.")
                ? "export"
              : command.operation === "document.open"
                ? "file-open"
                : command.operation === "document.save"
                  ? "file-save"
                  : "document",
    intent: command.operation.endsWith("inspect")
      ? "inspect"
      : "intent" in command
        ? command.intent
        : "fulfill",
    basis: command.basis
      ? {
          documentId: command.basis.documentId,
          revisionId: command.basis.revisionId,
          repositoryHeads: command.basis.repositoryHeads,
        }
      : null,
  };
}
