import { useEffect, useEffectEvent, useState } from "react";

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
import { getToolIconSrc } from "@/core/tools/tool-icons";
import {
  annotationTargetsEqual,
  resolveSketchAnnotationLayer,
} from "@/components/cad/sketch-constraint-annotation-visibility";
import {
  getAnnotationProjectionId,
  layoutSketchAnnotationProjections,
  type SketchViewportFeedbackProjection,
} from "@/components/cad/sketch-viewport-feedback-model";
import { getSketchRenderingPaletteToken } from "@/components/cad/sketch-rendering-palette";
import {
  DimensionAnnotationLabelDrag,
  type DimensionAnnotationDragListener,
} from "@/components/cad/three-cad-viewport-annotation-drag";

interface SketchConstraintAnnotationsProps {
  annotations: readonly SketchAnnotationDescriptor[];
  projections: readonly SketchViewportFeedbackProjection[];
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
  onHover: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onClearHover: () => void;
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onEdit: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onDimensionDrag?: DimensionAnnotationDragListener;
}

export function SketchConstraintAnnotations({
  annotations,
  projections,
  hoveredAnnotation,
  hoverTarget,
  selection,
  annotationContext,
  definition,
  interactive,
  onHover,
  onClearHover,
  onSelect,
  onEdit,
  onDimensionDrag,
}: SketchConstraintAnnotationsProps) {
  const [labelDrag] = useState(() => new DimensionAnnotationLabelDrag());

  const layer = resolveSketchAnnotationLayer(annotations, {
    hoveredAnnotation,
    hoverTarget,
    selection,
    annotationContext,
    definition,
    interactive,
  });
  const visibleAnnotations = layer.items;

  // T14c: the greedy layout places earlier items first. Always-visible
  // annotations (dimensions, problems) go first and hover previews last, so
  // the controls a selection newly pins (an annotation's siblings) never
  // displace a chip that was already on screen (the one just clicked).
  const layoutRankByProjectionId = new Map(
    visibleAnnotations.map(({ annotation, visibility }) => [
      getAnnotationProjectionId(annotation.id),
      annotation.status === "dimension" ||
      annotation.constraintDisplay?.isAffectedOverconstraint
        ? 0
        : visibility === "pinned"
          ? 1
          : 2,
    ]),
  );
  const projectionById = new Map(
    layoutSketchAnnotationProjections(
      projections
        .filter((projection) => layoutRankByProjectionId.has(projection.id))
        .sort(
          (left, right) =>
            layoutRankByProjectionId.get(left.id)! -
            layoutRankByProjectionId.get(right.id)!,
        ),
    ).map((projection) => [projection.id, projection]),
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
  const clearStaleHover = useEffectEvent(onClearHover);
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
            isDimension ? "min-w-8 gap-1.5 px-2" : "w-8 justify-center p-1"
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
              onPointerEnter={() => onHover(annotation.target)}
              onPointerLeave={onClearHover}
              onPointerDown={(event) =>
                labelDrag.pointerDown(annotation, event)
              }
              onPointerMove={(event) =>
                labelDrag.pointerMove(
                  annotation,
                  event,
                  onSelect,
                  onDimensionDrag,
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

function getAnnotationConstraintColor(annotation: SketchAnnotationDescriptor) {
  if (annotation.constraintDisplay?.isAffectedOverconstraint) {
    return `var(${getSketchRenderingPaletteToken("overconstrained")})`;
  }

  // T13d (D12): a reference dimension only measures; it reads muted.
  if (annotation.reference) {
    return "var(--cad-muted-foreground)";
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
  }
}
