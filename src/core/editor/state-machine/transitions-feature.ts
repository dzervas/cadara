import {
  getFeatureEditorFormField,
  patchFeatureEditSession,
  getSelectionFilterForFeatureType,
} from "@/domain/editor/feature-editing";
import {
  getSketchPlaneEditFormField,
  getSketchPlaneEditPreviewLabel,
  getSketchPlaneEditSelectionTarget,
} from "@/domain/editor/sketch-plane-editing";
import { getDefaultSelectionFilterForMode } from "@/core/editor/schema";
import type { EditorEvent, EditorTransitionResult, EditorState } from "./types";
import type { EditorExtensionDependencies } from "./dependencies";
import {
  createFeatureSelectionPreview,
  createImportSelectionPreview,
  createSelectionPreview,
} from "./selection-helpers";
import { emitFeaturePreview } from "./effect-emitters";
import { getImportSessionFormField } from "./form-traversal";

export function handleFormFeaturePatched(
  state: EditorState,
  event: Extract<EditorEvent, { type: "form.featurePatched" }>,
): EditorTransitionResult {
  if (state.kind !== "editingFeature") {
    return { state, effects: [] };
  }

  const nextSession = {
    ...patchFeatureEditSession(state.session, event.patch),
    status: "idle" as const,
  };

  return emitFeaturePreview({
    ...state,
    session: nextSession,
    pendingPreviewRequestId: null,
    preview: createFeatureSelectionPreview(nextSession),
  });
}

export function handleFormReferencePickerActivated(
  state: EditorState,
  event: Extract<EditorEvent, { type: "form.referencePickerActivated" }>,
): EditorTransitionResult {
  if (
    state.kind !== "editingFeature" &&
    state.kind !== "editingSketchPlane" &&
    state.kind !== "importing"
  ) {
    return { state, effects: [] };
  }

  const field =
    state.kind === "editingFeature"
      ? getFeatureEditorFormField(state.session, event.fieldId)
      : state.kind === "editingSketchPlane"
        ? getSketchPlaneEditFormField(state.session, event.fieldId)
        : getImportSessionFormField(state.session, event.fieldId);

  if (
    field?.kind !== "referencePicker" &&
    field?.kind !== "referenceCollection"
  ) {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      activeReferencePickerFieldId: field.id,
      selection: [],
      hoverTarget: null,
      selectionFilter: field.picker.selectionFilter,
      preview: createSelectionPreview(
        { ...state, selection: [] },
        field.picker.selectionFilter,
      ),
      command: {
        ...state.command,
        phase: "collecting",
      },
    },
    effects: [],
  };
}

export function handleFormReferencePickerCancelled(
  state: EditorState,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  if (
    (state.kind !== "editingFeature" &&
      state.kind !== "editingSketchPlane" &&
      state.kind !== "importing") ||
    !state.activeReferencePickerFieldId
  ) {
    return { state, effects: [] };
  }

  const sketchPlaneTarget =
    state.kind === "editingSketchPlane"
      ? getSketchPlaneEditSelectionTarget(state.session)
      : null;

  return {
    state: {
      ...state,
      activeReferencePickerFieldId: null,
      selection: sketchPlaneTarget ? [sketchPlaneTarget] : [],
      hoverTarget: sketchPlaneTarget,
      selectionFilter:
        state.kind === "editingFeature"
          ? getSelectionFilterForFeatureType(state.session.featureType)
          : state.kind === "editingSketchPlane"
            ? getDefaultSelectionFilterForMode("part")
            : getDefaultSelectionFilterForMode("part"),
      preview:
        state.kind === "editingFeature"
          ? createFeatureSelectionPreview(state.session)
          : state.kind === "editingSketchPlane"
            ? {
                kind: "selection",
                label: getSketchPlaneEditPreviewLabel(state.session),
                target: sketchPlaneTarget,
              }
            : createImportSelectionPreview(state.session, dependencies),
      command: {
        ...state.command,
        phase: "editing",
      },
    },
    effects: [],
  };
}
