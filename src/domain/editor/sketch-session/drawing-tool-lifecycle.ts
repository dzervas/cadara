import type { SketchSessionState, SketchAuthoringToolId } from "./types";
import type {
  SketchConstraintToolId,
  SketchConstraintTargetRecord,
} from "@/core/sketch-constraints/definition";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getSketchConstraintDefinition,
  resolveSketchConstraintTarget,
  isRegisteredSketchConstraintToolId,
} from "@/core/sketch-constraints/registry";
import {
  getTargetKey,
  isDrawingSketchTool,
  withConstructionFlag,
} from "./tool-authoring";
import {
  prepareSketchConstraintCommit,
  isSketchConstraintReadyForValue,
  canSketchConstraintSelectMoreTargets,
  authorSketchConstraintTarget,
  activateSketchConstraintTool,
} from "./constraints";
import {
  beginSketchConstructionTool,
  beginSketchReferenceTool,
  beginSketchEditTool,
} from "./edit-tool-activation";
import { isRegisteredSketchEditToolId } from "@/core/sketch-edit-tools/registry";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import type { SketchToolRuntimeState } from "@/core/sketch-tools/definition";
import { getToolRuntimeState } from "./tool-presentation";
import {
  withPlacementPresentation,
  isSketchToolChainActive,
} from "./tool-placement";
import { commitSketchDraw } from "./drawing-commit";
import { isSketchConstructionSelected } from "./state";
import { getSketchSessionInvalidFeedback } from "./session-feedback";
import { keptSketchWithheldRegionText } from "./region-feedback";

/**
 * cadara-h026.2: a constraint or Dimension tool activated on the
 * preselection adopts the targets it resolves, in selection order, and
 * reports which (the editor selection keeps them while the tool holds them).
 * A tool with a `selectionExpansion` commits more targets than its steps at
 * once (Horizontal on N lines constrains each, Equal chains them); any other
 * tool takes them as picks, so a complete pick set commits (or, for a value
 * tool, previews its value) and a partial one arms the tool with them. With
 * nothing resolved the tool is armed as usual and adopts nothing.
 */
export function beginSketchConstraintToolFromSelection(
  current: SketchSessionState,
  toolId: SketchConstraintToolId,
  selection: readonly PrimitiveRef[],
): { session: SketchSessionState; adopted: PrimitiveRef[] } {
  let session = beginSketchTool(current, toolId);
  const definition = getSketchConstraintDefinition(toolId);
  const candidates: { target: PrimitiveRef; resolvedKey: string }[] = [];
  const resolved: SketchConstraintTargetRecord[] = [];
  for (const target of selection) {
    const record = resolveSketchConstraintTarget(
      toolId,
      session.definition,
      target,
      session.projectedReferences,
    );
    const resolvedKey = record ? getTargetKey(record.target) : null;
    if (
      !record ||
      !resolvedKey ||
      candidates.some((candidate) => candidate.resolvedKey === resolvedKey)
    )
      continue;
    candidates.push({ target, resolvedKey });
    resolved.push(record);
  }

  if (
    definition.selectionExpansion &&
    resolved.length > definition.steps.length
  ) {
    session = prepareSketchConstraintCommit(session, {
      ...session.constraintAuthoring!,
      selectedTargets: resolved,
    }).session;
  } else {
    for (const record of resolved.slice(0, definition.steps.length)) {
      // A commit ends the authoring; a complete value pick set waits.
      const authoring = session.constraintAuthoring;
      if (
        !authoring ||
        (isSketchConstraintReadyForValue(
          definition,
          authoring.selectedTargets,
        ) &&
          !canSketchConstraintSelectMoreTargets(
            definition,
            authoring.selectedTargets,
          ))
      )
        break;
      session = authorSketchConstraintTarget(session, record.target).session;
    }
  }

  const heldKeys = new Set(
    session.constraintAuthoring?.selectedTargets.map((entry) =>
      getTargetKey(entry.target),
    ) ?? [],
  );
  return {
    session,
    adopted: candidates
      .filter((candidate) => heldKeys.has(candidate.resolvedKey))
      .map((candidate) => candidate.target),
  };
}

