import { readFile } from "node:fs/promises";
import type { CommandModule } from "@/cli/types";
import type {
  SemanticBasis,
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";

type AliasedCommand<T> = T extends { basis: SemanticBasis }
  ? Omit<T, "basis"> & { basis: { alias: string } }
  : never;
interface RecipeOperation {
  command: SemanticCommand | AliasedCommand<SemanticCommand>;
  alias?: string;
}
const example = {
  version: 1,
  operations: [
    {
      version: 1,
      commandId: "create",
      operation: "document.create",
      label: "Bracket",
      basis: null,
      as: "part",
    },
    {
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Renamed bracket",
      basis: { alias: "part" },
      as: "renamed",
    },
    {
      version: 1,
      commandId: "save",
      operation: "document.save",
      path: "bracket.cadara",
      basis: { alias: "renamed" },
    },
    {
      version: 1,
      commandId: "open",
      operation: "document.open",
      path: "bracket.cadara",
      basis: null,
      as: "opened",
    },
    {
      version: 1,
      commandId: "inspect",
      operation: "document.inspect",
      basis: { alias: "opened" },
    },
  ],
};
function parseRecipe(input: unknown): RecipeOperation[] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Recipe must be an object.");
  const recipe = input as Record<string, unknown>;
  if (
    Object.keys(recipe).some(
      (key) => !["version", "operations"].includes(key),
    ) ||
    recipe.version !== 1 ||
    !Array.isArray(recipe.operations) ||
    !recipe.operations.length
  )
    throw new Error("Expected version:1 and nonempty operations.");
  const ids = new Set<string>();
  const aliases = new Set<string>();
  return recipe.operations.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Operation must be an object.");
    const { as: alias, ...command } = value as Record<string, unknown>;
    if (
      alias !== undefined &&
      (typeof alias !== "string" || !alias || aliases.has(alias))
    )
      throw new Error("Aliases must be nonempty and unique.");
    if (
      typeof command.commandId !== "string" ||
      !command.commandId ||
      ids.has(command.commandId)
    )
      throw new Error("Command IDs must be nonempty and unique.");
    ids.add(command.commandId);
    const basis = command.basis;
    if (basis && typeof basis === "object" && "alias" in basis) {
      if (
        Object.keys(basis).length !== 1 ||
        typeof basis.alias !== "string" ||
        !aliases.has(basis.alias)
      )
        throw new Error("Unknown or ambiguous document alias.");
      const validated = validateSemanticCommand({
        ...command,
        basis: {
          documentId: "doc_validation",
          revisionId: "rev_validation",
          repositoryHeads: [],
        },
      });
      if (!validated.success) throw new Error("Invalid inspect operation.");
    } else if (!validateSemanticCommand(command).success)
      throw new Error("Invalid semantic operation.");
    if (
      alias !== undefined &&
      !["document.create", "document.open", "document.rename"].includes(
        String(command.operation),
      )
    )
      throw new Error(
        "Only document creation, opening or rename defines an alias.",
      );
    if (typeof alias === "string") aliases.add(alias);
    return {
      command: command as RecipeOperation["command"],
      ...(typeof alias === "string" ? { alias } : {}),
    };
  });
}
export const documentRecipesCommand: CommandModule = {
  name: "document recipe",
  description:
    "Run sequential native document operations in an isolated editing context",
  async run(argv, _env, io) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) {
      io.stdout(
        `Usage: cadara document recipe <recipe.json>\n${JSON.stringify(example, null, 2)}\n`,
      );
      return { ok: true };
    }
    if (argv.length !== 1)
      return {
        ok: false,
        kind: "usage",
        message: "Usage: cadara document recipe <recipe.json>",
      };
    let operations: RecipeOperation[];
    try {
      operations = parseRecipe(JSON.parse(await readFile(argv[0]!, "utf8")));
    } catch (error) {
      return {
        ok: false,
        kind: "usage",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    // Capture/help/invalid-input paths never acquire a model or load WASM.
    const { createHeadlessSessionFactory } =
      await import("@/composition/headless");
    const opened = await createHeadlessSessionFactory().open();
    if (opened.kind !== "ready") {
      io.stdout(
        JSON.stringify({ version: 1, initialization: opened, results: [] }) +
          "\n",
      );
      return {
        ok: false,
        kind: "failure",
        message: "Document initialization failed.",
      };
    }
    const results: SemanticResult[] = [];
    const aliases = new Map<string, SemanticBasis>();
    let succeeded = true;
    try {
      for (const operation of operations) {
        let command = operation.command;
        if (command.basis && "alias" in command.basis) {
          const basis = aliases.get(command.basis.alias);
          if (!basis)
            throw new Error("Alias has no completed authoritative state.");
          command = { ...command, basis };
        }
        const validated = validateSemanticCommand(command);
        if (!validated.success)
          throw new Error("Resolved operation is invalid.");
        const terminal = await opened.session.execute(validated.data);
        const checked = validateSemanticResult(
          {
            commandId: validated.data.commandId,
            family:
              validated.data.operation === "document.open"
                ? "file-open"
                : validated.data.operation === "document.save"
                  ? "file-save"
                  : "document",
            intent:
              validated.data.operation === "document.inspect"
                ? "inspect"
                : "fulfill",
            basis: validated.data.basis,
          },
          terminal,
        );
        if (!checked.success)
          throw new Error(
            "Application returned an invalid completion certificate.",
          );
        results.push(terminal);
        if (terminal.outcome.kind !== "completed") {
          succeeded = false;
          break;
        }
        if (operation.alias && terminal.discovery) {
          const { documentId, revisionId, repositoryHeads } =
            terminal.discovery.state;
          aliases.set(operation.alias, {
            documentId,
            revisionId,
            repositoryHeads,
          });
        }
      }
    } finally {
      const cleanup = await opened.session.close();
      succeeded &&= cleanup.kind === "closed";
      io.stdout(
        JSON.stringify({
          version: 1,
          results,
          unexecuted: operations
            .slice(results.length)
            .map((operation) => operation.command.commandId),
          cleanup,
        }) + "\n",
      );
    }
    return succeeded
      ? { ok: true }
      : {
          ok: false,
          kind: "failure",
          message: "Recipe failed; prior completed operations are retained.",
        };
  },
};
