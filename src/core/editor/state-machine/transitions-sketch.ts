import type { SketchToolId } from "@/core/sketch-tools/definition";
import { isRegisteredSketchToolId } from "@/core/sketch-tools/registry";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  beginSketchTool,
  cancelSketchGeometryDrag,
  clearActiveSketchTool,
  confirmSketchDrawing,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationAffectedGeometryRefs,
  pruneSketchAnnotationContext,
  withoutSketchAnnotationWheel,
  type SketchAnnotationContext,
  deleteSelectedSketchGeometry,
  deleteSketchReferenceTarget,
  escapeSketchDrawing,
  finalizeSketchDraw,
  finishSketchGeometryDrag,
  getConnectedSketchEntitySelectionTargets,
  getSketchSessionPreviewLabel,
  isEditableSketchGeometrySelection,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  patchSketchDrawingToolValue,
  patchSketchEditToolValue,
  patchSketchStyleValue,
  pinSketchConstraintPreview,
  setSketchInferenceSuppression,
  setSketchSnapScale,
  shouldDeferSketchConstraintPreviewPinToSelection,
  startSketchDraw,
  updateSketchGeometryDrag,
  updateSketchPointer,
  type SketchDrawingEscapeStep,
} from "@/domain/editor/sketch-session";
import { applySketchMirrorRemoval } from "@/domain/editor/sketch-session/mirror-actions";
import { applyTangentAction } from "@/domain/editor/sketch-session/tangent-actions";
import {
  enterSketchSpecialMode,
  getSketchSpecialModeSelectionFilter,
  handleSketchSpecialModeClick,
  handleSketchSpecialModeDoubleClick,
  handleSketchSpecialModeDragEnd,
  handleSketchSpecialModeDragMove,
  handleSketchSpecialModeDragStart,
  handleSketchSpecialModePanelAction,
  resolveSketchSpecialModeOpenRequest,
  sketchSessionHasActiveSpecialMode,
} from "@/core/sketch-special-modes/presentation";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { getDefaultSelectionFilterForMode } from "@/core/editor/schema";
import type {
  EditorEvent,
  EditorTransitionResult,
  SketchEditorState,
  EditorState,
} from "./types";
import type { EditorExtensionDependencies } from "./dependencies";
import {
  emitSketchReferenceImageImportWithPayloads,
  emitSketchReferenceProjection,
  emitSketchSpecialModeEffect,
} from "./effect-emitters";
import { enterSketchEditing, withPreview } from "./state-creators";
import {
  getSketchAnnotationSelectionContext,
  getSketchGeometrySelectionContext,
} from "./transitions-viewport";
import { deriveSketchPointFromWorld, nextRequestId } from "./utility-helpers";

export function handleSketchPointerMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.pointerMoved" }>,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = updateSketchPointer(
    setSketchSnapScale(state.session, event.sketchUnitsPerPixel),
    deriveSketchPointFromWorld(state.session.plane, event.point),
  );

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: session.status === "drawing" ? "editing" : "collecting",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

