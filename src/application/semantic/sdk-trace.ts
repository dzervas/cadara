import type { SemanticCommand, SemanticDiscovery, SemanticBasis } from "@/contracts/semantic/schema";
import type { RecipeTrace } from "./sdk-types";
import { sameTarget } from "./sdk-queries";
import { resolveSemanticCommand } from "./target-resolution";
import { SelectionError } from "./selection-error";
import { validateSemanticCommand } from "@/contracts/semantic/runtime-schema";
import { validateDurableRef } from "@/contracts/shared/references.runtime-schema";
import type { RecipeCommand } from "@/contracts/semantic/recipe";
import { advanceSemanticCreations, type SemanticCreationOutput } from "@/contracts/semantic/creation-outputs";
import type { RecipeReference } from "@/contracts/semantic/recipe-references";
import { validateRecordedRecipe } from "@/contracts/semantic/recipe.runtime-schema";

export class SemanticTraceError extends Error {
  readonly commandId: string;
  readonly operation: SemanticCommand["operation"];
  readonly reference: unknown;
  readonly path: string;
  readonly reason: string;
  constructor(command: SemanticCommand, reference: unknown, reason: string, path = "") {
    super(`Cannot export trace step ${command.commandId} (${command.operation}): ${reason}: ${JSON.stringify(reference)}`);
    this.name = "SemanticTraceError";
    this.commandId = command.commandId;
    this.operation = command.operation;
    this.reference = reference;
    const findPath = (value: unknown, at = ""): string | undefined => {
      if (sameTarget(value, reference)) return at;
      if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
        const found = findPath(child, at ? `${at}.${key}` : key);
        if (found !== undefined) return found;
      }
    };
    this.path = path || findPath(command) || "";
    this.reason = reason;
  }
}

class UnportableReference extends Error {
  readonly reference: unknown;
  readonly path: string;
  constructor(reference: unknown, reason = "Missing creation provenance: reference is not uniquely label-selectable (pre-existing asset or unsupported creation output role)", path = "") { super(reason); this.reference = reference; this.path = path; }
}

function authority(state: SemanticBasis) {
  const { documentId, revisionId, repositoryHeads } = state;
  return { documentId, revisionId, repositoryHeads: [...repositoryHeads].sort() };
}

/** Recipe encoding only. Selection/execution still belongs to the shared resolver/session. */
export class SemanticTrace {
  private readonly operations: (RecipeCommand & { as: string })[] = [];
  private readonly snapshots = new Map<string, SemanticDiscovery>();
  private readonly commands: SemanticCommand[] = [];
  private readonly errors: SemanticTraceError[] = [];
  private readonly origins = new WeakMap<object, unknown>();
  private readonly creations = new Map<string, readonly SemanticCreationOutput[]>();
  private latest: SemanticDiscovery | undefined;

  executed(): readonly SemanticCommand[] { return structuredClone(this.commands); }

