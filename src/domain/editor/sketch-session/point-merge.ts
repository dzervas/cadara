import type { SketchSessionState, SketchEditToolState } from "./types";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import type { SketchEditOperationResult } from "@/core/sketch-editing/operations";
import {
  createSketchMergePointsMutation,
  MERGE_POINTS_NON_LOCAL_MESSAGE,
  MERGE_POINTS_SAME_POINT_MESSAGE,
  getSketchMergePointRefusal,
} from "@/core/sketch-editing/merge-points";
import { refusedEditOperation } from "./offset-editing";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import { buildSketchEditToolPresentation } from "./edit-tool-activation";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import {
  withLiveSolveBasis,
  hasAcceptedLiveSolveOfDefinition,
} from "./session-live-solve";
import { rebuildSessionCommitRequest } from "./tool-authoring";
import { getSketchSessionInvalidFeedback } from "./session-feedback";

/**
 * T13j (D25): the Merge Points picks, resolved to this sketch's point ids in
 * pick order (source, then destination). A Point-tool entity pick stands for
 * its point.
 */
function getSketchMergePointIds(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
): SketchPointId[] {
  return targets.flatMap((target) => {
    const pointId = getSketchMergeTargetPointId(session, target);
    return pointId ? [pointId] : [];
  });
}

function getSketchMergeTargetPointId(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchPointId | null {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  if (target.kind === "sketchPoint" && target.sketchId === sketchId)
    return target.pointId;
  if (target.kind === "sketchEntity" && target.sketchId === sketchId) {
    const entity = session.definition.entities.find(
      (record) => record.entityId === target.entityId,
    );
    return entity?.kind === "point" ? entity.pointId : null;
  }
  return null;
}

function getSketchMergePoint(
  session: SketchSessionState,
  pointId: SketchPointId,
) {
  return session.definition.points.find((point) => point.pointId === pointId);
}

/** The source→destination arrow (a preview polyline; no geometry is authored). */
function createSketchMergeArrow(
  from: SketchPoint,
  to: SketchPoint,
): SketchDraftEntity[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) return [];
  const ux = (from[0] - to[0]) / length;
  const uy = (from[1] - to[1]) / length;
  const head = length / 4;
  const barb = (angle: number): SketchPoint => [
    to[0] + head * (ux * Math.cos(angle) - uy * Math.sin(angle)),
    to[1] + head * (ux * Math.sin(angle) + uy * Math.cos(angle)),
  ];
  return [
    {
      id: "merge-points-arrow",
      kind: "polyline",
      points: [from, to, barb(Math.PI / 7), to, barb(-Math.PI / 7)],
      isClosed: false,
      entityId: null,
      status: "preview",
      label: "Merge direction",
      isConstruction: true,
    },
  ];
}

export function getSketchMergePointsResult(
  session: SketchSessionState,
  tool: SketchEditToolState,
): SketchEditOperationResult {
  const [source, destination] = getSketchMergePointIds(
    session,
    tool.selectedTargets,
  );
  if (!source || !destination)
    return {
      valid: false,
      message: null,
      definition: null,
      contribution: null,
      previewEntities: [],
    };
  const result = createSketchMergePointsMutation({
    definition: session.definition,
    sourcePointId: source,
    destinationPointId: destination,
  });
  if (!result.valid) return refusedEditOperation(result.message);
  return {
    valid: true,
    message: null,
    definition: result.definition,
    contribution: null,
    previewEntities: createSketchMergeArrow(
      getSketchMergePoint(session, source)!.position,
      getSketchMergePoint(session, destination)!.position,
    ),
  };
}

/**
 * T13j: the Merge Points presentation. After the second pick the
 * destination carries a "Destination" label (the editor selection, the
 * last pick, gives it the selection accent), the preview draws the
 * source→destination arrow, and a floating Merge/Cancel confirms; Enter
 * confirms too (`getEnterEvent`). `notice` reports a completed merge.
 */
