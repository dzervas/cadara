// Barrel re-exports for sketch-session module

// Type re-exports from types.ts
export type { SketchDraftEntity, SketchToolId } from '@/domain/sketch-tools/definition'
export type { SketchConstraintToolId } from '@/domain/sketch-constraints/definition'
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
  SketchEditToolState,
  SketchSessionState,
  SketchSessionDisplayRenderable,
  SketchConstraintDisplayState,
  SketchConstraintDisplayTargetState,
  SketchConstraintDisplaySummary,
  SketchDisplayDiagnosticStyle,
  SketchDisplayPaintStyle,
  SketchDisplayStrokeStyle,
  SketchHistoryCursor,
  SketchHistoryOperation,
  SketchHistoryItem,
} from './types'

export {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
  normalizeSketchConstraintDisplayState,
} from './annotation-display'

export {
  createProjectedPrimitiveRef,
  createReferencePrimitiveRef,
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from './annotation-targets'

export {
  beginSketchAnnotationEdit,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  selectSketchAnnotation,
} from './annotations'

export {
  addAnchorOffset,
  applyPointPositionsToDefinition,
  getSketchDatumGuideExtent,
} from './definition-patches'

export {
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  shouldDeferSketchConstraintPreviewPinToSelection,
  shouldPinSketchConstraintPreviewBeforeSelection,
  updateSketchConstraintHover,
} from './constraints'

export {
  getSketchSessionDisplayRenderables,
  sketchSessionHasReferenceImage,
} from './display'

export {
  beginSketchGeometryDrag,
  deleteSelectedSketchGeometry,
  deleteSketchHistoryOperation,
  finishSketchGeometryDrag,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  updateSketchEditToolHover,
  updateSketchGeometryDrag,
} from './editing'

export {
  buildCommitRequest,
  createTailSketchHistoryCursor,
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
} from './history'

export {
  filterSketchDefinitionThroughCursor,
  getSketchSessionRegionDiagnostics,
} from './internals'

export {
  appendReferenceImageOperations,
  updateReferenceImageOperationStates,
  updateSketchReferenceProjection,
} from './references'

export {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
  getOperationOwnedStateTargetIds,
  pruneDirectOperationDependents,
  repairSketchHistoryCursorAfterOperationRemoval,
} from './selection'

export {
  constraintReferencesSketchGeometry,
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  derivePlaneKeyFromTarget,
  deriveSketchDisplayEntities,
  dimensionReferencesSketchGeometry,
  getConnectedSketchEntitySelectionTargets,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  isEditableSketchGeometrySelection,
  isSketchConstructionSelected,
  isSketchReferenceToolSelected,
  mapSketchPointToWorld,
  moveSketchHistoryCursor,
} from './state'

export {
  focusSketchStyleTool,
  getActiveSketchStyleToolId,
  hasSketchStyleTarget,
  isSketchSvgRenderingEnabled,
  patchSketchStyleValue,
  toggleSketchSvgRendering,
  updateSketchStyleFocusTarget,
} from './styles'

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
} from './tools'
