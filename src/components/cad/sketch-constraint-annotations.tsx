import {
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  SketchAnnotationDescriptor,
  SketchDimensionAnnotationDragHandle,
} from "@/domain/editor/sketch-session";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { PrimitiveRef } from "@/core/editor/schema";
import { getToolIconSrc } from "@/core/tools/tool-icons";
import {
  annotationTargetsEqual,
  resolveSketchAnnotationVisibility,
} from "@/components/cad/sketch-constraint-annotation-visibility";
import {
  getAnnotationProjectionId,
  layoutSketchAnnotationProjections,
  type SketchViewportFeedbackProjection,
} from "@/components/cad/sketch-viewport-feedback-model";
import { getSketchRenderingPaletteToken } from "@/components/cad/sketch-rendering-palette";

interface SketchConstraintAnnotationsProps {
  annotations: readonly SketchAnnotationDescriptor[];
  projections: readonly SketchViewportFeedbackProjection[];
  hoveredAnnotation: SketchConstraintRef | SketchDimensionRef | null;
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null;
  hoverTarget: PrimitiveRef | null;
  selection: readonly PrimitiveRef[];
  onHover: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onClearHover: () => void;
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onEdit: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onDimensionDrag?: (
    handle: SketchDimensionAnnotationDragHandle,
    clientX: number,
    clientY: number,
  ) => void;
}

const DIMENSION_ANNOTATION_DRAG_THRESHOLD_PX = 6;

