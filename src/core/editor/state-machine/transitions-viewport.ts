import {
  getActiveSketchStyleToolId,
  getSketchSessionPreviewLabel,
  selectSketchEditTarget,
  selectSketchEditToolTarget,
  selectSketchAnnotation,
  authorSketchConstraintTarget,
  getSketchAnnotationAffectedGeometryRefs,
  isSketchAnnotationInContext,
  type SketchAnnotationContext,
  selectSketchReferenceTarget,
  shouldPinSketchConstraintPreviewBeforeSelection,
  pinSketchConstraintPreview,
  removeSketchToolCyclePick,
  toggleSketchConstructionTarget,
  updateSketchConstraintHover,
  updateSketchEditToolHover,
  updateSketchStyleFocusTarget,
  withoutSketchAnnotationWheel,
} from "@/domain/editor/sketch-session";
import {
  doesSketchSpecialModeAcceptTarget,
  handleSketchSpecialModeHover,
  sketchSessionHasActiveSpecialMode,
} from "@/core/sketch-special-modes/presentation";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import {
  getSketchSelectionCycleContext,
  hasSketchSelectionCycleDeselectEntry,
  isSketchSelectionCyclePickRetained,
  withoutSketchSelectionCyclePick,
} from "@/domain/editor/sketch-session/selection";
import { createSectionViewSession } from "@/core/section-view/session";
import { resolveSketchConstraintTarget } from "@/core/sketch-constraints/registry";
import {
  getDefaultSelectionFilterForMode,
  getSelectionFilterRejectionLabel,
  getSelectionPreviewLabel,
  primitiveRefEquals,
  resolveSelectionCandidate,
  selectionFilterAllowsTarget,
  sketchReferenceSelectionFilter,
  sketchStartSelectionFilter,
} from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import { resolveMeasureSelectionCandidate } from "@/domain/measure/measurement";
import { createFeatureEditorReferenceSelectionPatch } from "@/core/feature-authoring/form-events";
import {
  applySelectionToFeatureEditSession,
  getSelectionFilterForFeatureType,
  patchFeatureEditSession,
  type FeatureEditSessionState,
} from "@/domain/editor/feature-editing";
import {
  applySelectionToSketchPlaneEditSession,
  getSketchPlaneEditSelectionTarget,
  getSketchPlaneEditPreviewLabel,
  hydrateSketchPlaneEditSession,
} from "@/domain/editor/sketch-plane-editing";
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
  SketchEditorState,
} from "./types";
import type { EditorExtensionDependencies } from "./dependencies";
import {
  createImportViewportSelectionPatch,
  getActiveSketchPlaneReferencePickerField,
  getActiveImportReferencePickerField,
  getActiveReferencePickerField,
  getDefaultImportSelectionField,
} from "./form-traversal";
import {
  applyMultiSelectionRequest,
  applyMultiSelectionTargets,
  createFeatureSelectionPreview,
  createImportSelectionPreview,
  createSelectionPreview,
  isMultiSelectionContext,
} from "./selection-helpers";
import {
  createCommandState,
  createSketchPlaneEditingState,
  createSectionViewEditingState,
  enterSketchEditing,
  withPreview,
} from "./state-creators";
import {
  canReopenSketchDirectlyFromCurrentCursor,
  createEditSessionCursorContext,
} from "./document-helpers";
import {
  emitDocumentCursorMove,
  emitFeaturePreview,
  emitSketchOpen,
  emitSketchReferenceProjection,
} from "./effect-emitters";
import { commandAfterSketchToolCommit, isFeatureTool } from "./utility-helpers";