  record(command: SemanticCommand): string {
    const alias = `trace${this.operations.length + 1}`;
    this.commands.push(structuredClone(command));
    let encoded: RecipeCommand = command;
    try {
      encoded = this.encode(command) as RecipeCommand;
      const replay = resolveSemanticCommand(encoded, { aliases: this.snapshots, creations: this.creations, discovery: this.latest });
      const checked = validateSemanticCommand(replay);
      if (!checked.success) throw new UnportableReference({ command, issues: checked.issues });
    } catch (error) {
      if (error instanceof UnportableReference) this.errors.push(new SemanticTraceError(command, error.reference, error.message, error.path));
      else if (error instanceof SelectionError) {
        const selector = error.selection.selector;
        const reference = selector && typeof selector === "object" ? this.origins.get(selector) ?? selector : selector;
        this.errors.push(new SemanticTraceError(command, reference, `Missing creation provenance: ${error.message}`, "path" in error ? String(error.path) : ""));
      }
      else throw error;
    }
    this.operations.push({ ...encoded, as: alias });
    return alias;
  }
  publish(alias: string, discovery: SemanticDiscovery | null, outputs: readonly SemanticCreationOutput[], command: SemanticCommand, before: SemanticDiscovery | undefined) {
    if (discovery) this.snapshots.set(alias, discovery);
    this.creations.set(alias, outputs);
    advanceSemanticCreations(this.creations, command, before, discovery);
    this.latest = discovery ?? undefined;
  }
  encode(input: unknown): unknown {
    const snapshots = [...this.snapshots].reverse();
    const selector = (label: string, alias: string, sketchId: string | undefined, source: unknown) => {
      const owner = sketchId && snapshots.find(([, d]) => d.sketch?.sketchId === sketchId);
      const selector = { alias, label, ...(owner ? { sketch: owner[0] } : {}) };
      this.origins.set(selector, source);
      return selector;
    };
    const creation = (value: unknown, path: string): RecipeReference | undefined => {
      for (const [createdBy, outputs] of this.creations) {
        const output = outputs.find(o => sameTarget(o.target, value));
        if (!output || !("sketchId" in output.target)) continue;
        const sketchId = output.target.sketchId;
        const owner = [...this.creations].find(([, os]) => os.some(o => o.output.role === "sketch" && o.target.kind === "sketch" && o.target.sketchId === sketchId));
        if (!owner) throw new UnportableReference(value, "Missing creation provenance for sketch owner", path);
        return { kind: "recipeRef", version: 1, createdBy, owner: { alias: owner[0] }, output: output.output };
      }
      return undefined;
    };
    const visit = (value: unknown, key = "", path = ""): unknown => {
      if (value === null || value === undefined) return value;
      if (key === "basis" && typeof value === "object") {
        const match = snapshots.find(([, d]) => sameTarget(authority(d.state), authority(value as SemanticBasis)));
        return match ? { alias: match[0] } : value;
      }
      if (key === "draft" && typeof value === "object") {
        const match = snapshots.find(([, d]) => sameTarget(d.state.draft, value));
        return match ? { alias: match[0] } : value;
      }
      if (typeof value === "object" && !Array.isArray(value) && "kind" in value) {
        if (value.kind === "sketchTangentHandle") {
          const ref = value as import("@/contracts/shared/references").SketchTangentHandleRef;
          const entity = this.latest?.sketch?.entities.find(e => e.entityId === ref.entityId && this.latest?.sketch?.sketchId === ref.sketchId);
          const slots = entity?.tangents?.flatMap((t, i) => t.occurrenceId === ref.occurrenceId && t.pointId === ref.pointId ? [i] : []) ?? [];
          if (slots.length !== 1) throw new UnportableReference(value, "Expired occurrence: tangent is not an exact live spline occurrence", path);
          const binding = creation({ kind: "sketchEntity", sketchId: ref.sketchId, entityId: ref.entityId }, path);
          if (!binding) throw new UnportableReference(value, "Missing creation provenance for spline tangent", path);
          return { ...binding, output: { kind: "sketchTangentHandle", role: "splineOccurrence", index: slots[0]! } };
        }
        const binding = creation(value, path);
        if (binding) return binding;
        for (const [alias, d] of snapshots) {
          const ref = d.references.find((r) => sameTarget(r.target, value));
          if (ref) return selector(ref.label, alias, ref.owner?.kind === "sketch" ? ref.owner.sketchId : undefined, value);
          const operand = d.sketch?.operands.find((r) => sameTarget(r.target, value));
          if (operand) return selector(operand.label, alias, d.sketch?.sketchId ?? undefined, value);
        }
        if (validateDurableRef(value).success) throw new UnportableReference(value, undefined, path);
      }
      if (typeof value === "string" && (/Ids?$/.test(key) || key === "points" || key === "derivationId")) {
        for (const [alias, d] of snapshots) {
          const ref = d.references.find((r) => Object.entries(r.target).some(([field, id]) => /Id$/.test(field) && field !== "sketchId" && field !== "bodyId" && id === value) ||
            (r.target.kind === "sketch" && r.target.sketchId === value) || (r.target.kind === "body" && r.target.bodyId === value));
          if (ref) return creation(ref.target, path) ?? selector(ref.label, alias, ref.owner?.kind === "sketch" ? ref.owner.sketchId : undefined, value);
          const variable = d.variables?.find((v) => v.variableId === value);
          if (variable) return selector(variable.name, alias, undefined, value);
          const derivation = [...(d.sketch?.mirrors ?? []), ...(d.sketch?.offsets ?? [])].find((v) => v.derivationId === value);
          if (derivation) return selector(derivation.label, alias, d.sketch?.sketchId ?? undefined, value);
        }
      }
      if (Array.isArray(value)) return value.map((v, i) => visit(v, key, `${path}[${i}]`));
      if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k, path ? `${path}.${k}` : k)]));
      return value;
    };
    return visit(input);
  }
  recipe(): RecipeTrace {
    if (this.errors.length) throw this.errors[0];
    const first = this.operations[0]?.operation;
    if (first !== "document.create" && first !== "document.open")
      throw new Error("Replayable traces must begin with document.create or document.open.");
    const recipe = structuredClone({ version: 2 as const, operations: this.operations });
    const checked = validateRecordedRecipe(recipe);
    if (!checked.success) throw new Error(`Invalid recorded recipe: ${JSON.stringify(checked.issues)}`);
    return recipe;
  }
}
