import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import { getToolCommandBehavior } from "@/core/tools/activation-policy";
import {
  getSelectionFilterForCommand,
  selectionFilterAllowsTarget,
  sketchStartSelectionFilter,
} from "@/core/editor/schema";
import {
  adoptCompatibleFeatureSelection,
  createFeatureEditSession,
  getSelectionFilterForFeatureType,
} from "@/domain/editor/feature-editing";
import {
  getSketchPlaneEditSelectionTarget,
  patchSketchPlaneEditSession,
} from "@/domain/editor/sketch-plane-editing";
import {
  getDocumentHistoryCursorIndex,
  isValidDocumentHistoryCursor,
} from "@/domain/modeling/document-history";
import type {
  EditorEvent,
  EditorState,
  EditorTransitionResult,
  FeatureEvent,
  ImportWorkflowEvent,
  SectionEvent,
  SketchEvent,
  SketchPlaneEvent,
  ToolActivatedEvent,
} from "./types";
import {
  defaultEditorExtensionDependencies,
  type EditorExtensionDependencies,
} from "./dependencies";
import {
  createCommandState,
  createFeatureEditingState,
  toIdleState,
  withPreview,
  withActivationSelection,
} from "./state-creators";
import {
  adoptSelectionForFilter,
  createSelectionPreview,
} from "./selection-helpers";
import {
  createEditSessionCursorContext,
  hasPendingDocumentCursorRefresh,
  replaceStateDocumentSnapshot,
  updateStateDocumentSnapshot,
} from "./document-helpers";
import {
  emitDocumentCursorMove,
  emitEditSessionCursorRestore,
  emitFeaturePreview,
  emitSketchOpen,
  emitSketchPlaneCommit,
  emitSnapshotFetch,
} from "./effect-emitters";
import { isFeatureTool } from "./utility-helpers";
import { reduceFeatureWorkflow } from "./reducer-feature";
import { reduceImportWorkflow, startImportWorkflow } from "./reducer-import";
import { reduceSectionWorkflow } from "./reducer-section";
import { reduceSketchWorkflow } from "./reducer-sketch";
import {
  handleViewportHoverCleared,
  handleViewportHovered,
  handleSelectionCleared,
  handleViewportSelectionRequested,
  handleAuthoringReopenRequested,
  handleSketchPlaneEditRequested,
} from "./transitions-viewport";
import {
  handleFormReferencePickerActivated,
  handleFormReferencePickerCancelled,
} from "./transitions-feature";
import {
  handleEffectDocumentCursorMoved,
  handleEffectDocumentCursorMoveFailed,
  handleEffectSnapshotLoaded,
  handleEffectSnapshotFailed,
  handleEffectSketchSessionOpened,
  handleEffectSketchSessionOpenFailed,
  handleEffectFeatureSessionHydrated,
  handleEffectFeatureSessionHydrationFailed,
  handleEffectFeaturePreviewCompleted,
  handleEffectFeaturePreviewFailed,
  handleEffectFeatureCommitted,
  handleEffectFeatureCommitFailed,
  handleEffectSketchCommitted,
  handleEffectSketchCommitFailed,
  handleEffectSketchPlaneCommitted,
  handleEffectSketchPlaneCommitFailed,
  handleEffectSketchReferencesProjected,
  handleEffectSketchReferenceProjectionFailed,
  handleEffectSketchReferenceImageImportCompleted,
  handleEffectSketchReferenceImageImportFailed,
  handleEffectSketchSpecialModeEffectCompleted,
  handleEffectSketchSpecialModeEffectFailed,
} from "./transitions-effects";
import {
  handleSketchReferenceImagePayloadsPicked,
  handleSketchSpecialModeEntered,
} from "./transitions-sketch";

