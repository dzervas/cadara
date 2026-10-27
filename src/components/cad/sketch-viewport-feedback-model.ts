import { SKETCH_POINT_RADII_PX } from "@/core/sketch-interaction/screen-radii";

import type {
  SketchToolAnchorDescriptor,
  SketchToolFloatingInputDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";

export interface SketchViewportFeedbackProjection {
  id: string;
  x: number;
  y: number;
}

interface SketchViewportFeedbackAnchor {
  id: string;
  anchor: SketchToolAnchorDescriptor;
}

export function collectSketchViewportFeedbackAnchors(
  schema: SketchToolPresentationSchema | null,
): readonly SketchViewportFeedbackAnchor[] {
  if (!schema) {
    return [];
  }

  return [
    ...(schema.overlays ?? []).flatMap((overlay) => {
      const anchor = getOverlayAnchor(overlay);
      return [
        ...(anchor ? [{ id: getOverlayProjectionId(overlay.id), anchor }] : []),
        ...getOverlayGeometryAnchors(overlay),
      ];
    }),
    ...(schema.floatingInput?.anchor
      ? [
          {
            id: getFloatingInputProjectionId(schema.floatingInput.id),
            anchor: schema.floatingInput.anchor,
          },
        ]
      : []),
  ];
}

export function getOverlayProjectionId(id: string) {
  return `overlay:${id}`;
}

export function getOverlayGeometryProjectionId(id: string, point: string) {
  return `overlay-geometry:${id}:${point}`;
}

export function getFloatingInputProjectionId(id: string) {
  return `floating-input:${id}`;
}

export function getAnnotationProjectionId(annotationId: string) {
  return `annotation:${annotationId}`;
}

/** A screen rect in canvas px: `x`/`y` is the top-left corner. */
export interface SketchAnnotationLayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A rect the labels keep clear of. `chrome` marks workbench chrome floating
 * over the canvas (parts panel, view-cube column, notifications, debugger,
 * variables button): it is not usable canvas, so a label anchored in it is
 * not rendered, and no label is ever placed over it, not even as a fallback.
 */
export interface SketchAnnotationLayoutObstacle extends SketchAnnotationLayoutRect {
  chrome?: boolean;
}

/**
 * T14d (T-8) layout priority, highest first: a problem, a dimension, a
 * pinned constraint glyph (including the active and last one), a hover
 * preview. Selection never changes the rank (orchestrator, option (c)), so a
 * click never reorders labels under the pointer; dimensions rank above pinned
 * glyphs, so pinning a context never moves a chip the user is about to click.
 * T14f: a cluster's `+N` (`overflow`) ranks below pinned glyphs and above
 * hover previews (plan T-8), so it never displaces a pinned glyph.
 */
export type SketchAnnotationLayoutPriority =
  | "problem"
  | "dimension"
  | "pinned"
  | "overflow"
  | "preview";

const SKETCH_ANNOTATION_LAYOUT_PRIORITY_RANK: Record<
  SketchAnnotationLayoutPriority,
  number
> = { problem: 0, dimension: 1, pinned: 2, overflow: 3, preview: 4 };

export interface SketchAnnotationLayoutItem {
  id: string;
  /** The projected anchor (the label centre when nothing is in the way). */
  anchor: { x: number; y: number };
  width: number;
  height: number;
  priority: SketchAnnotationLayoutPriority;
  /** Problems and dimensions stay at their clamped anchor when no candidate is free; anything else is dropped. */
  keepWhenUnplaceable: boolean;
  /** A-7: placed here (centre) as is, before everything else, and avoided by every other item. */
  fixed?: { x: number; y: number } | null;
  /**
   * cadara-0atd: a dimension whose label the user placed (a committed
   * `annotationPlacement`: the Dimension tool's placing click or a label
   * drag; persisted). It is placed before the auto-placed labels of its
   * priority, so a dropped chip keeps its place across a reload too.
   */
  placedByUser?: boolean;
  /**
   * cadara-0atd: a chip a drag dropped on its anchor in this sketch session,
   * by recency (0: the last drop). Among the user-placed labels of its
   * priority it is placed first, so after the release it stays where it was
   * dropped and the labels it was dropped on stay displaced.
   */
  dropRank?: number | null;
}

/**
 * cadara-0atd: one label drag's drop, kept (most recent first) for the open
 * sketch session only. `placedByUserBeforeDrag` is null for a chip dropped on
 * its anchor. An angle label dropped at its layout displacement (its
 * placement cannot follow the pointer off the bisector) records whether it
 * was user-placed before the drag instead: the drag commits a placement,
 * which would otherwise let it outrank the label displacing it and jump
 * onto its anchor at the release.
 */
export interface SketchDimensionLabelDrop {
  handleId: string;
  placedByUserBeforeDrag: boolean | null;
}

/** cadara-0atd: `drop` first, then the earlier drops whose chips still exist. */
export function recordSketchDimensionLabelDrop(
  drops: readonly SketchDimensionLabelDrop[],
  drop: SketchDimensionLabelDrop,
  liveHandleIds: ReadonlySet<string>,
): readonly SketchDimensionLabelDrop[] {
  return [
    drop,
    ...drops.filter(
      (entry) =>
        entry.handleId !== drop.handleId && liveHandleIds.has(entry.handleId),
    ),
  ];
}

/**
 * cadara-0atd: a label's layout rank inputs from the session's drops and
 * whether its dimension has a committed placement now.
 */
export function getSketchDimensionLabelDropRank(
  drops: readonly SketchDimensionLabelDrop[],
  handleId: string,
  placedByUser: boolean,
): Pick<SketchAnnotationLayoutItem, "placedByUser" | "dropRank"> {
  const onAnchor = drops.filter(
    (entry) => entry.placedByUserBeforeDrag === null,
  );
  const rank = onAnchor.findIndex((entry) => entry.handleId === handleId);
  if (rank >= 0) {
    return { placedByUser, dropRank: rank };
  }
  const displaced = drops.find((entry) => entry.handleId === handleId);
  return {
    placedByUser: displaced?.placedByUserBeforeDrag ?? placedByUser,
    dropRank: null,
  };
}

export interface SketchAnnotationLayoutViewport {
  width: number;
  height: number;
  /** The top overlay row (toolbar) the labels stay below. */
  topInset: number;
  /** The bottom band (history timeline, document tabs) the labels stay above. */
  bottomInset: number;
}

/** A placed label: its centre. */
export interface SketchAnnotationPlacement {
  id: string;
  x: number;
  y: number;
}

export const SKETCH_ANNOTATION_LAYOUT_GAP_PX = 6;
export const SKETCH_ANNOTATION_LAYOUT_EDGE_INSET_PX = 8;
const SKETCH_ANNOTATION_LAYOUT_RING_CAP = 6;
const SKETCH_ANNOTATION_LAYOUT_EPSILON_PX = 1e-6;
/** Constraint glyphs are `h-8 w-8` buttons. */
export const SKETCH_ANNOTATION_GLYPH_SIZE_PX = 32;
/**
 * Dimension chip frame: 2 px border + 16 px padding + 16 px icon + 6 px gap.
 * The 11 px monospace label is estimated at 7 px per character, calibrated on
 * the measured 110 px "Coincident" chip (40 + 10 × 7) and rounded up from
 * the nominal 6.6 px (review A-6); the E2E bounding-box row pins it.
 */
const SKETCH_ANNOTATION_CHIP_FRAME_PX = 40;
const SKETCH_ANNOTATION_CHIP_CHAR_PX = 7;

/** The estimated extent of an annotation label (no DOM measurement, T-8). */
export function estimateSketchAnnotationExtent(annotation: {
  status: string;
  visibleLabel?: string;
}) {
  return annotation.status === "dimension"
    ? {
        width: Math.ceil(
          SKETCH_ANNOTATION_CHIP_FRAME_PX +
            [...(annotation.visibleLabel ?? "")].length *
              SKETCH_ANNOTATION_CHIP_CHAR_PX,
        ),
        height: SKETCH_ANNOTATION_GLYPH_SIZE_PX,
      }
    : {
        width: SKETCH_ANNOTATION_GLYPH_SIZE_PX,
        height: SKETCH_ANNOTATION_GLYPH_SIZE_PX,
      };
}

/**
 * T14d (T-8): places annotation labels in a stable order (fixed items, then
 * priority, then user-placed labels, the most recently dropped first, then
 * id). The usable area is the canvas between the top and bottom chrome
 * bands minus the `chrome` obstacles: a label whose anchor is outside it
 * is not rendered (problems included; off-screen anchors are not pulled
 * in). Each other label takes the first candidate from its anchor
 * outward (8 directions on up to 6 rings, ring step = its own size + 6 px
 * gap), clamped 8 px inside the usable band, whose rect keeps the gap to
 * every placed label and obstacle. With no free candidate, a problem or
 * dimension takes the first candidate that only keeps clear of the chrome;
 * otherwise it is dropped. A lower-priority item never moves a
 * higher-priority one (A-14). Pure: a function of its inputs only.
 */
export function layoutSketchAnnotations(
  items: readonly SketchAnnotationLayoutItem[],
  viewport: SketchAnnotationLayoutViewport,
  obstacles: readonly SketchAnnotationLayoutObstacle[],
): SketchAnnotationPlacement[] {
  const chrome = obstacles.filter((obstacle) => obstacle.chrome);
  const taken: SketchAnnotationLayoutRect[] = [...obstacles];
  const placements: SketchAnnotationPlacement[] = [];
  const ordered = [...items].sort(
    (left, right) =>
      Number(!left.fixed) - Number(!right.fixed) ||
      SKETCH_ANNOTATION_LAYOUT_PRIORITY_RANK[left.priority] -
        SKETCH_ANNOTATION_LAYOUT_PRIORITY_RANK[right.priority] ||
      Number(!left.placedByUser) - Number(!right.placedByUser) ||
      (left.dropRank ?? Infinity) - (right.dropRank ?? Infinity) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  const clear = (
    candidate: { x: number; y: number },
    item: SketchAnnotationLayoutItem,
    rects: readonly SketchAnnotationLayoutRect[],
  ) =>
    !rects.some((rect) =>
      layoutRectsTooClose(layoutRectAt(candidate, item), rect),
    );

  for (const item of ordered) {
    let centre: { x: number; y: number } | null = null;

    if (item.fixed) {
      centre = item.fixed;
    } else if (isUsableAnchor(item.anchor, viewport, chrome)) {
      const candidates = getSketchAnnotationLayoutCandidates(item).map(
        (candidate) => clampLayoutCentre(candidate, item, viewport),
      );
      centre =
        candidates.find((candidate) => clear(candidate, item, taken)) ??
        (item.keepWhenUnplaceable
          ? (candidates.find((candidate) => clear(candidate, item, chrome)) ??
            null)
          : null);
    }

    if (centre) {
      taken.push(layoutRectAt(centre, item));
      placements.push({ id: item.id, x: centre.x, y: centre.y });
    }
  }

  return placements;
}

/** Inside the band between the top and bottom chrome, and not under chrome. */
function isUsableAnchor(
  anchor: { x: number; y: number },
  viewport: SketchAnnotationLayoutViewport,
  chrome: readonly SketchAnnotationLayoutRect[],
) {
  return (
    anchor.x >= 0 &&
    anchor.x <= viewport.width &&
    anchor.y >= viewport.topInset &&
    anchor.y <= viewport.height - viewport.bottomInset &&
    !chrome.some(
      (rect) =>
        anchor.x >= rect.x &&
        anchor.x <= rect.x + rect.width &&
        anchor.y >= rect.y &&
        anchor.y <= rect.y + rect.height,
    )
  );
}

const SKETCH_ANNOTATION_LAYOUT_DIRECTIONS = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
  [1, 1],
] as const;

function getSketchAnnotationLayoutCandidates(item: SketchAnnotationLayoutItem) {
  const stepX = item.width + SKETCH_ANNOTATION_LAYOUT_GAP_PX;
  const stepY = item.height + SKETCH_ANNOTATION_LAYOUT_GAP_PX;
  const candidates = [item.anchor];

  for (let ring = 1; ring <= SKETCH_ANNOTATION_LAYOUT_RING_CAP; ring += 1) {
    for (const [dx, dy] of SKETCH_ANNOTATION_LAYOUT_DIRECTIONS) {
      candidates.push({
        x: item.anchor.x + dx * ring * stepX,
        y: item.anchor.y + dy * ring * stepY,
      });
    }
  }

  return candidates;
}

function clampLayoutCentre(
  centre: { x: number; y: number },
  item: Pick<SketchAnnotationLayoutItem, "width" | "height">,
  viewport: SketchAnnotationLayoutViewport,
) {
  const inset = SKETCH_ANNOTATION_LAYOUT_EDGE_INSET_PX;
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(value, high));

  return {
    x: clamp(
      centre.x,
      inset + item.width / 2,
      viewport.width - inset - item.width / 2,
    ),
    y: clamp(
      centre.y,
      viewport.topInset + inset + item.height / 2,
      viewport.height - viewport.bottomInset - inset - item.height / 2,
    ),
  };
}

