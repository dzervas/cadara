import type { SemanticCommand, SemanticCorrelation } from "./schema";

/** Both clients and application validation use the requested intent, never the returned envelope. */
export function semanticCommandCorrelation(
  command: SemanticCommand,
): SemanticCorrelation {
  return {
    commandId: command.commandId,
    family:
      command.operation === "sketch.begin"
        ? "sketch-open"
        : command.operation === "sketch.publish"
          ? "sketch-publish"
          : command.operation === "sketch.discard"
            ? "sketch-discard"
            : command.operation.startsWith("sketch.")
              ? "sketch-author"
              : command.operation === "document.open"
                ? "file-open"
                : command.operation === "document.save"
                  ? "file-save"
                  : "document",
    intent: command.operation.endsWith("inspect")
      ? "inspect"
      : command.operation === "sketch.author"
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
