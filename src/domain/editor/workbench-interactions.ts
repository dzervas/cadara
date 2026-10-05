import type {
  AuthoringReopenRequestedEvent,
  EditorEvent,
  EditorViewState,
} from "@/domain/editor/state-machine";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { PrimitiveRef, SelectionFilter } from "@/core/editor/schema";
import { primitiveRefEquals } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { resolveHandleFromTarget } from "@/domain/editor/sketch-session/drag-intent";
import { getRegisteredFeatureAuthoringDefinitions } from "@/core/feature-authoring/registry";
import {
  confirmSketchDrawing,
  getActiveSketchStyleToolId,
  isSketchConstructionSelected,
  type SketchAuthoringToolId,
  type SketchSessionStatus,
} from "@/domain/editor/sketch-session";
import { isRegisteredSketchEditToolId } from "@/core/sketch-edit-tools/registry";
import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import { isRegisteredSketchToolId } from "@/core/sketch-tools/registry";

export function getNavigationReopenRequest(
  snapshot: WorkspaceSnapshot | null,
  target: PrimitiveRef,
): AuthoringReopenRequestedEvent | null {
  if (target.kind === "sketch") {
    return {
      type: "authoring.reopenRequested",
      target,
      toolId: "sketch",
    };
  }

  if (target.kind !== "feature" || !snapshot) {
    return null;
  }

  const feature = snapshot.document.features.find(
    (entry) => entry.featureId === target.featureId,
  );

  if (!feature) {
    return null;
  }

  const featureDefinition = getRegisteredFeatureAuthoringDefinitions().find(
    (entry) => entry.metadata.toolId === feature.definition.kind,
  );

  if (!featureDefinition) {
    return null;
  }

  return {
    type: "authoring.reopenRequested",
    target,
    toolId: featureDefinition.metadata.toolId,
  };
}

export function getEscapeEvent(
  state: Pick<
    EditorViewState,
    | "activeCommand"
    | "activeReferencePickerFieldId"
    | "selection"
    | "sketchSession"
  >,
): EditorEvent | null {
  // Escape during an active drag cancels the drag and does nothing else (D2).
  if (state.sketchSession?.activeDrag) {
    return { type: "sketch.geometryDragCancelled" };
  }

  if (state.activeReferencePickerFieldId) {
    return { type: "form.referencePickerCancelled" };
  }

  // Drawing tools take Escape in steps (T11-D10); edit, constraint and
  // special-mode tools keep the single-Escape exit.
  if (
    state.sketchSession?.activeTool &&
    isRegisteredSketchToolId(state.sketchSession.activeTool)
  ) {
    return { type: "sketch.escapeRequested" };
  }

  if (
    state.sketchSession?.activeTool ||
    (state.sketchSession &&
      isSketchConstructionSelected(state.sketchSession)) ||
    (state.sketchSession && getActiveSketchStyleToolId(state.sketchSession))
  ) {
    return { type: "sketch.activeToolCleared" };
  }

  if (!state.sketchSession && state.activeCommand) {
    return {
      type: "command.cancelled",
      commandSessionId: state.activeCommand.commandSessionId,
    };
  }

  if (state.selection.length > 0) {
    return { type: "selection.cleared" };
  }

  return null;
}

/**
 * Enter ends a Line chain or finalizes a viable fit-point draft; otherwise it
 * is not consumed (T11-D10).
 */
export function getEnterEvent(
  state: Pick<EditorViewState, "sketchSession">,
): EditorEvent | null {
  const session = state.sketchSession;

  return session?.activeTool &&
    isRegisteredSketchToolId(session.activeTool) &&
    confirmSketchDrawing(session) !== null
    ? { type: "sketch.confirmRequested" }
    : null;
}

export function shouldViewportClickRequestSelection(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
) {
  return (
    activeSketchTool == null ||
    activeSketchTool === "construction" ||
    activeSketchTool === "projectReference" ||
    isRegisteredSketchEditToolId(activeSketchTool) ||
    isRegisteredSketchConstraintToolId(activeSketchTool)
  );
}

export function shouldViewportStartSketchGeometryDrag(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
  sketchStatus: SketchSessionStatus | null | undefined,
) {
  if (sketchStatus !== "idle") {
    return false;
  }

  return activeSketchTool == null || isRegisteredSketchToolId(activeSketchTool);
}

