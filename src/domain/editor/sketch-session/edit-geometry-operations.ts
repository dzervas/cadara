import type { SketchEditToolState, SketchSessionState } from "./types";
import type { SketchEntityId, SketchId } from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createSketchSlotContribution,
  createSketchCornersMutation,
  createSketchDerivedTransformContribution,
} from "@/domain/sketch-editing/operations";
import type { SketchEditOperationResult } from "@/domain/sketch-editing/operations";
import { offsetEditInputGate, refusedEditOperation } from "./offset-editing";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import {
  createSessionCommitFactories,
  getSessionSketchId,
} from "./tool-authoring";
import { completeSketchEditOperation } from "./edit-tool-interaction";
import { isSketchEditQueryTool } from "./edit-queries";
import { getSketchMergePointsResult } from "./point-merge";

export function getSelectedSketchEntityIds(
  activeEditTool: SketchEditToolState,
): SketchEntityId[] {
  return activeEditTool.selectedTargets
    .filter(
      (target): target is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
        target.kind === "sketchEntity",
    )
    .map((target) => target.entityId);
}

/** T15b (review A10): a sketch axis is only the final Sketch Mirror pick. */
export const MIRROR_DATUM_AXIS_ORDER_MESSAGE =
  "Pick the geometry to mirror first, then the sketch axis as the final mirror axis.";

/** Explicit construction inputs shared with browser preview and commit. */
function getSketchCornerSlotResult(
  session: SketchSessionState,
  input: { kind: "fillet" | "chamfer" | "slot"; entityIds: readonly SketchEntityId[]; value: number | null },
): SketchEditOperationResult {
  const toolId = input.kind === "fillet" ? "sketchFillet" : input.kind === "chamfer" ? "sketchChamfer" : "sketchSlot";
  const gate = offsetEditInputGate(session, input.entityIds, `a ${getSketchEditToolDefinition(toolId).metadata.name} input`);
  if (gate) return refusedEditOperation(gate.message);
  const common = {
    definition: session.definition,
    entityIds: input.entityIds,
    sequence: session.sequence + 1,
    factories: createSessionCommitFactories(session.sequence + 1, session.sketchId ?? ("sketch_draft" as SketchId)),
  };
  // cadara-h026.2: Fillet and Chamfer round every corner of their lines.
  return input.kind === "slot"
    ? createSketchSlotContribution({ ...common, width: input.value })
    : createSketchCornersMutation({ ...common, kind: input.kind, value: input.value });
}

export function buildSketchGeometry(
  session: SketchSessionState,
  input: import("@/contracts/semantic/schema").SemanticSketchConstruction,
): SketchSessionState {
  if (!input.targets.length || !input.targets.every(t => t.sketchId === getSessionSketchId(session) && session.definition.entities.some(e => e.entityId === t.entityId)) || new Set(input.targets.map(t => t.entityId)).size !== input.targets.length)
    return { ...session, validationMessage: "Construction targets must be distinct owned sketch entities." };
  const result = getSketchCornerSlotResult(session, { kind: input.kind, entityIds: input.targets.map(t => t.entityId), value: input.kind === "fillet" ? input.radius : input.kind === "chamfer" ? input.distance : input.width });
  return completeSketchEditOperation(session, result);
}

/** Explicit and browser mirrors share the canonical coupled relationship builder. */
function getSketchMirrorResult(
  session: SketchSessionState,
  entityIds: readonly SketchEntityId[],
  mirrorDatumAxis: "xAxis" | "yAxis" | null,
): SketchEditOperationResult {
  const gate = offsetEditInputGate(session, entityIds, `a ${getSketchEditToolDefinition("sketchMirror").metadata.name} input`);
  if (gate) return refusedEditOperation(gate.message);
  const nextSequence = session.sequence + 1;
  return createSketchDerivedTransformContribution({
    definition: session.definition, operatorKind: "mirror", entityIds,
    value: null, sequence: nextSequence,
    factories: createSessionCommitFactories(nextSequence, getSessionSketchId(session)),
    modelingTolerance: session.modelingTolerance, mirrorDatumAxis,
    documentVariables: session.documentVariables,
  });
}

export function createSketchMirror(
  session: SketchSessionState,
  targets: readonly Extract<import("@/contracts/shared/references").DurableRef, { kind: "sketchEntity" }>[],
  axis: Extract<import("@/contracts/shared/references").DurableRef, { kind: "sketchEntity" }> | import("@/contracts/shared/references").SketchDatumReferenceRef,
): SketchSessionState {
  const ids = targets.map(t => t.entityId);
  if (!ids.length || new Set(ids).size !== ids.length || [...targets, axis].some(t => t.sketchId !== getSessionSketchId(session)) ||
      !ids.every(id => session.definition.entities.some(e => e.entityId === id)) ||
      (axis.kind === "sketchEntity" ? ids.includes(axis.entityId) || !session.definition.entities.some(e => e.entityId === axis.entityId) : axis.datumId === "origin" || axis.geometryKind !== "lineSegment"))
    return { ...session, validationMessage: "Mirror requires distinct owned seeds and a separate straight axis." };
  return completeSketchEditOperation(session, getSketchMirrorResult(session,
    axis.kind === "sketchEntity" ? [...ids, axis.entityId] : ids,
    axis.kind === "sketchDatumReference" && axis.datumId !== "origin" ? axis.datumId : null));
}

