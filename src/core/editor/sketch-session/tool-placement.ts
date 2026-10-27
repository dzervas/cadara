import type { SketchSessionState, SketchToolChain } from "./types";
import { isDrawingSketchTool, withConstructionFlag } from "./tool-authoring";
import type { SketchToolId } from "@/core/sketch-tools/definition";
import {
  inferPlacement,
  inferPlacementFromCandidate,
} from "@/core/sketch-inference/placement-inference";
import type { PlacementInference } from "@/core/sketch-inference/placement-inference";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import {
  getSketchSessionSolvedSnapshot,
  getSketchSessionSnapIntersections,
} from "./session-live-solve";
import { getTangentArcSourceDirection } from "@/core/sketch-inference/tangent-arc-source";
import type {
  SketchToolPresentationSchema,
  SketchToolOverlayDescriptor,
} from "@/core/sketch-tools/editor-schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";

/**
 * Reconciles the armed drawing tool's draft with a restored definition
 * (T11-D12: Undo, Redo and every other restore). T13-D21: each placed
 * click's inference is recomputed through the owner at its raw position,
 * with its stored scale, against the restored geometry, so a point an Undo
 * moved or removed no longer pulls the commit; the click's position and
 * badge follow the recomputed inference. An active Line chain keeps its
 * records and is restaged from its committed prefix
 * (`restageSketchToolChain`).
 */
export function reconcileSketchToolDraft(
  session: SketchSessionState,
): SketchSessionState {
  const placements = session.toolPlacements ?? [];
  const reconciled: SketchSessionState = {
    ...session,
    activeInference: null,
    ...(placements.length > 0 && isDrawingSketchTool(session.activeTool)
      ? reinferSketchToolPlacements(session, session.activeTool, placements)
      : {}),
  };

  return session.toolChain && isSketchToolChainActive(session)
    ? restageSketchToolChain(reconciled, session.toolChain)
    : reconciled;
}

function reinferSketchToolPlacements(
  session: SketchSessionState,
  toolId: SketchToolId,
  placements: readonly PlacementInference[],
): Partial<SketchSessionState> {
  const toolDefinition = getSketchToolDefinition(toolId);
  const solvedSnapshot = getSketchSessionSolvedSnapshot(session);
  const recomputed = placements.map((placement, index) =>
    inferPlacement({
      toolId,
      role: placement.role,
      // R-7: a Tangent arc's first click re-picks its source structurally.
      ...(toolDefinition.structuralTangentSource && index === 0
        ? {
            tangentSource: {
              previousEntityId: session.toolTangentSourceEntityId ?? null,
            },
          }
        : {}),
      definition: session.definition,
      projectedReferences: session.projectedReferences,
      pointer: placement.rawPosition,
      solvedSnapshot,
      exactIntersections: getSketchSessionSnapIntersections(session),
      sketchUnitsPerPixel: placement.sketchUnitsPerPixel,
      // Only a Line end aligns to its start, and a Line end commits at once.
      anchor: null,
      activeCandidateKey: placement.candidate?.key ?? null,
      // T13-D22: a click placed free stays free.
      suppressed: placement.suppressed,
    }),
  );
  // O25: restored source geometry owns the direction too, not just the
  // endpoint badge. Losing the source cancels the draft rather than authoring
  // a dangling tangent or reusing the removed curve's old direction.
  if (toolDefinition.structuralTangentSource) {
    const source = recomputed[0] && getTangentArcSourceDirection(session.definition,
      recomputed[0].tangentSourceEntityId ?? null, recomputed[0].position, solvedSnapshot);
    if (!source) {
      const state: import("@/core/sketch-tools/definition").SketchToolRuntimeState = { status: "idle", pointerDownPoint: null, livePoint: null,
        placedPoints: [], settings: {}, validationMessage: "Pick a curve end (line, arc or spline)." };
      return { status: "idle", pointerDownPoint: null, livePoint: null, toolPlacedPoints: [],
        toolSettings: {}, toolPlacements: [], toolStagedEntities: [], toolTangentSourceEntityId: null,
        toolPresentation: toolDefinition.getPresentation(state) };
    }
    session = { ...session, toolSettings: { ...session.toolSettings,
      tangentDirectionX: source.direction[0], tangentDirectionY: source.direction[1],
      tangentSourceCenterX: source.center?.[0] ?? null, tangentSourceCenterY: source.center?.[1] ?? null,
    } };
  }
  const positions = recomputed.map((placement) => placement.position);
  const pointerDownPoint = positions[0] ?? session.pointerDownPoint;
  const toolPlacedPoints =
    session.toolPlacedPoints.length > 0 ? positions : session.toolPlacedPoints;

  return {
    toolPlacements: recomputed,
    pointerDownPoint,
    toolPlacedPoints,
    // The badges show the recomputed inferences at once, without a pointer
    // move (T13g review RQ-1).
    toolPresentation: withPlacementPresentation(
      toolDefinition.getPresentation({
        status: session.status === "drawing" ? "drawing" : "idle",
        pointerDownPoint,
        livePoint: session.livePoint,
        placedPoints: toolPlacedPoints,
        settings: session.toolSettings,
        validationMessage: session.toolPresentation?.validation?.[0]?.message ?? null,
      }),
      recomputed,
      null,
    ),
    ...(toolDefinition.structuralTangentSource
      ? {
          toolTangentSourceEntityId:
            recomputed[0]?.tangentSourceEntityId ?? null,
          toolSettings: session.toolSettings,
        }
      : {}),
  };
}

/**
 * The draft's placement badges (T13-D15): every placed click keeps its
 * snap glyph and inference text, so every requirement the commit will
 * author is visible before the final click; `active` is the live one.
 */
