import type {
  SketchSessionState,
  SketchConstraintAuthoringState,
  SketchSnapIntersectionCache,
} from "./types";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { updateSketchOffsetPointer } from "./offset-editing";
import { updateSketchSplitPointer } from "./edit-queries";
import {
  isRegisteredSketchConstraintToolId,
  getSketchConstraintDefinition,
  inferDimensionAnnotationPlacement,
} from "@/core/sketch-constraints/registry";
import {
  isSketchConstraintReadyForValue,
  buildConstraintToolPresentation,
} from "./constraints";
import { isDrawingSketchTool, withConstructionFlag } from "./tool-authoring";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import { getToolRuntimeState } from "./tool-presentation";
import {
  withPlacementPresentation,
  isSketchInferenceSuppressed,
} from "./tool-placement";
import type { SketchToolRuntimeState } from "@/core/sketch-tools/definition";
import { inferPlacement } from "@/domain/sketch-inference/placement-inference";
import type { PlacementInference } from "@/domain/sketch-inference/placement-inference";
import { getSketchSessionDisplaySolvedSnapshot } from "./solved-snapshot";
import {
  getSketchSessionSnapIntersections,
  hasAcceptedLiveSolveOfDefinition,
} from "./session-live-solve";
import {
  getSketchSnapIntersectionTargets,
  getSketchExactIntersections,
} from "@/domain/sketch-snapping/snap-candidates";
import type { SketchSnapIntersectionTargetResult } from "@/contracts/sketch/edit-intersections";

export function updateSketchPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  if (session.activeEditTool?.toolId === "offset") {
    return updateSketchOffsetPointer(session, point);
  }

  if (session.activeEditTool?.toolId === "sketchSplit" || session.activeEditTool?.toolId === "trim") {
    return updateSketchSplitPointer(session, point);
  }

  if (
    session.activeTool !== null &&
    isRegisteredSketchConstraintToolId(session.activeTool)
  ) {
    if (!session.constraintAuthoring) {
      return session;
    }

    if (session.constraintAuthoring.isPreviewPinned) {
      return session;
    }

    const pendingAnnotationPlacement = isSketchConstraintReadyForValue(
      getSketchConstraintDefinition(session.constraintAuthoring.toolId),
      session.constraintAuthoring.selectedTargets,
    )
      ? inferDimensionAnnotationPlacement(
          session.constraintAuthoring.selectedTargets,
          point,
        )
      : session.constraintAuthoring.pendingAnnotationPlacement;

    if (
      sketchPointsEqual(session.constraintAuthoring.pointer, point) &&
      dimensionAnnotationPlacementsEqual(
        session.constraintAuthoring.pendingAnnotationPlacement,
        pendingAnnotationPlacement,
      )
    ) {
      return session;
    }

    const nextAuthoring: SketchConstraintAuthoringState = {
      ...session.constraintAuthoring,
      pointer: point,
      pendingAnnotationPlacement,
    };

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
      activeInference: null,
    };
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    return session.activeInference
      ? { ...session, activeInference: null }
      : session;
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const inference = previewSketchPlacement(session, point);
  const result = toolDefinition.pointerMove({
    state: getToolRuntimeState(session),
    point: inference?.position ?? point,
  });

  const nextSession: SketchSessionState = {
    ...session,
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
      session.toolPlacements ?? [],
      inference,
    ),
    activeInference: inference,
  };

  return sketchPointerPreviewStateEqual(session, nextSession)
    ? session
    : nextSession;
}

function sketchPointerPreviewStateEqual(
  current: SketchSessionState,
  next: SketchSessionState,
) {
  return (
    current.status === next.status &&
    sketchPointsEqual(current.pointerDownPoint, next.pointerDownPoint) &&
    sketchPointsEqual(current.livePoint, next.livePoint) &&
    sketchPointArraysEqual(current.toolPlacedPoints, next.toolPlacedPoints) &&
    current.toolSettings === next.toolSettings &&
    current.validationMessage === next.validationMessage &&
    current.activeInference?.candidate?.key ===
      next.activeInference?.candidate?.key &&
    sketchDraftEntitiesEqual(
      current.toolStagedEntities,
      next.toolStagedEntities,
    ) &&
    JSON.stringify(current.toolPresentation) ===
      JSON.stringify(next.toolPresentation)
  );
}

function sketchPointsEqual(
  left: SketchPoint | null,
  right: SketchPoint | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    Math.abs(left[0] - right[0]) <= 1e-9 && Math.abs(left[1] - right[1]) <= 1e-9
  );
}

function sketchPointArraysEqual(
  left: readonly SketchPoint[],
  right: readonly SketchPoint[],
) {
  return (
    left.length === right.length &&
    left.every((point, index) => sketchPointsEqual(point, right[index] ?? null))
  );
}

