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
  SketchAnnotationEditState,
  SketchAnnotationDescriptor,
  SketchDimensionAnnotationDragHandle,
  SketchAnnotationGlyphKind,
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
  resolveSketchDragIntent,
} from "./drag-intent";

export {
  createProjectedPrimitiveRef,
  createReferencePrimitiveRef,
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from "./annotation-targets";

export {
  beginSketchAnnotationEdit,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  selectSketchAnnotation,
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
  completeSketchOffsetPreviewPublication,
  completeSketchTrimQuery,
  deleteSelectedSketchGeometry,
  failSketchTrimQuery,
  finishSketchGeometryDrag,
  patchSketchEditToolValue,
  refreshSketchEditToolAfterOffsetRound,
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
  constraintReferencesSketchGeometry,
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  derivePlaneKeyFromTarget,
  deriveSketchDisplayEntities,
  dimensionReferencesSketchGeometry,
  getConnectedSketchEntitySelectionTargets,
  isEditableSketchGeometrySelection,
  isSketchConstructionSelected,
  isSketchReferenceToolSelected,
  mapSketchPointToWorld,
} from "./state";

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
  deleteSketchReferenceTarget,
  getSketchSessionPreviewLabel,
  getSketchToolPresentation,
  patchSketchDrawingToolValue,
  selectSketchEditTarget,
  selectSketchReferenceTarget,
  startSketchDraw,
  toggleSketchConstructionTarget,
  updateSketchPointer,
} from "./tools";
