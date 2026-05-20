import type { PrimitiveRef } from "@/core/editor/schema";
import type { SectionViewSession, Vec3 } from "@/core/section-view/session";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import type {
  SketchSpecialModeHandleRef,
  SketchSpecialModeViewportPresentation,
} from "@/core/sketch-special-modes/schema";
import type { EditorViewState } from "@/domain/editor/state-machine";
import type {
  SketchAnnotationDescriptor,
  SketchSessionDisplayRenderable,
  SketchSessionState,
} from "@/domain/editor/sketch-session";
import type { MeasurementWitness } from "@/domain/measure/measurement";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

export interface ViewportSpecialModeTargetInput {
  session: SketchSessionState;
  target: PrimitiveRef;
  selection: PrimitiveRef[];
  selectionCatalog: EditorViewState["selectionCatalog"];
}

export interface ViewportModel {
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
  interaction: {
    mode: EditorViewState["mode"];
    selectionFilter: EditorViewState["selectionFilter"];
    selectionCatalog: EditorViewState["selectionCatalog"];
    sketchSession: SketchSessionState | null;
    isEditorRenderIdle: boolean;
  };
  capabilities: {
    acceptsSpecialModeTarget(input: ViewportSpecialModeTargetInput): boolean;
  };
}

export type ViewportCommand = {
  type: "fitViewRequested";
  requestId: number;
};

export type ViewportIntent =
  | { type: "hovered"; target: PrimitiveRef }
  | {
      type: "selected";
      target: PrimitiveRef;
      cameraPosition?: Vec3;
    }
  | { type: "connectedSketchSelected"; target: PrimitiveRef }
  | { type: "deselected" }
  | {
      type: "annotationEditRequested";
      target: Extract<PrimitiveRef, { kind: "constraint" | "dimension" }>;
    }
  | { type: "hoverCleared" }
  | { type: "sketchPointerMoved"; point: readonly [number, number] }
  | {
      type: "sketchPointerReleased";
      point: readonly [number, number];
      target?: PrimitiveRef | null;
    }
  | {
      type: "sketchGeometryDragStarted";
      target: PrimitiveRef;
      point: readonly [number, number];
    }
  | { type: "sketchGeometryDragMoved"; point: readonly [number, number] }
  | { type: "sketchGeometryDragEnded"; point: readonly [number, number] }
  | {
      type: "specialModeClicked";
      point: readonly [number, number];
      target?: PrimitiveRef | null;
    }
  | {
      type: "specialModeDoubleClicked";
      point: readonly [number, number];
      target?: PrimitiveRef | null;
    }
  | {
      type: "specialModeDragStarted";
      handle: SketchSpecialModeHandleRef;
      point: readonly [number, number];
    }
  | {
      type: "specialModeDragMoved";
      handle: SketchSpecialModeHandleRef;
      point: readonly [number, number];
    }
  | {
      type: "specialModeDragEnded";
      handle: SketchSpecialModeHandleRef;
      point: readonly [number, number];
    }
  | { type: "sectionOffsetChanged"; offset: number }
  | { type: "sectionFlipRequested" }
  | { type: "sectionClearRequested" }
  | { type: "sketchToolPatched"; patch: Record<string, unknown> }
  | { type: "lodTierChanged"; tierId: OccTessellationTierId }
  | { type: "canvasCreated" }
  | { type: "firstNonEmptyGeometryFrame" };

export function getLatestViewportFitViewRequestId(
  commands: readonly ViewportCommand[],
) {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    if (command?.type === "fitViewRequested") {
      return command.requestId;
    }
  }
  return 0;
}