function layoutRectAt(
  centre: { x: number; y: number },
  item: Pick<SketchAnnotationLayoutItem, "width" | "height">,
): SketchAnnotationLayoutRect {
  return {
    x: centre.x - item.width / 2,
    y: centre.y - item.height / 2,
    width: item.width,
    height: item.height,
  };
}

/** Closer than the 6 px gap (touching at exactly the gap is fine). */
function layoutRectsTooClose(
  left: SketchAnnotationLayoutRect,
  right: SketchAnnotationLayoutRect,
) {
  const gap =
    SKETCH_ANNOTATION_LAYOUT_GAP_PX - SKETCH_ANNOTATION_LAYOUT_EPSILON_PX;

  return (
    left.x < right.x + right.width + gap &&
    right.x < left.x + left.width + gap &&
    left.y < right.y + right.height + gap &&
    right.y < left.y + left.height + gap
  );
}

/**
 * T14d (A4): the active tool's on-canvas labels (`referenceLabel` such as
 * Merge "Source"/"Destination", measurement, snap and dimension-preview
 * labels) as layout obstacles with an estimated text extent. Pointer labels
 * use the same hotspot gap and edge flipping as their measured DOM boxes;
 * geometry labels stay centred on their projections. The labels
 * themselves stay `pointer-events-none`; the layout only avoids them.
 */
