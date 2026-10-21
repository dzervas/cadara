import type { SemanticDiscovery } from "@/contracts/semantic/schema";
import type { SemanticCreationOutput } from "@/contracts/semantic/creation-outputs";
import { isRecipeReference, type RecipeReference } from "@/contracts/semantic/recipe-references";
import { validateRecipeReference } from "@/contracts/semantic/recipe.runtime-schema";
import { SelectionError, selectionError } from "./selection-error";
import { sameTarget } from "./sdk-queries";
import { isTargetSelector, isDiscoveryAlias } from "./target-inputs";

export class RecipeReferenceError extends SelectionError {
  readonly path: string;
  readonly reason: string;
  constructor(reference: unknown, path: string, reason: string) {
    super(selectionError(`Creation reference at ${path}: ${reason}.`, reference, [], [], undefined).selection);
    this.name = "RecipeReferenceError";
    this.path = path;
    this.reason = reason;
  }
}

export type CreationBindings = ReadonlyMap<string, readonly SemanticCreationOutput[]>;
export interface CreationReferenceContext {
  creations?: CreationBindings;
  aliases?: ReadonlyMap<string, SemanticDiscovery>;
  discovery?: SemanticDiscovery;
}

export function resolveCreationReference(ref: RecipeReference, context: CreationReferenceContext, path: string) {
  const refuse = (reason: string): never => { throw new RecipeReferenceError(ref, path, reason); };
  if (!validateRecipeReference(ref).success) return refuse("unsupported version or malformed creation output role/slot");
  const outputs = context.creations?.get(ref.createdBy);
  if (!outputs) return refuse(`unknown or unavailable creation producer ${ref.createdBy}`);
  const ownerBinding = context.creations?.get(ref.owner.alias)?.find(o => o.output.role === "sketch");
  const owner = ownerBinding?.target.kind === "sketch" ? ownerBinding.target.sketchId : context.aliases?.get(ref.owner.alias)?.sketch?.sketchId;
  if (!owner) return refuse(`owner alias ${ref.owner.alias} has no sketch identity`);
  const output = ref.output.role === "splineOccurrence"
    ? outputs.find(o => o.output.role === "authoredEntity" && o.pointIds)
    : outputs.find(o => o.output.role === ref.output.role && o.output.kind === ref.output.kind && o.output.index === ref.output.index);
  if (!output || !("sketchId" in output.target) || output.target.sketchId !== owner)
    return refuse("wrong owner/kind or unsupported output role/slot for producer");
  const live = context.discovery;
  if (ref.output.role === "splineOccurrence") {
    const target = output.target;
    const entity = live?.sketch?.sketchId === owner && target.kind === "sketchEntity"
      ? live.sketch.entities.find(e => e.entityId === target.entityId) : undefined;
    if (!entity || entity.kind !== "spline" || JSON.stringify(entity.pointIds) !== JSON.stringify(output.pointIds))
      return refuse("expired occurrence: spline was deleted, changed or is not in the current draft; reopen its sketch");
    const tangent = entity.tangents?.[ref.output.index];
    if (!tangent || tangent.pointId !== entity.pointIds[ref.output.index] || entity.tangents?.filter(t => t.occurrenceId === tangent.occurrenceId).length !== 1)
      return refuse("expired occurrence: authored fit-point slot is unavailable or ambiguous");
    return { kind: "sketchTangentHandle" as const, sketchId: live!.sketch!.sketchId!, entityId: entity.entityId, pointId: tangent.pointId, occurrenceId: tangent.occurrenceId };
  }
  const target = output.target;
  const available = live?.references.some(r => sameTarget(r.target, target)) ||
    (live?.sketch?.sketchId === owner && (target.kind === "sketchPoint" ? live.sketch.points.some(p => p.pointId === target.pointId) : target.kind === "sketchEntity" ? live.sketch.entities.some(e => e.entityId === target.entityId) : target.kind === "dimension" ? [...live.sketch.requirements, ...live.sketch.measurements].some(d => d.dimensionId === target.dimensionId) : target.kind === "sketch"));
  if (!available) return refuse("creation output is missing or deleted in current discovery");
  return target;
}

/** Remap before the ordinary field-specific resolver and semantic validation. */
export function mapCreationReferences(input: unknown, context: CreationReferenceContext, path = "", key = ""): unknown {
  if (isRecipeReference(input)) {
    const target = resolveCreationReference(input, context, path);
    if (key === "points" || key === "pointId") {
      if (target.kind !== "sketchPoint") throw new RecipeReferenceError(input, path, "target kind must be sketchPoint");
      return target.pointId;
    }
    const idKey = key === "sketchId" || key === "dimensionId" ? key : null;
    if (idKey) {
      if (!(idKey in target)) throw new RecipeReferenceError(input, path, `target kind is incompatible with ${key}`);
      return target[idKey as keyof typeof target];
    }
    return target;
  }
  if (isTargetSelector(input) || isDiscoveryAlias(input)) return input;
  if (Array.isArray(input)) return input.map((v, i) => mapCreationReferences(v, context, `${path}[${i}]`, key));
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, mapCreationReferences(v, context, path ? `${path}.${k}` : k, k)]));
  return input;
}

export function firstCreationReference(input: unknown, path = ""): { reference: RecipeReference; path: string } | undefined {
  if (isRecipeReference(input)) return { reference: input, path };
  if (input && typeof input === "object") for (const [key, value] of Object.entries(input)) {
    const found = firstCreationReference(value, path ? `${path}.${key}` : key);
    if (found) return found;
  }
}
