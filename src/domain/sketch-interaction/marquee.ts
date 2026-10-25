import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  solvedCubicSpanLocalDomain,
  solvedCubicSpanPoint,
} from "@/contracts/sketch/spline-geometry";
import {
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  getSketchInteractionCircularPieces,
  type SketchInteractionGeometry,
} from "./geometry";

/**
 * Sketch marquee selection (cadara-h026.1), as Onshape: a box dragged left
 * to right selects what it fully encloses (`enclosed`); right to left it
 * also selects what it crosses (`crossing`).
 */
export type SketchMarqueeMode = "enclosed" | "crossing";

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export function getSketchMarqueeMode(
  start: ScreenPoint,
  end: ScreenPoint,
): SketchMarqueeMode {
  return end.x >= start.x ? "enclosed" : "crossing";
}

/** Circle/arc samples per quarter turn, cubic span samples per span. */
const MARQUEE_CURVE_SAMPLES = 16;

/**
 * The geometry as sketch-plane polyline points: a point alone, a line's
 * end points, a sampled curve's points (closed back to its first), and
 * circles, arcs and cubic spans sampled densely enough for a marquee test
 * on screen.
 */
export function sampleSketchMarqueeGeometry(
  geometry: SketchInteractionGeometry,
): SketchPoint2D[] {
  switch (geometry.kind) {
    case "point":
      return [geometry.position];
    case "lineSegment":
      return [geometry.start, geometry.end];
    case "sampledCurve":
      return geometry.isClosed && geometry.points.length > 2
        ? [...geometry.points, geometry.points[0]!]
        : [...geometry.points];
    case "circle":
    case "arc":
      return getSketchInteractionCircularPieces(geometry).flatMap(
        ({ poles, weight }, index) =>
          Array.from(
            { length: MARQUEE_CURVE_SAMPLES + (index === 0 ? 1 : 0) },
            (_, sample) =>
              rationalQuadraticAt(
                poles,
                weight,
                (sample + (index === 0 ? 0 : 1)) / MARQUEE_CURVE_SAMPLES,
              ),
          ),
      );
    case "cubicSpans":
      return geometry.spans.flatMap((span, index) => {
        // Drawn domain only (a clipped span's query domain).
        const [from, to] = solvedCubicSpanLocalDomain(span);
        return Array.from(
          { length: MARQUEE_CURVE_SAMPLES + (index === 0 ? 1 : 0) },
          (_, sample) => {
            const t =
              (sample + (index === 0 ? 0 : 1)) / MARQUEE_CURVE_SAMPLES;
            return solvedCubicSpanPoint(span, from + (to - from) * t);
          },
        );
      });
  }
}

function rationalQuadraticAt(
  poles: readonly [SketchPoint2D, SketchPoint2D, SketchPoint2D],
  weight: number,
  t: number,
): SketchPoint2D {
  const b0 = (1 - t) ** 2;
  const b1 = 2 * t * (1 - t) * weight;
  const b2 = t * t;
  const w = b0 + b1 + b2;
  return [
    (b0 * poles[0][0] + b1 * poles[1][0] + b2 * poles[2][0]) / w,
    (b0 * poles[0][1] + b1 * poles[1][1] + b2 * poles[2][1]) / w,
  ];
}

export interface SketchMarqueeCandidate {
  readonly target: PrimitiveRef;
  /** The candidate's screen polyline (one point for a point). */
  readonly points: readonly ScreenPoint[];
}

/**
 * The candidates a marquee from `start` to `end` (screen px) selects, in
 * candidate order without duplicates: `enclosed` takes those whose every
 * polyline point lies in the box, `crossing` also those with a point in it
 * or a polyline segment crossing its edge. A candidate with no points
 * (not on screen) is never taken.
 */
export function selectSketchMarqueeTargets(
  candidates: readonly SketchMarqueeCandidate[],
  start: ScreenPoint,
  end: ScreenPoint,
): PrimitiveRef[] {
  const mode = getSketchMarqueeMode(start, end);
  const box = {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
  const inside = (point: ScreenPoint) =>
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom;
  const selected: PrimitiveRef[] = [];
  for (const { target, points } of candidates) {
    const taken =
      points.length > 0 &&
      (mode === "enclosed"
        ? points.every(inside)
        : points.some(inside) ||
          points.some(
            (point, index) =>
              index > 0 && segmentCrossesBox(points[index - 1]!, point, box),
          ));
    if (taken && !selected.some((entry) => primitiveRefEquals(entry, target))) {
      selected.push(target);
    }
  }
  return selected;
}

/** Liang–Barsky: whether the segment meets the box. */
function segmentCrossesBox(
  from: ScreenPoint,
  to: ScreenPoint,
  box: { left: number; right: number; top: number; bottom: number },
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let exit = 1;
  for (const [p, q] of [
    [-dx, from.x - box.left],
    [dx, box.right - from.x],
    [-dy, from.y - box.top],
    [dy, box.bottom - from.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) enter = Math.max(enter, r);
    else exit = Math.min(exit, r);
    if (enter > exit) return false;
  }
  return true;
}
