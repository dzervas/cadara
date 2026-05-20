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
} from "@/domain/editor/state-machine";
import type {
  SketchAnnotationDescriptor,
  SketchSessionDisplayRenderable,
} from "@/domain/editor/sketch-session";
import type { MeasurementWitness } from "@/domain/measure/measurement";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import type {
  ViewportCommand,
  ViewportIntent,
  ViewportModel,
} from "@/workbench/viewport/viewport-boundary";

interface WorkbenchViewportModelInput {
  activeSectionView: SectionViewSession | null;
  hoverTarget: PrimitiveRef | null;
  measurementWitnesses: readonly MeasurementWitness[];
  renderables: ViewportRenderableRecord[];
  sketchDisplayRenderables: SketchSessionDisplayRenderable[];
  sketchAnnotations: SketchAnnotationDescriptor[];
  selection: PrimitiveRef[];
  sketchToolPresentation: SketchToolPresentationSchema | null;
  specialModePresentation: SketchSpecialModeViewportPresentation | null;
  hasNonEmptyCommittedGeometry: boolean;
  mode: EditorViewState["mode"];
  selectionFilter: EditorViewState["selectionFilter"];
  selectionCatalog: EditorViewState["selectionCatalog"];
  sketchSession: EditorViewState["sketchSession"];
  isEditorRenderIdle: boolean;
  acceptsSpecialModeTarget: ViewportModel["capabilities"]["acceptsSpecialModeTarget"];
}

export function createWorkbenchViewportModel({
  activeSectionView,
  hoverTarget,
  measurementWitnesses,
  renderables,
  sketchDisplayRenderables,
  sketchAnnotations,
  selection,
  sketchToolPresentation,
  specialModePresentation,
  hasNonEmptyCommittedGeometry,
  mode,
  selectionFilter,
  selectionCatalog,
  sketchSession,
  isEditorRenderIdle,
  acceptsSpecialModeTarget,
}: WorkbenchViewportModelInput): ViewportModel {
  return {
    activeSectionView,
    hoverTarget,
    measurementWitnesses,
    renderables,
    sketchDisplayRenderables,
    sketchAnnotations,
    selection,
    sketchToolPresentation,
    specialModePresentation,
    hasNonEmptyCommittedGeometry,
    interaction: {
      mode,
      selectionFilter,
      selectionCatalog,
      sketchSession,
      isEditorRenderIdle,
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
  onSelect: (target: PrimitiveRef, cameraPosition?: Vec3) => void;
  onConnectedSketchSelect: (target: PrimitiveRef) => void;
  onDeselect: () => void;
  onClearHover: () => void;
  onSketchMove: (point: readonly [number, number]) => void;
  onSketchRelease: (
    point: readonly [number, number],
    target?: PrimitiveRef | null,
  ) => void;
  onSketchGeometryDragStart: (
    target: PrimitiveRef,
    point: readonly [number, number],
  ) => void;
  onSketchGeometryDragMove: (point: readonly [number, number]) => void;
  onSketchGeometryDragEnd: (point: readonly [number, number]) => void;
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
        onSelect(intent.target, intent.cameraPosition);
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
      case "sketchPointerMoved":
        onSketchMove(intent.point);
        return;
      case "sketchPointerReleased":
        onSketchRelease(intent.point, intent.target);
        return;
      case "sketchGeometryDragStarted":
        onSketchGeometryDragStart(intent.target, intent.point);
        return;
      case "sketchGeometryDragMoved":
        onSketchGeometryDragMove(intent.point);
        return;
      case "sketchGeometryDragEnded":
        onSketchGeometryDragEnd(intent.point);
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
