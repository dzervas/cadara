import { isRegisteredSketchToolId } from "@/core/sketch-tools/registry";
import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import { isRegisteredSketchEditToolId } from "@/core/sketch-edit-tools/registry";
import {
  adoptCompatibleSketchEditToolTargets,
  beginSketchTool,
  focusSketchStyleTool,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  getSketchSessionPreviewLabel,
  isSketchSvgRenderingEnabled,
  moveSketchHistoryCursor,
  toggleSketchSvgRendering,
} from "@/domain/editor/sketch-session";
import {
  cancelSketchSpecialMode,
  commitSketchSpecialMode,
  sketchSessionHasActiveSpecialMode,
} from "@/core/sketch-special-modes/presentation";
import {
  getDefaultSelectionFilterForMode,
  sketchReferenceSelectionFilter,
} from "@/core/editor/schema";
import type {
  EditorEvent,
  EditorState,
  EditorTransitionResult,
  SketchEditorState,
  SketchEvent,
} from "./types";
import type { EditorExtensionDependencies } from "./dependencies";
import {
  emitSketchCommit,
  emitSketchReferenceProjection,
  emitSketchSpecialModeEffect,
  emitEditSessionCursorRestore,
} from "./effect-emitters";
import { toIdleState, withActivationSelection } from "./state-creators";
import { getEditorHistoryAvailability } from "./selectors";
import { isPassiveSketchTool, nextRequestId } from "./utility-helpers";
import {
  handleSketchPointerMoved,
  handleSketchPointerReleased,
  handleSketchToolPatched,
  handleSketchActiveToolCleared,
  handleSketchHistoryCursorRequested,
  handleSketchHistoryOperationDeleteRequested,
  handleSketchAnnotationDeleteRequested,
  handleSketchAnnotationEditRequested,
  handleSketchConnectedSelectionRequested,
  handleSketchGeometryDragStarted,
  handleSketchGeometryDragMoved,
  handleSketchGeometryDragEnded,
  handleSketchReferenceImagePayloadsPicked,
  handleSketchSpecialModeEntered,
  handleSketchSpecialModePanelActionInvoked,
  handleSketchSpecialModeClickRequested,
  handleSketchSpecialModeDoubleClickRequested,
  handleSketchSpecialModeDragStarted,
  handleSketchSpecialModeDragMoved,
  handleSketchSpecialModeDragEnded,
} from "./transitions-sketch";

