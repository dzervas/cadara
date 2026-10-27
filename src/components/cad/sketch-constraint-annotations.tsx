import { SvgIcon } from "@/components/ui/svg-icon";
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
} from "@/core/editor/sketch-session";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import {
  annotationTargetsEqual,
  resolveSketchAnnotationLayer,
} from "@/components/cad/sketch-constraint-annotation-visibility";
import {
  getSketchAnnotationClusterSignature,
  getSketchAnnotationContextExtent,
  getSketchAnnotationWheelObstacles,
  isSketchAnnotationHoverUnplaced,
  layoutSketchAnnotationClusters,
  layoutSketchAnnotationWheel,
  SKETCH_ANNOTATION_WHEEL_DOUBLE_CLICK_MS,
  resolveSketchAnnotationDenseLimit,
  type SketchAnnotationClusterGroup,
  type SketchAnnotationClusterLayoutItem,
  type SketchAnnotationDenseLimit,
  type SketchAnnotationPreferredExpansion,
} from "@/components/cad/sketch-annotation-clusters";
import {
  estimateSketchAnnotationExtent,
  getAnnotationProjectionId,
  getSketchDimensionLabelDropRank,
  recordSketchDimensionLabelDrop,
  type SketchAnnotationLayoutObstacle,
  type SketchAnnotationLayoutViewport,
  type SketchDimensionLabelDrop,
  type SketchViewportFeedbackProjection,
} from "@/components/cad/sketch-viewport-feedback-model";
import {
  getAnnotationConstraintColor,
  getAnnotationGlyphIconFileName,
} from "@/components/cad/sketch-annotation-glyph";
import { SketchAnnotationWheel } from "@/components/cad/sketch-annotation-wheel";
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
  /**
   * T14f (T-9): each entity's screen bounding-box diagonal in px, keyed by
   * primitive ref key; it sets the dense limit (K = 4, or 2 for a small
   * context). Absent: the limit stays at its previous value (initially 4).
   */
  entityScreenExtents?: ReadonlyMap<string, number>;
  onHover: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onClearHover: () => void;
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onEdit: (target: SketchConstraintRef | SketchDimensionRef) => void;
  onDimensionDrag?: DimensionAnnotationDragListener;
  /** T14b review A-6: a wheel over a control is forwarded (camera zoom). */
  onWheel?: (event: WheelEvent) => void;
  /** T14g (T-10): a pinned, idle `+N` opens its cluster's radial wheel. */
  onOpenAnnotationWheel?: (
    clusterKey: string,
    members: readonly (SketchConstraintRef | SketchDimensionRef)[],
  ) => void;
  /** T14g: `−N`, or the open wheel no longer has more spokes than K. */
  onCloseAnnotationWheel?: () => void;
  /** T14g: "More…" narrows the Constraints list to the wheel's members. */
  onAnnotationWheelListFilter?: (filtered: boolean) => void;
}

function isSameScreenPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
}

/**
 * cadara-2wpl: where the dragged chip is drawn: its anchor plus the drag
 * offset, or plus its layout displacement while the anchor is still where
 * the drag grabbed it.
 */