function isSketchEvent(event: EditorEvent): event is SketchEvent {
  return (
    event.type.startsWith("sketch.") ||
    event.type === "tool.activated" ||
    event.type === "command.cancelled" ||
    event.type === "command.commitRequested" ||
    event.type === "history.undoRequested" ||
    event.type === "history.redoRequested"
  );
}

function isFeatureEvent(event: EditorEvent): event is FeatureEvent {
  return (
    event.type.startsWith("form.") ||
    event.type === "command.cancelled" ||
    event.type === "command.commitRequested"
  );
}

function isImportWorkflowEvent(
  event: EditorEvent,
): event is ImportWorkflowEvent {
  return (
    event.type === "command.cancelled" ||
    event.type === "form.referencePickerActivated" ||
    event.type === "form.referencePickerCancelled" ||
    event.type === "import.providerSelected" ||
    event.type === "import.selectionPatched" ||
    event.type === "import.commitRequested" ||
    event.type === "import.cancelled" ||
    event.type === "import.committed" ||
    event.type === "import.failed"
  );
}

function isSketchPlaneEvent(event: EditorEvent): event is SketchPlaneEvent {
  return (
    event.type.startsWith("sketchPlaneEdit.") ||
    event.type === "form.referencePickerActivated" ||
    event.type === "form.referencePickerCancelled" ||
    event.type === "command.cancelled" ||
    event.type === "command.commitRequested"
  );
}

function reduceSketchPlaneWorkflow(
  state: Extract<EditorState, { kind: "editingSketchPlane" }>,
  event: SketchPlaneEvent,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  switch (event.type) {
    case "command.cancelled":
      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] };
      }

      if (state.editSessionCursorContext?.phase === "active") {
        return emitEditSessionCursorRestore(toIdleState(state, "part"));
      }

      return {
        state: toIdleState(state, "part"),
        effects: [],
      };
    case "command.commitRequested":
      return state.command.commandSessionId === event.commandSessionId
        ? emitSketchPlaneCommit(state)
        : { state, effects: [] };
    case "form.referencePickerActivated":
      return handleFormReferencePickerActivated(state, event);
    case "form.referencePickerCancelled":
      return handleFormReferencePickerCancelled(state, dependencies);
    case "sketchPlaneEdit.patched": {
      const session = patchSketchPlaneEditSession(state.session, event.patch);
      return {
        state: withPreview(
          {
            ...state,
            session,
            command: {
              ...state.command,
              phase: "editing",
            },
          },
          {
            kind: "selection",
            label: `Editing ${session.sketchLabel}`,
            target: getSketchPlaneEditSelectionTarget(session),
          },
        ),
        effects: [],
      };
    }
  }

  return { state, effects: [] };
}

function isSectionEvent(event: EditorEvent): event is SectionEvent {
  return (
    event.type.startsWith("section.") || event.type === "command.cancelled"
  );
}

function handleImportImageToolActivation(
  state: EditorState,
): EditorTransitionResult {
  if (state.kind === "editingSketch") {
    return {
      state: {
        ...state,
        command: {
          ...state.command,
          phase: "editing",
        },
        preview: {
          kind: "sketch",
          label: "Select reference images",
          target: state.session.planeTarget,
        },
      },
      effects: [],
    };
  }

  if (
    state.kind === "selectionCommand" &&
    (state.command.toolId === "sketch" ||
      state.command.toolId === "importImage")
  ) {
    return {
      state: {
        ...state,
        command: {
          ...state.command,
          phase: "collecting",
        },
        preview: {
          kind: "sketch",
          label: "Select reference images",
          target: state.selection[0] ?? null,
        },
      },
      effects: [],
    };
  }

  return { state, effects: [] };
}

