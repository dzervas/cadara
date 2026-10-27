import type { SketchSessionState } from "./types";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  isDrawingSketchTool,
  withConstructionFlag,
  createSessionCommitFactories,
} from "./tool-authoring";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import { previewSketchPlacement, getPlacedClickCount } from "./drawing-pointer";
import type {
  SketchToolRuntimeState,
  SketchToolDefinition,
  SketchToolPointerResult,
  SketchToolCommitContribution,
} from "@/core/sketch-tools/definition";
import { getTangentArcSourceDirection } from "@/core/sketch-inference/tangent-arc-source";
import { getSketchSessionDisplaySolvedSnapshot } from "./solved-snapshot";
import {
  withPlacementPresentation,
  getCommittedSketchToolChainSegments,
  restageSketchToolChain,
} from "./tool-placement";
import { getToolRuntimeState } from "./tool-presentation";
import { bindPlacementInferences } from "@/core/sketch-inference/placement-inference";
import type { PlacementInference } from "@/core/sketch-inference/placement-inference";
import { keptSketchWithheldRegionText } from "./region-feedback";
import type { SketchId } from "@/contracts/shared/ids";
import { createConstraintId } from "./session-definition";
import { applySketchContribution } from "./definition-authoring";
import { buildCommitRequest } from "./history";
import { withLiveSolveBasis } from "./session-live-solve";
import { sketchPrimitiveContributionInput } from "@/core/sketch-tools/semantic-primitive";

export function startSketchDraw(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
    return session;
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const inference = previewSketchPlacement(session, point)!;
  const startPoint = inference.position;
  const result = toolDefinition.pointerRelease({
    state: {
      status: "idle",
      pointerDownPoint: null,
      livePoint: null,
      placedPoints: [],
      settings: session.toolSettings,
      validationMessage: null,
    } satisfies SketchToolRuntimeState,
    point: startPoint,
    tangentSource: toolDefinition.structuralTangentSource
      ? getTangentArcSourceDirection(session.definition, inference.tangentSourceEntityId ?? null, startPoint, getSketchSessionDisplaySolvedSnapshot(session))
      : null,
  });
  // A draft started from idle never continues a chain (review R-1).
  const fresh: SketchSessionState = {
    ...session,
    toolChain: null,
    toolStartPointId: null,
    toolPlacements: [],
    // R-7: a Tangent arc records its tangent source at its first click.
    toolTangentSourceEntityId: inference.tangentSourceEntityId ?? null,
  };

  // A one-click tool (Point, T11-D19) completes on its first release.
  if (
    result.state.status === "idle" &&
    result.state.validationMessage === null
  ) {
    return commitSketchDraw(
      fresh,
      toolDefinition,
      result,
      startPoint,
      startPoint,
      [inference],
    );
  }

  const placements = getPlacedClickCount(result.state) > 0 ? [inference] : [];
  return {
    ...fresh,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(
      result.stagedEntities,
      session.constructionModifierActive,
    ),
    toolPresentation: withPlacementPresentation(
      result.presentation,
      placements,
      placements.length > 0 ? null : inference,
    ),
    activeInference: inference,
    toolPlacements: placements,
  };
}

export function acceptSketchDraw(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool) ||
    session.pointerDownPoint === null
  ) {
    return session;
  }

  const startPoint = session.pointerDownPoint;
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  // The release commits the inference the preview shows at the (flushed)
  // release point, with the same hysteresis state (D15).
  const inference = previewSketchPlacement(session, point)!;
  const endPoint = inference.position;
  const runtimeState = getToolRuntimeState(session);
  const result = toolDefinition.pointerRelease({
    state: runtimeState,
    point: endPoint,
  });
  const previousPlacements = session.toolPlacements ?? [];
  // An ignored or refused release places nothing.
  const placed =
    getPlacedClickCount(result.state) > getPlacedClickCount(runtimeState);
  const placements = placed
    ? [...previousPlacements, inference]
    : previousPlacements;

  if (result.state.validationMessage || result.state.status !== "idle") {
    return {
      ...session,
      toolStagedEntities: result.state.validationMessage
        ? []
        : withConstructionFlag(
            result.stagedEntities,
            session.constructionModifierActive,
          ),
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
      toolSettings: result.state.settings ?? session.toolSettings,
      toolPresentation: withPlacementPresentation(
        result.presentation,
        placements,
        placed ? null : inference,
      ),
      activeInference: inference,
      toolPlacements: placements,
    };
  }

  return commitSketchDraw(
    session,
    toolDefinition,
    result,
    startPoint,
    endPoint,
    [...previousPlacements, inference],
  );
}

/**
 * Commits a completed draw as one definition change. The release `result`
 * completed the tool; `placements` are the inferences of every placed click
 * (the last one the release's), which the commit binds unchanged (D15). A
 * Line chain segment starts structurally at `toolStartPointId` (D20).
 */