export function handleViewportHoverCleared(
  state: EditorState,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind === "editingSketch" &&
    sketchSessionHasActiveSpecialMode(state.session)
  ) {
    const session = handleSketchSpecialModeHover(
      state.session,
      null,
      state.selection,
      state.selectionCatalog,
      dependencies.sketchSpecialModes,
    );

    return {
      state: {
        ...state,
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

  if (state.kind === "editingSketch" && state.session.constraintAuthoring) {
    const session = updateSketchConstraintHover(state.session, null);

    return {
      state: {
        ...state,
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

  if (state.kind === "editingSketch" && state.session.activeEditTool) {
    const session = updateSketchEditToolHover(state.session, null);

    return {
      state: {
        ...state,
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

  return {
    state: withPreview(
      {
        ...state,
        hoverTarget: null,
      },
      state.kind === "editingSketch"
        ? {
            kind: "sketch",
            label: getSketchSessionPreviewLabel(state.session),
            target: state.session.planeTarget,
          }
        : state.kind === "selectionCommand"
          ? createSelectionPreview(state, state.selectionFilter)
          : state.kind === "editingFeature"
            ? createFeatureSelectionPreview(state.session)
            : state.kind === "importing"
              ? createImportSelectionPreview(state.session, dependencies)
              : state.preview,
    ),
    effects: [],
  };
}

export function handleViewportHovered(
  state: EditorState,
  event: Extract<EditorEvent, { type: "viewport.hovered" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    state.kind === "editingSketch" &&
    sketchSessionHasActiveSpecialMode(state.session)
  ) {
    if (
      !doesSketchSpecialModeAcceptTarget(
        state.session,
        event.target,
        state.selection,
        state.selectionCatalog,
        dependencies.sketchSpecialModes,
      )
    ) {
      return { state, effects: [] };
    }

    const session = handleSketchSpecialModeHover(
      state.session,
      event.target,
      state.selection,
      state.selectionCatalog,
      dependencies.sketchSpecialModes,
    );

    return {
      state: {
        ...state,
        hoverTarget: event.target,
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
    !selectionFilterAllowsTarget(
      state.selectionFilter,
      state.selection,
      event.target,
      state.selectionCatalog,
    )
  ) {
    return { state, effects: [] };
  }

  if (state.kind === "editingSketch" && state.session.constraintAuthoring) {
    const session = updateSketchConstraintHover(state.session, event.target);

    return {
      state: {
        ...state,
        hoverTarget: event.target,
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

  if (state.kind === "editingSketch" && state.session.activeEditTool) {
    const session = updateSketchEditToolHover(state.session, event.target);

    return {
      state: {
        ...state,
        hoverTarget: event.target,
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

  return {
    state: withPreview(
      {
        ...state,
        hoverTarget: event.target,
      },
      state.kind === "selectionCommand"
        ? {
            kind: "selection",
            label: getSelectionPreviewLabel(
              state.selectionFilter,
              event.target,
              "hover",
            ),
            target: event.target,
          }
        : state.preview,
    ),
    effects: [],
  };
}

export function handleSelectionCleared(
  state: EditorState,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (state.kind === "editingSketch" && state.session.constraintAuthoring) {
    const session = updateSketchConstraintHover(state.session, null);

    return {
      state: {
        ...state,
        selection: [],
        hoverTarget: null,
        annotationContext: null,
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

  if (state.kind === "editingSketch" && state.session.activeEditTool) {
    const session = updateSketchEditToolHover(state.session, null);

    return {
      state: {
        ...state,
        selection: [],
        hoverTarget: null,
        annotationContext: null,
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
    state.kind === "editingSketch" &&
    getActiveSketchStyleToolId(state.session)
  ) {
    const session = updateSketchStyleFocusTarget(state.session, []);

    return {
      state: {
        ...state,
        selection: [],
        hoverTarget: null,
        annotationContext: null,
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

  const clearedState: EditorState =
    state.kind === "editingSketch"
      ? {
          ...state,
          selection: [],
          hoverTarget: null,
          // T14c two-stage clear: a blank with an active annotation clears
          // only the annotation (owners and `last` stay, siblings reachable);
          // any other blank, including the second, drops the context.
          // T14g (T-10): an open wheel is first-stage too; the blank
          // collapses it and keeps owners and `last`.
          annotationContext:
            isAnnotationRef(state.selection[0]) ||
            state.annotationContext?.wheel
              ? withoutSketchAnnotationWheel(state.annotationContext ?? null)
              : null,
        }
      : {
          ...state,
          selection: [],
          hoverTarget: null,
        };

  return {
    state: withPreview(
      clearedState,
      state.kind === "editingSketch"
        ? {
            kind: "sketch",
            label: getSketchSessionPreviewLabel(state.session),
            target: state.session.planeTarget,
          }
        : state.kind === "selectionCommand"
          ? createSelectionPreview(clearedState, state.selectionFilter)
          : state.kind === "editingFeature"
            ? createFeatureSelectionPreview(state.session)
            : state.kind === "importing"
              ? createImportSelectionPreview(state.session, dependencies)
              : state.preview,
    ),
    effects: [],
  };
}

function rejectViewportSelection(
  state: EditorState,
  label: string,
  target: PrimitiveRef | null,
): EditorTransitionResult {
  return {
    state: withPreview(state, {
      kind: "selection",
      label,
      target,
    }),
    effects: [],
  };
}

function applySketchSelectionState(
  state: SketchEditorState,
  session: SketchEditorState["session"],
  target: PrimitiveRef,
  commandPhase?: SketchEditorState["command"]["phase"],
): SketchEditorState {
  return {
    ...state,
    selection: [target],
    hoverTarget: target,
    session,
    command: commandPhase
      ? {
          ...state.command,
          phase: commandPhase,
        }
      : state.command,
    preview: {
      kind: "sketch",
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  };
}

function createSketchPreviewState(
  state: SketchEditorState,
  session: SketchEditorState["session"],
): SketchEditorState {
  return {
    ...state,
    session,
    preview: {
      kind: "sketch",
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
  };
}

function handleSelectionCommandViewportSelection(
  state: Extract<EditorState, { kind: "selectionCommand" }>,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
): EditorTransitionResult | null {
  if (
    state.command.toolId === "sketch" ||
    state.command.toolId === "importImage"
  ) {
    return emitSketchOpen(
      {
        ...state,
        selection: [event.target],
        hoverTarget: event.target,
      },
      [event.target],
    );
  }

  if (state.command.toolId === "sectionView") {
    if (
      (event.target.kind !== "construction" &&
        event.target.kind !== "face" &&
        event.target.kind !== "region") ||
      !event.cameraPosition
    ) {
      return rejectViewportSelection(
        state,
        "Section view requires a viewport-picked planar face, closed region, or construction plane.",
        state.selection[0] ?? null,
      );
    }

    const section = createSectionViewSession({
      snapshot: state.snapshot,
      seed: event.target,
      cameraPosition: event.cameraPosition,
    });

    if (!section) {
      return rejectViewportSelection(
        state,
        "Selected target does not resolve to a usable section plane.",
        event.target,
      );
    }

    return {
      state: createSectionViewEditingState(state, section),
      effects: [],
    };
  }

  if (state.command.toolId === "measure") {
    const candidate = resolveMeasureSelectionCandidate(
      state.snapshot,
      state.selection,
      event.target,
    );

    if (!candidate.accepted) {
      return rejectViewportSelection(
        state,
        candidate.reason ??
          getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
        state.selection[0] ?? null,
      );
    }

    return {
      state: {
        ...state,
        selection: candidate.nextSelection,
        hoverTarget: event.target,
        command: {
          ...state.command,
          phase: "collecting",
        },
        preview: {
          kind: "selection",
          label: getSelectionPreviewLabel(
            state.selectionFilter,
            event.target,
            "select",
          ),
          target: event.target,
        },
      },
      effects: [],
    };
  }

  return null;
}

function handleEditingFeatureViewportSelection(
  state: Extract<EditorState, { kind: "editingFeature" }>,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
): EditorTransitionResult {
  const activeReferenceField = getActiveReferencePickerField(state);
  const nextSelection = [event.target];
  const nextSession: FeatureEditSessionState = {
    ...(activeReferenceField
      ? patchFeatureEditSession(
          state.session,
          createFeatureEditorReferenceSelectionPatch(
            activeReferenceField,
            event.target,
          ),
        )
      : applySelectionToFeatureEditSession(state.session, event.target)),
    status: "idle",
  };

  return emitFeaturePreview({
    ...state,
    selection: nextSelection,
    hoverTarget: event.target,
    command: {
      ...state.command,
      phase: "collecting",
    },
    preview: createFeatureSelectionPreview(nextSession, "Selected"),
    session: nextSession,
    activeReferencePickerFieldId:
      activeReferenceField?.id ?? state.activeReferencePickerFieldId,
    pendingPreviewRequestId: null,
  });
}

function handleImportViewportSelection(
  state: Extract<EditorState, { kind: "importing" }>,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  const activeReferenceField =
    getActiveImportReferencePickerField(state) ??
    getDefaultImportSelectionField(state.session);
  const nextPatch = createImportViewportSelectionPatch(
    state,
    activeReferenceField,
    event.target,
  );
  const provider = dependencies.importProviders.getById(
    state.session.providerId,
  );

  if (!provider || !nextPatch) {
    return { state, effects: [] };
  }

  const nextSelections = provider.applySelectionPatch(
    state.session.review,
    state.session.selections,
    nextPatch,
  );
  const nextSession = {
    ...state.session,
    selections: nextSelections,
    formSchema: provider.getReviewFormSchema(
      state.session.review,
      nextSelections,
    ),
  };

  return {
    state: {
      ...state,
      selection: [event.target],
      hoverTarget: event.target,
      session: nextSession,
      selectionFilter:
        activeReferenceField?.kind === "referencePicker"
          ? getDefaultSelectionFilterForMode("part")
          : state.selectionFilter,
      command: {
        ...state.command,
        phase:
          activeReferenceField?.kind === "referencePicker"
            ? "editing"
            : "collecting",
      },
      preview: createImportSelectionPreview(
        nextSession,
        dependencies,
        "Selected",
      ),
      activeReferencePickerFieldId:
        activeReferenceField?.kind === "referencePicker"
          ? null
          : (activeReferenceField?.id ?? state.activeReferencePickerFieldId),
    },
    effects: [],
  };
}

function handleEditingSketchPlaneViewportSelection(
  state: Extract<EditorState, { kind: "editingSketchPlane" }>,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
): EditorTransitionResult {
  const activeReferenceField = getActiveSketchPlaneReferencePickerField(state);
  if (!activeReferenceField) {
    return { state, effects: [] };
  }

  const target = getSketchPlaneEditSelectionTarget(state.session);
  const nextSession = {
    ...applySelectionToSketchPlaneEditSession(
      state.session,
      event.target,
      state.snapshot,
    ),
    status: "idle" as const,
  };

  return {
    state: {
      ...state,
      selection: [target],
      hoverTarget: target,
      selectionFilter: getDefaultSelectionFilterForMode("part"),
      session: nextSession,
      preview: {
        kind: "selection",
        label: getSketchPlaneEditPreviewLabel(nextSession),
        target,
      },
      command: {
        ...state.command,
        phase: "editing",
      },
      activeReferencePickerFieldId:
        activeReferenceField.kind === "referencePicker"
          ? null
          : activeReferenceField.id,
    },
    effects: [],
  };
}

/**
 * A repeated-click cycle selection (T11d, review R-2): the previous pick
 * (`cycleReplaces`) is first removed as the context's last-added target,
 * then the next stack entry is selected as one ordinary click. The result
 * stands only when it holds the new target where the previous pick was;
 * otherwise (the context no longer holds the previous pick, or rejects or
 * toggles the new one) nothing changes: a cycle click never toggles or
 * appends a second target.
 */
function handleEditingSketchViewportSelection(
  state: SketchEditorState,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
): EditorTransitionResult {
  // cadara-h026.2: a tool cycle's deselect entry drops the tool's own pick.
  if (event.selectionMode === "remove" && !isMultiSelectionContext(state)) {
    const session = removeSketchToolCyclePick(state.session, event.target);
    return session === state.session
      ? { state, effects: [] }
      : {
          state: {
            ...createSketchPreviewState(state, session),
            selection: state.selection.filter(
              (target) => !primitiveRefEquals(target, event.target),
            ),
            hoverTarget: null,
          },
          effects: [],
        };
  }

  if (!event.cycleReplaces) {
    return selectEditingSketchViewportTarget(state, event);
  }

  const { mode } = getSketchSelectionCycleContext(
    state.session,
    state.selectionFilter,
  );
  const trimmed = withoutSketchSelectionCyclePick(state, event.cycleReplaces);
  if (!trimmed) {
    return { state, effects: [] };
  }

  const result = selectEditingSketchViewportTarget(trimmed, event);
  return result.state.kind === "editingSketch" &&
    isSketchSelectionCyclePickRetained(result.state, event.target, mode)
    ? result
    : { state, effects: [] };
}

/**
 * A click in the no-tool sketch selection (cadara-h026.1): the geometry
 * selection accumulates by the event's mode (`applyMultiSelectionRequest`);
 * an active annotation leaves it. A sketch point added becomes the edit
 * target, as a plain point click makes it.
 */
function selectSketchMultiSelectionTarget(
  state: SketchEditorState,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
): EditorTransitionResult {
  const selection = applyMultiSelectionRequest(
    state.selection.filter((target) => !isAnnotationRef(target)),
    event,
  );
  const added = selection.some((target) =>
    primitiveRefEquals(target, event.target),
  );
  const session =
    added && event.target.kind === "sketchPoint"
      ? selectSketchEditTarget(state.session, event.target)
      : state.session;
  return {
    state: {
      ...createSketchPreviewState(state, session),
      selection,
      hoverTarget: event.target,
      annotationContext: getSketchGeometrySelectionContext(state, selection),
    },
    effects: [],
  };
}

function selectEditingSketchViewportTarget(
  state: SketchEditorState,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
): EditorTransitionResult {
  if (
    (event.selectionMode || event.cycleReplaces) &&
    !isAnnotationRef(event.target) &&
    getSketchSelectionCycleContext(state.session, state.selectionFilter)
      .mode === "multiSelect"
  ) {
    return selectSketchMultiSelectionTarget(state, event);
  }

  if (getActiveSketchStyleToolId(state.session)) {
    const session = updateSketchStyleFocusTarget(state.session, [event.target]);
    return {
      state: applySketchSelectionState(state, session, event.target),
      effects: [],
    };
  }

  if (state.session.constructionTargetPicking) {
    const session = toggleSketchConstructionTarget(state.session, event.target);
    return {
      state: {
        ...applySketchSelectionState(state, session, event.target, "editing"),
        command: {
          ...state.command,
          toolId: session.activeTool ?? "sketch",
          phase: "editing",
        },
      },
      effects: [],
    };
  }

  if (state.session.referenceTargetPicking) {
    const session = selectSketchReferenceTarget(state.session, event.target);
    const nextState: SketchEditorState = {
      ...applySketchSelectionState(state, session, event.target, "editing"),
      selectionFilter: session.referenceTargetPicking
        ? sketchReferenceSelectionFilter
        : getDefaultSelectionFilterForMode("sketch"),
      command: {
        ...state.command,
        toolId: session.activeTool ?? "sketch",
        phase: "editing",
      },
    };

    return emitSketchReferenceProjection(nextState, session);
  }

  if (state.session.activeEditTool) {
    const session = selectSketchEditToolTarget(state.session, event.target);
    return {
      state: applySketchSelectionState(state, session, event.target, "editing"),
      effects: [],
    };
  }

  if (shouldPinSketchConstraintPreviewBeforeSelection(state.session)) {
    const session = pinSketchConstraintPreview(
      state.session,
      state.session.constraintAuthoring?.pointer ?? null,
    );

    return {
      state: {
        ...createSketchPreviewState(state, session),
        command: {
          ...state.command,
          phase: "collecting",
        },
      },
      effects: [],
    };
  }

  if (event.target.kind === "constraint" || event.target.kind === "dimension") {
    return {
      state: {
        ...applySketchSelectionState(
          state,
          selectSketchAnnotation(state.session),
          event.target,
        ),
        annotationContext: getSketchAnnotationSelectionContext(
          state,
          event.target,
        ),
      },
      effects: [],
    };
  }

  if (state.session.constraintAuthoring) {
    const authoring = state.session.constraintAuthoring;
    // Review A-6: the owners are the resolved picks, the current one too.
    const current =
      resolveSketchConstraintTarget(
        authoring.toolId,
        state.session.definition,
        event.target,
        state.session.projectedReferences,
      )?.target ?? event.target;
    const picked = [
      ...authoring.selectedTargets.map((entry) => entry.target),
      current,
    ];
    const { session, duplicates } = authorSketchConstraintTarget(
      state.session,
      event.target,
    );
    const existing = duplicates[0];
    // T14c (A2/T-14): a refused duplicate selects the existing constraint
    // (passive while the tool stays armed, linked-highlighted); the next
    // pick starts a fresh pick set (A-10).
    if (existing) {
      return {
        state: {
          ...applySketchSelectionState(state, session, existing, "collecting"),
          annotationContext: {
            owners: picked,
            last: existing,
          },
        },
        effects: [],
      };
    }
    const selected = applySketchSelectionState(
      state,
      session,
      event.target,
      "collecting",
    );
    return {
      state: {
        ...selected,
        command: commandAfterSketchToolCommit(state, session, selected.command),
        annotationContext: null,
      },
      effects: [],
    };
  }

  if (event.target.kind === "sketchPoint") {
    const session = selectSketchEditTarget(state.session, event.target);
    return {
      state: {
        ...applySketchSelectionState(state, session, event.target),
        annotationContext: getSketchGeometrySelectionContext(state, [
          event.target,
        ]),
      },
      effects: [],
    };
  }

  const candidate = resolveSelectionCandidate(
    state.selectionFilter,
    state.selection,
    event.target,
    state.selectionCatalog,
  );

  if (!candidate.accepted) {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      selection: candidate.nextSelection,
      hoverTarget: event.target,
      annotationContext: getSketchGeometrySelectionContext(
        state,
        candidate.nextSelection,
      ),
    },
    effects: [],
  };
}

function isAnnotationRef(
  target: PrimitiveRef | undefined,
): target is SketchConstraintRef | SketchDimensionRef {
  return target?.kind === "constraint" || target?.kind === "dimension";
}

/**
 * T14c (§2.4): selecting annotation A makes it the active selection and the
 * context's `last`. The owners stay when A is one of their contextual
 * annotations (a pinned sibling); otherwise (a list, problem or history pick)
 * A's own affected geometry becomes the owners.
 */
export function getSketchAnnotationSelectionContext(
  state: SketchEditorState,
  target: SketchConstraintRef | SketchDimensionRef,
): SketchAnnotationContext {
  const owners = state.annotationContext?.owners ?? [];
  const wheel = state.annotationContext?.wheel;
  return {
    owners: isSketchAnnotationInContext(state.session, target, owners)
      ? owners
      : (getSketchAnnotationAffectedGeometryRefs(state.session, target) ?? []),
    last: target,
    // T14g (T-10): a spoke goes to the wheel's centre and the wheel stays;
    // any other annotation closes it.
    ...(wheel &&
    wheel.members.some((member) => primitiveRefEquals(member, target))
      ? { wheel }
      : {}),
  };
}

/**
 * T14c (§2.4): selecting geometry makes it the owners; `last` is kept only
 * when it is one of the new owners' contextual annotations.
 */
export function getSketchGeometrySelectionContext(
  state: SketchEditorState,
  selection: readonly PrimitiveRef[],
): SketchAnnotationContext | null {
  const owners = selection.filter((target) => !isAnnotationRef(target));
  if (owners.length === 0) {
    return null;
  }

  const last = state.annotationContext?.last ?? null;
  const wheel = state.annotationContext?.wheel;
  return {
    owners,
    last:
      last && isSketchAnnotationInContext(state.session, last, owners)
        ? last
        : null,
    // T14g (T-10): geometry whose context holds the wheel's cluster keeps
    // it open; geometry outside the context closes it.
    ...(wheel &&
    wheel.members.some((member) =>
      isSketchAnnotationInContext(state.session, member, owners),
    )
      ? { wheel }
      : {}),
  };
}

export function handleViewportSelectionRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "viewport.selectionRequested" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  // Only a multi-selection or a sketch tool that accumulates picks removes
  // a pick (its cycle's deselect entry; cadara-h026.2).
  if (
    event.selectionMode === "remove" &&
    !isMultiSelectionContext(state) &&
    !(
      state.kind === "editingSketch" &&
      hasSketchSelectionCycleDeselectEntry(state.session, state.selectionFilter)
    )
  ) {
    return { state, effects: [] };
  }

  // A cycle click is gated on the selection without the pick it replaces
  // (T11d review A-6; matters for multi-slot filters).
  const gateSelection =
    state.kind === "editingSketch" && event.cycleReplaces
      ? (withoutSketchSelectionCyclePick(state, event.cycleReplaces)
          ?.selection ?? state.selection)
      : state.selection;
  if (
    !selectionFilterAllowsTarget(
      state.selectionFilter,
      gateSelection,
      event.target,
      state.selectionCatalog,
    )
  ) {
    return rejectViewportSelection(
      state,
      getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
      state.preview?.target ?? null,
    );
  }

  if (state.kind === "selectionCommand") {
    const result = handleSelectionCommandViewportSelection(state, event);
    if (result) {
      return result;
    }
  }

  if (state.kind === "editingFeature") {
    return handleEditingFeatureViewportSelection(state, event);
  }

  if (state.kind === "importing") {
    return handleImportViewportSelection(state, event, dependencies);
  }

  if (state.kind === "editingSketchPlane") {
    return handleEditingSketchPlaneViewportSelection(state, event);
  }

  if (state.kind === "editingSketch") {
    return handleEditingSketchViewportSelection(state, event);
  }

  if (state.kind === "inspectingSection") {
    return { state, effects: [] };
  }

  if (state.kind === "idle" && (event.selectionMode || event.cycleReplaces)) {
    return {
      state: {
        ...state,
        selection: applyMultiSelectionRequest(state.selection, event),
        hoverTarget: event.target,
      },
      effects: [],
    };
  }

  const candidate = resolveSelectionCandidate(
    state.selectionFilter,
    state.selection,
    event.target,
    state.selectionCatalog,
  );

  if (!candidate.accepted) {
    return { state, effects: [] };
  }

  if (state.kind === "selectionCommand") {
    return {
      state: {
        ...state,
        selection: candidate.nextSelection,
        hoverTarget: event.target,
        command: {
          ...state.command,
          phase: "collecting",
        },
        preview: {
          kind: "selection",
          label: getSelectionPreviewLabel(
            state.selectionFilter,
            event.target,
            "select",
          ),
          target: event.target,
        },
      },
      effects: [],
    };
  }

  return {
    state: {
      ...state,
      selection: candidate.nextSelection,
      hoverTarget: event.target,
    },
    effects: [],
  };
}

/**
 * The sketch marquee or a parts-tree range (cadara-h026.1); see
 * `SelectionTargetsRequestedEvent`.
 */
export function handleSelectionTargetsRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "selection.targetsRequested" }>,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (!isMultiSelectionContext(state)) {
    const last = event.targets.at(-1);
    return last
      ? handleViewportSelectionRequested(
          state,
          { type: "viewport.selectionRequested", target: last },
          dependencies,
        )
      : { state, effects: [] };
  }

  const targets = event.targets.filter((target) =>
    selectionFilterAllowsTarget(
      state.selectionFilter,
      [],
      target,
      state.selectionCatalog,
    ),
  );
  if (state.kind !== "editingSketch") {
    return {
      state: {
        ...state,
        selection: applyMultiSelectionTargets(
          state.selection,
          targets,
          event.mode,
        ),
      },
      effects: [],
    };
  }

  const selection = applyMultiSelectionTargets(
    state.selection.filter((target) => !isAnnotationRef(target)),
    targets,
    event.mode,
  );
  return {
    state: {
      ...state,
      selection,
      annotationContext: getSketchGeometrySelectionContext(state, selection),
    },
    effects: [],
  };
}

export function handleAuthoringReopenRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "authoring.reopenRequested" }>,
): EditorTransitionResult {
  if (event.target.kind === "sketch" && event.toolId === "sketch") {
    const nextState = createCommandState(
      state,
      "sketch",
      state.mode,
      sketchStartSelectionFilter,
      createSelectionPreview(state, sketchStartSelectionFilter),
    );

    if (
      state.snapshot &&
      canReopenSketchDirectlyFromCurrentCursor(state.snapshot, event.target)
    ) {
      const session = openSketchSessionFromSelection(
        [event.target],
        state.snapshot,
      );

      if (session) {
        return enterSketchEditing(
          {
            ...nextState,
            selection: [event.target],
            hoverTarget: event.target,
          },
          session,
        );
      }
    }

    const cursorContext = createEditSessionCursorContext(
      state.snapshot,
      {
        kind: "sketch",
        sketchId: event.target.sketchId,
      },
      "sketchAuthoring",
    );

    if (!cursorContext) {
      return {
        state: withPreview(nextState, {
          kind: "selection",
          label: `Sketch ${event.target.sketchId} is not in document history.`,
          target: event.target,
        }),
        effects: [],
      };
    }

    return emitDocumentCursorMove(
      {
        ...nextState,
        selection: [event.target],
        hoverTarget: event.target,
        editSessionCursorContext: cursorContext,
        preview: {
          kind: "selection",
          label: `Rolling back before sketch ${event.target.sketchId}`,
          target: event.target,
        },
      },
      cursorContext.rollbackCursor,
      true,
    );
  }

  if (event.target.kind !== "feature" || !isFeatureTool(event.toolId)) {
    return { state, effects: [] };
  }

  const selectionFilter = getSelectionFilterForFeatureType(event.toolId);
  const nextState = createCommandState(
    state,
    event.toolId,
    "part",
    selectionFilter,
    createSelectionPreview(state, selectionFilter),
  );
  const cursorContext = createEditSessionCursorContext(
    state.snapshot,
    {
      kind: "feature",
      featureId: event.target.featureId,
    },
    "featureEdit",
  );

  if (!cursorContext) {
    return {
      state: withPreview(nextState, {
        kind: "selection",
        label: `Feature ${event.target.featureId} is not in document history.`,
        target: event.target,
      }),
      effects: [],
    };
  }

  return emitDocumentCursorMove(
    {
      ...nextState,
      selection: [event.target],
      hoverTarget: event.target,
      editSessionCursorContext: cursorContext,
      preview: {
        kind: "selection",
        label: `Rolling back before feature ${event.target.featureId}`,
        target: event.target,
      },
    },
    cursorContext.rollbackCursor,
    true,
  );
}

export function handleSketchPlaneEditRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: "sketchPlaneEdit.requested" }>,
): EditorTransitionResult {
  const nextState = createCommandState(
    state,
    "sketchPlaneEdit",
    "part",
    getDefaultSelectionFilterForMode("part"),
    {
      kind: "selection",
      label: `Change sketch plane for ${event.target.sketchId}`,
      target: event.target,
    },
  );

  const session = state.snapshot
    ? hydrateSketchPlaneEditSession(state.snapshot, event.target.sketchId)
    : null;

  if (!session) {
    return {
      state: withPreview(nextState, {
        kind: "selection",
        label: `Sketch ${event.target.sketchId} does not support plane reassignment.`,
        target: event.target,
      }),
      effects: [],
    };
  }

  if (canReopenSketchDirectlyFromCurrentCursor(state.snapshot, event.target)) {
    return {
      state: createSketchPlaneEditingState(
        {
          ...nextState,
          selection: [event.target],
          hoverTarget: event.target,
        },
        session,
      ),
      effects: [],
    };
  }

  const cursorContext = createEditSessionCursorContext(
    state.snapshot,
    {
      kind: "sketch",
      sketchId: event.target.sketchId,
    },
    "sketchPlaneEdit",
  );

  if (!cursorContext) {
    return {
      state: withPreview(nextState, {
        kind: "selection",
        label: `Sketch ${event.target.sketchId} is not in document history.`,
        target: event.target,
      }),
      effects: [],
    };
  }

  return emitDocumentCursorMove(
    {
      ...nextState,
      selection: [event.target],
      hoverTarget: event.target,
      editSessionCursorContext: cursorContext,
      preview: {
        kind: "selection",
        label: `Rolling back before sketch ${event.target.sketchId}`,
        target: event.target,
      },
    },
    cursorContext.rollbackCursor,
    true,
  );
}