export function beginSketchTool(
  current: SketchSessionState,
  toolId: SketchAuthoringToolId,
  initialSelectedTargets: readonly PrimitiveRef[] = [],
): SketchSessionState {
  // Any (re)activation ends an active Line chain (T11-D14, review A-7).
  const session = current.toolChain ? { ...current, toolChain: null } : current;

  if (toolId === "construction") {
    return beginSketchConstructionTool(session);
  }

  if (toolId === "projectReference") {
    return beginSketchReferenceTool(session);
  }

  if (isRegisteredSketchConstraintToolId(toolId)) {
    return {
      ...activateSketchConstraintTool(session, toolId),
      constructionTargetPicking: false,
      referenceTargetPicking: false,
    };
  }

  if (isRegisteredSketchEditToolId(toolId)) {
    return beginSketchEditTool(session, toolId, initialSelectedTargets);
  }

  const toolDefinition = getSketchToolDefinition(toolId);
  const activation = toolDefinition.activate();
  const constructionModifierActive =
    session.constructionModifierActive || session.constructionTargetPicking;

  return {
    ...session,
    activeTool: toolId,
    status: activation.state.status,
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive,
    pointerDownPoint: activation.state.pointerDownPoint,
    livePoint: activation.state.livePoint,
    toolPlacedPoints: activation.state.placedPoints ?? [],
    toolSettings: activation.state.settings ?? {},
    toolStagedEntities: [],
    toolPresentation: activation.presentation,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
  };
}

/** Fit-point clicks are draft state, not authored actions. */
export function canUndoSketchDraftPoint(session: SketchSessionState): boolean {
  if (!isDrawingSketchTool(session.activeTool)) return false;
  const { lifecycle } = getSketchToolDefinition(session.activeTool);
  return (
    typeof lifecycle === "object" &&
    lifecycle.kind === "fitPoints" &&
    session.toolPlacedPoints.length > 0
  );
}

export function undoSketchDraftPoint(
  session: SketchSessionState,
): SketchSessionState {
  if (
    !canUndoSketchDraftPoint(session) ||
    !isDrawingSketchTool(session.activeTool)
  ) {
    return session;
  }

  const tool = getSketchToolDefinition(session.activeTool);
  const placedPoints = session.toolPlacedPoints.slice(0, -1);
  const placements = (session.toolPlacements ?? []).slice(0, -1);
  const runtimeState: SketchToolRuntimeState = {
    ...getToolRuntimeState(session),
    status: placedPoints.length ? "drawing" : "idle",
    pointerDownPoint: placedPoints[0] ?? null,
    livePoint: null,
    placedPoints,
    validationMessage: null,
  };
  return {
    ...session,
    status: runtimeState.status,
    pointerDownPoint: runtimeState.pointerDownPoint,
    livePoint: null,
    toolPlacedPoints: placedPoints,
    toolPlacements: placements,
    toolStartPointId: placedPoints.length ? session.toolStartPointId : null,
    activeInference: null,
    validationMessage: null,
    toolStagedEntities: withConstructionFlag(
      tool.getStagedEntities(runtimeState),
      session.constructionModifierActive,
    ),
    toolPresentation: withPlacementPresentation(
      tool.getPresentation(runtimeState),
      placements,
      null,
    ),
  };
}

/** What one Escape does to an armed drawing tool (T11-D10). */
export type SketchDrawingEscapeStep =
  | "endChain"
  | "finalizeDraft"
  | "cancelDraft"
  | "exitTool";

/**
 * The Escape step order for an armed drawing tool (T11-D10). An open pick
 * chooser consumes Escape before this, in the viewport (T11e). Then: end an
 * active Line chain (Line stays armed); finalize a fit-point draft that has
 * its minimum points (one action, the tool stays armed); cancel any other
 * incomplete draft (no action, the tool stays armed); otherwise leave the
 * tool for Select.
 */
