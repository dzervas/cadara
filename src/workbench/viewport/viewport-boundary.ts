import type { DocumentId } from "@/contracts/shared/ids";
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
  documentId: DocumentId | null;
  activeSectionView: SectionViewSession | null;
  hoverTarget: PrimitiveRef | null;
  measurementWitnesses: readonly MeasurementWitness[];
  renderables: ViewportRenderableRecord[];
  sketchDisplayRenderables: SketchSessionDisplayRenderable[];
  sketchAnnotations: SketchAnnotationDescriptor[];
  selection: PrimitiveRef[];
  /** T14c: the sketch's annotation selection lifecycle (owners, last; T14g: wheel). */
  annotationContext: EditorViewState["annotationContext"];
  /** T14e (T-11): the Constraints panel's Show all switch. */
  showAllAnnotations: boolean;
  sketchToolPresentation: SketchToolPresentationSchema | null;
  documentVariableNames: readonly string[];
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
      /** The previous pick a repeated-click cycle replaces (T11d). */
      cycleReplaces?: PrimitiveRef;
    }
  | { type: "connectedSketchSelected"; target: PrimitiveRef }
  | { type: "deselected" }
  | {
      type: "annotationEditRequested";
      target: Extract<PrimitiveRef, { kind: "constraint" | "dimension" }>;
    }
  | { type: "hoverCleared" }
  /** T14g (T-10): a pinned `+N` opened its cluster's radial wheel. */
  | {
      type: "annotationWheelOpened";
      clusterKey: string;
      members: readonly Extract<
        PrimitiveRef,
        { kind: "constraint" | "dimension" }
      >[];
    }
  /** T14g: `−N`, a camera change, the chooser or a stale wheel. */
  | { type: "annotationWheelClosed" }
  /** T14g: the wheel's "More…" (or the list's reset) filters the Constraints list. */
  | { type: "annotationWheelListFilterChanged"; filtered: boolean }
  /** `sketchUnitsPerPixel`: the screen scale at the pointer (T13-D13). */
  | {
      type: "sketchPointerMoved";
      point: readonly [number, number];
      sketchUnitsPerPixel: number | null;
    }
  | {
      type: "sketchPointerReleased";
      point: readonly [number, number];
      sketchUnitsPerPixel: number | null;
      target?: PrimitiveRef | null;
    }
  /** A double-click with a spline draft: finalize it (T11-D13). */
  | { type: "sketchDrawFinalizeRequested" }
  /** Shift pressed or released over a sketch (T13-D22). */
  | { type: "sketchInferenceSuppressionChanged"; held: boolean }
  | {
      type: "sketchGeometryDragStarted";
      target: PrimitiveRef;
      point: readonly [number, number];
    }
  | {
      type: "sketchGeometryDragMoved";
      point: readonly [number, number];
      exactZero?: boolean;
    }
  | {
      type: "sketchGeometryDragEnded";
      point: readonly [number, number];
      exactZero?: boolean;
    }
  | { type: "sketchGeometryDragCancelled" }
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
  /** The near-gap hint's Merge…: arm Merge Points source → destination (T13k). */
  | {
      type: "sketchMergeOffered";
      source: PrimitiveRef;
      destination: PrimitiveRef;
    }
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
