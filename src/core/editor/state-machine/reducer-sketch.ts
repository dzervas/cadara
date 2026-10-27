import { getPeerDeletedSketchNotice } from "./selectors";
import { authorSketchDimension, authorSketchRequirement } from "@/domain/editor/sketch-session/constraints";
import {
  updateSketchDimensionValue,
  deleteSelectedSketchAnnotation,
  makeSketchAnnotationReference,
} from "@/domain/editor/sketch-session";
import { updateSketchGeometry, setSketchItemLabel } from "@/domain/editor/sketch-session/geometry-actions";
import { applySketchMirrorRemoval, completeSketchMirrorRepair } from "@/domain/editor/sketch-session/mirror-actions";
import { applySketchOffsetRemoval } from "@/domain/editor/sketch-session/offset-actions";
import {
  createSketchDerivation,
  createSketchMirror,
  completeSketchOffset,
  buildSketchGeometry,
  completeSketchIntersectionEdit,
  deleteSelectedSketchGeometry,
} from "@/domain/editor/sketch-session";
import { authorReferenceImage, editReferenceImage } from "@/domain/editor/sketch-session/references";
import { authorSketchStyle } from "@/domain/editor/sketch-session/styles";
import {
  authorSketchReference,
  setSketchConstructionTarget,
  authorSketchPrimitive,
} from "@/domain/editor/sketch-session";
import { isRegisteredSketchToolId } from "@/core/sketch-tools/registry";
import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import { isRegisteredSketchEditToolId } from "@/core/sketch-edit-tools/registry";
import {
  adoptCompatibleSketchEditToolTargets,
  beginSketchConstraintToolFromSelection,
  beginSketchTool,
  cancelSketchGeometryDrag,
  finalizeSketchDraw,
  focusSketchStyleTool,
  getSketchSessionPreviewLabel,
  isSketchSvgRenderingEnabled,
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
import { isMultiSelectionContext } from "./selection-helpers";

import { isPassiveSketchTool, nextRequestId } from "./utility-helpers";
import {
  handleSketchPointerMoved,
  handleSketchPointerReleased,
  handleSketchToolPatched,
  handleSketchActiveToolCleared,
  handleSketchEscapeRequested,
  handleSketchConfirmRequested,
  handleSketchInferenceSuppressionChanged,
  handleSketchShowAllAnnotationsChanged,
  handleSketchAnnotationWheelOpened,
  handleSketchAnnotationWheelClosed,
  handleSketchAnnotationWheelListFilterChanged,
  handleSketchAnnotationDeleteRequested,
  handleSketchAnnotationEditRequested,
  handleSketchConnectedSelectionRequested,
  handleSketchGeometryDragStarted,
  handleSketchGeometryDragMoved,
  handleSketchGeometryDragEnded,
  handleSketchGeometryDragCancelled,
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

/**
 * Finish, by any path (T13-D23, amending T11-D14 for viable drafts): a
 * viable fit-point draft is first finalized as its own creation action,
 * then the sketch is published. Any other unfinished draft is discarded:
 * the commit request never includes it.
 */
function finishSketchSession(state: SketchEditorState): EditorTransitionResult {
  // T17-20 (T17k2): a sketch another session deleted can't be published;
  // Finish does nothing and the author stays (the deleted-sketch notice says
  // why; Discard and leave is the way out). Review R-1: nothing is stored,
  // so nothing goes stale when the sketch comes back.
  if (getPeerDeletedSketchNotice(state) !== null) return { state, effects: [] };
  // O30 (cadara-b3k.2): a Finish while the commit is in flight changes
  // nothing; the pending commit's result decides (see emitSketchCommit).
  if (state.pendingCommitRequestId !== null) return { state, effects: [] };
  const session = finalizeSketchDraw(state.session);
  // T14c: Finish drops the annotation context (a reopened sketch starts
  // without one).
  return emitSketchCommit({ ...state, session, annotationContext: null });
}

function handleEditingSketchToolActivation(
  state: SketchEditorState,
  event: Extract<SketchEvent, { type: "tool.activated" }>,
): EditorTransitionResult | null {
  // Cancel an active drag before any tool switch or Finish (D2).
  if (state.session.activeDrag) {
    const session = cancelSketchGeometryDrag(state.session);
    return handleEditingSketchToolActivation({ ...state, session }, event);
  }

  if (event.toolId === "finishSketch") {
    return finishSketchSession(state);
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

  // cadara-h026.2: constraint and Dimension tools act on the preselection,
  // the no-tool multi-selection (`beginSketchConstraintToolFromSelection`);
  // the selection keeps what the armed tool holds. A commit disarms the
  // tool, so the toolbar shows Select (not while a routed shared-driver edit,
  // which re-arms it, is open). Another tool's picks are no preselection:
  // the selection is cleared.
  if (
    isRegisteredSketchConstraintToolId(event.toolId) ||
    event.toolId === "dimension"
  ) {
    const fromSelection = isMultiSelectionContext(state);
    const { session, adopted } = beginSketchConstraintToolFromSelection(
      state.session,
      event.toolId === "dimension" ? "dimensionDistance" : event.toolId,
      fromSelection ? state.selection : [],
    );
    const activationState = withActivationSelection(state, adopted);

    return {
      state: {
        ...createSketchPreviewState(activationState, session),
        selectionFilter: getDefaultSelectionFilterForMode("sketch"),
        command: {
          ...state.command,
          toolId:
            session.activeTool === null && !session.activeAnnotationEdit?.shared
              ? "sketch"
              : event.toolId,
          phase: "editing",
        },
      },
      effects: [],
    };
  }

  if (
    isRegisteredSketchToolId(event.toolId) ||
    event.toolId === "construction" ||
    event.toolId === "projectReference"
  ) {
    const session = beginSketchTool(state.session, event.toolId);

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
    case "sketch.beginRequested":
    case "sketch.draftRecoveryRequested":
      return { state, effects: [] };
    case "sketch.imageEdited":
      return { state: createSketchPreviewState(state, editReferenceImage(state.session, event.target.operationId, event.edit)), effects: [] };
    case "sketch.imageRemoved":
      return { state: createSketchPreviewState(state, deleteSelectedSketchGeometry(state.session, [event.target])), effects: [] };
    case "sketch.imageAuthored":
      return { state: createSketchPreviewState(state, authorReferenceImage(state.session, event.payload)), effects: [] };
    case "sketch.styleAuthored":
      return { state: createSketchPreviewState(state, authorSketchStyle(state.session, event.targets, event.patch)), effects: [] };
    case "sketch.referenceAuthored": {
      const session = authorSketchReference(state.session, event.target);
      return session.definition === state.session.definition
        ? { state: createSketchPreviewState(state, session), effects: [] }
        : emitSketchReferenceProjection(createSketchPreviewState(state, session), session);
    }
    case "sketch.intersectionEditCompleted":
      return { state: createSketchPreviewState(state, completeSketchIntersectionEdit(state.session, event.basis, event.result).session), effects: [] };
    case "sketch.offsetCompleted":
      return { state: createSketchPreviewState(state, completeSketchOffset(state.session, event.prepared, event.record)), effects: [] };
    case "sketch.derivationCreated":
      return { state: createSketchPreviewState(state, createSketchDerivation(state.session, event.input)), effects: [] };
    case "sketch.mirrorRemoved":
      return { state: createSketchPreviewState(state, applySketchMirrorRemoval(state.session, event.derivationId)), effects: [] };
    case "sketch.mirrorRepaired":
      return { state: createSketchPreviewState(state, completeSketchMirrorRepair(state.session, event.repair, event.target)), effects: [] };
    case "sketch.mirrorCreated":
      return { state: createSketchPreviewState(state, createSketchMirror(state.session, event.targets, event.axis)), effects: [] };
    case "sketch.offsetRemoved":
      return { state: createSketchPreviewState(state, applySketchOffsetRemoval(state.session, event.derivationId)), effects: [] };
    case "sketch.geometryBuilt":
      return { state: createSketchPreviewState(state, buildSketchGeometry(state.session, event.input)), effects: [] };
    case "sketch.geometryUpdated":
      return { state: createSketchPreviewState(state, updateSketchGeometry(state.session, event.edit)), effects: [] };
    case "sketch.geometryDeleted":
      return { state: createSketchPreviewState(state, deleteSelectedSketchGeometry(state.session, event.targets)), effects: [] };
    case "sketch.labelSet":
      return { state: createSketchPreviewState(state, setSketchItemLabel(state.session, event.target, event.label)), effects: [] };
    case "sketch.constructionSet":
      return { state: createSketchPreviewState(state, setSketchConstructionTarget(state.session, event.target, event.construction)), effects: [] };
    case "sketch.primitiveAuthored":
      return { state: createSketchPreviewState(state, authorSketchPrimitive(state.session, event.primitive, event.construction)), effects: [] };
    case "sketch.requirementRemoved":
      return { state: createSketchPreviewState(state, event.targets.reduce((session, target) => deleteSelectedSketchAnnotation(session, [target]), state.session)), effects: [] };
    case "sketch.requirementAuthored":
      return { state: createSketchPreviewState(state, authorSketchRequirement(state.session, event.input)), effects: [] };
    case "sketch.dimensionAuthored":
      return { state: createSketchPreviewState(state, authorSketchDimension(state.session, event.input)), effects: [] };
    case "sketch.dimensionMadeReference":
      return { state: createSketchPreviewState(state, makeSketchAnnotationReference(state.session, { target: { kind: "dimension", sketchId: state.session.sketchId ?? state.session.actionContextId, dimensionId: event.dimensionId }, pendingValue: null })), effects: [] };
    case "sketch.dimensionUpdated":
      return { state: createSketchPreviewState(state, updateSketchDimensionValue(state.session, event.dimensionId, event.value)), effects: [] };
    case "sketch.publishRequested":
      return finishSketchSession(state);
    case "sketch.discardRequested":
      return state.editSessionCursorContext?.phase === "active"
        ? emitEditSessionCursorRestore(toIdleState(state, "part"))
        : { state: toIdleState(state, "part"), effects: [] };
    case "tool.activated": {
      // T14c: activating any sketch tool drops the annotation context.
      const result = handleEditingSketchToolActivation(state, event);
      return result?.state.kind === "editingSketch"
        ? {
            ...result,
            state: { ...result.state, annotationContext: null },
          }
        : result;
    }
    case "history.undoRequested":
    case "history.redoRequested":
      return { state, effects: [] };
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

      return finishSketchSession(state);
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
    case "sketch.geometryDragCancelled":
      return handleSketchGeometryDragCancelled(state);
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
    case "sketch.escapeRequested":
      return handleSketchEscapeRequested(state);
    case "sketch.confirmRequested":
      return handleSketchConfirmRequested(state);
    case "sketch.inferenceSuppressionChanged":
      return handleSketchInferenceSuppressionChanged(state, {
        held: event.held,
      });
    case "sketch.showAllAnnotationsChanged":
      return handleSketchShowAllAnnotationsChanged(state, event);
    case "sketch.annotationWheelOpened":
      return handleSketchAnnotationWheelOpened(state, event);
    case "sketch.annotationWheelClosed":
      return handleSketchAnnotationWheelClosed(state);
    case "sketch.annotationWheelListFilterChanged":
      return handleSketchAnnotationWheelListFilterChanged(state, event);
    case "sketch.annotationDeleteRequested":
      return handleSketchAnnotationDeleteRequested(state);
    case "sketch.annotationEditRequested":
      return handleSketchAnnotationEditRequested(state, event);
  }
}