function createSketchPreviewState(
  state: SketchEditorState,
  session: SketchEditorState["session"],
): SketchEditorState {
  return {
    ...state,
    mode: "sketch",
    session,
    preview: {
      kind: "sketch",
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  };
}

function handleEditingSketchToolActivation(
  state: SketchEditorState,
  event: Extract<SketchEvent, { type: "tool.activated" }>,
): EditorTransitionResult | null {
  if (event.toolId === "finishSketch") {
    return emitSketchCommit(state);
  }

  if (event.toolId === "svgRendering") {
    const session = toggleSketchSvgRendering(state.session);
    return {
      state: createSketchPreviewState(state, session),
      effects: [],
    };
  }

  if (isRegisteredSketchEditToolId(event.toolId)) {
    const adoptedSelection = adoptCompatibleSketchEditToolTargets(
      state.session,
      event.toolId,
      state.selection,
    );
    const activationState = withActivationSelection(state, adoptedSelection);
    const session = beginSketchTool(
      activationState.session,
      event.toolId,
      adoptedSelection,
    );

    return {
      state: {
        ...createSketchPreviewState(activationState, session),
        selectionFilter: getDefaultSelectionFilterForMode("sketch"),
        command: {
          ...activationState.command,
          toolId: event.toolId,
          phase: "editing",
        },
      },
      effects: [],
    };
  }

  if (
    isRegisteredSketchToolId(event.toolId) ||
    isRegisteredSketchConstraintToolId(event.toolId) ||
    event.toolId === "dimension" ||
    event.toolId === "construction" ||
    event.toolId === "projectReference"
  ) {
    const session = beginSketchTool(
      state.session,
      event.toolId === "dimension" ? "dimensionDistance" : event.toolId,
    );

    return {
      state: {
        ...createSketchPreviewState(state, session),
        selectionFilter:
          event.toolId === "projectReference"
            ? sketchReferenceSelectionFilter
            : getDefaultSelectionFilterForMode("sketch"),
        command: {
          ...state.command,
          toolId: event.toolId,
          phase: "editing",
        },
      },
      effects: [],
    };
  }

  if (isPassiveSketchTool(event.toolId)) {
    if (!isSketchSvgRenderingEnabled(state.session)) {
      return { state, effects: [] };
    }

    const session = focusSketchStyleTool(
      state.session,
      state.selection,
      event.toolId,
    );
    return {
      state: {
        ...createSketchPreviewState(state, session),
        command: {
          ...state.command,
          phase: "editing",
        },
      },
      effects: [],
    };
  }

  // Sketch mode only owns sketch-scoped tool activations. Returning null lets the
  // root reducer fall back to shared activation handling for everything else.
  return null;
}

function moveSketchHistory(
  state: SketchEditorState,
  direction: "undo" | "redo",
): EditorTransitionResult {
  const cursor =
    direction === "undo"
      ? getPreviousSketchHistoryCursor(state.session)
      : getNextSketchHistoryCursor(state.session);

  if (!cursor) {
    return { state, effects: [] };
  }

  const session = moveSketchHistoryCursor(state.session, cursor);

  return {
    state: {
      ...state,
      selection: [],
      hoverTarget: null,
      session,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

export function reduceSketchWorkflow(
  state: SketchEditorState,
  event: SketchEvent,
  dependencies: EditorExtensionDependencies,
  transitionEditorState: (
    state: EditorState,
    event: EditorEvent,
  ) => EditorTransitionResult,
): EditorTransitionResult | null {
  switch (event.type) {
    case "tool.activated":
      return handleEditingSketchToolActivation(state, event);
    case "history.undoRequested":
      return getEditorHistoryAvailability(state).canUndo
        ? moveSketchHistory(state, "undo")
        : { state, effects: [] };
    case "history.redoRequested":
      return getEditorHistoryAvailability(state).canRedo
        ? moveSketchHistory(state, "redo")
        : { state, effects: [] };
    case "sketch.draftHistoryRestored":
      return emitSketchReferenceProjection(
        {
          ...state,
          selection: [
            {
              kind: "sketch",
              sketchId: event.session.sketchId ?? ("sketch_draft" as const),
            },
          ],
          hoverTarget: null,
          preview: {
            kind: "sketch",
            label: getSketchSessionPreviewLabel(event.session),
            target: event.session.planeTarget,
          },
        },
        event.session,
      );
    case "command.cancelled":
      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] };
      }

      if (sketchSessionHasActiveSpecialMode(state.session)) {
        const requestId = nextRequestId(state, "sketch-special-cancel");
        const session = cancelSketchSpecialMode(
          state.session,
          dependencies.sketchSpecialModes,
          requestId,
        );
        return emitSketchSpecialModeEffect(
          state,
          session,
          requestId,
          dependencies,
        );
      }

      if (state.editSessionCursorContext?.phase === "active") {
        return emitEditSessionCursorRestore(toIdleState(state, "part"));
      }

      return {
        state: toIdleState(state, "part"),
        effects: [],
      };
    case "command.commitRequested":
      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] };
      }

      if (sketchSessionHasActiveSpecialMode(state.session)) {
        const requestId = nextRequestId(state, "sketch-special-commit");
        const session = commitSketchSpecialMode(
          state.session,
          dependencies.sketchSpecialModes,
          requestId,
        );
        return emitSketchSpecialModeEffect(
          state,
          session,
          requestId,
          dependencies,
        );
      }

      return emitSketchCommit(state);
    case "sketch.connectedSelectionRequested":
      return handleSketchConnectedSelectionRequested(state, event);
    case "sketch.specialModeEntered":
      return handleSketchSpecialModeEntered(
        state,
        event,
        transitionEditorState,
        dependencies,
      );
    case "sketch.specialModePanelActionInvoked":
      return handleSketchSpecialModePanelActionInvoked(
        state,
        event,
        dependencies,
      );
    case "sketch.specialModeClickRequested":
      return handleSketchSpecialModeClickRequested(state, event, dependencies);
    case "sketch.specialModeDoubleClickRequested":
      return handleSketchSpecialModeDoubleClickRequested(
        state,
        event,
        dependencies,
      );
    case "sketch.specialModeDragStarted":
      return handleSketchSpecialModeDragStarted(state, event, dependencies);
    case "sketch.specialModeDragMoved":
      return handleSketchSpecialModeDragMoved(state, event, dependencies);
    case "sketch.specialModeDragEnded":
      return handleSketchSpecialModeDragEnded(state, event, dependencies);
    case "sketch.geometryDragStarted":
      return handleSketchGeometryDragStarted(state, event);
    case "sketch.geometryDragMoved":
      return handleSketchGeometryDragMoved(state, event, dependencies);
    case "sketch.geometryDragEnded":
      return handleSketchGeometryDragEnded(state, event);
    case "sketch.referenceImagePayloadsPicked":
      return handleSketchReferenceImagePayloadsPicked(
        state,
        event,
        transitionEditorState,
      );
    case "sketch.pointerMoved":
      return handleSketchPointerMoved(state, event);
    case "sketch.pointerReleased":
      return handleSketchPointerReleased(state, event);
    case "sketch.toolPatched":
      return handleSketchToolPatched(state, event);
    case "sketch.activeToolCleared":
      return handleSketchActiveToolCleared(state);
    case "sketch.historyCursorRequested":
      return handleSketchHistoryCursorRequested(state, event);
    case "sketch.historyOperationDeleteRequested":
      return handleSketchHistoryOperationDeleteRequested(state, event);
    case "sketch.annotationDeleteRequested":
      return handleSketchAnnotationDeleteRequested(state);
    case "sketch.annotationEditRequested":
      return handleSketchAnnotationEditRequested(state, event);
  }
}