export function getSketchToolLabelObstacles(
  schema: SketchToolPresentationSchema | null,
  projections: readonly SketchViewportFeedbackProjection[],
  viewport = { width: Infinity, height: Infinity },
): SketchAnnotationLayoutRect[] {
  const projectionById = new Map(
    projections.map((projection) => [projection.id, projection]),
  );

  const overlays = schema?.overlays ?? [];
  return overlays.flatMap((overlay) => {
    const parts = getSketchToolOverlayLabelParts(overlay, overlays);
    const projection = projectionById.get(getOverlayProjectionId(overlay.id));

    if (!parts || !projection) {
      return [];
    }

    const hotspot = getSketchPointerLabelHotspot(overlay, projection);
    const maxWidth = hotspot
      ? Math.min(360, viewport.width - 12)
      : SKETCH_TOOL_LABEL_MAX_WIDTH_PX;
    const textWidth =
      SKETCH_TOOL_LABEL_FRAME_PX +
      parts.reduce(
        (total, part) =>
          total + [...part].length * SKETCH_ANNOTATION_CHIP_CHAR_PX,
        0,
      ) +
      (parts.length - 1) * SKETCH_TOOL_LABEL_PART_GAP_PX;
    const width = Math.min(maxWidth, textWidth);
    const height =
      SKETCH_TOOL_LABEL_HEIGHT_PX *
      (hotspot ? Math.ceil(textWidth / maxWidth) : 1);
    return [
      hotspot
        ? {
            ...placeSketchPointerLabel(hotspot, { width, height }, viewport),
            width,
            height,
          }
        : layoutRectAt(projection, { width, height }),
    ];
  });
}