export function withPlacementPresentation(
  presentation: SketchToolPresentationSchema,
  placements: readonly PlacementInference[],
  active: PlacementInference | null,
): SketchToolPresentationSchema {
  const overlays = [
    ...(active?.suppressed && active.text
      ? [getSuppressedPlacementOverlay(active)]
      : active
        ? getPlacementOverlays("active-snap", active)
        : []),
    ...placements.flatMap((placement, index) =>
      getPlacementOverlays(`placement-${index + 1}-snap`, placement),
    ),
  ];

  return overlays.length === 0
    ? presentation
    : {
        ...presentation,
        overlays: [...(presentation.overlays ?? []), ...overlays],
      };
}

/**
 * T13-D22: the live placement under suppression says it is free where a
 * snap was available, at the raw pointer (it has no snap glyph).
 */
function getSuppressedPlacementOverlay(
  inference: PlacementInference,
): SketchToolOverlayDescriptor {
  return {
    id: "active-snap-suppressed",
    kind: "referenceLabel",
    label: inference.text,
    anchor: {
      kind: "sketchPoint",
      point: inference.rawPosition,
      offset: { x: 18, y: -18 },
    },
  };
}

/** T13-D22: Shift held or the "Snap & infer" toggle off. */
export function isSketchInferenceSuppressed(
  session: Pick<
    SketchSessionState,
    "inferenceSuppressionHeld" | "inferenceSuppressionToggled"
  >,
) {
  return Boolean(
    session.inferenceSuppressionHeld || session.inferenceSuppressionToggled,
  );
}

function getPlacementOverlays(
  id: string,
  inference: PlacementInference,
): SketchToolOverlayDescriptor[] {
  const { candidate } = inference;
  if (!candidate) {
    return [];
  }

  return [
    ...(inference.requirements.length > 0 || inference.tangentSourceEntityId
      ? [
          {
            id: `${id}-inferred-constraint`,
            kind: "constraintPreview" as const,
            label: "Inferred constraint",
            detail: inference.text,
            anchor: {
              kind: "sketchPoint" as const,
              point: candidate.point,
              offset: { x: 18, y: 18 },
            },
          },
        ]
      : []),
    {
      id,
      kind: "snapIndicator",
      label: inference.text,
      point: candidate.point,
      candidateKind: candidate.kind,
      glyphKind: candidate.preview.glyph,
    },
  ];
}

/**
 * Whether a chain is active: the armed tool chains its segments
 * (`lifecycle: "chain"`), is drawing, and has chain records (review R-1).
 */
export function isSketchToolChainActive(
  session: Pick<SketchSessionState, "activeTool" | "status" | "toolChain">,
) {
  return (
    Boolean(session.toolChain) &&
    session.status === "drawing" &&
    isDrawingSketchTool(session.activeTool) &&
    getSketchToolDefinition(session.activeTool).lifecycle === "chain"
  );
}

/**
 * The committed prefix of a chain: the longest prefix of its segments whose
 * entities all exist in the definition (T11-D12).
 */
export function getCommittedSketchToolChainSegments(
  chain: SketchToolChain,
  definition: SketchDefinition,
): SketchToolChain["segments"] {
  const missing = chain.segments.findIndex(
    (segment) =>
      !definition.entities.some(
        (entity) => entity.entityId === segment.entityId,
      ),
  );

  return missing === -1 ? chain.segments : chain.segments.slice(0, missing);
}

/**
 * Stages the next segment of a chain (T11-D11/D12): the draft starts at the
 * anchor, the end point of the last committed segment (or the chain start
 * when no segment is committed), at its current definition position. The
 * anchor is the draft's structural start (T13-D20: not a snap, never
 * suppressed), so the next segment reuses its id. A chain start whose point no longer exists keeps
 * only its position. The rubber band is restaged from `livePoint`.
 */
export function restageSketchToolChain(
  session: SketchSessionState,
  chain: SketchToolChain,
): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
    return session;
  }

  // The last committed segment's current end point (review A-1), else the
  // chain start.
  const lastSegment = getCommittedSketchToolChainSegments(
    chain,
    session.definition,
  ).at(-1);
  const lastEntity = session.definition.entities.find(
    (entity) => entity.entityId === lastSegment?.entityId,
  );
  const anchorPointId =
    lastEntity?.kind === "lineSegment"
      ? lastEntity.endPointId
      : chain.start.pointId;
  const anchorPoint = session.definition.points.find(
    (point) => point.pointId === anchorPointId,
  );
  const anchor = anchorPoint?.position ?? chain.start.position;
  const result = getSketchToolDefinition(session.activeTool).pointerMove({
    state: {
      status: "drawing",
      pointerDownPoint: anchor,
      livePoint: null,
      placedPoints: [],
      settings: session.toolSettings,
      validationMessage: null,
    },
    point: session.livePoint ?? anchor,
  });

  return {
    ...session,
    toolChain: chain,
    status: "drawing",
    pointerDownPoint: anchor,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? [],
    toolStagedEntities: withConstructionFlag(
      result.stagedEntities,
      session.constructionModifierActive,
    ),
    toolPresentation: result.presentation,
    activeInference: null,
    // D20: the next segment starts structurally at the anchor's id; a
    // vanished chain start is a placement at its position that authors
    // nothing.
    toolPlacements: anchorPoint
      ? []
      : [
          inferPlacementFromCandidate(
            {
              toolId: session.activeTool,
              role: "point",
              definition: session.definition,
            },
            {
              candidate: null,
              rawPosition: anchor,
              sketchUnitsPerPixel: session.sketchUnitsPerPixel ?? null,
            },
          ),
        ],
    toolStartPointId: anchorPoint?.pointId ?? null,
  };
}
