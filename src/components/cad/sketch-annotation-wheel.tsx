import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import {
  annotationTargetsEqual,
  type SketchAnnotationLayerItem,
} from "@/components/cad/sketch-constraint-annotation-visibility";
import {
  SKETCH_ANNOTATION_WHEEL_SPOKE_PX,
  type SketchAnnotationWheelLayout,
} from "@/components/cad/sketch-annotation-clusters";
import {
  getAnnotationConstraintColor,
  getAnnotationGlyphIconSrc,
} from "@/components/cad/sketch-annotation-glyph";

type AnnotationTarget = SketchConstraintRef | SketchDimensionRef;

interface SketchAnnotationWheelProps {
  clusterKey: string;
  layout: SketchAnnotationWheelLayout;
  /** The members' layer items by layout id. */
  items: ReadonlyMap<string, SketchAnnotationLayerItem>;
  /** The `−N` count: the members a collapsed cluster hides. */
  collapseCount: number;
  /** T-5: only in the idle select context; otherwise passive markup. */
  interactive: boolean;
  hoveredAnnotation: AnnotationTarget | null;
  onHover: (target: AnnotationTarget) => void;
  onClearHover: () => void;
  /** `clickCount`: the click's `detail` (0 for a keyboard activation). */
  onSelect: (target: AnnotationTarget, clickCount: number) => void;
  onEdit: (target: AnnotationTarget) => void;
  onCollapse: () => void;
  /** "More…": the Constraints list shows the wheel's members. */
  onMore: () => void;
  /**
   * A wheel control took the focus (the focused spoke's annotation id; null
   * for `−N` or "More…"), or the focus left the wheel (null).
   */
  onFocusWithinChange: (
    focused: { annotationId: string | null } | null,
  ) => void;
}

/**
 * T14g (T-10): a dense cluster's radial wheel (issue 10 Answer, prototype
 * `isWheel`): 28 px spokes on an 82 px radius around a pointer-centred
 * centre that holds the active spoke or, with none, the `−N` collapse
 * toggle. Spokes are native buttons in tab order (centre first, then
 * clockwise from the top); hovering one hovers its annotation (the linked
 * highlight, T-18); a press is a DOM button press and never reaches the
 * canvas. Outside the idle select context the wheel is passive (T-5).
 */
