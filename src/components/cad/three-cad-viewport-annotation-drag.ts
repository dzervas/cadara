import type {
  SketchAnnotationDescriptor,
  SketchDimensionAnnotationDragHandle,
} from "@/domain/editor/sketch-session";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";

export function createDimensionAnnotationPlacementPatch(
  handle: SketchDimensionAnnotationDragHandle,
  point: readonly [number, number],
) {
  return {
    intent: "setDimensionAnnotationPlacement" as const,
    handleId: handle.id,
    dimensionId: handle.dimensionId,
    point,
  };
}

const DIMENSION_ANNOTATION_DRAG_THRESHOLD_PX = 6;

export type DimensionAnnotationDragListener = (
  handle: SketchDimensionAnnotationDragHandle,
  clientX: number,
  clientY: number,
  phase: "start" | "move" | "end" | "cancel",
) => void;

/** The parts of a chip pointer event the label drag reads. */
export interface DimensionAnnotationPointerEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  isPrimary: boolean;
  currentTarget: Pick<
    Element,
    "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture"
  >;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * A dimension chip's label drag: a press and release within 6 px is a click;
 * past 6 px it selects the label and reports start, move and end. A drag that
 * loses its pointer capture or its chip reports cancel (T14a C2).
 */
export class DimensionAnnotationLabelDrag {
  private drag: {
    handle: SketchDimensionAnnotationDragHandle;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    target: SketchConstraintRef | SketchDimensionRef;
    listener: DimensionAnnotationDragListener | undefined;
    dragging: boolean;
  } | null = null;
  private suppressClickHandleId: string | null = null;

  pointerDown(
    annotation: SketchAnnotationDescriptor,
    event: DimensionAnnotationPointerEvent,
  ) {
    if (
      annotation.status !== "dimension" ||
      !annotation.dragHandle ||
      event.button !== 0 ||
      !event.isPrimary
    ) {
      return;
    }

    this.drag = {
      handle: annotation.dragHandle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      target: annotation.target,
      listener: undefined,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  pointerMove(
    annotation: SketchAnnotationDescriptor,
    event: DimensionAnnotationPointerEvent,
    onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void,
    onDimensionDrag: DimensionAnnotationDragListener | undefined,
  ) {
    const drag = this.drag;
    if (
      annotation.status !== "dimension" ||
      !annotation.dragHandle ||
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.handle.id !== annotation.dragHandle.id
    ) {
      return;
    }

    if (
      !drag.dragging &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <=
        DIMENSION_ANNOTATION_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    if (!drag.dragging) {
      drag.dragging = true;
      drag.listener = onDimensionDrag;
      onSelect(drag.target);
      drag.listener?.(drag.handle, drag.startX, drag.startY, "start");
    }

    event.preventDefault();
    event.stopPropagation();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.listener?.(drag.handle, event.clientX, event.clientY, "move");
  }

  pointerEnd(event: DimensionAnnotationPointerEvent, phase: "end" | "cancel") {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    this.drag = null;
    if (drag.dragging) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressClickHandleId = drag.handle.id;
      drag.listener?.(drag.handle, event.clientX, event.clientY, phase);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /** The capture went elsewhere without a release: the drag is over. */
  lostPointerCapture(
    event: Pick<DimensionAnnotationPointerEvent, "pointerId">,
  ) {
    if (this.drag?.pointerId === event.pointerId) {
      this.cancel();
    }
  }

  /** Cancels a drag whose chip is no longer rendered. */
  retainHandles(renderedHandleIds: ReadonlySet<string>) {
    if (this.drag && !renderedHandleIds.has(this.drag.handle.id)) {
      this.cancel();
    }
  }

  cancel() {
    const drag = this.drag;
    this.drag = null;
    if (drag?.dragging) {
      drag.listener?.(drag.handle, drag.lastX, drag.lastY, "cancel");
    }
  }

  /** True once for the click that ends a drag of this handle. */
  consumeClickSuppression(handleId: string | undefined) {
    const suppressed = this.suppressClickHandleId;
    this.suppressClickHandleId = null;
    return suppressed !== null && suppressed === handleId;
  }
}