export function SketchConstraintAnnotations({
  annotations,
  projections,
  hoveredAnnotation,
  selectedAnnotation,
  hoverTarget,
  selection,
  onHover,
  onClearHover,
  onSelect,
  onEdit,
  onDimensionDrag,
}: SketchConstraintAnnotationsProps) {
  const dragStateRef = useRef<{
    handle: SketchDimensionAnnotationDragHandle;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    target: SketchConstraintRef | SketchDimensionRef;
  } | null>(null);
  const suppressClickHandleIdRef = useRef<string | null>(null);

  const visibleAnnotations = annotations.flatMap((annotation) => {
    const visibility = resolveSketchAnnotationVisibility(annotation, {
      hoveredAnnotation,
      selectedAnnotation,
      hoverTarget,
      selection,
    });

    return visibility === "hidden" ? [] : [{ annotation, visibility }];
  });

  if (visibleAnnotations.length === 0) {
    return null;
  }

  const visibleProjectionIds = new Set(
    visibleAnnotations.map(({ annotation }) =>
      getAnnotationProjectionId(annotation.id),
    ),
  );
  const projectionById = new Map(
    layoutSketchAnnotationProjections(
      projections.filter((projection) =>
        visibleProjectionIds.has(projection.id),
      ),
    ).map((projection) => [projection.id, projection]),
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {visibleAnnotations.map(({ annotation, visibility }) => {
        const projection = projectionById.get(
          getAnnotationProjectionId(annotation.id),
        );

        if (!projection) {
          return null;
        }

        const isSelected = annotationTargetsEqual(
          selectedAnnotation,
          annotation.target,
        );
        const isHovered = annotationTargetsEqual(
          hoveredAnnotation,
          annotation.target,
        );
        const iconSrc = getAnnotationGlyphIconSrc(annotation.glyphKind);
        const isDimension = annotation.status === "dimension";
        const baseClassName = isDimension
          ? `pointer-events-auto absolute flex h-8 min-w-8 items-center gap-1.5 rounded border px-2 shadow-[var(--cad-panel-shadow)] transition ${
              isSelected
                ? "border-[var(--cad-accent)] bg-[var(--cad-surface-elevated)]"
                : isHovered
                  ? "border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)]"
                  : "border-[var(--cad-border)] bg-[var(--cad-surface-overlay)] hover:border-[var(--cad-border-strong)]"
            }`
          : `pointer-events-auto absolute flex h-8 w-8 items-center justify-center rounded border p-1 shadow-[var(--cad-panel-shadow)] transition ${
              visibility === "faded" ? "opacity-60 hover:opacity-100 " : ""
            }${
              isSelected
                ? "border-[var(--cad-accent)] bg-[var(--cad-surface-elevated)]"
                : isHovered
                  ? "border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)]"
                  : "border-[var(--cad-border)] bg-[var(--cad-surface-overlay)] hover:border-[var(--cad-border-strong)]"
            }`;

        return (
          <button
            key={annotation.id}
            type="button"
            data-sketch-annotation-glyph={annotation.glyphKind}
            data-sketch-annotation-kind={annotation.status}
            data-sketch-annotation-visibility={visibility}
            className={baseClassName}
            style={{
              left: projection.x,
              top: projection.y,
              transform: "translate(-50%, -50%)",
              borderColor: getAnnotationConstraintColor(annotation),
              color: getAnnotationConstraintColor(annotation),
            }}
            aria-label={`${annotation.label}: ${annotation.detail}`}
            title={`${annotation.label}: ${annotation.detail}`}
            onPointerEnter={() => onHover(annotation.target)}
            onPointerLeave={onClearHover}
            onPointerDown={(event) =>
              handleDimensionPointerDown(annotation, event, dragStateRef)
            }
            onPointerMove={(event) =>
              handleDimensionPointerMove(
                annotation,
                event,
                dragStateRef,
                onSelect,
                onDimensionDrag,
              )
            }
            onPointerUp={(event) =>
              handleDimensionPointerEnd(
                event,
                dragStateRef,
                suppressClickHandleIdRef,
              )
            }
            onPointerCancel={(event) =>
              handleDimensionPointerEnd(
                event,
                dragStateRef,
                suppressClickHandleIdRef,
              )
            }
            onClick={(event) => {
              const suppressHandleId = suppressClickHandleIdRef.current;
              suppressClickHandleIdRef.current = null;

              if (
                suppressHandleId &&
                suppressHandleId === annotation.dragHandle?.id
              ) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }

              onSelect(annotation.target);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              onEdit(annotation.target);
            }}
          >
            <img
              alt=""
              aria-hidden="true"
              className={isDimension ? "h-4 w-4 shrink-0" : "h-5 w-5"}
              draggable={false}
              src={iconSrc}
            />
            {annotation.status === "dimension" ? (
              <span className="font-mono text-[11px] leading-none">
                {annotation.visibleLabel}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function handleDimensionPointerDown(
  annotation: SketchAnnotationDescriptor,
  event: ReactPointerEvent<HTMLButtonElement>,
  dragStateRef: MutableRefObject<{
    handle: SketchDimensionAnnotationDragHandle;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    target: SketchConstraintRef | SketchDimensionRef;
  } | null>,
) {
  if (
    annotation.status !== "dimension" ||
    !annotation.dragHandle ||
    event.button !== 0 ||
    !event.isPrimary
  ) {
    return;
  }

  dragStateRef.current = {
    handle: annotation.dragHandle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    target: annotation.target,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function handleDimensionPointerMove(
  annotation: SketchAnnotationDescriptor,
  event: ReactPointerEvent<HTMLButtonElement>,
  dragStateRef: MutableRefObject<{
    handle: SketchDimensionAnnotationDragHandle;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    target: SketchConstraintRef | SketchDimensionRef;
  } | null>,
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void,
  onDimensionDrag?: (
    handle: SketchDimensionAnnotationDragHandle,
    clientX: number,
    clientY: number,
  ) => void,
) {
  if (annotation.status !== "dimension" || !annotation.dragHandle) {
    return;
  }

  const dragState = dragStateRef.current;
  if (
    !dragState ||
    dragState.pointerId !== event.pointerId ||
    dragState.handle.id !== annotation.dragHandle.id
  ) {
    return;
  }

  const dragDistance = Math.hypot(
    event.clientX - dragState.startX,
    event.clientY - dragState.startY,
  );
  if (
    !dragState.dragging &&
    dragDistance <= DIMENSION_ANNOTATION_DRAG_THRESHOLD_PX
  ) {
    return;
  }

  if (!dragState.dragging) {
    dragState.dragging = true;
    onSelect(dragState.target);
  }

  event.preventDefault();
  event.stopPropagation();
  onDimensionDrag?.(dragState.handle, event.clientX, event.clientY);
}

function handleDimensionPointerEnd(
  event: ReactPointerEvent<HTMLButtonElement>,
  dragStateRef: MutableRefObject<{
    handle: SketchDimensionAnnotationDragHandle;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    target: SketchConstraintRef | SketchDimensionRef;
  } | null>,
  suppressClickHandleIdRef: MutableRefObject<string | null>,
) {
  const dragState = dragStateRef.current;
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  if (dragState.dragging) {
    event.preventDefault();
    event.stopPropagation();
    suppressClickHandleIdRef.current = dragState.handle.id;
  }

  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  dragStateRef.current = null;
}

function getAnnotationConstraintColor(annotation: SketchAnnotationDescriptor) {
  if (annotation.constraintDisplay?.isAffectedOverconstraint) {
    return `var(${getSketchRenderingPaletteToken("overconstrained")})`;
  }

  if (annotation.constraintDisplay?.state === "constrained") {
    return `var(${getSketchRenderingPaletteToken("constrained")})`;
  }

  return `var(${getSketchRenderingPaletteToken("underconstrained")})`;
}

function getAnnotationGlyphIconSrc(
  glyphKind: SketchAnnotationDescriptor["glyphKind"],
) {
  switch (glyphKind) {
    case "constraintCoincident":
      return getToolIconSrc("constraintCoincident");
    case "constraintCollinear":
      return getToolIconSrc("constraintCollinear");
    case "constraintParallel":
      return getToolIconSrc("constraintParallel");
    case "constraintEqual":
      return getToolIconSrc("constraintEqual");
    case "constraintHorizontal":
      return getToolIconSrc("constraintHorizontal");
    case "constraintVertical":
      return getToolIconSrc("constraintVertical");
    case "constraintFixed":
      return getToolIconSrc("constraintFix");
    case "constraintAngle":
      return "/icons/drawing-angular-dim-line-to-line.svg";
    case "constraintPerpendicular":
      return "/icons/sketch-perpendicular.svg";
    case "constraintTangent":
      return "/icons/sketch-tangent.svg";
    case "constraintConcentric":
      return getToolIconSrc("constraintConcentric");
    case "constraintMidpoint":
      return getToolIconSrc("constraintMidpoint");
    case "constraintNormal":
      return getToolIconSrc("constraintNormal");
    case "constraintPierce":
      return getToolIconSrc("constraintPierce");
    case "constraintSymmetric":
      return getToolIconSrc("constraintSymmetric");
    case "dimensionDistance":
      return getToolIconSrc("dimension");
    case "dimensionHorizontal":
      return getToolIconSrc("dimension");
    case "dimensionVertical":
      return getToolIconSrc("dimension");
    case "dimensionRadius":
      return getToolIconSrc("dimension");
    case "dimensionAngle":
      return "/icons/drawing-angular-dim-line-to-line.svg";
    case "dimensionCoincident":
      return getToolIconSrc("dimension");
  }
}