export function handleSketchPointerReleased(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.pointerReleased" }>,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const point = deriveSketchPointFromWorld(state.session.plane, event.point);
  const scaled = setSketchSnapScale(state.session, event.sketchUnitsPerPixel);
  const session = scaled.constraintAuthoring
    ? shouldDeferSketchConstraintPreviewPinToSelection(scaled, event.target)
      ? scaled
      : pinSketchConstraintPreview(scaled, point)
    : scaled.status === "drawing"
      ? acceptSketchDraw(scaled, point)
      : startSketchDraw(scaled, point);

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: session.status === "drawing" ? "editing" : "collecting",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

/**
 * T13-D22: Shift pressed or released (the toggle arrives as the
 * `setSnapInference` tool patch). Session UI state only: no action.
 */
export function handleSketchInferenceSuppressionChanged(
  state: EditorState,
  change: { held: boolean } | { inferenceEnabled: boolean },
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = setSketchInferenceSuppression(state.session, change);
  if (session === state.session) {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      session,
      // A pending commit keeps its "Committing…" label (T13h review A-7).
      preview: state.pendingCommitRequestId
        ? state.preview
        : {
            kind: "sketch",
            label: getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
    },
    effects: [],
  };
}

/**
 * T14e (T-11): the Show all switch. Editor UI state only: the session (and
 * so the authored state, history and the descriptor memo) is untouched.
 */
export function handleSketchShowAllAnnotationsChanged(
  state: SketchEditorState,
  event: Extract<EditorEvent, { type: "sketch.showAllAnnotationsChanged" }>,
): EditorTransitionResult {
  return (state.showAllAnnotations ?? false) === event.showAll
    ? { state, effects: [] }
    : { state: { ...state, showAllAnnotations: event.showAll }, effects: [] };
}

/**
 * T14g (T-10): a pinned `+N` opens its cluster's wheel, only in the idle
 * select context (no tool, edit tool, special mode, annotation edit or
 * drag), where `+N` is a control. Editor UI state: the session, history and
 * the descriptor memo are untouched. Owners and `last` are kept.
 */
export function handleSketchAnnotationWheelOpened(
  state: SketchEditorState,
  event: Extract<EditorEvent, { type: "sketch.annotationWheelOpened" }>,
): EditorTransitionResult {
  const { session } = state;
  if (
    event.members.length === 0 ||
    session.activeTool !== null ||
    session.activeEditTool !== null ||
    session.activeSpecialMode !== null ||
    session.activeAnnotationEdit !== null ||
    session.activeDrag !== null
  ) {
    return { state, effects: [] };
  }
  return {
    state: {
      ...state,
      annotationContext: {
        owners: state.annotationContext?.owners ?? [],
        last: state.annotationContext?.last ?? null,
        wheel: { clusterKey: event.clusterKey, members: event.members },
      },
    },
    effects: [],
  };
}

/** T14g (T-10): `−N`, Escape's wheel stage, a camera change, the chooser. */
export function handleSketchAnnotationWheelClosed(
  state: SketchEditorState,
): EditorTransitionResult {
  return state.annotationContext?.wheel
    ? {
        state: {
          ...state,
          annotationContext: withoutSketchAnnotationWheel(
            state.annotationContext,
          ),
        },
        effects: [],
      }
    : { state, effects: [] };
}

/** T14g (T-10): the wheel's "More…" filters the Constraints list to its members. */
export function handleSketchAnnotationWheelListFilterChanged(
  state: SketchEditorState,
  event: Extract<
    EditorEvent,
    { type: "sketch.annotationWheelListFilterChanged" }
  >,
): EditorTransitionResult {
  const context = state.annotationContext;
  if (
    !context?.wheel ||
    (context.wheel.listFiltered ?? false) === event.filtered
  ) {
    return { state, effects: [] };
  }
  const { clusterKey, members } = context.wheel;
  return {
    state: {
      ...state,
      annotationContext: {
        ...context,
        wheel: event.filtered
          ? { clusterKey, members, listFiltered: true }
          : { clusterKey, members },
      },
    },
    effects: [],
  };
}

/**
 * T14g: the pruned context with the open wheel minus the spokes the
 * session's definition no longer holds; the wheel goes when none is left.
 */
function withPrunedSketchAnnotationWheel(
  context: SketchAnnotationContext | null,
  wheel: SketchAnnotationContext["wheel"],
  session: SketchEditorState["session"],
): SketchAnnotationContext | null {
  const members =
    wheel?.members.filter(
      (member) =>
        getSketchAnnotationAffectedGeometryRefs(session, member) !== null,
    ) ?? [];
  if (!wheel || members.length === 0) {
    return withoutSketchAnnotationWheel(context);
  }
  return {
    owners: context?.owners ?? [],
    last: context?.last ?? null,
    wheel: { ...wheel, members },
  };
}

export function handleSketchToolPatched(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.toolPatched" }>,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  if (event.patch.intent === "setSnapInference") {
    return handleSketchInferenceSuppressionChanged(state, {
      inferenceEnabled: event.patch.value === true,
    });
  }

  if (event.patch.intent === "setDimensionAnnotationPlacement") {
    const session = patchSketchDimensionAnnotationPlacement(
      state.session,
      event.patch,
    );

    return {
      state: {
        ...state,
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

  if (state.session.constraintAuthoring || state.session.activeAnnotationEdit) {
    const session = patchSketchConstraintValue(state.session, event.patch);

    return {
      state: {
        ...state,
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

  if (state.session.activeEditTool) {
    const session = patchSketchEditToolValue(state.session, event.patch);

    return {
      state: {
        ...state,
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

  // T12e: tangent reset-to-automatic and set-to-zero selection-context actions.
  if (
    event.patch.intent === "resetTangentToAutomatic" ||
    event.patch.intent === "setTangentToZero"
  ) {
    const session = applyTangentAction(
      state.session,
      state.selection,
      event.patch.intent,
    );

    return {
      state: {
        ...state,
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

  // T16a ([TECH] T16-1): the Mirror panel's Remove mirror, one action
  // ("Remove Mirror"). Like Delete, the selection (copies included) clears.
  if (
    event.patch.intent === "removeMirror" &&
    typeof event.patch.derivationId === "string"
  ) {
    const session = applySketchMirrorRemoval(
      state.session,
      event.patch.derivationId,
    );

    return {
      state: {
        ...state,
        selection: [],
        hoverTarget: null,
        annotationContext: withoutSketchAnnotationWheel(
          pruneSketchAnnotationContext(
            state.annotationContext ?? null,
            session,
          ),
        ),
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

  if (
    event.patch.intent === "setToolSetting" &&
    state.session.activeTool &&
    isRegisteredSketchToolId(state.session.activeTool)
  ) {
    const session = patchSketchDrawingToolValue(state.session, event.patch);

    return {
      state: {
        ...state,
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

  {
    const session = patchSketchStyleValue(
      state.session,
      state.selection,
      event.patch,
    );

    return {
      state: {
        ...state,
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
}

export function handleSketchActiveToolCleared(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = clearActiveSketchTool(state.session);

  return {
    state: {
      ...state,
      selection: [],
      hoverTarget: null,
      annotationContext: null,
      session,
      command: {
        ...state.command,
        toolId: "sketch",
        phase: "editing",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

/** Escape with an armed drawing tool takes the next step (T11-D10). */
export function handleSketchEscapeRequested(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const toolId = state.session.activeTool;
  if (toolId === null || !isRegisteredSketchToolId(toolId)) {
    return handleSketchActiveToolCleared(state);
  }

  return applySketchDrawingStep(
    state,
    toolId,
    escapeSketchDrawing(state.session),
  );
}

/** Enter with an armed drawing tool: end a chain or finalize, else nothing. */
export function handleSketchConfirmRequested(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const toolId = state.session.activeTool;
  if (toolId === null || !isRegisteredSketchToolId(toolId)) {
    return { state, effects: [] };
  }

  const step = confirmSketchDrawing(state.session);
  return step
    ? applySketchDrawingStep(state, toolId, step)
    : { state, effects: [] };
}

function applySketchDrawingStep(
  state: SketchEditorState,
  toolId: SketchToolId,
  step: SketchDrawingEscapeStep,
): EditorTransitionResult {
  switch (step) {
    case "finalizeDraft": {
      // One definition change (one action); the tool stays armed (T11-D10).
      const session = finalizeSketchDraw(state.session);

      return {
        state: {
          ...state,
          session,
          command: { ...state.command, phase: "collecting" },
          preview: {
            kind: "sketch",
            label: getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
        },
        effects: [],
      };
    }
    case "endChain":
    case "cancelDraft": {
      // The draft and the chain never reached the definition (each committed
      // segment already did): restarting the armed tool drops them with no
      // action, like a tool switch (T11-D14).
      const session = beginSketchTool(state.session, toolId);

      return {
        state: {
          ...state,
          session,
          command: { ...state.command, phase: "collecting" },
          preview: {
            kind: "sketch",
            label: getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
        },
        effects: [],
      };
    }
    case "exitTool":
      return handleSketchActiveToolCleared(state);
  }
}

export function handleSketchAnnotationDeleteRequested(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const selected = state.selection[0] ?? null;
  const referenceTarget =
    selected &&
    (selected.kind === "projectedReferenceGeometry" ||
      selected.kind === "sketchExternalReference")
      ? selected
      : null;
  const session = referenceTarget
    ? deleteSketchReferenceTarget(state.session, referenceTarget)
    : isEditableSketchGeometrySelection(state.session, state.selection)
      ? deleteSelectedSketchGeometry(state.session, state.selection)
      : deleteSelectedSketchAnnotation(state.session, state.selection);
  const nextState: SketchEditorState = {
    ...state,
    selection: [],
    hoverTarget: null,
    // T14c: deleted refs leave the context; deleting the active annotation
    // keeps its owners, so its siblings stay reachable. T14g: an open wheel
    // loses the deleted spoke and stays open (the layer closes it once its
    // remaining spokes fit the dense limit).
    annotationContext: withPrunedSketchAnnotationWheel(
      pruneSketchAnnotationContext(state.annotationContext ?? null, session),
      state.annotationContext?.wheel,
      session,
    ),
    session,
    preview: {
      kind: "sketch",
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  };

  return referenceTarget
    ? emitSketchReferenceProjection(nextState, session)
    : { state: nextState, effects: [] };
}

export function handleSketchAnnotationEditRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.annotationEditRequested" }>,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = beginSketchAnnotationEdit(state.session, event.target);

  return {
    state: {
      ...state,
      selection: [event.target],
      hoverTarget: event.target,
      annotationContext: getSketchAnnotationSelectionContext(
        state,
        event.target,
      ),
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

export function handleSketchConnectedSelectionRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.connectedSelectionRequested" }>,
): EditorTransitionResult {
  if (
    state.kind !== "editingSketch" ||
    sketchSessionHasActiveSpecialMode(state.session) ||
    !(
      state.session.activeTool === null ||
      (state.session.status === "idle" &&
        isRegisteredSketchToolId(state.session.activeTool))
    ) ||
    state.session.constructionTargetPicking ||
    state.session.referenceTargetPicking ||
    state.session.constraintAuthoring ||
    state.session.activeEditTool ||
    state.session.activeStyleFocus
  ) {
    return { state, effects: [] };
  }

  const targets = getConnectedSketchEntitySelectionTargets(
    state.session,
    event.target,
  );

  if (targets.length === 0) {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      selection: targets,
      hoverTarget: event.target,
      annotationContext: getSketchGeometrySelectionContext(state, targets),
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(state.session),
        target: state.session.planeTarget,
      },
    },
    effects: [],
  };
}

export function handleSketchGeometryDragStarted(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.geometryDragStarted" }>,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const point = deriveSketchPointFromWorld(state.session.plane, event.point);
  const session = beginSketchGeometryDrag(state.session, event.target, point);

  return {
    state: {
      ...state,
      selection:
        event.target.kind === "sketchPoint" ? [event.target] : state.selection,
      hoverTarget:
        event.target.kind === "sketchPoint" ? event.target : state.hoverTarget,
      session,
      command: {
        ...state.command,
        phase: "editing",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

export function handleSketchGeometryDragMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.geometryDragMoved" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = updateSketchGeometryDrag(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    event.exactZero ? { exactZero: true } : undefined,
  );

  return {
    state: {
      ...state,
      session,
      selectionFilter:
        getSketchSpecialModeSelectionFilter(
          session,
          dependencies.sketchSpecialModes,
        ) ?? getDefaultSelectionFilterForMode("sketch"),
      command: {
        ...state.command,
        phase: "editing",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

export function handleSketchGeometryDragEnded(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.geometryDragEnded" }>,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = finishSketchGeometryDrag(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    event.exactZero ? { exactZero: true } : undefined,
  );

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: "editing",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

/**
 * Cancel the active drag gesture: restore pre-drag state with no history
 * entry (D2). Dispatched by Escape, pointercancel, lost pointer capture,
 * tool switch, and Finish while a drag is active.
 */
export function handleSketchGeometryDragCancelled(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const session = cancelSketchGeometryDrag(state.session);

  return {
    state: {
      ...state,
      session,
      command: {
        ...state.command,
        phase: "editing",
      },
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
    },
    effects: [],
  };
}

export function handleSketchReferenceImagePayloadsPicked(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.referenceImagePayloadsPicked" }>,
  _transitionEditorState: (
    state: EditorState,
    event: EditorEvent,
  ) => EditorTransitionResult,
): EditorTransitionResult {
  if (
    state.kind === "selectionCommand" &&
    (state.command.toolId === "sketch" ||
      state.command.toolId === "importImage")
  ) {
    const session = state.snapshot
      ? openSketchSessionFromSelection(state.selection.slice(), state.snapshot)
      : null;

    if (!session) {
      return { state, effects: [] };
    }

    const entered = enterSketchEditing(state, session);
    const nextState = entered.state;

    if (!event.payloads || event.payloads.length === 0) {
      return {
        state: {
          ...nextState,
          preview: {
            kind: "sketch",
            label: event.message ?? getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
          session: event.message
            ? {
                ...nextState.session,
                validationMessage: event.message,
              }
            : nextState.session,
        },
        effects: entered.effects,
      };
    }

    const imported = emitSketchReferenceImageImportWithPayloads(
      nextState,
      event.payloads,
    );
    return {
      state: imported.state,
      effects: [...entered.effects, ...imported.effects],
    };
  }

  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  if (!event.payloads || event.payloads.length === 0) {
    return {
      state: {
        ...state,
        command: {
          ...state.command,
          phase: "editing",
        },
        preview: {
          kind: "sketch",
          label: event.message ?? getSketchSessionPreviewLabel(state.session),
          target: state.session.planeTarget,
        },
        session: event.message
          ? {
              ...state.session,
              validationMessage: event.message,
            }
          : state.session,
      },
      effects: [],
    };
  }

  return emitSketchReferenceImageImportWithPayloads(state, event.payloads);
}

export function handleSketchSpecialModeEntered(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.specialModeEntered" }>,
  transitionEditorState: (
    state: EditorState,
    event: EditorEvent,
  ) => EditorTransitionResult,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind === "selectionCommand" &&
    (state.command.toolId === "sketch" ||
      state.command.toolId === "importImage")
  ) {
    const session = state.snapshot
      ? openSketchSessionFromSelection(state.selection.slice(), state.snapshot)
      : null;

    if (!session) {
      return {
        state: withPreview(state, {
          kind: "sketch",
          label: "Reference-image import requires an active sketch plane.",
          target: state.selection[0] ?? null,
        }),
        effects: [],
      };
    }

    const entered = enterSketchEditing(state, session);
    const forwarded = transitionEditorState(entered.state, event);
    return {
      state: forwarded.state,
      effects: [...entered.effects, ...forwarded.effects],
    };
  }

  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  const requestId = nextRequestId(state, "sketch-special-enter");
  const session = enterSketchSpecialMode({
    session: state.session,
    registry: dependencies.sketchSpecialModes,
    modeId: event.modeId,
    operationId: event.operationId,
    payload: event.payload,
    requestId,
  });

  return emitSketchSpecialModeEffect(
    {
      ...state,
      selection: [
        session.activeSpecialMode?.operationTarget ?? state.selection[0],
      ].flatMap((target) => (target ? [target] : [])),
      hoverTarget: null,
      annotationContext: null,
      selectionFilter:
        getSketchSpecialModeSelectionFilter(
          session,
          dependencies.sketchSpecialModes,
        ) ?? getDefaultSelectionFilterForMode("sketch"),
    },
    session,
    requestId,
    dependencies,
  );
}

export function handleSketchSpecialModePanelActionInvoked(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.specialModePanelActionInvoked" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== "editingSketch" ||
    !sketchSessionHasActiveSpecialMode(state.session)
  ) {
    return { state, effects: [] };
  }

  const requestId = nextRequestId(state, "sketch-special-panel");
  const session = handleSketchSpecialModePanelAction(
    state.session,
    event.action,
    dependencies.sketchSpecialModes,
    requestId,
  );

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies);
}

export function handleSketchSpecialModeClickRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.specialModeClickRequested" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== "editingSketch" ||
    !sketchSessionHasActiveSpecialMode(state.session)
  ) {
    return { state, effects: [] };
  }

  const requestId = nextRequestId(state, "sketch-special-click");
  const session = handleSketchSpecialModeClick(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    event.target ?? null,
    state.selection,
    state.selectionCatalog,
    dependencies.sketchSpecialModes,
    requestId,
  );

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies);
}

export function handleSketchSpecialModeDoubleClickRequested(
  state: EditorState,
  event: Extract<
    EditorEvent,
    { type: "sketch.specialModeDoubleClickRequested" }
  >,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind !== "editingSketch") {
    return { state, effects: [] };
  }

  if (!sketchSessionHasActiveSpecialMode(state.session)) {
    const point = deriveSketchPointFromWorld(state.session.plane, event.point);
    const request = resolveSketchSpecialModeOpenRequest(
      {
        sketchSession: state.session,
        point,
        target: event.target ?? null,
        selection: state.selection,
        selectionCatalog: state.selectionCatalog,
      },
      dependencies.sketchSpecialModes,
    );

    if (!request) {
      return { state, effects: [] };
    }

    const requestId = nextRequestId(state, "sketch-special-enter");
    const session = enterSketchSpecialMode({
      session: state.session,
      registry: dependencies.sketchSpecialModes,
      modeId: request.modeId,
      operationId: request.operationId,
      payload: request.payload,
      requestId,
    });

    return emitSketchSpecialModeEffect(
      {
        ...state,
        selection: [
          session.activeSpecialMode?.operationTarget ?? state.selection[0],
        ].flatMap((target) => (target ? [target] : [])),
        hoverTarget: null,
        // T14c review R-1: the canvas entry drops the context too.
        annotationContext: null,
        selectionFilter:
          getSketchSpecialModeSelectionFilter(
            session,
            dependencies.sketchSpecialModes,
          ) ?? getDefaultSelectionFilterForMode("sketch"),
      },
      session,
      requestId,
      dependencies,
    );
  }

  const requestId = nextRequestId(state, "sketch-special-double-click");
  const session = handleSketchSpecialModeDoubleClick(
    state.session,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    event.target ?? null,
    state.selection,
    state.selectionCatalog,
    dependencies.sketchSpecialModes,
    requestId,
  );

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies);
}

export function handleSketchSpecialModeDragStarted(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.specialModeDragStarted" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== "editingSketch" ||
    !sketchSessionHasActiveSpecialMode(state.session)
  ) {
    return { state, effects: [] };
  }

  const requestId = nextRequestId(state, "sketch-special-drag-start");
  const session = handleSketchSpecialModeDragStart(
    state.session,
    event.handle,
    deriveSketchPointFromWorld(state.session.plane, event.point),
    dependencies.sketchSpecialModes,
    requestId,
  );

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies);
}

export function handleSketchSpecialModeDragMoved(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.specialModeDragMoved" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== "editingSketch" ||
    !sketchSessionHasActiveSpecialMode(state.session)
  ) {
    return { state, effects: [] };
  }

  const requestId = nextRequestId(state, "sketch-special-drag-move");
  const session = handleSketchSpecialModeDragMove(
    state.session.activeSpecialMode?.activeDragHandle?.handleId ===
      event.handle.handleId
      ? state.session
      : {
          ...state.session,
          activeSpecialMode: state.session.activeSpecialMode
            ? {
                ...state.session.activeSpecialMode,
                activeDragHandle: event.handle,
              }
            : null,
        },
    deriveSketchPointFromWorld(state.session.plane, event.point),
    dependencies.sketchSpecialModes,
    requestId,
  );

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies);
}

export function handleSketchSpecialModeDragEnded(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketch.specialModeDragEnded" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind !== "editingSketch" ||
    !sketchSessionHasActiveSpecialMode(state.session)
  ) {
    return { state, effects: [] };
  }

  const requestId = nextRequestId(state, "sketch-special-drag-end");
  const session = handleSketchSpecialModeDragEnd(
    state.session.activeSpecialMode?.activeDragHandle?.handleId ===
      event.handle.handleId
      ? state.session
      : {
          ...state.session,
          activeSpecialMode: state.session.activeSpecialMode
            ? {
                ...state.session.activeSpecialMode,
                activeDragHandle: event.handle,
              }
            : null,
        },
    deriveSketchPointFromWorld(state.session.plane, event.point),
    dependencies.sketchSpecialModes,
    requestId,
  );

  return emitSketchSpecialModeEffect(state, session, requestId, dependencies);
}