export function buildSketchMergePointsPresentation(
  session: SketchSessionState,
  tool: SketchEditToolState,
  validationMessage: string | null = null,
  notice: string | null = null,
): SketchToolPresentationSchema {
  const base = buildSketchEditToolPresentation(tool, validationMessage);
  const [source, destination] = getSketchMergePointIds(
    session,
    tool.selectedTargets,
  ).map((pointId) => getSketchMergePoint(session, pointId));
  // T17f (T17-9′, as T16d review R-1 for Mirror): the popup shows exactly
  // when Enter confirms (`isSketchMergePointsReady`): a valid staged pair,
  // with a refused later pick's message shown alongside, not hiding it.
  const ready = getSketchMergePointsResult(session, tool).valid;
  const text =
    notice ??
    (source && destination
      ? `Merge ${source.label} into ${destination.label} — Enter or Merge to confirm`
      : source
        ? `Pick the destination for ${source.label}`
        : getSketchEditToolDefinition(tool.toolId).metadata.validationMessages
            .emptySelection);
  const label = (
    id: string,
    text: string,
    point: SketchPoint,
  ): NonNullable<SketchToolPresentationSchema["overlays"]>[number] => ({
    id,
    kind: "referenceLabel",
    label: text,
    // Centred above the point; the confirm popup sits below (review R-3).
    anchor: { kind: "sketchPoint", point, offset: { x: 0, y: -24 } },
  });
  return {
    ...base,
    prompts: [
      {
        id: `${tool.toolId}-prompt`,
        text,
        tone:
          validationMessage || (notice && session.validationMessage)
            ? "warning"
            : notice
              ? "success"
              : "neutral",
      },
    ],
    overlays: destination
      ? [label("merge-points-destination", "Destination", destination.position)]
      : source
        ? [label("merge-points-source", "Source", source.position)]
        : [],
    completionHints: [
      {
        id: `${tool.toolId}-completion`,
        text: ready ? "Confirm merge" : text,
        ready,
      },
    ],
    floatingInput:
      ready && source && destination
        ? {
            id: "merge-points-confirm",
            label: "Merge Points",
            value: null,
            readout: `${source.label} → ${destination.label}`,
            confirmOnly: true,
            confirmLabel: "Merge",
            cancelLabel: "Cancel",
            placement: "target",
            // The popup grows up from its anchor: its bottom edge 140 px
            // below the destination, centred, so it clears the point, the
            // "Destination" label above it and a short arrow (review R-3).
            anchor: {
              kind: "sketchPoint",
              point: destination.position,
              offset: { x: -110, y: 140 },
            },
            submitAction: { type: "patch", patch: { intent: "mergePoints" } },
            cancelAction: {
              type: "patch",
              patch: { intent: "cancelSketchEditOperator" },
            },
          }
        : null,
  };
}

/** Whether Enter confirms the active tool's ready merge (T13j). */
export function isSketchMergePointsReady(session: SketchSessionState) {
  const tool = session.activeEditTool;
  return (
    tool?.toolId === "sketchMergePoints" &&
    getSketchMergePointsResult(session, tool).valid
  );
}

export function withSketchMergePointsTool(
  session: SketchSessionState,
  tool: SketchEditToolState,
  validationMessage: string | null,
): SketchSessionState {
  const preview = getSketchMergePointsResult(session, tool);
  return {
    ...session,
    activeEditTool: tool,
    toolStagedEntities: preview.previewEntities,
    toolPresentation: buildSketchMergePointsPresentation(
      session,
      tool,
      validationMessage,
    ),
  };
}

/**
 * T17f (T17-9′, as T16d review A-3 for Mirror): after Undo/Redo rebuilds the
 * definition, Merge Points' picks are re-judged against it, so its arrow,
 * popup and Enter agree at once: a pick whose point is gone is dropped, a
 * pair that is now refused shows its refusal with no popup, and a valid one
 * keeps the rebuilt session's own message.
 */
export function restageSketchMergePointsTool(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool?.toolId !== "sketchMergePoints" || tool.selectedTargets.length === 0)
    return session;
  const selectedTargets = tool.selectedTargets.filter((target) => {
    const pointId = getSketchMergeTargetPointId(session, target);
    return pointId !== null && getSketchMergePoint(session, pointId);
  });
  const next: SketchEditToolState = {
    ...tool,
    selectedTarget: selectedTargets[0] ?? null,
    selectedTargets,
  };
  const pair = getSketchMergePointsResult(session, next);
  return withSketchMergePointsTool(
    session,
    next,
    pair.valid || pair.message === null
      ? (session.toolPresentation?.validation?.[0]?.message ?? null)
      : pair.message,
  );
}

/**
 * T13j: a Merge Points pick. The first pick is the source, the second the
 * destination; a later pick replaces the destination, and picking the
 * destination again unpicks it. A refused pick (its own refusal, or the
 * pair's) is not taken and its message is shown.
 */