function handleSketchToolActivation(
  state: EditorState,
): EditorTransitionResult {
  const adoptedSelection = adoptSelectionForFilter(
    state.selection,
    sketchStartSelectionFilter,
    state.selectionCatalog,
  );
  const activationState = withActivationSelection(state, adoptedSelection);
  const nextState = createCommandState(
    activationState,
    "sketch",
    state.mode,
    sketchStartSelectionFilter,
    createSelectionPreview(activationState, sketchStartSelectionFilter),
  );
  const selectedTarget = nextState.selection[0] ?? null;

  if (
    selectedTarget &&
    selectionFilterAllowsTarget(
      sketchStartSelectionFilter,
      [],
      selectedTarget,
      nextState.selectionCatalog,
    )
  ) {
    if (selectedTarget.kind === "sketch") {
      const cursorContext = createEditSessionCursorContext(
        state.snapshot,
        {
          kind: "sketch",
          sketchId: selectedTarget.sketchId,
        },
        "sketchAuthoring",
      );

      if (!cursorContext) {
        return {
          state: withPreview(nextState, {
            kind: "selection",
            label: `Sketch ${selectedTarget.sketchId} is not in document history.`,
            target: selectedTarget,
          }),
          effects: [],
        };
      }

      return emitDocumentCursorMove(
        {
          ...nextState,
          editSessionCursorContext: cursorContext,
          preview: {
            kind: "selection",
            label: `Rolling back before sketch ${selectedTarget.sketchId}`,
            target: selectedTarget,
          },
        },
        cursorContext.rollbackCursor,
        true,
      );
    }

    return emitSketchOpen(nextState, [selectedTarget]);
  }

  return {
    state: nextState,
    effects: [],
  };
}

function handleFeatureToolActivation(
  state: EditorState,
  toolId: Parameters<typeof getSelectionFilterForFeatureType>[0],
): EditorTransitionResult {
  const selectionFilter = getSelectionFilterForFeatureType(toolId);
  const activationSelection =
    state.selection.length === 1 && state.selection[0]?.kind === "feature"
      ? state.selection
      : adoptCompatibleFeatureSelection(toolId, state.selection);
  const activationState = withActivationSelection(state, activationSelection);
  const nextState = createCommandState(
    activationState,
    toolId,
    "part",
    selectionFilter,
    createSelectionPreview(activationState, selectionFilter),
  );
  const selectedTarget = nextState.selection[0] ?? null;

  if (selectedTarget?.kind === "feature") {
    const cursorContext = createEditSessionCursorContext(
      state.snapshot,
      {
        kind: "feature",
        featureId: selectedTarget.featureId,
      },
      "featureEdit",
    );

    if (!cursorContext) {
      return {
        state: withPreview(nextState, {
          kind: "selection",
          label: `Feature ${selectedTarget.featureId} is not in document history.`,
          target: selectedTarget,
        }),
        effects: [],
      };
    }

    return emitDocumentCursorMove(
      {
        ...nextState,
        editSessionCursorContext: cursorContext,
        preview: {
          kind: "selection",
          label: `Rolling back before feature ${selectedTarget.featureId}`,
          target: selectedTarget,
        },
      },
      cursorContext.rollbackCursor,
      true,
    );
  }

  const session = createFeatureEditSession({
    featureType: toolId,
    selectedTargets: nextState.selection,
  });

  return emitFeaturePreview(
    createFeatureEditingState(nextState, nextState.command, session),
  );
}