/** Browser and explicit clients share the production pattern/transform builder and gate. */
function getSketchDerivationResult(
  session: SketchSessionState,
  kind: "linearPattern" | "circularPattern" | "transform",
  entityIds: readonly SketchEntityId[],
  value: number | null,
): SketchEditOperationResult {
  const toolId = kind === "linearPattern" ? "sketchLinearPattern" : kind === "circularPattern" ? "sketchCircularPattern" : "sketchTransform";
  const gate = offsetEditInputGate(session, entityIds, `a ${getSketchEditToolDefinition(toolId).metadata.name} input`);
  if (gate) return refusedEditOperation(gate.message);
  const sequence = session.sequence + 1;
  return createSketchDerivedTransformContribution({
    definition: session.definition, operatorKind: kind, entityIds, value, sequence,
    factories: createSessionCommitFactories(sequence, getSessionSketchId(session)),
    modelingTolerance: session.modelingTolerance,
    documentVariables: session.documentVariables,
  });
}

export function createSketchDerivation(
  session: SketchSessionState,
  input: Extract<import("@/contracts/semantic/schema").SemanticCommand, { operation: "sketch.derivation.create" }>,
): SketchSessionState {
  const ids = input.targets.map(t => t.entityId);
  if (!ids.length || new Set(ids).size !== ids.length || input.targets.some(t => t.sketchId !== getSessionSketchId(session)) ||
      !ids.every(id => session.definition.entities.some(e => e.entityId === id)) || !Number.isFinite(input.value) || input.value <= 0)
    return { ...session, validationMessage: "A derived pattern or transform requires distinct owned seeds and a finite positive setting." };
  return completeSketchEditOperation(session, getSketchDerivationResult(session, input.kind, ids, input.value));
}

export function getSketchEditOperatorResult(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
): SketchEditOperationResult {
  const entityIds = getSelectedSketchEntityIds(activeEditTool);
  // T10i (C3, review A8): one gate over the operation's full input set (its
  // selected targets, boundaries, sources, references and mirror axis),
  // also at commit, which recomputes this result. The edit-query tools
  // (Trim, Extend, Split) gate their clicks themselves.
  if (
    !isSketchEditQueryTool(activeEditTool.toolId) &&
    activeEditTool.toolId !== "offset" &&
    activeEditTool.toolId !== "sketchFillet" &&
    activeEditTool.toolId !== "sketchChamfer" &&
    activeEditTool.toolId !== "sketchSlot" &&
    activeEditTool.toolId !== "sketchMirror" &&
    activeEditTool.toolId !== "sketchLinearPattern" &&
    activeEditTool.toolId !== "sketchCircularPattern" &&
    activeEditTool.toolId !== "sketchTransform"
  ) {
    const gate = offsetEditInputGate(
      session,
      entityIds,
      `a ${getSketchEditToolDefinition(activeEditTool.toolId).metadata.name} input`,
    );
    if (gate) return refusedEditOperation(gate.message);
  }
  switch (activeEditTool.toolId) {
    case "sketchFillet":
      return getSketchCornerSlotResult(session, { kind: "fillet", entityIds, value: activeEditTool.toolValue });
    case "sketchChamfer":
      return getSketchCornerSlotResult(session, { kind: "chamfer", entityIds, value: activeEditTool.toolValue });
    case "sketchSlot":
      return getSketchCornerSlotResult(session, { kind: "slot", entityIds, value: activeEditTool.toolValue });
    case "sketchMirror": {
      // T15b (T-7): a sketch datum axis as the final pick is the axis;
      // review A10: one picked before the seeds is refused, not ignored.
      const last = activeEditTool.selectedTargets.at(-1);
      if (
        activeEditTool.selectedTargets.some(
          (target) => target.kind === "sketchDatumReference" && target !== last,
        )
      )
        return refusedEditOperation(MIRROR_DATUM_AXIS_ORDER_MESSAGE);
      return getSketchMirrorResult(session, entityIds,
        last?.kind === "sketchDatumReference" && last.datumId !== "origin" ? last.datumId : null);
    }
    case "sketchLinearPattern":
      return getSketchDerivationResult(session, "linearPattern", entityIds, activeEditTool.toolValue);
    case "sketchCircularPattern":
      return getSketchDerivationResult(session, "circularPattern", entityIds, activeEditTool.toolValue);
    case "sketchTransform":
      return getSketchDerivationResult(session, "transform", entityIds, activeEditTool.toolValue);
    case "sketchMergePoints":
      return getSketchMergePointsResult(session, activeEditTool);
    case "trim":
    case "sketchExtend":
    case "sketchSplit":
    case "offset":
      return {
        valid: false,
        message: null,
        definition: null,
        contribution: null,
        previewEntities: [],
      };
  }
}
