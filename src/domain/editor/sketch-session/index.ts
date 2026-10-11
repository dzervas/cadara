// Barrel re-exports for sketch-session module

// Type re-exports from types.ts
export type {
  SketchDraftEntity,
  SketchToolId,
} from "@/core/sketch-tools/definition";
export type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
export type {
  SketchConstructionToolId,
  SketchReferenceToolId,
  SketchAuthoringToolId,
  SketchSessionStatus,
  SketchConstraintAuthoringState,
  SketchAnnotationContext,
  SketchAnnotationEditState,
  SketchAnnotationDescriptor,
  SketchAnnotationProblem,
  SketchDimensionAnnotationDragHandle,
  SketchAnnotationGlyphKind,
  SketchDragFeedback,
  SketchGeometryDragState,
  SketchLiveRegionBasis,
  SketchLiveRegions,
  SketchLiveSolve,
  SketchEditToolState,
  SketchSessionState,
  SketchSessionDisplayRenderable,
  SketchConstraintDisplayState,
  SketchConstraintDisplayTargetState,
  SketchConstraintDisplaySummary,
  SketchDisplayDiagnosticStyle,
  SketchDisplayPaintStyle,
  SketchDisplayStrokeStyle,
  SketchHistoryItem,
} from "./types";

export {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
  normalizeSketchConstraintDisplayState,
} from "./annotation-display";

export type { SketchDragHandle, SketchDragIntent } from "./drag-intent";
export {
  getSketchEntityDefiningPointIds,
  resolveHandleFromTarget,
  resolveSketchDragIntent,
} from "./drag-intent";
export type { SketchAnnotationListRow } from "./annotations";

export {
  createProjectedPrimitiveRef,
  createReferencePrimitiveRef,
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from "./annotation-targets";

export {
  beginSketchAnnotationEdit,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationAffectedGeometryRefs,
  getSketchAnnotationContextRefs,
  getSketchAnnotationDescriptors,
  getSketchAnnotationListRows,
  isSketchAnnotationDrawnInViewport,
  isSketchAnnotationInContext,
  pruneSketchAnnotationContext,
  selectSketchAnnotation,
  withoutSketchAnnotationWheel,
} from "./annotations";

export {
  addAnchorOffset,
  applyPointPositionsToDefinition,
  getSketchDatumGuideExtent,
} from "./definition-patches";

export {
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  authorSketchConstraintTarget,
  selectSketchConstraintTarget,
  shouldDeferSketchConstraintPreviewPinToSelection,
  shouldPinSketchConstraintPreviewBeforeSelection,
  updateSketchConstraintHover,
} from "./constraints";

export {
  getSketchSessionDisplayRenderables,
  getStableSketchSessionDisplayKey,
  getStableSketchSessionDisplayRenderables,
  getTransientSketchSessionDisplayRenderables,
  sketchSessionHasReferenceImage,
} from "./display";

export {
  beginSketchGeometryDrag,
  cancelSketchGeometryDrag,
  completeSketchOffsetPreviewPublication,
  completeSketchEditQuery,
  deleteSelectedSketchGeometry,
  failSketchEditQuery,
  finishSketchGeometryDrag,
  getSketchMirrorConfirmIntent,
  isSketchMergePointsReady,
  isSketchMirrorReady,
  patchSketchEditToolValue,
  refreshSketchEditToolAfterOffsetRound,
  restageSketchMirrorTool,
  selectSketchEditToolTarget,
  updateSketchEditToolHover,
  updateSketchGeometryDrag,
} from "./editing";

export { buildCommitRequest, getSketchHistoryItems } from "./history";

export {
  failSketchLiveRegions,
  getSketchSessionDerivationSettings,
  getSketchSessionDerivedValidity,
  getSketchSessionLiveRegionBasis,
  getSketchSessionRegionDiagnostics,
  hasAcceptedLiveSolveOfDefinition,
  publishSketchLiveRegions,
  withLiveSolveBasis,
} from "./internals";

export {
  appendReferenceImageOperations,
  updateReferenceImageOperationStates,
  updateSketchReferenceProjection,
} from "./references";

export {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
} from "./selection";

export {
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  derivePlaneKeyFromTarget,
  deriveSketchDisplayEntities,
  getConnectedSketchEntitySelectionTargets,
  isEditableSketchGeometrySelection,
  isSketchConstructionSelected,
  isSketchReferenceToolSelected,
  mapSketchPointToWorld,
} from "./state";

export {
  constraintReferencesSketchGeometry,
  dimensionReferencesSketchGeometry,
} from "@/domain/sketch-editing/definition-references";

export { computeSketchMirrorActionState } from "./mirror-actions";
export type {
  SketchMirrorActionEntry,
  SketchMirrorActionState,
} from "./mirror-actions";

export { computeSketchTangentActionState } from "./tangent-actions";

export {
  focusSketchStyleTool,
  getActiveSketchStyleToolId,
  hasSketchStyleTarget,
  isSketchSvgRenderingEnabled,
  patchSketchStyleValue,
  toggleSketchSvgRendering,
  updateSketchStyleFocusTarget,
} from "./styles";

export {
  acceptSketchDraw,
  adoptCompatibleSketchEditToolTargets,
  beginSketchTool,
  clearActiveSketchTool,
  confirmSketchDrawing,
  deleteSketchReferenceTarget,
  escapeSketchDrawing,
  finalizeSketchDraw,
  getSketchSessionPreviewLabel,
  getSketchToolPresentation,
  patchSketchDrawingToolValue,
  resolveSketchDrawingEscapeStep,
  selectSketchEditTarget,
  selectSketchReferenceTarget,
  setSketchInferenceSuppression,
  planSketchSnapIntersectionQuery,
  getSketchSnapIntersectionQueryToIssue,
  completeSketchSnapIntersectionQuery,
  failSketchSnapIntersectionQuery,
  setSketchSnapScale,
  startSketchDraw,
  toggleSketchConstructionTarget,
  updateSketchPointer,
  type SketchDrawingEscapeStep,
} from "./tools";
