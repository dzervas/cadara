import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import type {
  SketchAnnotationContext,
  SketchAnnotationDescriptor,
} from "@/domain/editor/sketch-session";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  annotationTargetsEqual,
  resolveSketchAnnotationLayer,
} from "@/components/cad/sketch-constraint-annotation-visibility";
import {
  estimateSketchAnnotationExtent,
  getAnnotationProjectionId,
  layoutSketchAnnotations,
  type SketchAnnotationLayoutObstacle,
  type SketchAnnotationLayoutViewport,
  type SketchViewportFeedbackProjection,
} from "@/components/cad/sketch-viewport-feedback-model";
import {
  getAnnotationConstraintColor,
  getAnnotationGlyphIconSrc,
} from "@/components/cad/sketch-annotation-glyph";
import {
  DimensionAnnotationLabelDrag,
  type DimensionAnnotationDragListener,
} from "@/components/cad/three-cad-viewport-annotation-drag";

interface SketchConstraintAnnotationsProps {
  annotations: readonly SketchAnnotationDescriptor[];
  projections: readonly SketchViewportFeedbackProjection[];
  /** T14d: the canvas the labels are clamped into. */
  viewport: SketchAnnotationLayoutViewport;
  /** T14d (A4/A-11): screen rects the labels avoid (near-gap rings, tool labels, floating panels, hint chip). */
  obstacles: readonly SketchAnnotationLayoutObstacle[];
  hoveredAnnotation: SketchConstraintRef | SketchDimensionRef | null;
  hoverTarget: PrimitiveRef | null;
  /** The active selection; an annotation in it is the active annotation. */
  selection: readonly PrimitiveRef[];
  /** T14c: the retained owners and last annotation (two-stage clear). */
  annotationContext: SketchAnnotationContext | null;
  /** The sketch whose entities give a hovered or selected entity its points (T-4). */
  definition: SketchDefinition | null;
  /** T14b (T-5/R-6): the idle select context; otherwise every annotation is passive. */
  interactive: boolean;
  /** T14e (T-11): the Show all switch; every drawn annotation is pinned. */
  showAll?: boolean;
  onHover: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onClearHover: () => void;
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onEdit: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onDimensionDrag?: DimensionAnnotationDragListener;
  /** T14b review A-6: a wheel over a control is forwarded (camera zoom). */
  onWheel?: (event: WheelEvent) => void;
}