function getDraggedLabelCentre(
  anchor: { x: number; y: number },
  drag: {
    dx: number;
    dy: number;
    untilAnchorMoves: { x: number; y: number; dx: number; dy: number } | null;
  },
) {
  const offset =
    drag.untilAnchorMoves && isSameScreenPoint(anchor, drag.untilAnchorMoves)
      ? drag.untilAnchorMoves
      : drag;
  return { x: anchor.x + offset.dx, y: anchor.y + offset.dy };
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
  entityScreenExtents,
  onHover,
  onClearHover,
  onSelect,
  onEdit,
  onDimensionDrag,
  onWheel,
  onOpenAnnotationWheel,
  onCloseAnnotationWheel,
  onAnnotationWheelListFilter,
}: SketchConstraintAnnotationsProps) {
  const [labelDrag] = useState(() => new DimensionAnnotationLabelDrag());
  // T14g (T-10): the open wheel's activating point (viewport-local UI
  // state; the editor holds only which cluster is open) and, while one of
  // the wheel's controls holds the focus, the wheel's members (layout ids)
  // and the focused spoke's annotation id (null: `−N` or "More…").
  const [wheelPoint, setWheelPoint] = useState<{
    clusterKey: string;
    x: number;
    y: number;
  } | null>(null);
  // Review R-4: a mouse click that selects a spoke holds the ring's previous
  // centre for the double-click interval, so the spoke stays under the
  // pointer and a second click (and `dblclick`) lands on the same button;
  // the selected spoke then moves to the centre.
  const [wheelCentreHold, setWheelCentreHold] = useState<{
    clusterKey: string;
    centreId: string | null;
  } | null>(null);
  useEffect(() => {
    if (wheelCentreHold === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setWheelCentreHold(null),
      SKETCH_ANNOTATION_WHEEL_DOUBLE_CLICK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [wheelCentreHold]);
  const wheelFocusRef = useRef<{
    members: readonly string[];
    annotationId: string | null;
  } | null>(null);
  // Set when the activated `+N` held the focus: the wheel's first control
  // takes it once open (the `+N` itself gives way to the wheel).
  const focusWheelOnOpenRef = useRef(false);
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
  const layerElementRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useCallback((element: HTMLDivElement | null) => {
    layerElementRef.current = element;
    if (!element) {
      return;
    }
    const listener = (event: WheelEvent) => {
      event.preventDefault();
      onWheelRef.current?.(event);
    };
    element.addEventListener("wheel", listener, { passive: false });
    return () => {
      element.removeEventListener("wheel", listener);
      layerElementRef.current = null;
    };
  }, []);
  // T14d (A-7): the chip being dragged keeps its dragged position: it is
  // placed first, at its anchor plus `labelDragOffset`, and never re-placed
  // by the layout. cadara-bmy0: a dimension-line label the layout had
  // displaced is dragged from where it is drawn: the drag's press is moved by
  // that displacement (`labelDragPressShiftRef`) and the chip sits on its
  // anchor, so the first placement brings the anchor under the chip and the
  // release leaves the label where it was dropped. An angle label's
  // placement cannot follow the pointer off its bisector, so it keeps the
  // displacement as its offset instead. cadara-2wpl: the shifted anchor
  // arrives through the editor a render after the drag starts, so until the
  // anchor has moved the chip keeps its displacement (`untilAnchorMoves`);
  // dropping it at once drew the chip back on its old anchor for a frame.
  const [labelDragOffset, setLabelDragOffset] = useState<{
    handleId: string;
    dx: number;
    dy: number;
    untilAnchorMoves: { x: number; y: number; dx: number; dy: number } | null;
  } | null>(null);
  const labelDragPressShiftRef = useRef({ dx: 0, dy: 0 });
  // cadara-0atd: the label drags' drops in the open sketch session, most
  // recent first. Released, a chip is no longer `fixed`; laid out by id it
  // could lose its anchor to the chip it was dropped on and jump a ring away
  // while that one snapped back. Ranked first in their priority, the chips
  // dropped on their anchor stay where they were dropped and the labels
  // under them stay displaced. An angle label dropped at a displacement
  // keeps the rank it had before the drag (the layout keeps displacing it).
  const [labelDrops, setLabelDrops] = useState<
    readonly SketchDimensionLabelDrop[]
  >([]);
  // Session-only: cleared once the sketch session ends (no definition).
  if (definition === null && labelDrops.length > 0) {
    setLabelDrops([]);
  }
  // cadara-0atd: the persisted half of that precedence: a committed
  // placement is only written by the Dimension tool's placing click or a
  // label drag, so it marks a label the user placed.
  const userPlacedDimensionIds = new Set(
    (definition?.dimensions ?? []).flatMap((dimension) =>
      "annotationPlacement" in dimension && dimension.annotationPlacement
        ? [dimension.dimensionId as string]
        : [],
    ),
  );
  const labelDropRef = useRef<SketchDimensionLabelDrop | null>(null);
  const onTrackedDimensionDrag: DimensionAnnotationDragListener = (
    handle,
    clientX,
    clientY,
    phase,
    grab,
  ) => {
    if (phase === "start") {
      const annotation = annotations.find(
        (entry) => entry.dragHandle?.id === handle.id,
      );
      const id = annotation ? getAnnotationProjectionId(annotation.id) : null;
      const placed = id ? projectionById.get(id) : undefined;
      const anchor = id ? anchorById.get(id) : undefined;
      const displacement =
        placed && anchor
          ? { dx: placed.x - anchor.x, dy: placed.y - anchor.y }
          : { dx: 0, dy: 0 };
      const followsAlongLine = annotation?.glyphKind !== "dimensionAngle";
      labelDragPressShiftRef.current = followsAlongLine
        ? displacement
        : { dx: 0, dy: 0 };
      labelDropRef.current = {
        handleId: handle.id,
        placedByUserBeforeDrag:
          followsAlongLine || (displacement.dx === 0 && displacement.dy === 0)
            ? null
            : userPlacedDimensionIds.has(handle.dimensionId),
      };
      setLabelDragOffset({
        handleId: handle.id,
        ...(followsAlongLine ? { dx: 0, dy: 0 } : displacement),
        untilAnchorMoves:
          followsAlongLine && anchor
            ? { x: anchor.x, y: anchor.y, ...displacement }
            : null,
      });
    } else if (phase === "end" || phase === "cancel") {
      setLabelDragOffset(null);
      const drop = labelDropRef.current;
      if (phase === "end" && drop?.handleId === handle.id) {
        const liveHandleIds = new Set(
          annotations.flatMap((entry) =>
            entry.dragHandle ? [entry.dragHandle.id] : [],
          ),
        );
        setLabelDrops((drops) =>
          recordSketchDimensionLabelDrop(drops, drop, liveHandleIds),
        );
      }
    }
    const { dx, dy } = labelDragPressShiftRef.current;
    onDimensionDrag?.(handle, clientX, clientY, phase, {
      ...grab,
      clientX: grab.clientX - dx,
      clientY: grab.clientY - dy,
    });
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
  // cadara-2wpl: once the dragged chip's anchor has left the grab anchor the
  // chip sits on it for the rest of the drag, so a drag back over the grab
  // anchor does not bring the displacement back. Cleared here, in render,
  // because the drag listener is the closure of the render the drag began in.
  if (labelDragOffset?.untilAnchorMoves) {
    const dragged = annotations.find(
      (entry) => entry.dragHandle?.id === labelDragOffset.handleId,
    );
    const anchor = dragged
      ? anchorById.get(getAnnotationProjectionId(dragged.id))
      : undefined;
    if (
      anchor &&
      !isSameScreenPoint(anchor, labelDragOffset.untilAnchorMoves)
    ) {
      setLabelDragOffset({ ...labelDragOffset, untilAnchorMoves: null });
    }
  }
  const layoutItems = visibleAnnotations.flatMap(
    ({
      annotation,
      visibility,
      isSelected,
      isLast,
    }): SketchAnnotationClusterLayoutItem[] => {
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
              : visibility,
          keepWhenUnplaceable: isProblem || isDimension,
          fixed:
            labelDragOffset &&
            annotation.dragHandle?.id === labelDragOffset.handleId
              ? getDraggedLabelCentre(anchor, labelDragOffset)
              : null,
          ...(annotation.dragHandle
            ? getSketchDimensionLabelDropRank(
                labelDrops,
                annotation.dragHandle.id,
                userPlacedDimensionIds.has(annotation.dragHandle.dimensionId),
              )
            : {}),
          // T14f (T-9): dimensions and problems are never clustered.
          cluster:
            isProblem || isDimension
              ? null
              : { group: visibility, mustExpand: isSelected || isLast },
        },
      ];
    },
  );

  // T14f (T-9, A-5): one dense limit per group from its context's screen
  // extent, with hysteresis inside one context. Pinned: the selected
  // geometry and the retained owners, or, with Show all on (review R-3) or no
  // owner, the geometry the group's glyphs affect; a preview: the hovered
  // geometry. A new context starts fresh (the 160 px rule; review A-1). The
  // limits and the expanded sets per cluster membership (kept so a click
  // never swaps expanded glyphs) are layout state, adjusted while rendering;
  // never authored.
  const [denseState, setDenseState] = useState<{
    contexts: Record<
      SketchAnnotationClusterGroup,
      { key: string; limit: SketchAnnotationDenseLimit } | null
    >;
    expanded: SketchAnnotationPreferredExpansion;
    expandedKey: string;
  }>({
    contexts: { pinned: null, preview: null },
    expanded: new Map(),
    expandedKey: "",
  });
  const resolveGroupContext = (group: SketchAnnotationClusterGroup) => {
    const owners: PrimitiveRef[] =
      group === "pinned"
        ? showAll
          ? []
          : [
              ...selection.filter(
                (target) =>
                  target.kind !== "constraint" && target.kind !== "dimension",
              ),
              ...(annotationContext?.owners ?? []),
            ]
        : hoverTarget &&
            hoverTarget.kind !== "constraint" &&
            hoverTarget.kind !== "dimension"
          ? [hoverTarget]
          : [];
    const affected = layoutItems.flatMap((item) =>
      item.cluster?.group === group ? (affectedById.get(item.id) ?? []) : [],
    );
    const context = owners.length > 0 ? owners : affected;
    const key = [...new Set(context.map(getPrimitiveRefKey))].sort().join("|");
    const measure = (refs: readonly PrimitiveRef[]) =>
      entityScreenExtents && refs.length > 0
        ? getSketchAnnotationContextExtent(
            refs,
            definition,
            entityScreenExtents,
          )
        : null;
    const extent =
      measure(context) ?? (owners.length > 0 ? measure(affected) : null);
    const previous = denseState.contexts[group];
    return {
      key,
      extent,
      limit: resolveSketchAnnotationDenseLimit(
        extent,
        previous?.key === key ? previous.limit : null,
      ),
    };
  };
  const affectedById = new Map(
    visibleAnnotations.map(({ annotation }) => [
      getAnnotationProjectionId(annotation.id),
      annotation.affectedGeometryRefs,
    ]),
  );
  const pinnedContext = resolveGroupContext("pinned");
  const previewContext = resolveGroupContext("preview");
  const pinnedExtent = pinnedContext.extent;
  const limits = { pinned: pinnedContext.limit, preview: previewContext.limit };
  // T14g (T-10): the open wheel. Its spokes are the cluster's members that
  // are still pinned; while they exceed K the cluster renders as the wheel
  // (its glyphs and `+N` give way), otherwise the wheel is stale (a delete
  // left N − 1 ≤ K, or the members stopped being pinned) and closes. The
  // wheel's envelope is an obstacle placed before every other label (A-2).
  const wheel = annotationContext?.wheel ?? null;
  const wheelItems = wheel
    ? visibleAnnotations.filter(
        (item) =>
          item.visibility === "pinned" &&
          wheel.members.some((member) =>
            annotationTargetsEqual(member, item.annotation.target),
          ),
      )
    : [];
  const wheelIds = wheelItems.map(({ annotation }) =>
    getAnnotationProjectionId(annotation.id),
  );
  // T-10 (review R-1): a camera change closes the wheel in the viewport,
  // on the gesture's start; the damped tail of an earlier gesture leaves
  // the centre where it opened while the cluster settles.
  const wheelIsOpen = wheel !== null && wheelItems.length > limits.pinned;
  const wheelAnchors = wheelIds.flatMap((id) => {
    const anchor = anchorById.get(id);
    return anchor ? [anchor] : [];
  });
  const wheelLayout =
    wheel && wheelIsOpen
      ? layoutSketchAnnotationWheel({
          point:
            wheelPoint?.clusterKey === wheel.clusterKey
              ? wheelPoint
              : {
                  x:
                    wheelAnchors.reduce(
                      (total, anchor) => total + anchor.x,
                      0,
                    ) / Math.max(1, wheelAnchors.length),
                  y:
                    wheelAnchors.reduce(
                      (total, anchor) => total + anchor.y,
                      0,
                    ) / Math.max(1, wheelAnchors.length),
                },
          memberIds: wheelIds,
          activeId:
            wheelCentreHold?.clusterKey === wheel.clusterKey
              ? wheelCentreHold.centreId
              : (wheelIds[wheelItems.findIndex((item) => item.isSelected)] ??
                null),
          viewport,
          obstacles,
        })
      : null;
  const wheelIdSet = new Set(wheelLayout ? wheelIds : []);
  const clustered = layoutSketchAnnotationClusters(
    wheelLayout
      ? layoutItems.filter((item) => !wheelIdSet.has(item.id))
      : layoutItems,
    limits,
    denseState.expanded,
    viewport,
    wheelLayout
      ? [...obstacles, ...getSketchAnnotationWheelObstacles(wheelLayout)]
      : obstacles,
  );
  // T14g: the wheel's cluster keeps its pre-wheel expanded set while the
  // wheel is open, so on closing the other expanded glyphs keep their
  // places where possible (the selected spoke, now `last`, takes one slot).
  const wheelSignature = wheelLayout
    ? getSketchAnnotationClusterSignature(wheelIds)
    : null;
  const carriedExpansion =
    wheelSignature !== null
      ? denseState.expanded.get(wheelSignature)
      : undefined;
  const nextExpanded: SketchAnnotationPreferredExpansion =
    wheelSignature !== null && carriedExpansion
      ? new Map([...clustered.expanded, [wheelSignature, carriedExpansion]])
      : clustered.expanded;
  const expandedKey = [...nextExpanded]
    .map(([signature, ids]) => `${signature}=${ids.join("\n")}`)
    .sort()
    .join("\n\n");
  if (
    pinnedContext.key !== denseState.contexts.pinned?.key ||
    limits.pinned !== denseState.contexts.pinned?.limit ||
    previewContext.key !== denseState.contexts.preview?.key ||
    limits.preview !== denseState.contexts.preview?.limit ||
    expandedKey !== denseState.expandedKey
  ) {
    setDenseState({
      contexts: {
        pinned: { key: pinnedContext.key, limit: limits.pinned },
        preview: { key: previewContext.key, limit: limits.preview },
      },
      expanded: nextExpanded,
      expandedKey,
    });
  }
  const projectionById = clustered.placements;
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
  // Review R-1: a hovered control that collapsed into a `+N` (or that the
  // ring cap dropped) unmounted without a pointer leave: its hover is stale.
  // T14g: a wheel spoke is a placed control too.
  const wheelPlacements = new Map<string, { x: number; y: number }>(
    wheelLayout
      ? [
          ...(wheelLayout.centreId !== null
            ? [[wheelLayout.centreId, wheelLayout.centre] as const]
            : []),
          ...wheelLayout.spokes.flatMap((spoke) =>
            spoke.kind === "member" ? [[spoke.id, spoke] as const] : [],
          ),
        ]
      : [],
  );
  const hoverIsStale =
    layer.hoverIsStale ||
    isSketchAnnotationHoverUnplaced(
      hoveredAnnotation,
      visibleAnnotations,
      new Map([...projectionById, ...wheelPlacements]),
    );
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
  // T14g: a wheel whose remaining spokes fit K (a delete) or that lost its
  // pinned members closes; the cluster then renders expanded or collapsed.
  const wheelIsStale = wheel !== null && !wheelIsOpen;
  const closeStaleWheel = useEffectEvent(() => onCloseAnnotationWheel?.());
  useEffect(() => {
    if (wheelIsStale) {
      closeStaleWheel();
    }
  }, [wheelIsStale]);
  // T14g: closing the wheel with the focus on one of its controls (Escape,
  // `−N`, review R-3: a Delete that leaves N − 1 ≤ K) hands the focus to
  // the cluster's `+N` (found by its members: a deleted spoke can change the
  // cluster's key) or, with no `+N` left, its first glyph; never to the
  // page body.
  const focusCluster = useEffectEvent((members: readonly string[]) => {
    const chip = clustered.chips.find((entry) =>
      entry.memberIds.some((id) => members.includes(id)),
    );
    const element = layerElementRef.current;
    const target = chip
      ? element?.querySelector<HTMLElement>(
          `[data-sketch-annotation-cluster="${CSS.escape(chip.key)}"]`,
        )
      : [
          ...(element?.querySelectorAll<HTMLElement>(
            "button[data-sketch-annotation-id]",
          ) ?? []),
        ].find((button) =>
          members.includes(
            getAnnotationProjectionId(
              button.getAttribute("data-sketch-annotation-id")!,
            ),
          ),
        );
    target?.focus();
  });
  const openWheelKey = wheelLayout && wheel ? wheel.clusterKey : null;
  useEffect(() => {
    if (openWheelKey !== null) {
      if (focusWheelOnOpenRef.current) {
        focusWheelOnOpenRef.current = false;
        layerElementRef.current
          ?.querySelector<HTMLElement>(
            `[data-sketch-annotation-wheel="${CSS.escape(openWheelKey)}"] button`,
          )
          ?.focus();
      }
      return;
    }
    const focus = wheelFocusRef.current;
    wheelFocusRef.current = null;
    if (focus !== null) {
      focusCluster(focus.members);
    }
  }, [openWheelKey]);
  // Review R-3: Delete on the focused spoke (the centre) removes its button;
  // while the wheel stays open its new centre control (`−N`) takes the
  // focus the deletion dropped to the page body.
  const annotationIds = visibleAnnotations
    .map((item) => item.annotation.id)
    .join("\n");
  useEffect(() => {
    const focusedId = wheelFocusRef.current?.annotationId ?? null;
    if (
      openWheelKey === null ||
      focusedId === null ||
      annotationIds.split("\n").includes(focusedId) ||
      (document.activeElement !== null &&
        document.activeElement !== document.body)
    ) {
      return;
    }
    layerElementRef.current
      ?.querySelector<HTMLElement>(
        `[data-sketch-annotation-wheel="${CSS.escape(openWheelKey)}"] [data-sketch-annotation-wheel-slot="centre"]`,
      )
      ?.focus();
  }, [openWheelKey, annotationIds]);
  const itemById = new Map(
    visibleAnnotations.map((item) => [
      getAnnotationProjectionId(item.annotation.id),
      item,
    ]),
  );

  if (visibleAnnotations.length === 0) {
    return null;
  }

  // cadara-bmy0: a dimension label the layout moved off its anchor keeps a
  // leader to its point on the dimension line (the anchor without its
  // label offset), so it never reads as detached from its line.
  const leaders = visibleAnnotations.flatMap(({ annotation }) => {
    const id = getAnnotationProjectionId(annotation.id);
    const placed = projectionById.get(id);
    const anchor = anchorById.get(id);
    if (
      annotation.status !== "dimension" ||
      !placed ||
      !anchor ||
      Math.hypot(placed.x - anchor.x, placed.y - anchor.y) < 1
    ) {
      return [];
    }
    const offset =
      annotation.anchor.kind === "sketchPoint"
        ? annotation.anchor.offset
        : null;
    return [
      {
        id: annotation.id,
        color: getAnnotationConstraintColor(annotation),
        from: placed,
        to: {
          x: anchor.x - (offset?.x ?? 0),
          y: anchor.y - (offset?.y ?? 0),
        },
      },
    ];
  });

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-sketch-annotation-layer=""
      data-sketch-annotation-pinned-limit={limits.pinned}
      data-sketch-annotation-preview-limit={limits.preview}
      data-sketch-annotation-pinned-extent={
        pinnedExtent === null ? undefined : Math.round(pinnedExtent)
      }
      ref={layerRef}
    >
      {leaders.length > 0 ? (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          {leaders.map((leader) => (
            <line
              key={leader.id}
              data-sketch-annotation-leader={leader.id}
              x1={leader.from.x}
              y1={leader.from.y}
              x2={leader.to.x}
              y2={leader.to.y}
              stroke={leader.color}
              strokeWidth="1"
            />
          ))}
        </svg>
      ) : null}
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
          const iconFileName = getAnnotationGlyphIconFileName(annotation.glyphKind);
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
              <SvgIcon
                className={isDimension ? "h-4 w-4 shrink-0" : "h-5 w-5"}
                draggable={false}
                fileName={iconFileName}
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
              data-sketch-annotation-id={annotation.id}
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
      {clustered.chips.map((chip) => {
        // T14f (T-9, T-5): a cluster's `+N` is passive in a preview or
        // outside the idle context; pinned and idle, it is a focusable
        // control that opens the cluster's radial wheel (T14g).
        const isInteractive = interactive && chip.group === "pinned";
        const label = `${chip.count} more constraint${chip.count === 1 ? "" : "s"}`;
        const className = `absolute flex h-8 w-8 items-center justify-center rounded border border-[var(--cad-border)] bg-[var(--cad-surface-overlay)] font-mono text-[11px] leading-none text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)] ${
          isInteractive
            ? "pointer-events-auto transition hover:border-[var(--cad-border-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cad-accent)]"
            : chip.group === "preview"
              ? "pointer-events-none opacity-60"
              : "pointer-events-none"
        }`;
        const style = {
          left: chip.x,
          top: chip.y,
          transform: "translate(-50%, -50%)",
        };
        const attributes = {
          "data-sketch-annotation-overflow": chip.count,
          "data-sketch-annotation-cluster": chip.key,
          "data-sketch-annotation-visibility": chip.group,
          "data-sketch-annotation-interactive": String(isInteractive),
        };

        return isInteractive ? (
          <button
            key={chip.id}
            type="button"
            {...attributes}
            aria-label={label}
            title={label}
            className={className}
            style={style}
            onClick={(event) => {
              // T14g (T-10): the wheel centres on the activating pointer;
              // a keyboard activation (no pointer) on the chip's centre.
              const box = layerElementRef.current?.getBoundingClientRect();
              focusWheelOnOpenRef.current =
                document.activeElement === event.currentTarget;
              setWheelPoint({
                clusterKey: chip.key,
                ...(event.detail === 0 || !box
                  ? { x: chip.x, y: chip.y }
                  : {
                      x: event.clientX - box.left,
                      y: event.clientY - box.top,
                    }),
              });
              onOpenAnnotationWheel?.(
                chip.key,
                chip.memberIds.flatMap((id) => {
                  const item = itemById.get(id);
                  return item ? [item.annotation.target] : [];
                }),
              );
            }}
          >
            +{chip.count}
          </button>
        ) : (
          <div
            key={chip.id}
            aria-hidden="true"
            {...attributes}
            className={className}
            style={style}
          >
            +{chip.count}
          </div>
        );
      })}
      {wheel && wheelLayout ? (
        <SketchAnnotationWheel
          clusterKey={wheel.clusterKey}
          layout={wheelLayout}
          items={itemById}
          collapseCount={Math.max(1, wheelItems.length - limits.pinned)}
          interactive={interactive}
          hoveredAnnotation={hoveredAnnotation}
          onHover={(target) => {
            ownedHoverRef.current = target;
            onHover(target);
          }}
          onClearHover={() => {
            ownedHoverRef.current = null;
            onClearHover();
          }}
          onSelect={(target, clickCount) => {
            if (clickCount === 1) {
              setWheelCentreHold({
                clusterKey: wheel.clusterKey,
                centreId: wheelLayout.centreId,
              });
            }
            onSelect(target);
          }}
          onEdit={onEdit}
          onCollapse={() => onCloseAnnotationWheel?.()}
          onMore={() => onAnnotationWheelListFilter?.(true)}
          onFocusWithinChange={(focused) => {
            wheelFocusRef.current = focused
              ? { members: wheelIds, annotationId: focused.annotationId }
              : null;
          }}
        />
      ) : null}
    </div>
  );
}
