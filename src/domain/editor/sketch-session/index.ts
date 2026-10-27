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
export type { SketchAnnotationListRow } from "./annotation-descriptors";

export {
  createProjectedPrimitiveRef,
  createReferencePrimitiveRef,
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from "./annotation-targets";

export {
  beginSketchAnnotationEdit,
  updateSketchDimensionValue,
  makeSketchAnnotationReference,
} from "./annotation-editing";
export {
  deleteSelectedSketchAnnotation,
  getSketchAnnotationAffectedGeometryRefs,
  getSketchAnnotationContextRefs,
  isSketchAnnotationInContext,
  pruneSketchAnnotationContext,
  selectSketchAnnotation,
  withoutSketchAnnotationWheel,
  getSketchMirrorLinkedGeometryRefs,
} from "./annotation-selection";
export {
  getSketchAnnotationDescriptors,
  getSketchAnnotationListRows,
  isSketchAnnotationDrawnInViewport,
} from "./annotation-descriptors";

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
  beginSketchGeometryDrag,
  cancelSketchGeometryDrag,
  finishSketchGeometryDrag,
  updateSketchGeometryDrag,
} from "./geometry-drag";
export {
  completeSketchOffsetPreviewPublication,
  isSketchOffsetConfirmable,
  prepareSketchOffset,
  completeSketchOffset,
} from "./offset-editing";
export {
  completeSketchEditQuery,
  failSketchEditQuery,
  completeSketchIntersectionEdit,
  prepareSketchIntersectionEdit,
} from "./edit-queries";
export { deleteSelectedSketchGeometry } from "./geometry-deletion";
export {
  getSketchMirrorConfirmIntent,
  isSketchMirrorReady,
  restageSketchMirrorTool,
} from "./mirror-editing";
export {
  isSketchMergePointsReady,
  restageSketchMergePointsTool,
} from "./point-merge";
export {
  patchSketchEditToolValue,
  refreshSketchEditToolAfterOffsetRound,
  selectSketchEditToolTarget,
  updateSketchEditToolHover,
} from "./edit-tool-interaction";

export { buildCommitRequest, getSketchHistoryItems } from "./history";

export {
  failSketchLiveRegions,
  getSketchSessionDerivedValidity,
  getSketchSessionLiveRegionBasis,
  getSketchSessionRegionDiagnostics,
  hasAcceptedLiveSolveOfDefinition,
  publishSketchLiveRegions,
  withLiveSolveBasis,
  isAcceptedSketchSolve,
  getLiveRegionBoundaryDiagnostics,
} from "./session-live-solve";
export {
  getSketchSessionDerivationSettings,
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
  createSketchPointRef,
} from "./session-definition";

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

export { computeSketchOffsetActionState } from "./offset-actions";
export type {
  SketchOffsetActionEntry,
  SketchOffsetActionState,
} from "./offset-actions";

export { computeSketchTangentActionState } from "./tangent-actions";

export { computeSketchCloseSplineState } from "./close-spline";
export type { SketchCloseSplineState } from "./close-spline";

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
  setSketchSnapScale,
  startSketchDraw,
  authorSketchPrimitive,
} from "./drawing-commit";
export {
  adoptCompatibleSketchEditToolTargets,
  removeSketchToolCyclePick,
  selectSketchEditTarget,
} from "./edit-tool-activation";
export {
  beginSketchConstraintToolFromSelection,
  beginSketchTool,
  canUndoSketchDraftPoint,
  undoSketchDraftPoint,
  clearActiveSketchTool,
  confirmSketchDrawing,
  escapeSketchDrawing,
  finalizeSketchDraw,
  resolveSketchDrawingEscapeStep,
} from "./drawing-tool-lifecycle";
export type { SketchDrawingEscapeStep } from "./drawing-tool-lifecycle";
export {
  deleteSketchReferenceTarget,
  selectSketchReferenceTarget,
  toggleSketchConstructionTarget,
  authorSketchReference,
  setSketchConstructionTarget,
} from "./reference-authoring";
export {
  getSketchSessionPreviewLabel,
  getSketchToolPresentation,
  patchSketchDrawingToolValue,
} from "./tool-presentation";
export {
  setSketchInferenceSuppression,
  planSketchSnapIntersectionQuery,
  getSketchSnapIntersectionQueryToIssue,
  completeSketchSnapIntersectionQuery,
  failSketchSnapIntersectionQuery,
  updateSketchPointer,
} from "./drawing-pointer";

export {
  createSketchDerivation,
  createSketchMirror,
  buildSketchGeometry,
} from "./edit-geometry-operations";

export { rebuildSessionForDefinition } from "./definition-authoring";

export { getSessionSketchId } from "./tool-authoring";
