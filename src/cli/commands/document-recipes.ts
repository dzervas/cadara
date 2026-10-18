import { readFile } from "node:fs/promises";
import type { CommandModule } from "@/cli/types";
import type {
  SemanticDiscovery,
  SemanticResult,
} from "@/contracts/semantic/schema";
import {
  validateSemanticCommand,
} from "@/contracts/semantic/runtime-schema";

import { SemanticDocument } from "@/application/semantic/sdk";
import {
  isDiscoveryAlias as isAlias,
  type SelectableCommand as RecipeCommand,
} from "@/application/semantic/target-inputs";
import { SelectionError } from "@/application/semantic/selection-error";
import {
  contractSchemaAt,
  recipeCatalog,
  recipeLengthUnit,
  recipeOperationCatalog,
  recipeOperationNames,
  suggestOperations,
  summarizeSchema,
} from "@/cli/commands/recipe-catalog";
import {
  invalidRecipe,
  pathOf,
  RecipeError,
  recipeError,
  type RecipeCliError,
} from "@/cli/commands/recipe-diagnostics";

import {
  compactInitializationOutput,
  compactRecipeOutput,
  type CompactRecipeOutput,
} from "@/cli/commands/compact-output";
import { validateCompactRecipeOutput } from "@/cli/commands/compact-output.runtime-schema";

