import type { SketchSessionState } from "./types";
import { getSketchConstraintDefinition } from "@/core/sketch-constraints/registry";
import { getSketchSessionInvalidFeedback } from "./session-feedback";
import type {
  SketchToolPresentationSchema,
  SketchToolControlValue,
} from "@/core/sketch-tools/editor-schema";
import { buildSketchStylePresentation } from "@/core/sketch-styles/definition";
import { getSketchStyleTargetDefinition } from "./styles";
import { isDrawingSketchTool, withConstructionFlag } from "./tool-authoring";
import { buildCommittedDimensionOverlays } from "./dimension-overlays";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import { withPlacementPresentation } from "./tool-placement";

export function getToolRuntimeState(
  session: SketchSessionState,
): import("@/core/sketch-tools/definition").SketchToolRuntimeState {
  return {
    status: session.status === "drawing" ? "drawing" : "idle",
    pointerDownPoint: session.pointerDownPoint,
    livePoint: session.livePoint,
    placedPoints: session.toolPlacedPoints,
    settings: session.toolSettings,
    validationMessage: session.toolPresentation?.validation?.[0]?.message ?? null,
  };
}

export function getSketchSessionPreviewLabel(
  session: SketchSessionState,
): string {
  if (session.activeAnnotationEdit) {
    return (
      session.toolPresentation?.prompts[0]?.text ?? "Edit annotation value"
    );
  }

  if (session.activeSpecialMode) {
    return "Sketch special mode active";
  }

  if (session.constraintAuthoring) {
    const definition = getSketchConstraintDefinition(
      session.constraintAuthoring.toolId,
    );
    const valueSpec =
      definition.getValueSpec?.(session.constraintAuthoring.selectedTargets) ??
      definition.valueSpec;

    if (session.status === "awaitingValue") {
      return session.constraintAuthoring.isPreviewPinned
        ? `Enter ${valueSpec?.label.toLowerCase() ?? "value"}`
        : `Place ${valueSpec?.label.toLowerCase() ?? "value"} annotation`;
    }

    const step =
      definition.steps[
        Math.min(
          session.constraintAuthoring.selectedTargets.length,
          definition.steps.length - 1,
        )
      ];

    return step?.label ?? definition.metadata.name;
  }

  const primaryPrompt =
    session.toolPresentation?.validation?.[0]?.message ??
    session.toolPresentation?.prompts[0]?.text;

  if (primaryPrompt) {
    return primaryPrompt;
  }

  if (session.validationMessage) {
    return session.validationMessage;
  }

  if (session.projectionDiagnostics.length > 0) {
    return (
      session.projectionDiagnostics[0]?.message ??
      "Sketch reference projection has diagnostics"
    );
  }

  // T13c (R-2): the conflict explanation first, else the first non-info
  // region/validity diagnostic.
  const invalidFeedback = getSketchSessionInvalidFeedback(session);
  if (invalidFeedback) {
    return invalidFeedback;
  }

  if (session.activeDrag?.status === "dragging") {
    return "Dragging sketch point";
  }

  if (session.activeEditTarget) {
    return "Sketch point selected";
  }

  if (session.activeStyleFocus) {
    return session.activeStyleFocus.target
      ? "Sketch style controls active"
      : "Select sketch geometry to edit style";
  }

  if (session.constructionTargetPicking) {
    return "Select sketch geometry to toggle construction";
  }

  if (session.activeTool === null) {
    return session.definition.entityIds.length > 0
      ? `Sketch has ${session.definition.entityIds.length} authored entities`
      : "Sketch session ready";
  }

  if (session.status === "drawing") {
    return `${session.activeTool} preview active, click again to accept`;
  }

  return `Ready to place ${session.activeTool}, click to set first point`;
}

export function getSketchToolPresentation(
  session: SketchSessionState,
): SketchToolPresentationSchema | null {
  if (session.activeSpecialMode) {
    return null;
  }

  if (session.activeAnnotationEdit) {
    return session.toolPresentation;
  }

  if (session.activeTool === "construction") {
    return session.toolPresentation;
  }

  if (session.constraintAuthoring) {
    return session.toolPresentation;
  }

  if (session.activeEditTool) {
    return session.toolPresentation;
  }

  if (session.activeStyleFocus) {
    return buildSketchStylePresentation(
      session.activeStyleFocus,
      getSketchStyleTargetDefinition(session, session.activeStyleFocus.target)
        ?.style,
    );
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    if (!session.activeEditTarget) {
      const overlays = buildCommittedDimensionOverlays(
        session,
        session.definition,
      );
      return overlays.length > 0 ? { prompts: [], overlays } : null;
    }

    const overlays = buildCommittedDimensionOverlays(
      session,
      session.definition,
    );
    return overlays.length > 0 ? { prompts: [], overlays } : null;
  }

  const presentation =
    session.toolPresentation ??
    getSketchToolDefinition(session.activeTool).getPresentation(
      getToolRuntimeState(session),
    );
  // T13-D22: every drawing tool shows the visible suppression control.
  const inferenceEnabled = !session.inferenceSuppressionToggled;
  const cached = snapInferencePresentations.get(presentation);
  if (cached?.inferenceEnabled === inferenceEnabled) {
    return cached.presentation;
  }
  const withToggle: SketchToolPresentationSchema = {
    ...presentation,
    controls: [
      ...(presentation.controls ?? []),
      {
        id: "sketch-snap-inference",
        kind: "toggle",
        label: "Snap & infer",
        hint: "Hold Shift to place freely",
        value: inferenceEnabled,
        action: { type: "patch", patch: { intent: "setSnapInference" } },
      },
    ],
  };
  snapInferencePresentations.set(presentation, {
    inferenceEnabled,
    presentation: withToggle,
  });
  return withToggle;
}

/**
 * The toggle-augmented presentation per session presentation, so a render
 * that reads it twice gets the same object (the viewport keys feedback
 * projection on its identity).
 */
const snapInferencePresentations = new WeakMap<
  SketchToolPresentationSchema,
  {
    inferenceEnabled: boolean;
    presentation: SketchToolPresentationSchema;
  }
>();

export function patchSketchDrawingToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool) ||
    patch.intent !== "setToolSetting"
  ) {
    return session;
  }

  const key = typeof patch.key === "string" ? patch.key : null;
  if (!key) {
    return session;
  }

  const nextSettings = {
    ...session.toolSettings,
    [key]: (patch.value ?? null) as SketchToolControlValue,
  };
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const runtimeState = {
    ...getToolRuntimeState(session),
    settings: nextSettings,
  };

  return {
    ...session,
    toolSettings: nextSettings,
    toolStagedEntities: withConstructionFlag(
      toolDefinition.getStagedEntities(runtimeState),
      session.constructionModifierActive,
    ),
    // The placed clicks keep their badges (T13g review RQ-1).
    toolPresentation: withPlacementPresentation(
      toolDefinition.getPresentation(runtimeState),
      session.toolPlacements ?? [],
      null,
    ),
  };
}
