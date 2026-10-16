import { readFile } from "node:fs/promises";
import type { CommandModule } from "@/cli/types";
import type {
  SemanticCommand,
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
type RecipeGeometryEdit<T = import("@/contracts/semantic/schema").SemanticSketchGeometryEdit> = T extends { target: infer R } ? Omit<T, "target" | "destination" | "boundary"> & { target: R | TargetAlias } & (T extends { destination: infer D } ? { destination: D | TargetAlias } : unknown) & (T extends { boundary: infer B } ? { boundary: B | TargetAlias } : unknown) : never;
type RecipePrimitive<T = import("@/contracts/semantic/schema").SemanticSketchPrimitive> = T extends { source: infer S } ? Omit<T, "source"> & { source: S | TargetAlias } : T;
type RecipeFeatureParameters<T> = T extends { profiles: infer P extends readonly unknown[] } ? Omit<T, "profiles" | "axis"> & { profiles: readonly [P[number] | TargetAlias, ...(P[number] | TargetAlias)[]] } & (T extends { axis: infer A } ? { axis: A | TargetAlias } : unknown) : T extends { edgeTargets: infer E extends readonly unknown[] } ? Omit<T, "edgeTargets"> & { edgeTargets: readonly (E[number] | TargetAlias)[] } : T extends { participants: infer P extends readonly { role: string; targets: readonly unknown[] }[] } ? Omit<T, "participants"> & { participants: { [K in keyof P]: Omit<P[K], "targets"> & { targets: readonly (P[K]["targets"][number] | TargetAlias)[] } } } : T extends { bodyTarget: infer B; faceTargets: infer F extends readonly unknown[] } ? Omit<T, "bodyTarget" | "faceTargets"> & { bodyTarget: B | TargetAlias; faceTargets: readonly (F[number] | TargetAlias)[] } : T extends { reference: { target: infer R } } ? Omit<T, "reference"> & { reference: { target: R | TargetAlias } } : T;
type RecipeCommand<T = SemanticCommand> = T extends SemanticCommand
  ? Omit<T, "parameters" | "basis" | "draft" | "points" | "dimensionId" | "derivationId" | "profile" | "featureId" | "beforeFeatureId" | "bodyId" | "cursor" | "item" | "beforeItem" | "variableId" | "sketchId" | "target" | "targets" | "axis" | "repair" | "edit" | "primitive" | "support"> &
    (T extends { parameters: infer P } ? { parameters: RecipeFeatureParameters<P> } : unknown) &
    (T extends { support: infer S } ? { support: S | TargetAlias } : unknown) &
    (T extends { primitive: unknown } ? { primitive: RecipePrimitive } : unknown) &
    (T extends { edit: infer E } ? { edit: E extends { target: unknown } ? RecipeGeometryEdit<E> : E } : unknown) &
    (T extends { axis: infer A } ? { axis: A | TargetAlias } : unknown) &
    (T extends { repair: infer R } ? { repair: R extends { kind: "axis"; target: infer A } ? { kind: "axis"; target: A | TargetAlias } : R extends { kind: "original"; target: infer A; output: infer O } ? { kind: "original"; target: A | TargetAlias; output: O | TargetAlias } : never } : unknown) &
    (T extends { targets: infer R extends readonly unknown[] } ? { targets: readonly (R[number] | TargetAlias)[] } : unknown) &
    (T extends { profile: infer P } ? { profile: P | TargetAlias } : unknown) &
    (T extends { target: infer R } ? { target: R | TargetAlias } : unknown) &
    (T extends { featureId: infer F } ? { featureId: F | TargetAlias } : unknown) &
    (T extends { beforeFeatureId: infer F } ? { beforeFeatureId: F | TargetAlias } : unknown) &
    (T extends { bodyId: infer B } ? { bodyId: B | TargetAlias } : unknown) &
    (T extends { cursor: infer C } ? { cursor: C | TargetAlias } : unknown) &
    (T extends { item: infer I } ? { item: I | TargetAlias } : unknown) &
    (T extends { beforeItem: infer I } ? { beforeItem: I | TargetAlias } : unknown) &
    (T extends { variableId: infer V } ? { variableId: V | TargetAlias } : unknown) &
    (T extends { sketchId: infer S } ? { sketchId: S | TargetAlias } : unknown) &
    (T extends { points: infer P } ? { points: P | readonly [TargetAlias, TargetAlias] } : unknown) &
    (T extends { derivationId: infer D } ? { derivationId: D | TargetAlias } : unknown) &
    (T extends { dimensionId: infer D } ? { dimensionId: D | TargetAlias } : unknown) & { basis: T["basis"] | Alias } & (T extends {
        draft: infer D;
      }
        ? { draft: D | Alias }
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
    if ((command.operation === "revolve.create" || command.operation === "revolve.update") && command.parameters && typeof command.parameters === "object" && "axis" in command.parameters && isAlias(command.parameters.axis)) {
      validateTarget(command.parameters.axis, "sketch_entity_validation");
      validationCommand.parameters = { ...validationCommand.parameters as object, axis: { kind: "sketchEntity", sketchId: "sketch_validation", entityId: "sketch_entity_validation" } };
    }
    if ((command.operation === "plane.create" || command.operation === "plane.update") && command.parameters && typeof command.parameters === "object" && "reference" in command.parameters && command.parameters.reference && typeof command.parameters.reference === "object" && "target" in command.parameters.reference && isAlias(command.parameters.reference.target)) {
      validateTarget(command.parameters.reference.target, "construction_validation");
      validationCommand.parameters = { ...command.parameters, reference: { target: { kind: "construction", constructionId: "construction_validation" } } };
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
    if (isAlias(command.profile)) {
      validateTarget(command.profile, "region_validation");
      validationCommand.profile = { kind: "region", sketchId: "sketch_validation", regionId: "region_validation" };
    }
    if (isAlias(command.target)) {
      validateTarget(command.target, "body_validation");
      validationCommand.target = command.operation === "export.step" || command.operation === "target.delete" ? { kind: "body", bodyId: "body_validation" }
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
        if (!edit.kind || edit.kind === "tangent") throw new Error("Tangent edits require a typed handle reference.");
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
        if (command.operation === "variable.update" && isAlias(command.variableId)) {
          const target = command.variableId;
          const matches = aliases.get(target.alias)?.variables?.filter(variable => variable.name === target.label) ?? [];
          if (matches.length !== 1) throw new Error("Variable target alias is missing or ambiguous.");
          command.variableId = matches[0]!.variableId;
        }
        if ((command.operation === "sketch.dimension.update" || command.operation === "sketch.dimension.reference") && isAlias(command.dimensionId)) {
          const target = command.dimensionId;
          const sketch = aliases.get(target.alias)?.sketch;
          const matches = [...(sketch?.requirements ?? []), ...(sketch?.measurements ?? [])].filter(d => d.label === target.label);
          if (matches.length !== 1) throw new Error("Dimension target alias is missing or ambiguous.");
          command.dimensionId = matches[0]!.dimensionId;
        }
        if ((command.operation === "sketch.mirror.remove" || command.operation === "sketch.mirror.repair") && isAlias(command.derivationId)) {
          const target = command.derivationId;
          const matches = aliases.get(target.alias)?.sketch?.mirrors.filter(mirror => mirror.label === target.label) ?? [];
          if (matches.length !== 1) throw new Error("Mirror target alias is missing or ambiguous.");
          command.derivationId = matches[0]!.derivationId;
        }
        if (command.operation === "sketch.offset.remove" && isAlias(command.derivationId)) {
          const target = command.derivationId;
          const matches = aliases.get(target.alias)?.sketch?.offsets.filter(offset => offset.label === target.label) ?? [];
          if (matches.length !== 1) throw new Error("Offset target alias is missing or ambiguous.");
          command.derivationId = matches[0]!.derivationId;
        }
        function resolveSketchTarget(target: import("@/contracts/shared/references").DurableRef | import("@/contracts/shared/references").SketchTangentHandleRef | TargetAlias, kinds: readonly string[]) {
          if (!isAlias(target)) return target;
          const matches = aliases.get(target.alias)?.references.filter(r => r.label === target.label && kinds.includes(r.target.kind)) ?? [];
          if (matches.length !== 1) throw new Error("Sketch target alias is missing or ambiguous.");
          return matches[0]!.target;
        }
        function resolveMirrorAxis(target: import("@/contracts/shared/references").SketchDatumReferenceRef | Extract<import("@/contracts/shared/references").DurableRef, { kind: "sketchEntity" }> | TargetAlias) {
          if (!isAlias(target)) return target;
          const discovery = aliases.get(target.alias);
          const matches = [...(discovery?.references ?? []), ...(discovery?.sketch?.operands ?? [])].filter(r => r.label === target.label && (r.target.kind === "sketchEntity" || r.target.kind === "sketchDatumReference"));
          const found = matches.length === 1 ? matches[0]!.target : null;
          if (!found || (found.kind !== "sketchEntity" && found.kind !== "sketchDatumReference")) throw new Error("Mirror axis alias is missing or ambiguous.");
          return found;
        }
        if ("featureId" in command && isAlias(command.featureId)) {
          const target = resolveSketchTarget(command.featureId, ["feature"]);
          if (target.kind !== "feature") throw new Error("Invalid feature target.");
          command.featureId = target.featureId;
        }
        if (command.operation === "feature.reorder" && isAlias(command.beforeFeatureId)) {
          const target = resolveSketchTarget(command.beforeFeatureId, ["feature"]);
          if (target.kind !== "feature") throw new Error("Invalid feature reorder anchor.");
          command.beforeFeatureId = target.featureId;
        }
        if (command.operation === "body.rename" && isAlias(command.bodyId)) {
          const target = resolveSketchTarget(command.bodyId, ["body"]);
          if (target.kind !== "body") throw new Error("Invalid body target.");
          command.bodyId = target.bodyId;
        }
        function resolveTimelineTarget(value: import("@/contracts/modeling/schema").DocumentFeatureCursor | TargetAlias) {
          if (!isAlias(value)) return value;
          const target = resolveSketchTarget(value, ["feature", "sketch"]);
          if (target.kind !== "feature" && target.kind !== "sketch") throw new Error("Invalid timeline target.");
          return target;
        }
        if (command.operation === "timeline.cursor.set") command.cursor = resolveTimelineTarget(command.cursor);
        if (command.operation === "timeline.reorder") {
          const item = resolveTimelineTarget(command.item);
          const beforeItem = command.beforeItem === null ? null : resolveTimelineTarget(command.beforeItem);
          if (item.kind === "empty" || beforeItem?.kind === "empty") throw new Error("Invalid timeline order target.");
          command.item = item;
          command.beforeItem = beforeItem;
        }
        if (command.operation === "target.delete") {
          const target = resolveSketchTarget(command.target, ["body", "feature", "sketch", "face", "edge", "vertex", "loop", "construction", "region", "sketchEntity", "sketchPoint", "dimension", "constraint", "sketchOperation"]);
          if (target.kind === "sketchTangentHandle") throw new Error("Invalid deletion target.");
          command.target = target;
        }
        if (command.operation === "sketch.mirror.create") command.axis = resolveMirrorAxis(command.axis);
        if (command.operation === "sketch.mirror.repair") {
          if (command.repair.kind === "axis") command.repair.target = resolveMirrorAxis(command.repair.target);
          else {
            const target = resolveSketchTarget(command.repair.target, ["sketchEntity"]);
            const output = resolveSketchTarget(command.repair.output, ["sketchEntity"]);
            if (target.kind !== "sketchEntity" || output.kind !== "sketchEntity") throw new Error("Invalid mirror original target.");
            command.repair = { kind: "original", target, output };
          }
        }
        if (command.operation === "sketch.requirement.add") command.targets = command.targets.map(value => {
          if (!isAlias(value)) return value;
          const discovered = aliases.get(value.alias);
          const matches = [...(discovered?.references ?? []), ...(discovered?.sketch?.operands ?? [])].filter(r => r.label === value.label && ["sketchPoint", "sketchEntity", "sketchDatumReference", "projectedReferenceGeometry"].includes(r.target.kind));
          if (matches.length !== 1) throw new Error("Requirement target alias is missing or ambiguous.");
          const target = matches[0]!.target;
          if (target.kind !== "sketchPoint" && target.kind !== "sketchEntity" && target.kind !== "sketchDatumReference" && target.kind !== "projectedReferenceGeometry") throw new Error("Invalid requirement target.");
          return target;
        });
        if (command.operation === "sketch.requirement.remove") command.targets = command.targets.map(value => {
          const target = resolveSketchTarget(value, ["dimension", "constraint"]);
          if (target.kind !== "dimension" && target.kind !== "constraint") throw new Error("Invalid requirement removal target.");
          return target;
        });
        if (command.operation === "sketch.author" && command.primitive.kind === "tangentArc" && isAlias(command.primitive.source)) {
          const source = resolveSketchTarget(command.primitive.source, ["sketchEntity"]);
          if (source.kind !== "sketchEntity") throw new Error("Invalid tangent source target.");
          command.primitive = { ...command.primitive, source };
        }
        if ((command.operation === "sketch.begin" && "support" in command) || command.operation === "sketch.support.reassign") {
          const support = resolveSketchTarget(command.support, ["construction", "face"]);
          if (support.kind !== "construction" && support.kind !== "face") throw new Error("Invalid sketch support.");
          command.support = support;
        }
        if (command.operation === "sketch.reference.add") {
          const target = resolveSketchTarget(command.target, ["construction", "face", "edge", "vertex", "sketch", "sketchEntity", "sketchPoint"]);
          if (target.kind !== "construction" && target.kind !== "face" && target.kind !== "edge" && target.kind !== "vertex" && target.kind !== "sketch" && target.kind !== "sketchEntity" && target.kind !== "sketchPoint") throw new Error("Invalid external reference source.");
          command.target = target;
        }
        if (command.operation === "sketch.image.update" || command.operation === "sketch.image.replace" || command.operation === "sketch.image.remove") {
          const target = resolveSketchTarget(command.target, ["sketchOperation"]);
          if (target.kind !== "sketchOperation") throw new Error("Invalid reference image target.");
          command.target = target;
        }
        if (command.operation === "sketch.construction.set") {
          const target = resolveSketchTarget(command.target, ["sketchPoint", "sketchEntity"]);
          if (target.kind !== "sketchPoint" && target.kind !== "sketchEntity") throw new Error("Invalid construction target.");
          command.target = target;
        }
        if (command.operation === "sketch.label.set") {
          const target = resolveSketchTarget(command.target, ["sketchPoint", "sketchEntity", "dimension", "constraint", "sketch"]);
          if (target.kind !== "sketchPoint" && target.kind !== "sketchEntity" && target.kind !== "dimension" && target.kind !== "constraint" && target.kind !== "sketch") throw new Error("Invalid label target.");
          command.target = target;
        }
        if (command.operation === "sketch.geometry.build" || command.operation === "sketch.derivation.create" || command.operation === "sketch.mirror.create" || command.operation === "sketch.offset.create") command.targets = command.targets.map(value => {
          const target = resolveSketchTarget(value, ["sketchEntity"]);
          if (target.kind !== "sketchEntity") throw new Error("Invalid construction target.");
          return target;
        });
        if (command.operation === "sketch.style.patch") command.targets = command.targets.map(value => {
          const target = resolveSketchTarget(value, ["region", "sketchEntity"]);
          if (target.kind !== "region" && target.kind !== "sketchEntity") throw new Error("Invalid style target.");
          return target;
        });
        if (command.operation === "sketch.geometry.delete") command.targets = command.targets.map(value => {
          const target = resolveSketchTarget(value, ["sketchPoint", "sketchEntity"]);
          if (target.kind !== "sketchPoint" && target.kind !== "sketchEntity") throw new Error("Invalid deletion target.");
          return target;
        });
        if (command.operation === "sketch.geometry.update" && isAlias(command.edit.target)) {
          const target = resolveSketchTarget(command.edit.target, command.edit.kind === "point" || command.edit.kind === "mergePoints" ? ["sketchPoint"] : ["sketchEntity"]);
          if ((command.edit.kind === "point" || command.edit.kind === "mergePoints") && target.kind === "sketchPoint") command.edit.target = target;
          else if ((command.edit.kind === "translate" || command.edit.kind === "radius" || command.edit.kind === "trim" || command.edit.kind === "split" || command.edit.kind === "extend") && target.kind === "sketchEntity") command.edit.target = target;
          else throw new Error("Invalid geometry edit target.");
        }
        if (command.operation === "sketch.geometry.update" && (command.edit.kind === "split" || command.edit.kind === "extend") && isAlias(command.edit.boundary)) {
          const boundary = resolveSketchTarget(command.edit.boundary, ["sketchEntity"]);
          if (boundary.kind !== "sketchEntity") throw new Error("Invalid edit boundary.");
          command.edit.boundary = boundary;
        }
        if (command.operation === "sketch.geometry.update" && command.edit.kind === "mergePoints" && isAlias(command.edit.destination)) {
          const destination = resolveSketchTarget(command.edit.destination, ["sketchPoint"]);
          if (destination.kind !== "sketchPoint") throw new Error("Invalid merge destination.");
          command.edit.destination = destination;
        }
        if (command.operation === "export.step" && isAlias(command.target)) {
          const target = command.target;
          const matches = aliases.get(target.alias)?.references.filter(r => r.label === target.label && r.target.kind === "body") ?? [];
          if (matches.length !== 1) throw new Error("Export body target alias is missing or ambiguous.");
          command.target = matches[0]!.target;
        }
        if ((command.operation === "extrude.create" || command.operation === "extrude.update" || command.operation === "revolve.create" || command.operation === "revolve.update") && "parameters" in command && command.parameters !== undefined) {
          const parameters = command.parameters;
          function resolveProfile(profile: import("@/contracts/modeling/schema").ExtrudeSurfaceProfileRef | TargetAlias) {
            if (!isAlias(profile)) return profile;
            const kinds = parameters.resultBodyType === "surface" ? ["region", "face", "sketchEntity"] : ["region", "face"];
            const matches = aliases.get(profile.alias)?.references.filter(r => r.label === profile.label && kinds.includes(r.target.kind)) ?? [];
            if (matches.length !== 1) throw new Error("Extrude profile target alias is missing or ambiguous.");
            const target = matches[0]!.target;
            if (target.kind !== "region" && target.kind !== "face" && target.kind !== "sketchEntity") throw new Error("Unsupported extrude profile reference.");
            return target;
          }
          function resolveSolidProfile(profile: import("@/contracts/modeling/schema").ExtrudeProfileRef | TargetAlias) {
            const target = resolveProfile(profile);
            if (target.kind === "sketchEntity") throw new Error("Solid extrusion requires closed profiles.");
            return target;
          }
          command.parameters = parameters.resultBodyType === "solid"
            ? { ...parameters, profiles: [resolveSolidProfile(parameters.profiles[0]), ...parameters.profiles.slice(1).map(resolveSolidProfile)] }
            : { ...parameters, profiles: [resolveProfile(parameters.profiles[0]), ...parameters.profiles.slice(1).map(resolveProfile)] };
        }
        if (command.operation === "fillet.create" || command.operation === "fillet.update" || command.operation === "chamfer.create" || command.operation === "chamfer.update") {
          const resolveEdge = (value: Extract<import("@/contracts/shared/references").DurableRef, { kind: "edge" }> | TargetAlias) => {
            const target = resolveSketchTarget(value, ["edge"]);
            if (target.kind !== "edge") throw new Error("Invalid edge target.");
            return target;
          };
          if (command.operation === "fillet.create" || command.operation === "fillet.update")
            command.parameters = { ...command.parameters, edgeTargets: command.parameters.edgeTargets.map(resolveEdge) };
          else
            command.parameters = { ...command.parameters, participants: [{ role: "edge", targets: command.parameters.participants[0].targets.map(resolveEdge) }] };
        }
        if (command.operation === "shell.create" || command.operation === "shell.update") {
          const bodyTarget = resolveSketchTarget(command.parameters.bodyTarget, ["body"]);
          if (bodyTarget.kind !== "body") throw new Error("Invalid shell body reference.");
          const faceTargets = command.parameters.faceTargets.map(value => {
            const target = resolveSketchTarget(value, ["face"]);
            if (target.kind !== "face") throw new Error("Invalid shell face reference.");
            return target;
          });
          command.parameters = { ...command.parameters, bodyTarget, faceTargets } as typeof command.parameters;
        }
        if (command.operation === "thicken.create" || command.operation === "thicken.update") {
          const sources = command.parameters.participants[0].targets.map(value => {
            const target = resolveSketchTarget(value, ["body", "face"]);
            if (target.kind !== "body" && target.kind !== "face") throw new Error("Invalid thicken source.");
            return target;
          });
          const targets = command.parameters.participants.slice(1).map(p => ({ role: "targetBody" as const, targets: p.targets.map(value => {
            const target = resolveSketchTarget(value, ["body"]);
            if (target.kind !== "body") throw new Error("Invalid thicken boolean target.");
            return target;
          }) }));
          command.parameters = { ...command.parameters, participants: [{ role: "face", targets: sources }, ...targets] };
        }
        if (command.operation === "combine.create" || command.operation === "combine.update" || command.operation === "split.create" || command.operation === "split.update" || command.operation === "deleteSolid.create" || command.operation === "deleteSolid.update") {
          const resolveBody = (value: Extract<import("@/contracts/shared/references").DurableRef, { kind: "body" }> | TargetAlias) => {
            const target = resolveSketchTarget(value, ["body"]);
            if (target.kind !== "body") throw new Error("Invalid body boolean participant.");
            return target;
          };
          if (command.operation === "deleteSolid.create" || command.operation === "deleteSolid.update") {
            command.parameters = { ...command.parameters, participants: [{ role: "body", targets: command.parameters.participants[0].targets.map(resolveBody) }] };
          } else {
            command.parameters = { ...command.parameters, participants: command.parameters.participants.map(p => ({ role: p.role, targets: p.targets.map(resolveBody) })) };
          }
        }
        if (command.operation === "mirror.create" || command.operation === "mirror.update" || command.operation === "transform.create" || command.operation === "transform.update" || command.operation === "linearPattern.create" || command.operation === "linearPattern.update" || command.operation === "circularPattern.create" || command.operation === "circularPattern.update") {
          command.parameters = { ...command.parameters, participants: command.parameters.participants.map(p => {
            const kinds = p.role === "body" || p.role === "targetBody" ? ["body"] as const
              : p.role === "plane" || p.role === "transformReference" ? ["construction", "face"] as const
              : ["construction", "face", "edge", "sketchEntity"] as const;
            return { role: p.role, targets: p.targets.map(value => resolveSketchTarget(value, kinds)) };
          }) } as typeof command.parameters;
        }
        if (command.operation === "loft.create" || command.operation === "loft.update") {
          command.parameters = { ...command.parameters, participants: command.parameters.participants.map(p => {
            if (p.role === "profile") return { role: p.role, targets: p.targets.map(v => {
              const t = resolveSketchTarget(v, ["region", "face"]);
              if (t.kind !== "region" && t.kind !== "face") throw new Error("Invalid loft profile.");
              return t;
            }) };
            return { role: p.role, targets: p.targets.map(v => {
              const t = resolveSketchTarget(v, ["edge"]);
              if (t.kind !== "edge") throw new Error("Invalid loft path.");
              return t;
            }) };
          }) };
        }
        if (command.operation === "sweep.create" || command.operation === "sweep.update") {
          command.parameters = { ...command.parameters, participants: command.parameters.participants.map(p => {
            // Keep role/kind correspondence; labels never select an arbitrary first match.
            switch (p.role) {
              case "profile": return { role: p.role, targets: p.targets.map(v => {
                const t = resolveSketchTarget(v, ["region", "face"]);
                if (t.kind !== "region" && t.kind !== "face") throw new Error("Invalid sweep profile.");
                return t;
              }) };
              case "path": case "guideCurve": return { role: p.role, targets: p.targets.map(v => {
                const t = resolveSketchTarget(v, ["edge", "sketchEntity"]);
                if (t.kind !== "edge" && t.kind !== "sketchEntity") throw new Error("Invalid sweep path.");
                return t;
              }) };
              case "lockProfileFace": return { role: p.role, targets: p.targets.map(v => {
                const t = resolveSketchTarget(v, ["face"]);
                if (t.kind !== "face") throw new Error("Invalid sweep lock face.");
                return t;
              }) };
              case "lockProfileDirection": return { role: p.role, targets: p.targets.map(v => {
                const t = resolveSketchTarget(v, ["edge", "construction"]);
                if (t.kind !== "edge" && t.kind !== "construction") throw new Error("Invalid sweep lock direction.");
                return t;
              }) };
              case "targetBody": return { role: p.role, targets: p.targets.map(v => {
                const t = resolveSketchTarget(v, ["body"]);
                if (t.kind !== "body") throw new Error("Invalid sweep target body.");
                return t;
              }) };
            }
          }) };
        }
        if (command.operation === "hole.create" || command.operation === "hole.update") {
          const locations = command.parameters.participants[0].targets.map(value => {
            const target = resolveSketchTarget(value, ["sketchPoint"]);
            if (target.kind !== "sketchPoint") throw new Error("Invalid hole location.");
            return target;
          });
          const bodies = command.parameters.participants[1].targets.map(value => {
            const target = resolveSketchTarget(value, ["body"]);
            if (target.kind !== "body") throw new Error("Invalid hole body.");
            return target;
          });
          command.parameters = { ...command.parameters, participants: [{ role: "location", targets: locations }, { role: "body", targets: bodies }] };
        }
        if ((command.operation === "plane.create" || command.operation === "plane.update") && command.parameters.mode === "coplanar") {
          const target = resolveSketchTarget(command.parameters.reference.target, ["construction", "face"]);
          if (target.kind !== "construction" && target.kind !== "face") throw new Error("Invalid plane reference.");
          command.parameters = { ...command.parameters, reference: { target } };
        }
        if (command.operation === "revolve.create" || command.operation === "revolve.update") {
          const axis = resolveSketchTarget(command.parameters.axis, ["edge", "sketchEntity", "construction"]);
          if (axis.kind !== "edge" && axis.kind !== "sketchEntity" && axis.kind !== "construction") throw new Error("Invalid revolve axis.");
          command.parameters = { ...command.parameters, axis };
        }
        if (command.operation === "extrude.create" && "profile" in command && isAlias(command.profile)) {
          const target = command.profile;
          const matches = aliases.get(target.alias)?.references.filter(r => r.label === target.label && r.target.kind === "region") ?? [];
          if (matches.length !== 1 || matches[0]!.target.kind !== "region") throw new Error("Profile target alias is missing or ambiguous.");
          command.profile = matches[0]!.target;
        }
        if ((command.operation === "sketch.open" || command.operation === "sketch.support.reassign") && isAlias(command.sketchId)) {
          const target = resolveSketchTarget(command.sketchId, ["sketch"]);
          if (target.kind !== "sketch") throw new Error("Invalid sketch target.");
          command.sketchId = target.sketchId;
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
