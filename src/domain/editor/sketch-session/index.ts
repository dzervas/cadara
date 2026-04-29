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
  beginSketchAnnotationEdit,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  selectSketchAnnotation,
} from './annotations'

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
  filterSketchDefinitionThroughCursor,
  getSketchSessionRegionDiagnostics,
} from './internals'

export {
  appendReferenceImageOperations,
  updateReferenceImageOperationStates,
  updateSketchReferenceProjection,
} from './references'

export {
  constraintReferencesSketchGeometry,
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  createTailSketchHistoryCursor,
  derivePlaneKeyFromTarget,
  deriveSketchDisplayEntities,
  dimensionReferencesSketchGeometry,
  getConnectedSketchEntitySelectionTargets,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
  isEditableSketchGeometrySelection,
  isSketchConstructionSelected,
  isSketchReferenceToolSelected,
  mapSketchPointToWorld,
  moveSketchHistoryCursor,
  normalizeSketchConstraintDisplayState,
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