/** 16 px padding + 2 px border. */
const SKETCH_TOOL_LABEL_FRAME_PX = 18;
/** 11 px text + 8 px padding + 2 px border, rounded up. */
const SKETCH_TOOL_LABEL_HEIGHT_PX = 22;
const SKETCH_TOOL_LABEL_MAX_WIDTH_PX = 180;
/** `ml-2` between a label and its value. */
const SKETCH_TOOL_LABEL_PART_GAP_PX = 8;

/** The text parts of a rendered tool label (`SketchViewportFeedbackLayer`), or null when it renders none. */
export function getSketchToolOverlayLabelParts(
  overlay: SketchToolOverlayDescriptor,
  overlays: readonly SketchToolOverlayDescriptor[],
): string[] | null {
  switch (overlay.kind) {
    case "measurement":
      return [
        overlay.label,
        `${overlay.value.toFixed(2)} ${overlay.unit ?? ""}`,
      ];
    case "dimensionLine":
      return overlay.labelled
        ? [
            overlay.label,
            ...(overlay.value === null || overlay.value === undefined
              ? []
              : [`${overlay.value.toFixed(2)} ${overlay.unit ?? ""}`]),
          ]
        : null;
    case "angleArc":
      return overlay.labelled
        ? [
            overlay.label,
            ...(overlay.referenceLabel ? [overlay.referenceLabel] : []),
          ]
        : null;
    case "constraintPreview":
      return [overlay.label, overlay.detail];
    case "snapIndicator":
      // Placement inference owns an offset label; keep the snap glyph at the
      // point without repeating its text underneath the pointer.
      return overlays.some(
        (candidate) =>
          candidate.kind === "constraintPreview" &&
          candidate.id === `${overlay.id}-inferred-constraint`,
      )
        ? null
        : [overlay.label];
    case "referenceLabel":
      return [overlay.label];
    default:
      return null;
  }
}