export function resolveSketchDrawingEscapeStep(draft: {
  chainActive: boolean;
  finalizable: boolean;
  incomplete: boolean;
}): SketchDrawingEscapeStep {
  if (draft.chainActive) {
    return "endChain";
  }

  if (draft.finalizable) {
    return "finalizeDraft";
  }

  return draft.incomplete ? "cancelDraft" : "exitTool";
}

export function escapeSketchDrawing(
  session: SketchSessionState,
): SketchDrawingEscapeStep {
  return resolveSketchDrawingEscapeStep({
    chainActive: isSketchToolChainActive(session),
    finalizable: isSketchFitPointDraftFinalizable(session),
    incomplete: session.status === "drawing",
  });
}

/**
 * Whether the armed tool is a fit-point tool (`lifecycle.kind:
 * "fitPoints"`) drawing a draft with at least its minimum placed points.
 */
function isSketchFitPointDraftFinalizable(session: SketchSessionState) {
  if (
    session.status !== "drawing" ||
    !isDrawingSketchTool(session.activeTool)
  ) {
    return false;
  }

  const { lifecycle } = getSketchToolDefinition(session.activeTool);
  return (
    typeof lifecycle === "object" &&
    session.toolPlacedPoints.length >= lifecycle.minimum
  );
}

/**
 * Finalizes a viable fit-point draft (T11-D10, D13): one definition change
 * through every placed point, with the start snap and the snap accepted on
 * the last fit point; the tool stays armed and idle. Anything else is left
 * unchanged (review A-9).
 */
export function finalizeSketchDraw(
  session: SketchSessionState,
): SketchSessionState {
  if (
    !isSketchFitPointDraftFinalizable(session) ||
    !isDrawingSketchTool(session.activeTool)
  ) {
    return session;
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const activation = toolDefinition.activate();
  const points = session.toolPlacedPoints;

  return commitSketchDraw(
    session,
    toolDefinition,
    {
      state: { ...activation.state, placedPoints: points },
      stagedEntities: [],
      presentation: activation.presentation,
    },
    points[0]!,
    points.at(-1)!,
    session.toolPlacements ?? [],
  );
}

/**
 * What Enter does to an armed drawing tool: the Escape steps that complete
 * something (end a chain, finalize a viable fit-point draft), else nothing,
 * so Enter is not consumed (T11-D10, review A-9).
 */
export function confirmSketchDrawing(
  session: SketchSessionState,
): Extract<SketchDrawingEscapeStep, "endChain" | "finalizeDraft"> | null {
  const step = escapeSketchDrawing(session);
  return step === "endChain" || step === "finalizeDraft" ? step : null;
}

export function clearActiveSketchTool(
  session: SketchSessionState,
): SketchSessionState {
  if (
    session.activeTool === null &&
    !isSketchConstructionSelected(session) &&
    !session.referenceTargetPicking &&
    !session.activeStyleFocus
  ) {
    return session;
  }

  return {
    ...session,
    activeTool: null,
    status: "idle",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolStagedEntities: [],
    // T17k2 (T17k F-1): leaving a tool keeps the sketch's own explanation
    // (as point selection and Undo/Redo do); the tool's messages go.
    validationMessage: keptSketchStatusText(session),
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
    toolChain: null,
  };
}

/**
 * The status line that belongs to the sketch, not to a tool: the invalid
 * sketch's explanation while its profiles are blocked (T17c3), else a
 * withheld region's explanation (T17c6), else none.
 */
export function keptSketchStatusText(session: SketchSessionState) {
  return session.liveRegions.status === "unavailable"
    ? (getSketchSessionInvalidFeedback(session) ??
        "Sketch profiles are unavailable until the sketch is corrected.")
    : keptSketchWithheldRegionText(session);
}