function handleSharedToolActivated(
  state: EditorState,
  event: ToolActivatedEvent,
): EditorTransitionResult {
  const commandBehavior = getToolCommandBehavior(event.toolId);

  if (commandBehavior === "undo") {
    return transitionEditorState(state, { type: "history.undoRequested" });
  }

  if (commandBehavior === "redo") {
    return transitionEditorState(state, { type: "history.redoRequested" });
  }

  if (commandBehavior === "partImport") {
    return { state, effects: [] };
  }

  if (commandBehavior === "sketchReferenceImageImport") {
    return handleImportImageToolActivation(state);
  }

  if (event.toolId === "sketch") {
    return handleSketchToolActivation(state);
  }

  if (event.toolId === "sectionView" || event.toolId === "measure") {
    const selectionFilter = getSelectionFilterForCommand(event.toolId, "part");
    return {
      state: createCommandState(
        state,
        event.toolId,
        "part",
        selectionFilter,
        createSelectionPreview(state, selectionFilter),
      ),
      effects: [],
    };
  }

  if (isFeatureTool(event.toolId)) {
    return handleFeatureToolActivation(state, event.toolId);
  }

  const mode =
    event.toolId === "line" ||
    event.toolId === "rectangle" ||
    event.toolId === "circle" ||
    event.toolId === "construction" ||
    event.toolId === "projectReference" ||
    isRegisteredSketchConstraintToolId(event.toolId)
      ? "sketch"
      : state.mode;
  const filter = getSelectionFilterForCommand(event.toolId, mode);

  return {
    state: createCommandState(
      state,
      event.toolId,
      mode,
      filter,
      createSelectionPreview(state, filter),
    ),
    effects: [],
  };
}