/** A hover may be one exit-radius from the picked point: clear its whole pick box too. */
export const SKETCH_POINTER_LABEL_GAP_PX =
  2 * SKETCH_POINT_RADII_PX.exit + SKETCH_ANNOTATION_LAYOUT_GAP_PX;

export function getSketchPointerLabelHotspot(
  overlay: SketchToolOverlayDescriptor,
  projection: SketchViewportFeedbackProjection,
): { x: number; y: number } | null {
  const anchor = getOverlayAnchor(overlay);
  if (overlay.kind !== "constraintPreview" && anchor?.kind !== "cursor") {
    return null;
  }
  // Projection includes the descriptor's legacy centre offset. Placement now
  // works from the hotspot and the measured label box, not its centre.
  return {
    x: projection.x - (anchor?.offset?.x ?? 0),
    y: projection.y - (anchor?.offset?.y ?? 0),
  };
}

export function placeSketchPointerLabel(
  hotspot: { x: number; y: number },
  extent: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const inset = SKETCH_ANNOTATION_LAYOUT_GAP_PX;
  function placeAxis(point: number, size: number, limit: number) {
    const after = point + SKETCH_POINTER_LABEL_GAP_PX;
    const before = point - SKETCH_POINTER_LABEL_GAP_PX - size;
    return Math.max(
      inset,
      Math.min(
        after + size <= limit - inset ? after : before,
        limit - inset - size,
      ),
    );
  }
  return {
    x: placeAxis(hotspot.x, extent.width, viewport.width),
    y: placeAxis(hotspot.y, extent.height, viewport.height),
  };
}

