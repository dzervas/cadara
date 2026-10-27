import type { DocumentId } from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SectionViewSession, Vec3 } from "@/core/section-view/session";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import type {
  SketchSpecialModeHandleRef,
  SketchSpecialModeViewportPresentation,
} from "@/core/sketch-special-modes/schema";
import type {
  EditorEvent,
  EditorViewState,
  SelectionRequestMode,
} from "@/domain/editor/state-machine";
import type {
  SketchAnnotationDescriptor,
  SketchSessionDisplayRenderable,
} from "@/core/editor/sketch-session";
import type { MeasurementWitness } from "@/core/measure/measurement";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import { getSketchMergeOfferEvents } from "@/domain/editor/workbench-interactions";
import type {
  ViewportCommand,
  ViewportIntent,
  ViewportModel,
} from "@/workbench/viewport/viewport-boundary";

interface WorkbenchViewportModelInput {
  documentId: DocumentId | null;
  activeSectionView: SectionViewSession | null;
  hoverTarget: PrimitiveRef | null;
  measurementWitnesses: readonly MeasurementWitness[];
  renderables: ViewportRenderableRecord[];
  sketchDisplayRenderables: SketchSessionDisplayRenderable[];
  sketchAnnotations: SketchAnnotationDescriptor[];
  selection: PrimitiveRef[];
  annotationContext: EditorViewState["annotationContext"];
  showAllAnnotations: boolean;
  sketchToolPresentation: SketchToolPresentationSchema | null;
  documentVariableNames: readonly string[];
  specialModePresentation: SketchSpecialModeViewportPresentation | null;
  hasNonEmptyCommittedGeometry: boolean;
  mode: EditorViewState["mode"];
  selectionFilter: EditorViewState["selectionFilter"];
  selectionCatalog: EditorViewState["selectionCatalog"];
  sketchSession: EditorViewState["sketchSession"];
  isEditorRenderIdle: boolean;
  /** `isMultiSelectionContext(state)` (cadara-h026.1). */
  multiSelection: boolean;
  acceptsSpecialModeTarget: ViewportModel["capabilities"]["acceptsSpecialModeTarget"];
}

export function createWorkbenchViewportModel({
  documentId,
  activeSectionView,
  hoverTarget,
  measurementWitnesses,
  renderables,
  sketchDisplayRenderables,
  sketchAnnotations,
  selection,
  annotationContext,
  showAllAnnotations,
  sketchToolPresentation,
  documentVariableNames,
  specialModePresentation,
  hasNonEmptyCommittedGeometry,
  mode,
  selectionFilter,
  selectionCatalog,
  sketchSession,
  isEditorRenderIdle,
  multiSelection,
  acceptsSpecialModeTarget,
}: WorkbenchViewportModelInput): ViewportModel {
  return {
    documentId,
    activeSectionView,
    hoverTarget,
    measurementWitnesses,
    renderables,
    sketchDisplayRenderables,
    sketchAnnotations,
    selection,
    annotationContext,
    showAllAnnotations,
    sketchToolPresentation,
    documentVariableNames,
    specialModePresentation,
    hasNonEmptyCommittedGeometry,
    interaction: {
      mode,
      selectionFilter,
      selectionCatalog,
      sketchSession,
      isEditorRenderIdle,
      multiSelection,
    },
    capabilities: {
      acceptsSpecialModeTarget,
    },
  };
}

export function createWorkbenchViewportCommands(input: {
  fitViewRequestId: number;
}): readonly ViewportCommand[] {
  return [{ type: "fitViewRequested", requestId: input.fitViewRequestId }];
}

interface WorkbenchViewportIntentActions {
  dispatch: (event: EditorEvent) => void;
  onHover: (target: PrimitiveRef) => void;
  onSelect: (
    target: PrimitiveRef,
    cameraPosition?: Vec3,
    cycleReplaces?: PrimitiveRef,
    selectionMode?: SelectionRequestMode,
  ) => void;
  onConnectedSketchSelect: (target: PrimitiveRef) => void;
  onDeselect: () => void;
  onClearHover: () => void;
  onSketchMove: (
    point: readonly [number, number],
    sketchUnitsPerPixel: number | null,
  ) => void;
  onSketchRelease: (
    point: readonly [number, number],
    sketchUnitsPerPixel: number | null,
    target?: PrimitiveRef | null,
  ) => void;
  onSketchGeometryDragStart: (
    target: PrimitiveRef,
    point: readonly [number, number],
  ) => void;
  onSketchGeometryDragMove: (
    point: readonly [number, number],
    options?: { exactZero?: boolean },
  ) => void;
  onSketchGeometryDragEnd: (
    point: readonly [number, number],
    options?: { exactZero?: boolean },
  ) => void;
  onSpecialModeClick: (
    point: readonly [number, number],
    target?: PrimitiveRef | null,
  ) => void;
  onSpecialModeDoubleClick: (
    point: readonly [number, number],
    target?: PrimitiveRef | null,
  ) => void;
  onSpecialModeDragStart: (
    handle: SketchSpecialModeHandleRef,
    point: readonly [number, number],
  ) => void;
  onSpecialModeDragMove: (
    handle: SketchSpecialModeHandleRef,
    point: readonly [number, number],
  ) => void;
  onSpecialModeDragEnd: (
    handle: SketchSpecialModeHandleRef,
    point: readonly [number, number],
  ) => void;
  onSectionOffsetChange: (offset: number) => void;
  onSectionFlip: () => void;
  onSectionClear: () => void;
  onLodTierChange: (tierId: OccTessellationTierId) => void;
  onCanvasCreated: () => void;
  onFirstNonEmptyGeometryFrame: () => void;
}