export function SketchAnnotationWheel({
  clusterKey,
  layout,
  items,
  collapseCount,
  interactive,
  hoveredAnnotation,
  onHover,
  onClearHover,
  onSelect,
  onEdit,
  onCollapse,
  onMore,
  onFocusWithinChange,
}: SketchAnnotationWheelProps) {
  const centreItem =
    layout.centreId !== null ? items.get(layout.centreId) : undefined;
  // A focused spoke that moves to the centre is re-inserted in the DOM,
  // which drops its focus: it takes the focus back once rendered there.
  const centreId = centreItem?.annotation.id ?? null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [refocusId, setRefocusId] = useState<string | null>(null);
  useEffect(() => {
    // Only a focus the move dropped (to the page body) is taken back.
    if (
      refocusId === null ||
      centreId !== refocusId ||
      (document.activeElement !== null &&
        document.activeElement !== document.body)
    ) {
      return;
    }
    containerRef.current
      ?.querySelector<HTMLElement>(
        `[data-sketch-annotation-wheel-spoke="${CSS.escape(refocusId)}"]`,
      )
      ?.focus();
  }, [refocusId, centreId]);
  const slot = (
    key: string,
    kind: "centre" | "spoke" | "more",
    point: { x: number; y: number },
    content: ReactNode,
    control: {
      label: string;
      item?: SketchAnnotationLayerItem;
      onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    },
  ) => {
    const item = control.item;
    const isSelected = item?.isSelected === true;
    const isLast = item?.isLast === true;
    const isHovered =
      item !== undefined &&
      annotationTargetsEqual(hoveredAnnotation, item.annotation.target);
    const className = `absolute flex items-center justify-center rounded border font-mono text-[11px] leading-none shadow-[var(--cad-panel-shadow)] ${
      interactive
        ? "pointer-events-auto transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cad-accent)]"
        : "pointer-events-none"
    } ${
      isSelected
        ? "border-[var(--cad-accent)] bg-[var(--cad-surface-elevated)]"
        : isLast
          ? "border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)] opacity-80"
          : isHovered
            ? "border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)]"
            : `border-[var(--cad-border)] bg-[var(--cad-surface-overlay)] text-[var(--cad-foreground)]${
                interactive ? " hover:border-[var(--cad-border-strong)]" : ""
              }`
    }`;
    const style = {
      left: point.x,
      top: point.y,
      width: SKETCH_ANNOTATION_WHEEL_SPOKE_PX,
      height: SKETCH_ANNOTATION_WHEEL_SPOKE_PX,
      transform: "translate(-50%, -50%)",
      ...(item
        ? {
            borderColor: getAnnotationConstraintColor(item.annotation),
            color: getAnnotationConstraintColor(item.annotation),
          }
        : {}),
    };
    const attributes = {
      "data-sketch-annotation-wheel-slot": kind,
      ...(item
        ? {
            "data-sketch-annotation-wheel-spoke": item.annotation.id,
            "data-sketch-annotation-glyph": item.annotation.glyphKind,
            "data-sketch-annotation-selection": isSelected
              ? "active"
              : isLast
                ? "last"
                : undefined,
          }
        : {}),
    };

    if (!interactive) {
      return (
        <div
          key={key}
          aria-hidden="true"
          {...attributes}
          className={className}
          style={style}
        >
          {content}
        </div>
      );
    }

    return (
      <button
        key={key}
        type="button"
        {...attributes}
        aria-label={control.label}
        title={control.label}
        className={className}
        style={style}
        onPointerEnter={
          item ? () => onHover(item.annotation.target) : undefined
        }
        onPointerLeave={item ? onClearHover : undefined}
        onClick={control.onClick}
        onDoubleClick={
          item
            ? (event) => {
                event.preventDefault();
                onEdit(item.annotation.target);
              }
            : undefined
        }
      >
        {content}
      </button>
    );
  };
  const glyph = (item: SketchAnnotationLayerItem) => (
    <img
      alt=""
      aria-hidden="true"
      className="h-4 w-4"
      draggable={false}
      src={getAnnotationGlyphIconSrc(item.annotation.glyphKind)}
    />
  );
  const memberSlot = (
    item: SketchAnnotationLayerItem,
    kind: "centre" | "spoke",
    point: { x: number; y: number },
  ) =>
    slot(item.annotation.id, kind, point, glyph(item), {
      label: `${item.annotation.label}: ${item.annotation.detail}`,
      item,
      onClick: (event) => {
        setRefocusId(
          document.activeElement === event.currentTarget
            ? item.annotation.id
            : null,
        );
        onSelect(item.annotation.target, event.detail);
      },
    });

  return (
    <div
      ref={containerRef}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "Constraint wheel" : undefined}
      aria-hidden={interactive ? undefined : "true"}
      data-sketch-annotation-wheel={clusterKey}
      data-sketch-annotation-wheel-x={Math.round(layout.centre.x)}
      data-sketch-annotation-wheel-y={Math.round(layout.centre.y)}
      data-sketch-annotation-interactive={String(interactive)}
      onFocus={(event) =>
        onFocusWithinChange({
          annotationId: event.target.getAttribute(
            "data-sketch-annotation-wheel-spoke",
          ),
        })
      }
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          onFocusWithinChange(null);
        }
      }}
    >
      {centreItem
        ? memberSlot(centreItem, "centre", layout.centre)
        : slot("collapse", "centre", layout.centre, `−${collapseCount}`, {
            label: "Collapse the constraint wheel",
            onClick: onCollapse,
          })}
      {layout.spokes.map((spoke) => {
        if (spoke.kind === "more") {
          return slot("more", "more", spoke, "…", {
            label: `More: ${spoke.ids.length} more in the Constraints list`,
            onClick: onMore,
          });
        }
        const item = items.get(spoke.id);
        return item ? memberSlot(item, "spoke", spoke) : null;
      })}
    </div>
  );
}
