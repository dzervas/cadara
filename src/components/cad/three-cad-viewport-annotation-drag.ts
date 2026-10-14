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

/**
 * Where a label drag was grabbed: the press (client px) and the label's own
 * sketch point then (its descriptor anchor, the point the placement is
 * inferred from).
 */
export interface DimensionAnnotationLabelGrab {
  clientX: number;
  clientY: number;
  labelPoint: readonly [number, number];
}

export type DimensionAnnotationDragListener = (
  handle: SketchDimensionAnnotationDragHandle,
  clientX: number,
  clientY: number,
  phase: "start" | "move" | "end" | "cancel",
  grab: DimensionAnnotationLabelGrab,
) => void;

/**
 * T17j (F-1, issue 10's approved delta drag): the label moves by the
 * pointer's displacement in sketch space since the grab, so it keeps the
 * grab offset and never jumps to the pointer: the label's grabbed sketch
 * point plus (pointer − press), both projected onto the sketch.
 */
export function getDimensionLabelDragPoint(
  grab: DimensionAnnotationLabelGrab,
  clientX: number,
  clientY: number,
  project: (
    clientX: number,
    clientY: number,
  ) => readonly [number, number] | null,
): [number, number] | null {
  const pressed = project(grab.clientX, grab.clientY);
  const pointer = project(clientX, clientY);
  if (!pressed || !pointer) {
    return null;
  }
  return [
    grab.labelPoint[0] + pointer[0] - pressed[0],
    grab.labelPoint[1] + pointer[1] - pressed[1],
  ];
}

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
    grab: DimensionAnnotationLabelGrab;
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
      annotation.anchor.kind !== "sketchPoint" ||
      event.button !== 0 ||
      !event.isPrimary
    ) {
      return;
    }

    this.drag = {
      handle: annotation.dragHandle,
      pointerId: event.pointerId,
      grab: {
        clientX: event.clientX,
        clientY: event.clientY,
        labelPoint: annotation.anchor.point,
      },
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
      drag.listener?.(
        drag.handle,
        drag.startX,
        drag.startY,
        "start",
        drag.grab,
      );
    }

    event.preventDefault();
    event.stopPropagation();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.listener?.(
      drag.handle,
      event.clientX,
      event.clientY,
      "move",
      drag.grab,
    );
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
      drag.listener?.(
        drag.handle,
        event.clientX,
        event.clientY,
        phase,
        drag.grab,
      );
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
      drag.listener?.(drag.handle, drag.lastX, drag.lastY, "cancel", drag.grab);
    }
  }

  /** True once for the click that ends a drag of this handle. */
  consumeClickSuppression(handleId: string | undefined) {
    const suppressed = this.suppressClickHandleId;
    this.suppressClickHandleId = null;
    return suppressed !== null && suppressed === handleId;
  }
}
