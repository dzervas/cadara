import type { SemanticCommand, SemanticDiscovery } from "./schema";
import type { DurableRef } from "@/contracts/shared/references";
import type { CreationOutput } from "./recipe-references";

export interface SemanticCreationOutput {
  output: CreationOutput;
  target: DurableRef;
  /** Ordered authored fit-point identity, including repeated occurrences. */
  pointIds?: readonly string[];
}

/** Publication replaces the private action-context owner with the durable sketch
 * owner. Point/entity IDs are retained; this is an explicit ownership transition,
 * not a guessed label match. Historical authority snapshots remain immutable. */
export function advanceSemanticCreations(bindings: Map<string, readonly SemanticCreationOutput[]>, command: SemanticCommand, before: SemanticDiscovery | undefined, after: SemanticDiscovery | null) {
  if (command.operation !== "sketch.publish") return;
  const from = before?.sketch?.sketchId, to = after?.sketch?.sketchId;
  if (!from || !to || from === to) return;
  for (const [alias, outputs] of bindings) bindings.set(alias, outputs.map(output =>
    "sketchId" in output.target && output.target.sketchId === from
      ? { ...output, target: { ...output.target, sketchId: to } } : output));
}

/**
 * Creation/result seam shared by recording and replay. A singleton delta has
 * exactly one authored slot; spline points use the entity's authored pointIds,
 * NOT reference/entity/point discovery order. Multi-output producers without
 * an authored ordering contract are deliberately not assigned ordinal slots.
 */
export function semanticCreationOutputs(command: SemanticCommand, before: SemanticDiscovery | undefined, after: SemanticDiscovery | null): readonly SemanticCreationOutput[] {
  const sketch = after?.sketch;
  if (!sketch?.sketchId) return [];
  const sketchId = sketch.sketchId;
  if (command.operation === "sketch.begin")
    return [{ output: { kind: "sketch", role: "sketch", index: 0 }, target: { kind: "sketch", sketchId } }];
  if (command.operation === "sketch.dimension.add") {
    const prior = new Set([...(before?.sketch?.requirements ?? []), ...(before?.sketch?.measurements ?? [])].map(d => d.dimensionId));
    const added = [...sketch.requirements, ...sketch.measurements].filter(d => !prior.has(d.dimensionId));
    return added.length === 1 ? [{ output: { kind: "dimension", role: "dimension", index: 0 }, target: { kind: "dimension", sketchId, dimensionId: added[0]!.dimensionId } }] : [];
  }
  if (command.operation !== "sketch.author") return [];
  const priorPoints = new Set(before?.sketch?.points.map(p => p.pointId));
  if (command.primitive.kind === "point") {
    const added = sketch.points.filter(p => !priorPoints.has(p.pointId));
    const priorEntities = new Set(before?.sketch?.entities.map(e => e.entityId));
    const entities = sketch.entities.filter(e => !priorEntities.has(e.entityId));
    const outputs: SemanticCreationOutput[] = added.length === 1 ? [{ output: { kind: "sketchPoint", role: "authoredPoint", index: 0 }, target: { kind: "sketchPoint", sketchId, pointId: added[0]!.pointId } }] : [];
    if (entities.length === 1) outputs.push({ output: { kind: "sketchEntity", role: "authoredEntity", index: 0 }, target: { kind: "sketchEntity", sketchId, entityId: entities[0]!.entityId } });
    return outputs;
  }
  const priorEntities = new Set(before?.sketch?.entities.map(e => e.entityId));
  const added = sketch.entities.filter(e => !priorEntities.has(e.entityId));
  if (added.length !== 1) return [];
  const entity = added[0]!;
  const outputs: SemanticCreationOutput[] = [{ output: { kind: "sketchEntity", role: "authoredEntity", index: 0 }, target: { kind: "sketchEntity", sketchId, entityId: entity.entityId }, ...(entity.kind === "spline" ? { pointIds: [...entity.pointIds] } : {}) }];
  entity.pointIds.forEach((pointId, index) => outputs.push({ output: { kind: "sketchPoint", role: entity.kind === "spline" ? "fitPoint" : "authoredPoint", index }, target: { kind: "sketchPoint", sketchId, pointId } }));
  return outputs;
}