export function createWorkbenchViewportIntentHandler({
  dispatch,
  onHover,
  onSelect,
  onConnectedSketchSelect,
  onDeselect,
  onClearHover,
  onSketchMove,
  onSketchRelease,
  onSketchGeometryDragStart,
  onSketchGeometryDragMove,
  onSketchGeometryDragEnd,
  onSpecialModeClick,
  onSpecialModeDoubleClick,
  onSpecialModeDragStart,
  onSpecialModeDragMove,
  onSpecialModeDragEnd,
  onSectionOffsetChange,
  onSectionFlip,
  onSectionClear,
  onLodTierChange,
  onCanvasCreated,
  onFirstNonEmptyGeometryFrame,
}: WorkbenchViewportIntentActions): (intent: ViewportIntent) => void {
  return (intent) => {
    switch (intent.type) {
      case "hovered":
        onHover(intent.target);
        return;
      case "selected":
        onSelect(
          intent.target,
          intent.cameraPosition,
          intent.cycleReplaces,
          intent.selectionMode,
        );
        return;
      case "targetsSelected":
        dispatch({
          type: "selection.targetsRequested",
          targets: intent.targets,
          mode: intent.mode,
        });
        dispatch({ type: "viewport.hoverCleared" });
        return;
      case "connectedSketchSelected":
        onConnectedSketchSelect(intent.target);
        return;
      case "deselected":
        onDeselect();
        return;
      case "annotationEditRequested":
        dispatch({
          type: "sketch.annotationEditRequested",
          target: intent.target,
        });
        return;
      case "hoverCleared":
        onClearHover();
        return;
      case "annotationWheelOpened":
        dispatch({
          type: "sketch.annotationWheelOpened",
          clusterKey: intent.clusterKey,
          members: intent.members,
        });
        return;
      case "annotationWheelClosed":
        dispatch({ type: "sketch.annotationWheelClosed" });
        return;
      case "annotationWheelListFilterChanged":
        dispatch({
          type: "sketch.annotationWheelListFilterChanged",
          filtered: intent.filtered,
        });
        return;
      case "sketchPointerMoved":
        onSketchMove(intent.point, intent.sketchUnitsPerPixel);
        return;
      case "sketchPointerReleased":
        onSketchRelease(
          intent.point,
          intent.sketchUnitsPerPixel,
          intent.target,
        );
        return;
      case "sketchDrawFinalizeRequested":
        // Enter's confirm step: finalizes a viable spline, else nothing.
        dispatch({ type: "sketch.confirmRequested" });
        return;
      case "sketchInferenceSuppressionChanged":
        dispatch({
          type: "sketch.inferenceSuppressionChanged",
          held: intent.held,
        });
        return;
      case "sketchGeometryDragStarted":
        onSketchGeometryDragStart(intent.target, intent.point);
        return;
      case "sketchGeometryDragMoved":
        onSketchGeometryDragMove(
          intent.point,
          intent.exactZero ? { exactZero: true } : undefined,
        );
        return;
      case "sketchGeometryDragEnded":
        onSketchGeometryDragEnd(
          intent.point,
          intent.exactZero ? { exactZero: true } : undefined,
        );
        return;
      case "sketchGeometryDragCancelled":
        dispatch({ type: "sketch.geometryDragCancelled" });
        return;
      case "specialModeClicked":
        onSpecialModeClick(intent.point, intent.target);
        return;
      case "specialModeDoubleClicked":
        onSpecialModeDoubleClick(intent.point, intent.target);
        return;
      case "specialModeDragStarted":
        onSpecialModeDragStart(intent.handle, intent.point);
        return;
      case "specialModeDragMoved":
        onSpecialModeDragMove(intent.handle, intent.point);
        return;
      case "specialModeDragEnded":
        onSpecialModeDragEnd(intent.handle, intent.point);
        return;
      case "sectionOffsetChanged":
        onSectionOffsetChange(intent.offset);
        return;
      case "sectionFlipRequested":
        onSectionFlip();
        return;
      case "sectionClearRequested":
        onSectionClear();
        return;
      case "sketchToolPatched":
        dispatch({ type: "sketch.toolPatched", patch: intent.patch });
        return;
      case "sketchMergeOffered":
        for (const event of getSketchMergeOfferEvents(
          intent.source,
          intent.destination,
        ))
          dispatch(event);
        return;
      case "lodTierChanged":
        onLodTierChange(intent.tierId);
        return;
      case "canvasCreated":
        onCanvasCreated();
        return;
      case "firstNonEmptyGeometryFrame":
        onFirstNonEmptyGeometryFrame();
        return;
    }
  };
}