function routeToWorkflow(
  state: EditorState,
  event: EditorEvent,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult | null {
  if (state.kind === "editingSketch" && isSketchEvent(event)) {
    return reduceSketchWorkflow(
      state,
      event,
      dependencies,
      (nextState, nextEvent) =>
        transitionEditorState(nextState, nextEvent, dependencies),
    );
  }

  if (state.kind === "editingFeature" && isFeatureEvent(event)) {
    return reduceFeatureWorkflow(state, event, dependencies);
  }

  if (state.kind === "editingSketchPlane" && isSketchPlaneEvent(event)) {
    return reduceSketchPlaneWorkflow(state, event, dependencies);
  }

  if (state.kind === "importing" && isImportWorkflowEvent(event)) {
    return reduceImportWorkflow(state, event, dependencies);
  }

  if (state.kind === "inspectingSection" && isSectionEvent(event)) {
    return reduceSectionWorkflow(state, event);
  }

  return null;
}

function handleSharedEvent(
  state: EditorState,
  event: EditorEvent,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  switch (event.type) {
    case "session.started":
      return emitSnapshotFetch(state, null);
    case "tool.activated":
      return handleSharedToolActivated(state, event);
    case "history.undoRequested":
    case "history.redoRequested":
      return { state, effects: [] };
    case "command.cancelled":
      if (state.kind === "idle") {
        return { state, effects: [] };
      }

      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] };
      }

      if (state.editSessionCursorContext?.phase === "active") {
        return emitEditSessionCursorRestore(
          toIdleState(
            state,
            state.kind === "editingSketch" ? "part" : state.mode,
          ),
        );
      }

      return {
        state: toIdleState(
          state,
          state.kind === "editingSketch" ? "part" : state.mode,
        ),
        effects: [],
      };
    case "command.commitRequested":
      return { state, effects: [] };
    case "document.refreshRequested":
      return emitSnapshotFetch(state, null);
    case "document.snapshotLoaded":
      return {
        state: updateStateDocumentSnapshot(state, event.snapshot),
        effects: [],
      };
    case "document.replaced":
      return {
        state: replaceStateDocumentSnapshot(state, event.snapshot),
        effects: [],
      };
    case "document.historyCursorRequested":
      if (
        state.kind !== "idle" ||
        !state.snapshot ||
        hasPendingDocumentCursorRefresh(state) ||
        !isValidDocumentHistoryCursor(
          state.snapshot.presentation.documentHistory,
          event.cursor,
        ) ||
        getDocumentHistoryCursorIndex(
          state.snapshot.presentation.documentHistory,
          event.cursor,
        ) ===
          getDocumentHistoryCursorIndex(
            state.snapshot.presentation.documentHistory,
            state.snapshot.document.cursor,
          )
      ) {
        return { state, effects: [] };
      }

      return emitDocumentCursorMove(state, event.cursor, false);
    case "import.fileSelected":
      return startImportWorkflow(state, event, dependencies);
    case "viewport.hoverCleared":
      return handleViewportHoverCleared(state, dependencies);
    case "viewport.hovered":
      return handleViewportHovered(state, event, dependencies);
    case "selection.cleared":
      return handleSelectionCleared(state, dependencies);
    case "viewport.selectionRequested":
      return handleViewportSelectionRequested(state, event, dependencies);
    case "authoring.reopenRequested":
      return handleAuthoringReopenRequested(state, event);
    case "sketchPlaneEdit.requested":
      return handleSketchPlaneEditRequested(state, event);
    case "sketch.referenceImagePayloadsPicked":
      return state.kind === "selectionCommand"
        ? handleSketchReferenceImagePayloadsPicked(
            state,
            event,
            transitionEditorState,
          )
        : { state, effects: [] };
    case "sketch.specialModeEntered":
      return state.kind === "selectionCommand"
        ? handleSketchSpecialModeEntered(
            state,
            event,
            transitionEditorState,
            dependencies,
          )
        : { state, effects: [] };
    case "effect.documentCursorMoved":
      return handleEffectDocumentCursorMoved(state, event);
    case "effect.documentCursorMoveFailed":
      return handleEffectDocumentCursorMoveFailed(state, event);
    case "effect.snapshotLoaded":
      return handleEffectSnapshotLoaded(state, event);
    case "effect.snapshotFailed":
      return handleEffectSnapshotFailed(state, event);
    case "effect.sketchSessionOpened":
      return handleEffectSketchSessionOpened(state, event);
    case "effect.sketchSessionOpenFailed":
      return handleEffectSketchSessionOpenFailed(state, event);
    case "effect.featureSessionHydrated":
      return handleEffectFeatureSessionHydrated(state, event);
    case "effect.featureSessionHydrationFailed":
      return handleEffectFeatureSessionHydrationFailed(state, event);
    case "effect.featurePreviewCompleted":
      return handleEffectFeaturePreviewCompleted(state, event);
    case "effect.featurePreviewFailed":
      return handleEffectFeaturePreviewFailed(state, event);
    case "effect.featureCommitted":
      return handleEffectFeatureCommitted(state, event);
    case "effect.featureCommitFailed":
      return handleEffectFeatureCommitFailed(state, event);
    case "effect.sketchCommitted":
      return handleEffectSketchCommitted(state, event);
    case "effect.sketchCommitFailed":
      return handleEffectSketchCommitFailed(state, event);
    case "effect.sketchPlaneCommitted":
      return handleEffectSketchPlaneCommitted(state, event);
    case "effect.sketchPlaneCommitFailed":
      return handleEffectSketchPlaneCommitFailed(state, event);
    case "effect.sketchReferencesProjected":
      return handleEffectSketchReferencesProjected(state, event);
    case "effect.sketchReferenceProjectionFailed":
      return handleEffectSketchReferenceProjectionFailed(state, event);
    case "effect.sketchReferenceImageImportCompleted":
      return handleEffectSketchReferenceImageImportCompleted(state, event);
    case "effect.sketchReferenceImageImportFailed":
      return handleEffectSketchReferenceImageImportFailed(state, event);
    case "effect.sketchSpecialModeEffectCompleted":
      return handleEffectSketchSpecialModeEffectCompleted(
        state,
        event,
        dependencies,
      );
    case "effect.sketchSpecialModeEffectFailed":
      return handleEffectSketchSpecialModeEffectFailed(
        state,
        event,
        dependencies,
      );
    default:
      return { state, effects: [] };
  }
}

export function transitionEditorState(
  state: EditorState,
  event: EditorEvent,
  dependencies: EditorExtensionDependencies = defaultEditorExtensionDependencies,
): EditorTransitionResult {
  const workflowResult = routeToWorkflow(state, event, dependencies);

  if (workflowResult) {
    return workflowResult;
  }

  return handleSharedEvent(state, event, dependencies);
}