function dimensionAnnotationPlacementsEqual(
  left: import("@/contracts/sketch/schema").DimensionAnnotationPlacement | null,
  right:
    | import("@/contracts/sketch/schema").DimensionAnnotationPlacement
    | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function sketchDraftEntitiesEqual(
  left: readonly import("@/core/sketch-tools/definition").SketchDraftEntity[],
  right: readonly import("@/core/sketch-tools/definition").SketchDraftEntity[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * How many clicks of the armed drawing tool's draft are placed: a drawing
 * two-click tool (or Line chain) has its start, a fixed-point or fit-point
 * tool its placed points.
 */
export function getPlacedClickCount(
  state: Pick<SketchToolRuntimeState, "status" | "placedPoints">,
) {
  return state.status === "drawing"
    ? Math.max(1, state.placedPoints?.length ?? 0)
    : 0;
}

/**
 * T13-D15: the live inference of the armed drawing tool's next click at
 * `point`, through the one owner: where it places and what its commit will
 * author. Null without a pointer or a drawing tool.
 */
export function previewSketchPlacement(
  session: SketchSessionState,
  point: SketchPoint | null,
): PlacementInference | null {
  if (!point || !isDrawingSketchTool(session.activeTool)) {
    return null;
  }

  const index = getPlacedClickCount({
    status: session.status === "drawing" ? "drawing" : "idle",
    placedPoints: session.toolPlacedPoints,
  });
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  // R-7: a Tangent arc's first click picks its tangent source; the pick is
  // structural, so suppression keeps it (the owner frees the rest).
  const tangentSourcePick =
    Boolean(toolDefinition.structuralTangentSource) && index === 0;
  return inferPlacement({
    toolId: session.activeTool,
    role: toolDefinition.placementRole(index),
    ...(tangentSourcePick
      ? {
          tangentSource: {
            previousEntityId:
              session.activeInference?.tangentSourceEntityId ?? null,
          },
        }
      : {}),
    definition: session.definition,
    projectedReferences: session.projectedReferences,
    lineStartPointId:
      index === 1
        ? (session.toolStartPointId ??
          session.toolPlacements?.[0]?.requirements.find(
            (requirement) => requirement.kind === "joins",
          )?.pointId ??
          null)
        : null,
    pointer: point,
    solvedSnapshot: getSketchSessionDisplaySolvedSnapshot(session),
    exactIntersections: getSketchSessionSnapIntersections(session),
    sketchUnitsPerPixel: session.sketchUnitsPerPixel ?? null,
    anchor: session.status === "drawing" ? session.pointerDownPoint : null,
    activeCandidateKey: session.activeInference?.candidate?.key ?? null,
    suppressed: isSketchInferenceSuppressed(session),
  });
}

/**
 * T13-D22: records Shift held (`held`) or the "Snap & infer" toggle
 * (`inferenceEnabled`). Session UI state only: nothing is authored. When the
 * effective suppression changes, the live placement preview is recomputed
 * at the last pointer, with no pointer motion.
 */
export function setSketchInferenceSuppression(
  session: SketchSessionState,
  change: { held: boolean } | { inferenceEnabled: boolean },
): SketchSessionState {
  const next: SketchSessionState =
    "held" in change
      ? { ...session, inferenceSuppressionHeld: change.held }
      : { ...session, inferenceSuppressionToggled: !change.inferenceEnabled };
  if (
    Boolean(next.inferenceSuppressionHeld) ===
      Boolean(session.inferenceSuppressionHeld) &&
    Boolean(next.inferenceSuppressionToggled) ===
      Boolean(session.inferenceSuppressionToggled)
  ) {
    return session;
  }

  const pointer = session.activeInference?.rawPosition ?? null;
  return pointer &&
    isSketchInferenceSuppressed(next) !== isSketchInferenceSuppressed(session)
    ? updateSketchPointer(next, pointer)
    : next;
}

/**
 * T13i: the accepted live basis a snap query may run on while a drawing tool
 * is armed: the accepted live solve of the current definition (with offset
 * relationships, once its publication round is current, as for Trim).
 */
function getSnapQueryBasis(session: SketchSessionState) {
  const liveSolve = session.liveSolve;
  return isDrawingSketchTool(session.activeTool) &&
    liveSolve &&
    hasAcceptedLiveSolveOfDefinition(session) &&
    !(
      (session.definition.derivedRelationships ?? []).some(
        (relationship) => relationship.kind === "offset",
      ) && session.liveRegions.status === "pending"
    )
    ? liveSolve
    : null;
}

/** The stage of `cache`'s basis after `cutters` (A-3), or the ready cache. */
function nextSnapStage(
  cache: Omit<
    SketchSnapIntersectionCache,
    "queryId" | "input" | "status" | "stage"
  >,
  liveSolve: NonNullable<SketchSessionState["liveSolve"]>,
  modelingTolerance: number,
  stages: readonly ("curves" | "splines")[],
): SketchSnapIntersectionCache {
  for (const cutters of stages) {
    const targetEntityIds = getSketchSnapIntersectionTargets(
      liveSolve.definition,
      liveSolve.solvedSnapshot,
      modelingTolerance,
      cutters,
    );
    if (targetEntityIds.length > 0)
      return {
        ...cache,
        queryId: `snap-query-${crypto.randomUUID()}`,
        stage: cutters,
        status: "pending",
        input: {
          definition: liveSolve.definition,
          solvedSnapshot: liveSolve.solvedSnapshot,
          projectedReferences: liveSolve.projectedReferences,
          modelingTolerance,
          targetEntityIds,
          cutters,
        },
      };
  }
  return {
    ...cache,
    queryId: `snap-query-${crypto.randomUUID()}`,
    stage: null,
    status: "ready",
    input: null,
  };
}

/**
 * T13i (D24 with T13 review R-3): the spline intersection snap cache of the
 * accepted live basis (`getSnapQueryBasis`), planned once per basis while a
 * drawing tool is armed. A new basis replaces the cache with its first
 * pending stage (review A-3: spline × line/circle/arc first, then spline ×
 * spline; each stage's targets are `getSketchSnapIntersectionTargets`), or
 * a ready empty cache when no spline box meets another curve. Unchanged
 * otherwise.
 */
export function planSketchSnapIntersectionQuery(
  session: SketchSessionState,
): SketchSessionState {
  const liveSolve = getSnapQueryBasis(session);
  if (
    !liveSolve ||
    session.snapIntersections?.solvedSnapshot === liveSolve.solvedSnapshot
  ) {
    return session;
  }
  return {
    ...session,
    snapIntersections: nextSnapStage(
      { solvedSnapshot: liveSolve.solvedSnapshot, intersections: [] },
      liveSolve,
      session.modelingTolerance,
      ["curves", "splines"],
    ),
  };
}

/**
 * T13i: the pending stage the editor must issue: the current basis's
 * pending stage when it is not the query in flight (`inFlightQueryId`), e.g.
 * a new basis, the next stage, or a stage restored by Undo. Else null.
 */
export function getSketchSnapIntersectionQueryToIssue(
  session: SketchSessionState,
  inFlightQueryId: string | null,
): SketchSnapIntersectionCache | null {
  const cache = session.snapIntersections;
  return cache?.status === "pending" &&
    cache.queryId !== inFlightQueryId &&
    getSnapQueryBasis(session)?.solvedSnapshot === cache.solvedSnapshot
    ? cache
    : null;
}

/**
 * T13i: the results of the snap stage `queryId` (dropped unless it is the
 * cache's pending stage). Its intersections are offered at once (review
 * A-3: spline × line/circle/arc never wait for spline × spline); after the
 * `curves` stage the `splines` stage follows when there is one. The live
 * placement preview is recomputed at the last pointer, so a crossing
 * already hovered shows without pointer motion.
 */
export function completeSketchSnapIntersectionQuery(
  session: SketchSessionState,
  queryId: string,
  targets: readonly SketchSnapIntersectionTargetResult[],
): SketchSessionState {
  const cache = session.snapIntersections;
  if (!cache || cache.queryId !== queryId || cache.status !== "pending")
    return session;
  const published = {
    solvedSnapshot: cache.solvedSnapshot,
    intersections: [
      ...cache.intersections,
      ...getSketchExactIntersections(cache.input!.definition, targets),
    ],
  };
  const liveSolve = session.liveSolve;
  const next: SketchSessionState = {
    ...session,
    snapIntersections:
      cache.stage === "curves" &&
      liveSolve?.solvedSnapshot === cache.solvedSnapshot
        ? nextSnapStage(published, liveSolve, session.modelingTolerance, [
            "splines",
          ])
        : { ...cache, ...published, status: "ready" },
  };
  const pointer = session.activeInference?.rawPosition ?? null;
  return pointer ? updateSketchPointer(next, pointer) : next;
}

/** T13i: a failed snap query offers no spline intersections for its basis. */
export function failSketchSnapIntersectionQuery(
  session: SketchSessionState,
  queryId: string,
): SketchSessionState {
  const cache = session.snapIntersections;
  if (!cache || cache.queryId !== queryId || cache.status !== "pending")
    return session;
  return { ...session, snapIntersections: { ...cache, status: "failed" } };
}