export function selectSketchMergePointsTarget(
  session: SketchSessionState,
  tool: SketchEditToolState,
  target: PrimitiveRef,
): SketchSessionState {
  const pointId = getSketchMergeTargetPointId(session, target);
  if (!pointId)
    return withSketchMergePointsTool(
      session,
      tool,
      target.kind === "sketchEntity" || target.kind === "sketchPoint"
        ? getSketchEditToolDefinition(tool.toolId).metadata.validationMessages
            .unsupportedTarget
        : MERGE_POINTS_NON_LOCAL_MESSAGE,
    );
  const picked = getSketchMergePointIds(session, tool.selectedTargets);
  const sourceTargets = tool.selectedTargets.slice(0, 1);
  if (picked.length === 2 && picked[1] === pointId)
    return withSketchMergePointsTool(
      session,
      { ...tool, selectedTargets: sourceTargets, hoverTarget: null },
      null,
    );
  if (picked[0] === pointId)
    return withSketchMergePointsTool(
      session,
      tool,
      MERGE_POINTS_SAME_POINT_MESSAGE,
    );
  const refusal = getSketchMergePointRefusal(session.definition, pointId);
  if (refusal) return withSketchMergePointsTool(session, tool, refusal);
  const selectedTargets = [...sourceTargets, target];
  const next: SketchEditToolState = {
    ...tool,
    selectedTarget: selectedTargets[0] ?? null,
    selectedTargets,
    hoverTarget: null,
  };
  const pair = getSketchMergePointsResult(session, next);
  // A refused pair keeps the picks as they were (review A-4).
  return pair.valid || pair.message === null
    ? withSketchMergePointsTool(session, next, null)
    : withSketchMergePointsTool(session, tool, pair.message);
}

/** Apply explicit connectivity through the production merge owner, without picking or UI state. */
export function prepareSketchPointMerge(session: SketchSessionState, sourcePointId: SketchPointId, destinationPointId: SketchPointId) {
  const result = createSketchMergePointsMutation({ definition: session.definition, sourcePointId, destinationPointId });
  if (!result.valid) return { result, session };
  return {
    result,
    session: withLiveSolveBasis({
      ...session,
      definition: result.definition,
      sequence: session.sequence + 1,
      commitRequest: rebuildSessionCommitRequest(session, result.definition),
      toolStagedEntities: [],
      activeEditTarget: null,
      activeDrag: null,
    }, result.definition),
  };
}

/**
 * T13j (D25): confirm the merge as one definition change. The normal commit
 * solve follows (no solve gate): a conflict is retained and explained with
 * the retargeted requirements named first; absorbed coincidents and a
 * positional spline closure are announced. The tool stays armed.
 */
export function commitSketchMergePoints(
  session: SketchSessionState,
  tool: SketchEditToolState,
): SketchSessionState {
  const [source, destination] = getSketchMergePointIds(
    session,
    tool.selectedTargets,
  );
  if (!source || !destination) return session;
  const prepared = prepareSketchPointMerge(session, source, destination);
  const { result } = prepared;
  if (!result.valid)
    return withSketchMergePointsTool(session, tool, result.message);
  const sourceLabel = getSketchMergePoint(session, source)!.label;
  const destinationLabel = getSketchMergePoint(session, destination)!.label;
  const absorbed = result.absorbedConstraintIds.length;
  const closedSpline = session.definition.entities.find(
    (entity) => entity.entityId === result.closedSplineEntityId,
  );
  const notice = [
    `Merged ${sourceLabel} into ${destinationLabel}.`,
    absorbed === 1
      ? "1 coincident between them is now part of the merge."
      : absorbed > 1
        ? `${absorbed} coincidents between them are now part of the merge.`
        : null,
    closedSpline ? `${closedSpline.label} is now closed.` : null,
  ]
    .filter((part) => part !== null)
    .join(" ");
  const reset: SketchEditToolState = {
    ...tool,
    selectedTarget: null,
    selectedTargets: [],
    hoverTarget: null,
  };
  const committed = { ...prepared.session, activeEditTool: reset };
  // The merge is the committed change: the explanation names it (review A-1).
  // T15b (O-1): explained whenever profiles are unavailable (as after Undo/Redo).
  const explanation =
    committed.liveRegions.status !== "unavailable"
      ? null
      : getSketchSessionInvalidFeedback(
          committed,
          result.retargetedRequirementIds,
          hasAcceptedLiveSolveOfDefinition(session),
        );
  const validationMessage =
    explanation === null
      ? null
      : `Merging ${sourceLabel} into ${destinationLabel}: ${explanation}`;
  const next = { ...committed, validationMessage };
  return {
    ...next,
    toolPresentation: buildSketchMergePointsPresentation(
      next,
      reset,
      null,
      notice,
    ),
  };
}