function getOverlayAnchor(
  overlay: SketchToolOverlayDescriptor,
): SketchToolAnchorDescriptor | null {
  switch (overlay.kind) {
    case "measurement":
    case "constraintPreview":
      return overlay.anchor;
    case "dimensionLine":
    case "angleArc":
      return overlay.labelAnchor;
    case "referenceLabel":
      return overlay.anchor;
    case "extensionLine":
      return null;
    case "anchor":
    case "helperMarker":
    case "snapIndicator":
      return { kind: "sketchPoint", point: overlay.point };
    case "completionCue":
      return {
        kind: "sketchPoint",
        point: overlay.point,
        offset: { x: 0, y: 26 },
      };
  }
}

function getOverlayGeometryAnchors(
  overlay: SketchToolOverlayDescriptor,
): readonly SketchViewportFeedbackAnchor[] {
  switch (overlay.kind) {
    case "dimensionLine":
      return [
        {
          id: getOverlayGeometryProjectionId(overlay.id, "start"),
          anchor: getSketchPointAnchor(overlay.start),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, "end"),
          anchor: getSketchPointAnchor(overlay.end),
        },
        ...(overlay.extensionLines ?? []).flatMap((line) => [
          {
            id: getOverlayGeometryProjectionId(line.id, "start"),
            anchor: getSketchPointAnchor(line.start),
          },
          {
            id: getOverlayGeometryProjectionId(line.id, "end"),
            anchor: getSketchPointAnchor(line.end),
          },
        ]),
      ];
    case "extensionLine":
      return [
        {
          id: getOverlayGeometryProjectionId(overlay.id, "start"),
          anchor: getSketchPointAnchor(overlay.start),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, "end"),
          anchor: getSketchPointAnchor(overlay.end),
        },
      ];
    case "angleArc":
      return [
        {
          id: getOverlayGeometryProjectionId(overlay.id, "center"),
          anchor: getSketchPointAnchor(overlay.center),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, "start"),
          anchor: getSketchPointAnchor(overlay.start),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, "end"),
          anchor: getSketchPointAnchor(overlay.end),
        },
        ...(overlay.witnessLines ?? []).flatMap((line) => [
          {
            id: getOverlayGeometryProjectionId(line.id, "start"),
            anchor: getSketchPointAnchor(line.start),
          },
          {
            id: getOverlayGeometryProjectionId(line.id, "end"),
            anchor: getSketchPointAnchor(line.end),
          },
        ]),
      ];
    default:
      return [];
  }
}

function getSketchPointAnchor(
  point: readonly [number, number],
): SketchToolAnchorDescriptor {
  return { kind: "sketchPoint", point };
}

/**
 * The patch a key in a floating input's field sends. Shortcuts skip a
 * focused text input, so Escape there is the popup's own Cancel (T14b review
 * R-1) and Enter its confirm (T17f); a key that ends an IME composition is
 * the composition's, not the popup's (T17f review A-4).
 */
export function getFloatingInputKeyPatch(
  descriptor: Pick<
    SketchToolFloatingInputDescriptor,
    "submitAction" | "cancelAction" | "hideSubmit"
  >,
  key: string,
  isComposing: boolean,
): Record<string, unknown> | null {
  if (isComposing) return null;
  if (key === "Escape") return descriptor.cancelAction.patch;
  if (key === "Enter" && !descriptor.hideSubmit)
    return descriptor.submitAction.patch;
  return null;
}