export function SketchConstraintAnnotations({
  annotations,
  projections,
  viewport,
  obstacles,
  hoveredAnnotation,
  hoverTarget,
  selection,
  annotationContext,
  definition,
  interactive,
  showAll = false,
  onHover,
  onClearHover,
  onSelect,
  onEdit,
  onDimensionDrag,
  onWheel,
}: SketchConstraintAnnotationsProps) {
  const [labelDrag] = useState(() => new DimensionAnnotationLabelDrag());
  // T14e: the annotation hover this layer set (a control's pointer enter).
  // Only that one can go stale here; a Constraints list row's hover of an
  // annotation the layer does not render as a control is the list's.
  const ownedHoverRef = useRef<SketchConstraintRef | SketchDimensionRef | null>(
    null,
  );
  // T14b review A-6 / T14d review R-3: a wheel over a control is forwarded
  // and its native default (page zoom on Ctrl+wheel or a trackpad pinch) is
  // prevented, which React's passive `onWheel` cannot do.
  const onWheelRef = useRef(onWheel);
  useEffect(() => {
    onWheelRef.current = onWheel;
  });
  const layerRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      return;
    }
    const listener = (event: WheelEvent) => {
      event.preventDefault();
      onWheelRef.current?.(event);
    };
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);
  // T14d (A-7): the chip being dragged keeps its dragged position: where it
  // was when the drag started, moved with its anchor (the label placement
  // the drag writes). It is placed first and never re-placed by the layout.
  const [labelDragOffset, setLabelDragOffset] = useState<{
    handleId: string;
    dx: number;
    dy: number;
  } | null>(null);
  const onTrackedDimensionDrag: DimensionAnnotationDragListener = (
    handle,
    clientX,
    clientY,
    phase,
  ) => {
    if (phase === "start") {
      const annotation = annotations.find(
        (entry) => entry.dragHandle?.id === handle.id,
      );
      const id = annotation ? getAnnotationProjectionId(annotation.id) : null;
      const placed = id ? projectionById.get(id) : undefined;
      const anchor = id ? anchorById.get(id) : undefined;
      setLabelDragOffset(
        placed && anchor
          ? {
              handleId: handle.id,
              dx: placed.x - anchor.x,
              dy: placed.y - anchor.y,
            }
          : { handleId: handle.id, dx: 0, dy: 0 },
      );
    } else if (phase === "end" || phase === "cancel") {
      setLabelDragOffset(null);
    }
    onDimensionDrag?.(handle, clientX, clientY, phase);
  };

  const layer = resolveSketchAnnotationLayer(annotations, {
    hoveredAnnotation,
    hoverTarget,
    selection,
    annotationContext,
    definition,
    interactive,
    showAll,
  });
  const visibleAnnotations = layer.items;

  // T14d (T-8): one pure layout pass over the rendered labels, by priority
  // (problem > dimension > pinned/last/active glyph > preview; selection never
  // changes the rank), so a click never reorders labels under the pointer and
  // a newly pinned glyph or a hover preview never displaces a chip (A-14).
  const anchorById = new Map(
    projections.map((projection) => [projection.id, projection]),
  );
  const projectionById = new Map(
    layoutSketchAnnotations(
      visibleAnnotations.flatMap(({ annotation, visibility }) => {
        const id = getAnnotationProjectionId(annotation.id);
        const anchor = anchorById.get(id);
        if (!anchor) {
          return [];
        }
        const isProblem =
          annotation.constraintDisplay?.isAffectedOverconstraint === true;
        const isDimension = annotation.status === "dimension";
        return [
          {
            id,
            anchor,
            ...estimateSketchAnnotationExtent(annotation),
            priority: isProblem
              ? "problem"
              : isDimension
                ? "dimension"
                : visibility === "pinned"
                  ? "pinned"
                  : "preview",
            keepWhenUnplaceable: isProblem || isDimension,
            fixed:
              labelDragOffset &&
              annotation.dragHandle?.id === labelDragOffset.handleId
                ? {
                    x: anchor.x + labelDragOffset.dx,
                    y: anchor.y + labelDragOffset.dy,
                  }
                : null,
          } as const,
        ];
      }),
      viewport,
      obstacles,
    ).map((placement) => [placement.id, placement]),
  );
  // T14a C2: a drag whose chip unmounts, or whose layer unmounts, cancels; a
  // chip that turns passive (T14b T-5) no longer carries its drag either.
  const renderedDragHandleIds = visibleAnnotations
    .flatMap(({ annotation }) =>
      annotation.dragHandle &&
      layer.dragHandleIds.has(annotation.dragHandle.id) &&
      projectionById.has(getAnnotationProjectionId(annotation.id))
        ? [annotation.dragHandle.id]
        : [],
    )
    .join("\n");
  useEffect(() => {
    labelDrag.retainHandles(new Set(renderedDragHandleIds.split("\n")));
  }, [labelDrag, renderedDragHandleIds]);
  // T14b review A-2: an annotation hover whose chip turned passive or went
  // away gets no pointer leave; clear it once.
  const hoverIsStale = layer.hoverIsStale;
  const clearStaleHover = useEffectEvent(() => {
    if (annotationTargetsEqual(ownedHoverRef.current, hoveredAnnotation!)) {
      ownedHoverRef.current = null;
      onClearHover();
    }
  });
  useEffect(() => {
    if (hoverIsStale) {
      clearStaleHover();
    }
  }, [hoverIsStale]);
  useEffect(() => () => labelDrag.cancel(), [labelDrag]);

  if (visibleAnnotations.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-sketch-annotation-layer=""
      ref={layerRef}
    >
      {visibleAnnotations.map(
        ({ annotation, visibility, isInteractive, isSelected, isLast }) => {
          const projection = projectionById.get(
            getAnnotationProjectionId(annotation.id),
          );

          if (!projection) {
            return null;
          }

          const isHovered =
            isInteractive &&
            annotationTargetsEqual(hoveredAnnotation, annotation.target);
          // T14c: the active annotation, or the subdued last selected one.
          const selectionState = isSelected
            ? "active"
            : isLast
              ? "last"
              : undefined;
          const iconSrc = getAnnotationGlyphIconSrc(annotation.glyphKind);
          const isDimension = annotation.status === "dimension";
          const className = `absolute flex h-8 items-center rounded border shadow-[var(--cad-panel-shadow)] ${
            isDimension
              ? "min-w-8 gap-1.5 whitespace-nowrap px-2"
              : "w-8 justify-center p-1"
          } ${
            isInteractive
              ? "pointer-events-auto transition"
              : visibility === "preview"
                ? "pointer-events-none opacity-60"
                : "pointer-events-none"
          } ${
            isSelected
              ? "border-[var(--cad-accent)] bg-[var(--cad-surface-elevated)]"
              : isLast
                ? "border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)] opacity-80"
                : isHovered
                  ? "border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)]"
                  : `border-[var(--cad-border)] bg-[var(--cad-surface-overlay)]${
                      isInteractive
                        ? " hover:border-[var(--cad-border-strong)]"
                        : ""
                    }`
          }`;
          const style = {
            left: projection.x,
            top: projection.y,
            transform: "translate(-50%, -50%)",
            borderColor: getAnnotationConstraintColor(annotation),
            color: getAnnotationConstraintColor(annotation),
          };
          const content = (
            <>
              <img
                alt=""
                aria-hidden="true"
                className={isDimension ? "h-4 w-4 shrink-0" : "h-5 w-5"}
                draggable={false}
                src={iconSrc}
              />
              {isDimension ? (
                <span className="font-mono text-[11px] leading-none">
                  {annotation.visibleLabel}
                </span>
              ) : null}
            </>
          );

          // T14b (T-1, T-5): a preview, or any annotation outside the idle
          // select context, is passive markup: no button, no name, no title, no
          // handlers, no tab stop; the canvas under it owns the pointer.
          if (!isInteractive) {
            return (
              <div
                key={annotation.id}
                aria-hidden="true"
                data-sketch-annotation-glyph={annotation.glyphKind}
                data-sketch-annotation-kind={annotation.status}
                data-sketch-annotation-visibility={visibility}
                data-sketch-annotation-interactive="false"
                data-sketch-annotation-selection={selectionState}
                className={className}
                style={style}
              >
                {content}
              </div>
            );
          }

          return (
            <button
              key={annotation.id}
              type="button"
              data-sketch-annotation-glyph={annotation.glyphKind}
              data-sketch-annotation-kind={annotation.status}
              data-sketch-annotation-visibility={visibility}
              data-sketch-annotation-interactive="true"
              data-sketch-annotation-selection={selectionState}
              className={className}
              style={style}
              aria-label={`${annotation.label}: ${annotation.detail}`}
              title={`${annotation.label}: ${annotation.detail}`}
              onPointerEnter={() => {
                ownedHoverRef.current = annotation.target;
                onHover(annotation.target);
              }}
              onPointerLeave={() => {
                ownedHoverRef.current = null;
                onClearHover();
              }}
              onPointerDown={(event) =>
                labelDrag.pointerDown(annotation, event)
              }
              onPointerMove={(event) =>
                labelDrag.pointerMove(
                  annotation,
                  event,
                  onSelect,
                  onTrackedDimensionDrag,
                )
              }
              onPointerUp={(event) => labelDrag.pointerEnd(event, "end")}
              onPointerCancel={(event) => labelDrag.pointerEnd(event, "cancel")}
              onLostPointerCapture={(event) =>
                labelDrag.lostPointerCapture(event)
              }
              onClick={(event) => {
                if (
                  labelDrag.consumeClickSuppression(annotation.dragHandle?.id)
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
              {content}
            </button>
          );
        },
      )}
    </div>
  );
}