export function commitSketchDraw(
  session: SketchSessionState,
  toolDefinition: SketchToolDefinition,
  result: SketchToolPointerResult,
  startPoint: SketchPoint,
  endPoint: SketchPoint,
  placements: readonly PlacementInference[],
): SketchSessionState {
  const prepared = prepareSketchContribution(session, toolDefinition, {
    start: startPoint,
    end: endPoint,
    points: result.state.placedPoints ?? [startPoint, endPoint],
    settings: result.state.settings ?? session.toolSettings,
    placements,
  });
  const { definitionPatch } = prepared;
  const committed: SketchSessionState = {
    ...prepared.session,
    toolStagedEntities: [],
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.status === "idle" ? [] : (result.state.placedPoints ?? session.toolPlacedPoints),
    toolSettings: result.state.status === "idle" ? {} : (result.state.settings ?? session.toolSettings),
    // Keep the withheld status until the new region result decides; unavailable
    // commits have no region result and retain the previous clearing behavior.
    validationMessage: prepared.session.liveRegions.status === "unavailable"
      ? null : keptSketchWithheldRegionText(session),
    toolPresentation: result.presentation,
    activeAnnotationEdit: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
  };
  return toolDefinition.lifecycle === "chain"
    ? continueSketchToolChain(session, committed, definitionPatch, startPoint)
    : committed;
}

/** Shared contribution/identity/inference preparation, independent of pointer lifecycle. */
function prepareSketchContribution(
  session: SketchSessionState,
  toolDefinition: SketchToolDefinition,
  input: { start: SketchPoint; end: SketchPoint; points: readonly SketchPoint[]; settings: SketchToolRuntimeState["settings"]; placements: readonly PlacementInference[] | null },
) {
  const nextSequence = session.sequence + 1;
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const baseDefinitionPatch = toolDefinition.createCommitContribution({
    sequence: nextSequence,
    start: input.start,
    end: input.end,
    points: input.points,
    settings: input.settings ?? {},
    isConstruction: session.constructionModifierActive,
    tangentSourceEntityId: session.toolTangentSourceEntityId ?? null,
    factories: createSessionCommitFactories(nextSequence, sketchId, session.constructionModifierActive),
  });
  const structuralStartPointId = session.toolStartPointId ?? null;
  const definitionPatch = input.placements === null ? baseDefinitionPatch : bindPlacementInferences({
    patch: baseDefinitionPatch,
    placements: structuralStartPointId ? [null, ...input.placements] : input.placements,
    structuralStartPointId,
    sequence: nextSequence,
    createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
  });
  const { definition } = applySketchContribution(session, definitionPatch);
  const next = { ...session, definition, sequence: nextSequence, commitRequest: buildCommitRequest({ sketchId: session.sketchId, sketchLabel: session.sketchLabel, plane: session.plane, definition }) };
  return { definitionPatch, session: withLiveSolveBasis(next, definition) };
}

/** A completed semantic intent enters this helper only inside the authored-action transition. */
export function authorSketchPrimitive(session: SketchSessionState, primitive: import("@/contracts/semantic/schema").SemanticSketchPrimitive, construction: boolean): SketchSessionState {
  const tool = getSketchToolDefinition(primitive.kind);
  const input = sketchPrimitiveContributionInput(primitive);
  const prepared = prepareSketchContribution({ ...session, constructionModifierActive: construction, toolStartPointId: null, toolTangentSourceEntityId: primitive.kind === "tangentArc" ? primitive.source?.entityId ?? null : null }, tool, input);
  return { ...prepared.session, constructionModifierActive: session.constructionModifierActive };
}

/**
 * After a committed chain segment (T11-D11): the chain continues from the
 * segment's end point, whose id the next segment reuses. A new commit after
 * Undo first drops the records past the committed prefix (T11-D12). A
 * segment ending on the chain's own first point closes the loop: the chain
 * ends and the tool stays armed (Q1).
 */
function continueSketchToolChain(
  before: SketchSessionState,
  committed: SketchSessionState,
  patch: SketchToolCommitContribution,
  startPosition: SketchPoint,
): SketchSessionState {
  const segment = patch.entities.find(
    (entity) => entity.kind === "lineSegment",
  );
  if (segment?.kind !== "lineSegment") {
    return committed;
  }

  const prefix = before.toolChain
    ? getCommittedSketchToolChainSegments(before.toolChain, before.definition)
    : [];
  const start =
    before.toolChain && prefix.length > 0
      ? before.toolChain.start
      : { pointId: segment.startPointId, position: startPosition };

  if (segment.endPointId === start.pointId) {
    return { ...committed, toolChain: null };
  }

  return restageSketchToolChain(committed, {
    start,
    segments: [
      ...prefix,
      {
        entityId: segment.entityId,
        startPointId: segment.startPointId,
        endPointId: segment.endPointId,
      },
    ],
  });
}

/**
 * Stores the screen scale a sketch pointer event measured (T13-D13); snapping
 * resolves against the latest one, and `null` disables it.
 */
export function setSketchSnapScale(
  session: SketchSessionState,
  sketchUnitsPerPixel: number | null,
): SketchSessionState {
  return (session.sketchUnitsPerPixel ?? null) === sketchUnitsPerPixel
    ? session
    : { ...session, sketchUnitsPerPixel };
}