export function shouldViewportDoubleClickRequestConnectedSketchSelection({
  activeSketchTool,
  sketchStatus,
  target,
}: {
  activeSketchTool: SketchAuthoringToolId | null | undefined;
  sketchStatus: SketchSessionStatus | null | undefined;
  target: PrimitiveRef | null;
}) {
  if (target?.kind !== "sketchEntity") {
    return false;
  }

  return (
    activeSketchTool == null ||
    (sketchStatus === "idle" && isRegisteredSketchToolId(activeSketchTool))
  );
}

export function shouldViewportClickEventRequestConnectedSketchSelection({
  activeSketchTool,
  clickDetail,
  sketchStatus,
  target,
}: {
  activeSketchTool: SketchAuthoringToolId | null | undefined;
  clickDetail: number;
  sketchStatus: SketchSessionStatus | null | undefined;
  target: PrimitiveRef | null;
}) {
  return (
    clickDetail > 1 &&
    shouldViewportDoubleClickRequestConnectedSketchSelection({
      activeSketchTool,
      sketchStatus,
      target,
    })
  );
}

export type ViewportCanvasClickIntent =
  | "clearSelection"
  | "ignore"
  | "selectTarget";

export function getViewportCanvasClickIntent({
  activeSketchTool,
  hasResolvedTarget,
  isBackgroundDatumTarget = false,
  selectionFilterKind = null,
}: {
  activeSketchTool: SketchAuthoringToolId | null | undefined;
  hasResolvedTarget: boolean;
  isBackgroundDatumTarget?: boolean;
  selectionFilterKind?: SelectionFilter["kind"] | null;
}): ViewportCanvasClickIntent {
  if (
    !hasResolvedTarget ||
    (isBackgroundDatumTarget &&
      shouldTreatBackgroundDatumClickAsEmpty(
        activeSketchTool,
        selectionFilterKind,
      ))
  ) {
    return "clearSelection";
  }

  return shouldViewportClickRequestSelection(activeSketchTool)
    ? "selectTarget"
    : "ignore";
}

function shouldTreatBackgroundDatumClickAsEmpty(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
  selectionFilterKind: SelectionFilter["kind"] | null,
) {
  if (
    selectionFilterKind === "sketchStart" ||
    selectionFilterKind === "planeReferences"
  ) {
    return false;
  }

  return activeSketchTool !== "construction";
}

/**
 * D3 drag target resolution: given a pick stack and the current selection,
 * return the target to drag.
 *
 * If the current selection contains a draggable candidate that appears in the
 * pick stack, use that one (most recently selected first). Otherwise use
 * `stack[0]` if draggable. Otherwise return null (no drag).
 */
export function resolveSketchDragTarget(
  stack: readonly { target: PrimitiveRef }[],
  selection: readonly PrimitiveRef[],
  definition: SketchDefinition,
): PrimitiveRef | null {
  // D3: the selected draggable candidate in the pointer's stack wins
  // (most recently selected first).
  // D3a exception: a selected *spline entity* never overrides its own
  // sub-targets (fit points and tangent-handle tips) that are in the
  // stack — selecting the spline is how handles are revealed, so
  // pressing a revealed handle or fit point drags that sub-target.
  for (let i = selection.length - 1; i >= 0; i--) {
    const sel = selection[i]!;
    if (
      !stack.some((entry) => primitiveRefEquals(entry.target, sel)) ||
      resolveHandleFromTarget(definition, sel) === null
    ) {
      continue;
    }
    // D3a: skip if sel is a spline entity and the stack contains one of
    // its own sub-targets (a fit point or handle belonging to the spline).
    if (sel.kind === "sketchEntity") {
      const entity = definition.entities.find(
        (e) => e.entityId === sel.entityId,
      );
      if (
        entity?.kind === "spline" &&
        stack.some(
          (entry) =>
            (entry.target.kind === "sketchTangentHandle" &&
              entry.target.entityId === sel.entityId) ||
            (entry.target.kind === "sketchPoint" &&
              entity.pointOccurrences.some(
                (occ) =>
                  occ.pointId ===
                  (entry.target as { pointId?: string }).pointId,
              )),
        )
      ) {
        continue;
      }
    }
    return sel;
  }
  // T12d: a handle tip in the stack beats an arbitrary stack[0] entity
  // (e.g. when the spline entity is in the stack from curve proximity
  // but only the handle is the precise target).
  const handleInStack = stack.find(
    (entry) => entry.target.kind === "sketchTangentHandle",
  );
  if (
    handleInStack &&
    resolveHandleFromTarget(definition, handleInStack.target) !== null
  ) {
    return handleInStack.target;
  }
  // Fall back to stack[0].
  if (stack.length > 0) {
    const top = stack[0]!;
    if (resolveHandleFromTarget(definition, top.target) !== null) {
      return top.target;
    }
  }
  return null;
}