interface RecipeOperation {
  command: RecipeCommand;
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
      commandId: "extrude",
      operation: "extrude.create",
      basis: { alias: "published" },
      profile: { alias: "published", label: "Outer region" },
      depth: 7,
      intent: "fulfill",
      as: "solid",
    },
    {
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Renamed bracket",
      basis: { alias: "solid" },
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
/** `position.index` tracks the operation being parsed, to locate preflight errors. */
function parseRecipe(input: unknown, position: { index: number }): RecipeOperation[] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalidRecipe("Recipe must be an object.", { path: "" });
  const recipe = input as Record<string, unknown>;
  if (
    Object.keys(recipe).some(
      (key) => !["version", "operations"].includes(key),
    ) ||
    recipe.version !== 1 ||
    !Array.isArray(recipe.operations) ||
    !recipe.operations.length
  )
    throw invalidRecipe("Expected version:1 and nonempty operations.", { path: "" });
  const ids = new Set<string>();
  const aliases = new Set<string>();
  return recipe.operations.map((value: unknown, index: number) => {
    position.index = index;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalidRecipe("Operation must be an object.", { path: "" });
    const { as: alias, ...command } = value as Record<string, unknown>;
    if (
      alias !== undefined &&
      (typeof alias !== "string" || !alias || aliases.has(alias))
    )
      throw invalidRecipe("Aliases must be nonempty and unique.", { path: "as", knownAliases: [...aliases] });
    if (
      typeof command.commandId !== "string" ||
      !command.commandId ||
      ids.has(command.commandId)
    )
      throw invalidRecipe("Command IDs must be nonempty and unique.", { path: "commandId" });
    ids.add(command.commandId);
    if (typeof command.operation !== "string" || !recipeOperationNames.includes(command.operation))
      throw recipeError("unknown-operation", "preflight", `Unknown operation ${JSON.stringify(command.operation)}.`, {
        path: "operation",
        suggestions: typeof command.operation === "string" ? suggestOperations(command.operation) : [],
        help: "cadara document recipe --schema",
      });
    const validationCommand = { ...command };
    for (const key of ["basis", "draft"] as const) {
      const value = command[key];
      if (!isAlias(value)) continue;
      if (
        Object.keys(value).length !== 1 ||
        typeof value.alias !== "string" ||
        !aliases.has(value.alias)
      )
        throw invalidRecipe(key === "basis" ? "Unknown or ambiguous document alias." : "Unknown or ambiguous draft alias.", { path: key, selector: value, knownAliases: [...aliases] });
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
      if (Object.keys(value).length !== ("sketch" in value ? 3 : 2) || ("sketch" in value && (typeof value.sketch !== "string" || !aliases.has(value.sketch))) || typeof value.alias !== "string" || !aliases.has(value.alias) || !("label" in value) || typeof value.label !== "string" || !value.label)
        throw invalidRecipe("Unknown or ambiguous target alias.", { selector: value, knownAliases: [...aliases] });
      return placeholder;
    }
    if ((command.operation === "featureReplay.create" || command.operation === "featureReplay.update") && command.parameters && typeof command.parameters === "object") {
      const parameters = command.parameters as Record<string, unknown>;
      const transform = parameters.transform;
      const normalizedTransform = transform && typeof transform === "object" ? { ...transform } as Record<string, unknown> : null;
      if (normalizedTransform) {
        for (const key of ["direction", "plane"] as const) if (isAlias(normalizedTransform[key])) {
          validateTarget(normalizedTransform[key], "construction_validation");
          normalizedTransform[key] = { kind: "construction", constructionId: "construction_validation" };
        }
      }
      validationCommand.parameters = {
        ...parameters,
        ...(Array.isArray(parameters.sourceFeatureIds) ? { sourceFeatureIds: parameters.sourceFeatureIds.map(value => validateTarget(value, "feature_validation")) } : {}),
        transform: normalizedTransform,
      };
    }
    if (Array.isArray(command.points)) validationCommand.points = command.points.map(value => validateTarget(value, "sketch_point_validation"));
    if ("dimensionId" in command) validationCommand.dimensionId = validateTarget(command.dimensionId, "dimension_validation");
    if ("derivationId" in command) validationCommand.derivationId = validateTarget(command.derivationId, "derivation_validation");
    for (const [key, placeholder] of [["featureId", "feature_validation"], ["beforeFeatureId", "feature_validation"], ["bodyId", "body_validation"], ["variableId", "variable_validation"], ["sketchId", "sketch_validation"]] as const)
      if (key in command) validationCommand[key] = validateTarget(command[key], placeholder);
    for (const key of ["cursor", "item", "beforeItem"] as const) if (isAlias(command[key])) {
      validateTarget(command[key], "feature_validation");
      validationCommand[key] = { kind: "feature", featureId: "feature_validation" };
    }
    if ((command.operation === "extrude.create" || command.operation === "extrude.update" || command.operation === "revolve.create" || command.operation === "revolve.update") && command.parameters && typeof command.parameters === "object" && "profiles" in command.parameters && Array.isArray(command.parameters.profiles)) {
      validationCommand.parameters = { ...command.parameters, profiles: command.parameters.profiles.map(profile => {
        if (!isAlias(profile)) return profile;
        validateTarget(profile, "region_validation");
        return { kind: "region", sketchId: "sketch_validation", regionId: "region_validation" };
      }) };
    }
    if ((command.operation === "extrude.create" || command.operation === "extrude.update" || command.operation === "revolve.create" || command.operation === "revolve.update") && command.parameters && typeof command.parameters === "object") {
      const parameters = command.parameters as Record<string, unknown>;
      const validateBound = (value: unknown) => {
        if (!value || typeof value !== "object" || !("target" in value) || !isAlias(value.target)) return value;
        validateTarget(value.target, "extent_validation");
        const kind = "kind" in value ? value.kind : undefined;
        const target = kind === "sketchPointOffset" ? { kind: "sketchPoint", sketchId: "sketch_validation", pointId: "sketch_point_validation" }
          : kind === "entityOffset" || kind === "upToFace" ? { kind: "face", bodyId: "body_validation", faceId: "face_validation" }
          : kind === "upToPart" ? { kind: "body", bodyId: "body_validation" }
          : { kind: "vertex", bodyId: "body_validation", vertexId: "vertex_validation" };
        return { ...value, target };
      };
      const extent = parameters.extent;
      validationCommand.parameters = { ...validationCommand.parameters as object,
        ...("startExtent" in parameters ? { startExtent: validateBound(parameters.startExtent) } : {}),
        ...(extent && typeof extent === "object" ? { extent: Object.fromEntries(Object.entries(extent).map(([key, value]) => [key, ["end", "firstEnd", "secondEnd"].includes(key) ? validateBound(value) : value])) } : {}),
      };
      const scope = parameters.booleanScope;
      if (scope && typeof scope === "object" && "bodyIds" in scope && Array.isArray(scope.bodyIds))
        validationCommand.parameters = { ...validationCommand.parameters as object, booleanScope: { ...scope, bodyIds: scope.bodyIds.map((value) => validateTarget(value, "body_validation")) } };
    }
    if ((command.operation === "extrude.create" || command.operation === "extrude.update" || command.operation === "revolve.create" || command.operation === "revolve.update") && command.parameters && typeof command.parameters === "object" && "booleanScope" in command.parameters) {
      const scope = command.parameters.booleanScope;
      if (scope && typeof scope === "object" && "bodyId" in scope && isAlias(scope.bodyId)) {
        validationCommand.parameters = { ...validationCommand.parameters as object, booleanScope: { ...scope, bodyId: validateTarget(scope.bodyId, "body_validation") } };
      }
    }
    if ((command.operation === "revolve.create" || command.operation === "revolve.update") && command.parameters && typeof command.parameters === "object" && "axis" in command.parameters && isAlias(command.parameters.axis)) {
      validateTarget(command.parameters.axis, "sketch_entity_validation");
      validationCommand.parameters = { ...validationCommand.parameters as object, axis: { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" } };
    }
    if ((command.operation === "plane.create" || command.operation === "plane.update") && command.parameters && typeof command.parameters === "object" && "reference" in command.parameters && command.parameters.reference && typeof command.parameters.reference === "object" && "target" in command.parameters.reference && isAlias(command.parameters.reference.target)) {
      validateTarget(command.parameters.reference.target, "construction_validation");
      validationCommand.parameters = { ...command.parameters, reference: { ...command.parameters.reference, target: { kind: "construction", constructionId: "construction_validation" } } };
    }
    if ((command.operation === "fillet.create" || command.operation === "fillet.update" || command.operation === "chamfer.create" || command.operation === "chamfer.update") && command.parameters && typeof command.parameters === "object") {
      const parameters = command.parameters as Record<string, unknown>;
      const validateEdges = (targets: unknown[]) => targets.map(target => {
        if (!isAlias(target)) return target;
        validateTarget(target, "edge_validation");
        return { kind: "edge", bodyId: "body_validation", edgeId: "edge_validation" };
      });
      validationCommand.parameters = {
        ...parameters,
        ...(Array.isArray(parameters.edgeTargets) ? { edgeTargets: validateEdges(parameters.edgeTargets) } : {}),
        ...(Array.isArray(parameters.participants) ? { participants: parameters.participants.map(participant => {
          if (!participant || typeof participant !== "object" || !("targets" in participant) || !Array.isArray(participant.targets)) return participant;
          return { ...participant, targets: validateEdges(participant.targets) };
        }) } : {}),
      };
    }
    if ((command.operation === "shell.create" || command.operation === "shell.update" || command.operation === "thicken.create" || command.operation === "thicken.update" || command.operation === "hole.create" || command.operation === "hole.update" || command.operation === "combine.create" || command.operation === "combine.update" || command.operation === "split.create" || command.operation === "split.update" || command.operation === "deleteSolid.create" || command.operation === "deleteSolid.update") && command.parameters && typeof command.parameters === "object") {
      const parameters = command.parameters as Record<string, unknown>;
      const validateReference = (value: unknown, kind: "body" | "face" | "sketchPoint") => {
        if (!isAlias(value)) return value;
        validateTarget(value, kind === "body" ? "body_validation" : kind === "face" ? "face_validation" : "sketch_point_validation");
        return kind === "body" ? { kind, bodyId: "body_validation" } : kind === "face" ? { kind, bodyId: "body_validation", faceId: "face_validation" } : { kind, sketchId: "sketch_validation", pointId: "sketch_point_validation" };
      };
      validationCommand.parameters = {
        ...parameters,
        ...("bodyTarget" in parameters ? { bodyTarget: validateReference(parameters.bodyTarget, "body") } : {}),
        ...(Array.isArray(parameters.faceTargets) ? { faceTargets: parameters.faceTargets.map(t => validateReference(t, "face")) } : {}),
        ...(Array.isArray(parameters.participants) ? { participants: parameters.participants.map(p => {
          if (!p || typeof p !== "object" || !Array.isArray(p.targets)) return p;
          return { ...p, targets: p.targets.map((t: unknown) => validateReference(t, p.role === "location" ? "sketchPoint" : p.role === "targetBody" || p.role === "toolBody" || p.role === "body" ? "body" : "face")) };
        }) } : {}),
      };
    }
    if ((command.operation === "mirror.create" || command.operation === "mirror.update" || command.operation === "transform.create" || command.operation === "transform.update" || command.operation === "linearPattern.create" || command.operation === "linearPattern.update" || command.operation === "circularPattern.create" || command.operation === "circularPattern.update" || command.operation === "loft.create" || command.operation === "loft.update" || command.operation === "sweep.create" || command.operation === "sweep.update") && command.parameters && typeof command.parameters === "object" && "participants" in command.parameters && Array.isArray(command.parameters.participants)) {
      validationCommand.parameters = { ...command.parameters, participants: command.parameters.participants.map(p => {
        if (!p || typeof p !== "object" || !Array.isArray(p.targets)) return p;
        return { ...p, targets: p.targets.map((t: unknown) => {
          if (!isAlias(t)) return t;
          validateTarget(t, "sweep_validation");
          switch (p.role) {
            case "profile": return { kind: "region", sketchId: "sketch_validation", regionId: "region_validation" };
            case "path": case "guideCurve": case "lockProfileDirection": return { kind: "edge", bodyId: "body_validation", edgeId: "edge_validation" };
            case "lockProfileFace": return { kind: "face", bodyId: "body_validation", faceId: "face_validation" };
            case "body": case "targetBody": return { kind: "body", bodyId: "body_validation" };
            case "plane": case "transformReference": return { kind: "construction", constructionId: "construction_validation" };
            case "axis": case "direction": return { kind: "edge", bodyId: "body_validation", edgeId: "edge_validation" };
            default: return t;
          }
        }) };
      }) };
    }
    if (command.operation === "document.inspect" && isAlias(command.owner)) {
      validateTarget(command.owner, "sketch_validation");
      validationCommand.owner = { kind: "sketch", sketchId: "sketch_validation" };
    }
    if (isAlias(command.profile)) {
      validateTarget(command.profile, "region_validation");
      validationCommand.profile = { kind: "region", sketchId: "sketch_validation", regionId: "region_validation" };
    }
    if (isAlias(command.target)) {
      validateTarget(command.target, "body_validation");
      validationCommand.target = (typeof command.operation === "string" && command.operation.startsWith("export.")) || command.operation === "target.delete" ? { kind: "body", bodyId: "body_validation" }
        : command.operation === "sketch.image.update" || command.operation === "sketch.image.replace" || command.operation === "sketch.image.remove" ? { kind: "sketchOperation", sketchId: "sketch_validation", operationId: "sketch_operation_validation" }
        : { kind: "sketchPoint", sketchId: "sketch_validation", pointId: "sketch_point_validation" };
    }
    if (isAlias(command.support)) {
      validateTarget(command.support, "construction_validation");
      validationCommand.support = { kind: "construction", constructionId: "construction_plane-xy" };
    }
    if (isAlias(command.axis)) {
      validateTarget(command.axis, "sketch_entity_validation");
      validationCommand.axis = { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" };
    }
    if (command.repair && typeof command.repair === "object") {
      const repair: Record<string, unknown> = { ...command.repair };
      for (const key of ["target", "output"] as const) if (isAlias(repair[key])) {
        validateTarget(repair[key], "sketch_entity_validation");
        repair[key] = { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" };
      }
      validationCommand.repair = repair;
    }
    if (Array.isArray(command.targets)) validationCommand.targets = command.targets.map(target => {
      if (!isAlias(target)) return target;
      validateTarget(target, "sketch_point_validation");
      return command.operation === "sketch.requirement.remove"
        ? { kind: "dimension", sketchId: "sketch_validation", dimensionId: "dimension_validation" }
        : command.operation === "sketch.style.patch" || command.operation === "sketch.geometry.build" || command.operation === "sketch.derivation.create" || command.operation === "sketch.mirror.create" || command.operation === "sketch.offset.create"
          ? { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" }
          : { kind: "sketchPoint", sketchId: "sketch_validation", pointId: "sketch_point_validation" };
    });
    if (command.edit && typeof command.edit === "object") {
      const edit: Record<string, unknown> = { ...command.edit };
      if (isAlias(edit.target)) {
        validateTarget(edit.target, "sketch_point_validation");
        if (!edit.kind || edit.kind === "tangent") throw invalidRecipe("Tangent edits require a typed handle reference.", { path: "edit.target" });
        edit.target = edit.kind === "point" || edit.kind === "mergePoints" ? { kind: "sketchPoint", sketchId: "sketch_validation", pointId: "sketch_point_validation" } : { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" };
      }
      if (isAlias(edit.boundary)) {
        validateTarget(edit.boundary, "sketch_entity_validation");
        edit.boundary = { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" };
      }
      if (isAlias(edit.destination)) {
        validateTarget(edit.destination, "sketch_point_validation");
        edit.destination = { kind: "sketchPoint", sketchId: "sketch_validation", pointId: "sketch_point_validation" };
      }
      validationCommand.edit = edit;
    }
    if (command.primitive && typeof command.primitive === "object" && "source" in command.primitive && isAlias(command.primitive.source)) {
      validateTarget(command.primitive.source, "sketch_entity_validation");
      validationCommand.primitive = { ...command.primitive, source: { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" } };
    }
    const validation = validateSemanticCommand(validationCommand);
    if (!validation.success) {
      const issues = validation.issues.map(({ path, expected, value }) => ({ path, expected, value, ...contractSchemaAt(command.operation as string, path, validationCommand) }));
      const [first] = issues as [(typeof issues)[number]];
      const expected = first.schema ? summarizeSchema(first.schema) : first.expected;
      const detail = first.allowed ? `unknown field ${first.path}; allowed: ${first.allowed.join(", ")}` : `${first.path || "operation"} expected ${expected.length > 240 ? `${expected.slice(0, 240)}...` : expected}`;
      throw invalidRecipe(`Invalid semantic operation: ${detail}.`, {
        path: issues[0]!.path,
        issues,
        help: `cadara document recipe --schema ${command.operation as string}`,
      });
    }
    if (typeof alias === "string") aliases.add(alias);
    return {
      command: command as RecipeOperation["command"],
      ...(typeof alias === "string" ? { alias } : {}),
    };
  });
}
const usage = "Usage: cadara document recipe [--output detailed|compact] <recipe.json>";

function help() {
  const families = new Map<string, string[]>();
  for (const operation of recipeOperationNames) {
    const [family] = operation.split(".");
    families.set(family!, [...(families.get(family!) ?? []), operation.slice(family!.length + 1)]);
  }
  return [
    usage,
    "       cadara document recipe --schema [operation]",
    "",
    "Runs a sequential JSON recipe of semantic operations in an isolated document.",
    "Exit 0 success; 1 semantic, selection or initialization failure: stdout is one JSON envelope",
    "  (version, results, unexecuted, cleanup, plus initialization/error when present); stderr a summary.",
    "Exit 2 invalid invocation or recipe (nothing ran, kernel never started): stdout empty; the first stderr",
    "  line is JSON (version, error) with command index/ID, field path and expected schema, then a summary.",
    "",
    "--output compact      versioned compact discovery; preserves receipts, diagnostics and structured errors.",
    "--output detailed     full canonical discovery (default).",
    "--schema              machine-readable catalog: every operation's exact input schema (generated from the",
    "                      closed contract), execution/preview capability, angle units and recipe selectors.",
    "--schema <operation>  one operation with only the schema components it references.",
    "",
    "Recipe extras: `as` names an operation's discovery; `basis`/`draft` accept an object with `alias`; typed",
    "targets accept `alias` + `label` (the unique eligible discovered label), optionally `sketch` (an earlier alias",
    "naming the owning sketch). Lengths are " + `${recipeLengthUnit}s; every`,
    "angle field states its unit (radian or degree) in the schema `x-unit` and the operation's `units`; a `value`",
    "whose unit depends on the dimension or derivation kind states its units in its schema `description`.",
    "",
    `Operations (${recipeOperationNames.length}):`,
    ...[...families].map(([family, names]) => `  ${family}: ${names.join(", ")}`),
    "",
    "Example (the JSON below runs as is; it is the only JSON in this help):",
    JSON.stringify(example, null, 2),
    "",
  ].join("\n");
}

/**
 * Preflight refusals (exit 2) keep stdout empty, as for every usage error. The
 * machine-readable error is the first stderr line; the dispatcher prints the
 * human summary after it.
 */
function refuse(io: import("@/cli/types").CliIO, error: RecipeCliError) {
  io.stderr(JSON.stringify({ version: 1, error }) + "\n");
  return { ok: false, kind: "usage", message: error.message } as const;
}

/** Attach the operation position (and a selector's path) to an error. */
function locate(error: RecipeCliError, commandIndex: number, operation: unknown): RecipeCliError {
  if (commandIndex < 0) return error;
  const record = operation && typeof operation === "object" ? (operation as Record<string, unknown>) : {};
  const commandId = typeof record.commandId === "string" && record.commandId ? record.commandId : null;
  const name = typeof record.operation === "string" ? record.operation : null;
  const path = error.path ?? (error.selector === undefined ? null : pathOf(operation, error.selector));
  const expected = error.expected ?? (path && name && !error.issues ? contractSchemaAt(name, path, operation).schema : undefined);
  const where = [`operations[${commandIndex}]`, commandId && JSON.stringify(commandId), name, path && `at ${path}`].filter(Boolean).join(" ");
  return {
    ...error,
    message: `${error.message} (${where})${error.help ? ` See \`${error.help}\`.` : ""}`,
    commandIndex,
    commandId,
    operation: name,
    path,
    ...(expected ? { expected } : {}),
  };
}

export const documentRecipesCommand: CommandModule = {
  name: "document recipe",
  description:
    "Run a sequential document/sketch JSON recipe in an isolated document",
  async run(argv, _env, io) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) {
      io.stdout(help());
      return { ok: true };
    }
    if (argv[0] === "--schema" && argv.length <= 2) {
      const output = argv.length === 1 ? recipeCatalog() : recipeOperationCatalog(argv[1]!);
      if (!output)
        return refuse(io, recipeError("unknown-operation", "preflight", `Unknown operation ${JSON.stringify(argv[1])}.`, {
          suggestions: suggestOperations(argv[1]!),
          help: "cadara document recipe --schema",
        }).error);
      io.stdout(JSON.stringify(output) + "\n");
      return { ok: true };
    }
    const [, mode, ...path] =
      argv[0] === "--output" ? argv : [null, "detailed", ...argv];
    if (path.length !== 1 || (mode !== "detailed" && mode !== "compact"))
      return refuse(io, recipeError("usage", "preflight", usage, { help: "cadara document recipe --help" }).error);
    // Presentation only: execution, aliases and validation never see the mode.
    const print = (
      envelope: Record<string, unknown>,
      compact: () => CompactRecipeOutput,
    ) => {
      if (mode === "detailed")
        return io.stdout(JSON.stringify(envelope) + "\n");
      const validated = validateCompactRecipeOutput(compact());
      if (!validated.success)
        throw new Error(
          `CLI produced an invalid compact output envelope: ${validated.issues.map((issue) => issue.path).join(", ")}`,
        );
      io.stdout(JSON.stringify(validated.data) + "\n");
    };
    let input: unknown;
    try {
      input = JSON.parse(await readFile(path[0]!, "utf8"));
    } catch (error) {
      return refuse(io, recipeError("recipe-unreadable", "preflight", error instanceof Error ? error.message : String(error)).error);
    }
    let operations: RecipeOperation[];
    const position = { index: -1 };
    try {
      operations = parseRecipe(input, position);
    } catch (error) {
      if (!(error instanceof RecipeError)) throw error;
      const operation = position.index < 0 ? undefined : (input as { operations: unknown[] }).operations[position.index];
      return refuse(io, locate(error.error, position.index, operation));
    }
    // Capture/help/invalid-input paths never acquire a model or load WASM.
    const { createHeadlessSessionFactory } =
      await import("@/composition/headless");
    const opened = await createHeadlessSessionFactory().open();
    if (opened.kind !== "ready") {
      const error = recipeError("initialization", "initialization", "Document initialization failed.");
      print(
        { version: 1, initialization: opened, results: [], error: error.error },
        () => compactInitializationOutput(opened, error.error),
      );
      return {
        ok: false,
        kind: "failure",
        message: error.message,
      };
    }
    const sdk = new SemanticDocument(opened.session, opened.initialization.state);
    const results: SemanticResult[] = [];
    const snapshots = new Map<string, SemanticDiscovery>();
    let succeeded = true;
    let stopped: RecipeCliError | undefined;
    let failure: { error: unknown } | undefined;
    try {
      for (const [index, operation] of operations.entries()) try {
        const terminal = await sdk.execute(operation.command, { aliases: snapshots });
        results.push(terminal);
        if (
          terminal.outcome.kind !== "completed" &&
          terminal.outcome.kind !== "accepted-invalid"
        ) {
          succeeded = false;
          break;
        }
        if (operation.alias && terminal.discovery) {
          snapshots.set(operation.alias, terminal.discovery);
        }
      } catch (error) {
        // A selection that cannot resolve stops the recipe before this command
        // executes; it gets a CLI error, never a fabricated SemanticResult.
        if (!(error instanceof SelectionError)) throw error;
        const { code, message, ...selection } = error.selection;
        stopped = locate(
          recipeError(code, "resolution", message, selection).error,
          index,
          operation.command,
        );
        succeeded = false;
        break;
      }
    } catch (error) {
      failure = { error };
    }
    const cleanup = await opened.session.close();
    succeeded &&= cleanup.kind === "closed";
    const unexecuted = operations
      .slice(results.length)
      .map((operation) => operation.command.commandId);
    const printEnvelope = () => print(
      { version: 1, results, unexecuted, cleanup, ...(stopped ? { error: stopped } : {}) },
      () => compactRecipeOutput(results, unexecuted, cleanup, stopped),
    );
    if (failure) {
      // The unexpected failure stays authoritative over an output error, which is reported beside it.
      try {
        printEnvelope();
      } catch (printError) {
        io.stderr(`Recipe output could not be printed: ${printError instanceof Error ? printError.message : String(printError)}\n`);
      }
      throw failure.error;
    }
    printEnvelope();
    return succeeded
      ? { ok: true }
      : {
          ok: false,
          kind: "failure",
          message: stopped?.message ?? "Recipe failed; prior completed operations are retained.",
        };
  },
};
