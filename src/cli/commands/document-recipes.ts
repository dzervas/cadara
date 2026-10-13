import { readFile } from "node:fs/promises";
import type { CommandModule } from "@/cli/types";
import type {
  SemanticCommand,
  SemanticDraftBasis,
  SemanticDiscovery,
  SemanticResult,
} from "@/contracts/semantic/schema";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";

import { semanticCommandCorrelation } from "@/contracts/semantic/correlation";

type Alias = { alias: string };
type TargetAlias = Alias & { label: string };
type RecipeCommand<T = SemanticCommand> = T extends SemanticCommand
  ? Omit<T, "basis" | "draft" | "points" | "dimensionId"> &
    (T extends { points: infer P } ? { points: P | readonly [TargetAlias, TargetAlias] } : unknown) &
    (T extends { dimensionId: infer D } ? { dimensionId: D | TargetAlias } : unknown) & { basis: T["basis"] | Alias } & (T extends {
        draft: SemanticDraftBasis;
      }
        ? { draft: SemanticDraftBasis | Alias }
        : unknown)
  : never;
interface RecipeOperation {
  command: RecipeCommand;
  alias?: string;
}
function isAlias(value: unknown): value is Alias {
  return !!value && typeof value === "object" && "alias" in value;
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
      commandId: "begin",
      operation: "sketch.begin",
      basis: { alias: "part" },
      plane: "xy",
      as: "draft",
    },
    {
      version: 1,
      commandId: "rectangle",
      operation: "sketch.author",
      basis: { alias: "draft" },
      draft: { alias: "draft" },
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
      as: "rectangle",
    },
    {
      version: 1,
      commandId: "publish",
      operation: "sketch.publish",
      basis: { alias: "rectangle" },
      draft: { alias: "rectangle" },
      requireProfiles: true,
      as: "published",
    },
    {
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Renamed bracket",
      basis: { alias: "published" },
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
    const validationCommand = { ...command };
    for (const key of ["basis", "draft"] as const) {
      const value = command[key];
      if (!isAlias(value)) continue;
      if (
        Object.keys(value).length !== 1 ||
        typeof value.alias !== "string" ||
        !aliases.has(value.alias)
      )
        throw new Error(key === "basis" ? "Unknown or ambiguous document alias." : "Unknown or ambiguous draft alias.");
      validationCommand[key] =
        key === "basis"
          ? {
              documentId: "doc_validation",
              revisionId: "rev_validation",
              repositoryHeads: [],
            }
          : { commandSessionId: "command_validation", generation: 1 };
    }
    function validateTarget(value: unknown, placeholder: string) {
      if (!isAlias(value)) return value;
      if (Object.keys(value).length !== 2 || typeof value.alias !== "string" || !aliases.has(value.alias) || !("label" in value) || typeof value.label !== "string" || !value.label)
        throw new Error("Unknown or ambiguous target alias.");
      return placeholder;
    }
    if (Array.isArray(command.points)) validationCommand.points = command.points.map(value => validateTarget(value, "sketch_point_validation"));
    if ("dimensionId" in command) validationCommand.dimensionId = validateTarget(command.dimensionId, "dimension_validation");
    if (!validateSemanticCommand(validationCommand).success)
      throw new Error("Invalid semantic operation.");
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
    "Run a sequential document/sketch JSON recipe in an isolated document",
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
    const aliases = new Map<string, SemanticDiscovery>();
    let succeeded = true;
    try {
      for (const operation of operations) {
        const command = { ...operation.command };
        if (isAlias(command.basis)) {
          const state = aliases.get(command.basis.alias)?.state;
          if (!state)
            throw new Error("Alias has no completed authoritative state.");
          const { documentId, revisionId, repositoryHeads } = state;
          command.basis = { documentId, revisionId, repositoryHeads };
        }
        if ("draft" in command && isAlias(command.draft)) {
          const draft = aliases.get(command.draft.alias)?.state.draft;
          if (!draft) throw new Error("Alias has no current private draft.");
          command.draft = draft;
        }
        if (command.operation === "sketch.dimension.add") {
          const resolvePoint = (value: typeof command.points[number]) => {
            if (!isAlias(value)) return value;
            const matches = aliases.get(value.alias)?.references.filter(r => r.label === value.label && r.target.kind === "sketchPoint") ?? [];
            if (matches.length !== 1 || matches[0]!.target.kind !== "sketchPoint") throw new Error("Point target alias is missing or ambiguous.");
            return matches[0]!.target.pointId;
          };
          command.points = [resolvePoint(command.points[0]), resolvePoint(command.points[1])];
        }
        if (command.operation === "sketch.dimension.update" && isAlias(command.dimensionId)) {
          const target = command.dimensionId;
          const sketch = aliases.get(target.alias)?.sketch;
          const matches = [...(sketch?.requirements ?? []), ...(sketch?.measurements ?? [])].filter(d => d.label === target.label);
          if (matches.length !== 1) throw new Error("Dimension target alias is missing or ambiguous.");
          command.dimensionId = matches[0]!.dimensionId;
        }
        const validated = validateSemanticCommand(command);
        if (!validated.success)
          throw new Error("Resolved operation is invalid.");
        const terminal = await opened.session.execute(validated.data);
        const checked = validateSemanticResult(
          semanticCommandCorrelation(validated.data),
          terminal,
        );
        if (!checked.success)
          throw new Error(
            "Application returned an invalid completion certificate.",
          );
        results.push(terminal);
        if (
          terminal.outcome.kind !== "completed" &&
          terminal.outcome.kind !== "accepted-invalid"
        ) {
          succeeded = false;
          break;
        }
        if (operation.alias && terminal.discovery) {
          aliases.set(operation.alias, terminal.discovery);
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
