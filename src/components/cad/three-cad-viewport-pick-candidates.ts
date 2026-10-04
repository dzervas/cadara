import * as THREE from "three";

import { type PrimitiveRef, primitiveRefEquals } from "@/core/editor/schema";
import {
  mapSketchPointToWorld,
  type SketchAnnotationDescriptor,
  type SketchSessionDisplayRenderable,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  closestPointOnSketchInteractionCurve,
  collectSketchInteractionGeometry,
  getSketchInteractionCircularPieces,
  getSketchInteractionCurveBounds,
  type SketchInteractionCurveGeometry,
  isSketchInteractionCurveGeometry,
} from "@/domain/sketch-interaction/geometry";
import { mapWorldPointToWorkspaceSketch } from "@/core/workspace/sketch-plane-mapping";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  closestPointOnRationalCubic,
  closestPointOnRationalQuadratic,
  closestPointOnSolvedCubicSpans,
  clippedSolvedCubicSpanPoles,
  rationalCubicPoint,
  rationalQuadraticPoint,
  type RationalCubicWeights,
  solvedCubicSpanPoint,
  type SolvedCubicSpan,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import {
  createProjectedPickCandidate,
  DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
  DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
  shouldIncludeProjectedPickCandidate,
  type PickCandidate,
} from "@/infrastructure/viewport/render-picking";
import type { ViewportCamera } from "@/infrastructure/viewport/viewport-projection";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

export const DEFAULT_PROJECTED_SKETCH_CURVE_PICK_ENTER_RADIUS_PX = 10;
export const DEFAULT_PROJECTED_SKETCH_CURVE_PICK_EXIT_RADIUS_PX = 14;
/**
 * Below this angle between the pointer ray and the sketch plane (1°), the
 * sketch-plane metric is ill-conditioned: geometry that still uses the
 * plane metric (a line or polyline end point outside the near–far depth
 * range, or an arc, circle or cubic pole with clip w ≤ 0, i.e. geometry
 * that reaches behind the camera) gives no screen-space candidates (review
 * A6 grazing fallback; T11-D16).
 * Edge-on (< 1°) geometry that reaches behind the camera isn't pickable;
 * orbit slightly.
 * This is a hard floor only: the plane metric over-reports a distance by at
 * least (1 + c²)/(2c), c = sin(elevation) (×1.6 at 20°, ×3 at 10°, ×5.8 at
 * 5°), so such geometry is practically pickable only above about 10–20°.
 * Lines, polylines, arcs, circles and cubic spans wholly in front of the
 * camera are exact at every angle, under any camera.
 */
const SKETCH_CURVE_PICK_GRAZING_SINE = Math.sin(Math.PI / 180);

export function collectProjectedVertexCandidates({
  clientX,
  clientY,
  camera,
  viewportRect,
  renderables,
  acceptsTarget,
  currentHoverTarget,
}: {
  clientX: number;
  clientY: number;
  camera: ViewportCamera;
  viewportRect: DOMRectReadOnly;
  renderables: ViewportRenderableRecord[];
  acceptsTarget: (target: PrimitiveRef) => boolean;
  currentHoverTarget: PrimitiveRef | null;
}): PickCandidate[] {
  const pointerX = clientX - viewportRect.left;
  const pointerY = clientY - viewportRect.top;
  const projectedPoint = new THREE.Vector3();

  return renderables.flatMap(({ renderable }) => {
    const geometryData =
      renderable.geometry.kind === "marker" ? renderable.geometry : null;

    if (
      !geometryData ||
      renderable.binding.semanticClass !== "featureVertex" ||
      !acceptsTarget(renderable.binding.target)
    ) {
      return [];
    }

    projectedPoint.set(
      geometryData.position[0],
      geometryData.position[1],
      geometryData.position[2],
    );
    projectedPoint.project(camera);

    // Ignore vertices that project outside the view frustum; their clipped screen
    // coordinates can otherwise create false "nearest vertex" hits in blank space.
    if (!isVisibleProjectedPoint(projectedPoint)) {
      return [];
    }

    const screenX = ((projectedPoint.x + 1) / 2) * viewportRect.width;
    const screenY = ((-projectedPoint.y + 1) / 2) * viewportRect.height;
    const distance = Math.hypot(screenX - pointerX, screenY - pointerY);
    if (
      !shouldIncludeProjectedPickCandidate({
        target: renderable.binding.target,
        currentHoverTarget,
        screenDistance: distance,
        enterRadius: DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
        exitRadius: DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
      })
    ) {
      return [];
    }

    return [
      createProjectedPickCandidate({
        pickId: renderable.binding.pickId,
        target: renderable.binding.target,
        renderable,
        semanticClass: renderable.binding.semanticClass,
        priority: renderable.binding.pickPriority,
        screenDistance: distance,
        depth: projectedPoint.z,
      }),
    ];
  });
}

export function collectProjectedSketchDisplayPointCandidates({
  clientX,
  clientY,
  camera,
  viewportRect,
  sketchDisplayRenderables,
  acceptsTarget,
  currentHoverTarget,
}: {
  clientX: number;
  clientY: number;
  camera: ViewportCamera;
  viewportRect: DOMRectReadOnly;
  sketchDisplayRenderables: SketchSessionDisplayRenderable[];
  acceptsTarget: (target: PrimitiveRef) => boolean;
  currentHoverTarget: PrimitiveRef | null;
}): PickCandidate[] {
  const pointerX = clientX - viewportRect.left;
  const pointerY = clientY - viewportRect.top;
  const projectedPoint = new THREE.Vector3();

  return sketchDisplayRenderables.flatMap((renderable) => {
    const geometryData =
      renderable.geometry.kind === "marker" ? renderable.geometry : null;

    if (
      !geometryData ||
      !renderable.target ||
      (renderable.target.kind !== "sketchPoint" &&
        !(
          renderable.target.kind === "sketchDatumReference" &&
          renderable.target.geometryKind === "point"
        )) ||
      !acceptsTarget(renderable.target)
    ) {
      return [];
    }

    projectedPoint.set(
      geometryData.position[0],
      geometryData.position[1],
      geometryData.position[2],
    );
    projectedPoint.project(camera);

    if (!isVisibleProjectedPoint(projectedPoint)) {
      return [];
    }

    const screenX = ((projectedPoint.x + 1) / 2) * viewportRect.width;
    const screenY = ((-projectedPoint.y + 1) / 2) * viewportRect.height;
    const distance = Math.hypot(screenX - pointerX, screenY - pointerY);
    if (
      !shouldIncludeProjectedPickCandidate({
        target: renderable.target,
        currentHoverTarget,
        screenDistance: distance,
        enterRadius: DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
        exitRadius: DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
      })
    ) {
      return [];
    }

    return [
      createProjectedPickCandidate({
        pickId: null,
        target: renderable.target,
        semanticClass: getProjectedSketchDisplayPointSemanticClass(renderable),
        screenDistance: distance,
        depth: projectedPoint.z,
        stableKey: `sketch:${renderable.id}`,
      }),
    ];
  });
}

export function collectProjectedSketchCurveCandidates({
  clientX,
  clientY,
  camera,
  viewportRect,
  sketchSession,
  acceptsTarget,
  currentHoverTarget,
}: {
  clientX: number;
  clientY: number;
  camera: ViewportCamera;
  viewportRect: DOMRectReadOnly;
  sketchSession: SketchSessionState | null;
  acceptsTarget: (target: PrimitiveRef) => boolean;
  currentHoverTarget: PrimitiveRef | null;
}): PickCandidate[] {
  if (!sketchSession) {
    return [];
  }

  const pointer = {
    x: clientX - viewportRect.left,
    y: clientY - viewportRect.top,
  };
  // Computed lazily: only the plane metric (geometry that reaches behind
  // the camera) needs the sketch-plane pointer.
  let planePoint: SketchPoint2D | null | undefined;
  const getPlanePoint = () =>
    planePoint === undefined
      ? (planePoint = getSketchPlanePointerPoint({
          pointer,
          camera,
          viewportRect,
          sketchSession,
        }))
      : planePoint;
  const toScreen = (point: SketchPoint2D) =>
    projectSketchPointToScreen(point, sketchSession, camera, viewportRect);
  const toClip = (point: SketchPoint2D) =>
    projectSketchPointToClip(point, sketchSession, camera, viewportRect);

  return collectSketchInteractionGeometry(sketchSession).flatMap((geometry) => {
    if (
      !isSketchInteractionCurveGeometry(geometry) ||
      !acceptsTarget(geometry.target)
    ) {
      return [];
    }

    // Mandatory exact prefilter: the curve lies in its box, so its screen
    // image lies in the box's image; farther than the exit radius, no point
    // of the curve can be a candidate.
    const bounds = getSketchInteractionCurveBounds(geometry);
    if (
      !bounds ||
      screenDistanceToSketchBox(
        pointer,
        bounds,
        sketchSession,
        camera,
        viewportRect,
      ) > DEFAULT_PROJECTED_SKETCH_CURVE_PICK_EXIT_RADIUS_PX
    ) {
      return [];
    }

    const measured = measureSketchCurveScreenDistance(
      geometry,
      pointer,
      camera,
      toScreen,
      toClip,
      getPlanePoint,
    );
    if (!measured) {
      return [];
    }
    const { distance, depth } = measured;

    if (
      !shouldIncludeProjectedPickCandidate({
        target: geometry.target,
        currentHoverTarget,
        screenDistance: distance,
        enterRadius: DEFAULT_PROJECTED_SKETCH_CURVE_PICK_ENTER_RADIUS_PX,
        exitRadius: DEFAULT_PROJECTED_SKETCH_CURVE_PICK_EXIT_RADIUS_PX,
      })
    ) {
      return [];
    }

    return [
      createProjectedPickCandidate({
        pickId: null,
        target: geometry.target,
        semanticClass:
          geometry.source === "local" ? "sketchCurve" : "sketchReference",
        screenDistance: distance,
        depth,
        stableKey: `sketch-interaction:${geometry.id}`,
      }),
    ];
  });
}

/** Screen px and NDC depth; `visible` when the depth lies in the clip range. */
type ScreenPoint = { x: number; y: number; depth: number; visible: boolean };

/**
 * The pick metric (T10f, review A6 and A-1): the screen distance from the
 * pointer to the curve, and the NDC depth of the hit.
 * - Lines and sampled polylines: exact screen-space distance. A projective
 *   map sends segments to segments, so the projected end points (all with
 *   depth in the near–far range) give the projected curve; the depth
 *   interpolates affinely along each projected segment.
 * - Arcs and circles under any camera (all piece poles in front of it):
 *   exact, as projected rational quadratic pieces
 *   (`circularScreenDistance`, `closestPointOnRationalQuadratic`).
 * - Cubic spans under an orthographic camera: exact. The sketch-to-screen
 *   map is affine and Bézier curves are affinely invariant, so the poles
 *   mapped to screen px are the projected curve's poles; its closest point
 *   to the pointer is the owner's `closestPointOnSolvedCubicSpans` there.
 * - Cubic spans under a perspective camera (all drawn-domain poles in front
 *   of it): exact, as projected rational cubics
 *   (`perspectiveCubicScreenDistance`, `closestPointOnRationalCubic`).
 * - Otherwise (a line or polyline end point outside the near–far depth
 *   range, an arc/circle/cubic pole with clip w ≤ 0, or a cubic span whose
 *   rational image the owner can't evaluate): the plane metric |screen(C) − pointer|, C the exact closest
 *   point to the pointer ray's sketch-plane point P
 *   (`getSketchPlanePointerPoint`). Viewed along the normal this is the
 *   screen minimum; at oblique views it is an upper bound (screen(C) is a
 *   point of the projected curve), inflated by at least (1 + c²)/(2c) on a
 *   line, c = sin(elevation). Null at grazing views.
 */
function measureSketchCurveScreenDistance(
  geometry: SketchInteractionCurveGeometry,
  pointer: { x: number; y: number },
  camera: ViewportCamera,
  toScreen: (point: SketchPoint2D) => ScreenPoint,
  toClip: (point: SketchPoint2D) => ClipPoint,
  getPlanePoint: () => SketchPoint2D | null,
): { distance: number; depth: number } | null {
  if (geometry.kind === "lineSegment" || geometry.kind === "sampledCurve") {
    const points =
      geometry.kind === "lineSegment"
        ? [geometry.start, geometry.end]
        : geometry.isClosed && geometry.points.length > 2
          ? [...geometry.points, geometry.points[0]!]
          : geometry.points;
    const projected = points.map(toScreen);
    if (projected.every((point) => point.visible))
      return screenPolylineDistance(pointer, projected);
  } else if (geometry.kind === "circle" || geometry.kind === "arc") {
    const exact = circularScreenDistance(geometry, pointer, toClip);
    if (exact !== undefined) return exact;
  } else if (
    geometry.kind === "cubicSpans" &&
    !(camera as THREE.OrthographicCamera).isOrthographicCamera
  ) {
    const exact = perspectiveCubicScreenDistance(
      geometry.spans,
      pointer,
      toClip,
    );
    if (exact !== undefined) return exact;
  } else if (geometry.kind === "cubicSpans") {
    // The orthographic map is affine (w = 1): no pole lies behind it.
    const screenSpans = geometry.spans.map((span) => ({
      ...span,
      poles: span.poles.map((pole) => {
        const at = toScreen(pole);
        return [at.x, at.y] as const;
      }) as unknown as SplinePoles,
    }));
    const closest = closestPointOnSolvedCubicSpans(
      [pointer.x, pointer.y],
      screenSpans,
    );
    if (!closest) return null;
    const hit = toScreen(
      solvedCubicSpanPoint(geometry.spans[closest.spanIndex]!, closest.u),
    );
    return hit.visible
      ? { distance: closest.distance, depth: hit.depth }
      : null;
  }
  const planePoint = getPlanePoint();
  const closest = planePoint
    ? closestPointOnSketchInteractionCurve(geometry, planePoint)
    : null;
  const hit = closest ? toScreen(closest) : null;
  return hit?.visible
    ? {
        distance: Math.hypot(hit.x - pointer.x, hit.y - pointer.y),
        depth: hit.depth,
      }
    : null;
}

/** Screen px and NDC depth of a point with its clip-space w (> 0 in front). */
type ClipPoint = { x: number; y: number; depth: number; w: number };

/**
 * Exact screen distance of a circle or arc under any camera (review A-1):
 * each exact rational quadratic piece maps to a rational quadratic on the
 * screen with the poles' screen images and weights (1, w, 1) scaled by the
 * poles' clip w (projective invariance); rescaled to the standard form
 * w′ = w·w₁/√(w₀w₂) it is the same curve, depth included. Undefined (use the
 * plane metric) when a pole lies behind the camera.
 */
function circularScreenDistance(
  geometry: Extract<SketchInteractionCurveGeometry, { kind: "circle" | "arc" }>,
  pointer: { x: number; y: number },
  toClip: (point: SketchPoint2D) => ClipPoint,
): { distance: number; depth: number } | null | undefined {
  let best: { distance: number; depth: number } | null = null;
  for (const { poles, weight } of getSketchInteractionCircularPieces(
    geometry,
  )) {
    const clipped = poles.map(toClip);
    if (!clipped.every((pole) => pole.w > 0)) return undefined;
    const [c0, c1, c2] = clipped as [ClipPoint, ClipPoint, ClipPoint];
    const screenWeight = (weight * c1.w) / Math.sqrt(c0.w * c2.w);
    const closest = closestPointOnRationalQuadratic(
      [pointer.x, pointer.y],
      [
        [c0.x, c0.y],
        [c1.x, c1.y],
        [c2.x, c2.y],
      ],
      screenWeight,
    );
    if (!closest || (best && closest.distance >= best.distance)) continue;
    const depth = rationalQuadraticPoint(
      [
        [c0.depth, 0],
        [c1.depth, 0],
        [c2.depth, 0],
      ],
      screenWeight,
      closest.t,
    )[0];
    if (depth >= -1 && depth <= 1) best = { distance: closest.distance, depth };
  }
  return best;
}

/**
 * Exact screen distance of cubic spans under a perspective camera (T11b,
 * T11-D15): each span's drawn domain (`clippedSolvedCubicSpanPoles`) maps
 * to a rational cubic on the screen with the poles' screen images and
 * their clip w as weights (projective invariance); the depth is the same
 * rational cubic of the poles' NDC z. A span is searched only if its
 * screen pole box lies within U + slack of the pointer, U the distance to
 * the nearest drawn span end (a point of the curve): with positive weights
 * a span lies in its poles' convex hull, so every skipped span is farther.
 * The prefilter runs only when every clipped pole depth lies in [-1, 1]:
 * the depth of every point then lies in the hull of the pole depths, so
 * every hit passes the depth check and U is attained (T11b review REQ-1);
 * otherwise every span is searched.
 * The depth check is per span, as `circularScreenDistance` does per piece:
 * a span whose closest point lies outside the near–far range gives no hit,
 * even if other in-range points of it are within the radius (lines and
 * polylines instead fall back to the plane metric; review ADV-1).
 * Verified accuracy (T11b review ADV-3): projectively consistent inputs
 * are exact to ~1e-12 px, including pole clip w down to 1e-12; synthetic
 * weight ratios ≥ 1e6 with poles unrelated to the weights reached 2e-2 px.
 * Undefined (use the plane metric) when a clipped pole lies behind the
 * camera, or the owner can't evaluate a span (e.g. a denormal w overflowing
 * x/w; review ADV-4).
 */
function perspectiveCubicScreenDistance(
  spans: readonly SolvedCubicSpan[],
  pointer: { x: number; y: number },
  toClip: (point: SketchPoint2D) => ClipPoint,
): { distance: number; depth: number } | null | undefined {
  const clipped = spans.map((span) =>
    clippedSolvedCubicSpanPoles(span).map(toClip),
  );
  if (!clipped.every((poles) => poles.every((pole) => pole.w > 0)))
    return undefined;
  let upper = Number.POSITIVE_INFINITY;
  let scale = Math.max(Math.abs(pointer.x), Math.abs(pointer.y));
  for (const poles of clipped) {
    for (const end of [poles[0]!, poles[3]!])
      upper = Math.min(upper, Math.hypot(end.x - pointer.x, end.y - pointer.y));
    for (const pole of poles)
      scale = Math.max(scale, Math.abs(pole.x), Math.abs(pole.y));
  }
  const limit = clipped.every((poles) =>
    poles.every((pole) => pole.depth >= -1 && pole.depth <= 1),
  )
    ? upper + scale * 2 ** -30
    : Number.POSITIVE_INFINITY;
  let best: { distance: number; depth: number } | null = null;
  for (const poles of clipped) {
    const xs = poles.map((pole) => pole.x);
    const ys = poles.map((pole) => pole.y);
    if (
      Math.hypot(
        Math.max(Math.min(...xs) - pointer.x, 0, pointer.x - Math.max(...xs)),
        Math.max(Math.min(...ys) - pointer.y, 0, pointer.y - Math.max(...ys)),
      ) > limit
    )
      continue;
    const weights = poles.map(
      (pole) => pole.w,
    ) as unknown as RationalCubicWeights;
    const closest = closestPointOnRationalCubic(
      [pointer.x, pointer.y],
      poles.map((pole) => [pole.x, pole.y] as const) as unknown as SplinePoles,
      weights,
    );
    if (!closest) return undefined;
    if (best && closest.distance >= best.distance) continue;
    const depth = rationalCubicPoint(
      poles.map((pole) => [pole.depth, 0] as const) as unknown as SplinePoles,
      weights,
      closest.u,
    )[0];
    if (depth >= -1 && depth <= 1) best = { distance: closest.distance, depth };
  }
  return best;
}

function screenPolylineDistance(
  pointer: { x: number; y: number },
  points: readonly ScreenPoint[],
): { distance: number; depth: number } | null {
  let best: { distance: number; depth: number } | null =
    points.length === 1
      ? {
          distance: Math.hypot(
            points[0]!.x - pointer.x,
            points[0]!.y - pointer.y,
          ),
          depth: points[0]!.depth,
        }
      : null;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              ((pointer.x - start.x) * dx + (pointer.y - start.y) * dy) /
                lengthSquared,
            ),
          );
    const distance = Math.hypot(
      start.x + dx * t - pointer.x,
      start.y + dy * t - pointer.y,
    );
    if (!best || distance < best.distance)
      best = { distance, depth: start.depth + (end.depth - start.depth) * t };
  }
  return best;
}

/**
 * The pick metric's sketch-plane pointer (T10f, review A6): the pointer
 * ray (`Raycaster.setFromCamera`, as sketch tools place points) meets the
 * sketch plane at P. Null when the ray misses the plane or meets it at
 * less than 1° (`SKETCH_CURVE_PICK_GRAZING_SINE`), where P is
 * ill-conditioned; the plane metric then gives no candidate.
 */
function getSketchPlanePointerPoint({
  pointer,
  camera,
  viewportRect,
  sketchSession,
}: {
  pointer: { x: number; y: number };
  camera: ViewportCamera;
  viewportRect: DOMRectReadOnly;
  sketchSession: SketchSessionState;
}): SketchPoint2D | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      (pointer.x / viewportRect.width) * 2 - 1,
      -(pointer.y / viewportRect.height) * 2 + 1,
    ),
    camera,
  );
  const { frame } = sketchSession.plane;
  const normal = new THREE.Vector3(...frame.normal);
  if (
    Math.abs(raycaster.ray.direction.dot(normal)) <
    SKETCH_CURVE_PICK_GRAZING_SINE
  ) {
    return null;
  }
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(...frame.origin),
    ),
    new THREE.Vector3(),
  );
  return hit
    ? mapWorldPointToWorkspaceSketch(sketchSession.plane, [hit.x, hit.y, hit.z])
    : null;
}

function getProjectedSketchDisplayPointSemanticClass(
  renderable: SketchSessionDisplayRenderable,
) {
  return renderable.target?.kind === "sketchDatumReference" ||
    renderable.target?.kind === "projectedReferenceGeometry"
    ? "sketchPoint"
    : renderable.role === "reference"
      ? "sketchReference"
      : "sketchPoint";
}

export function isVisibleProjectedPoint(projectedPoint: THREE.Vector3) {
  return (
    hasVisibleProjectedDepth(projectedPoint) &&
    projectedPoint.x >= -1 &&
    projectedPoint.x <= 1 &&
    projectedPoint.y >= -1 &&
    projectedPoint.y <= 1
  );
}

function hasVisibleProjectedDepth(projectedPoint: THREE.Vector3) {
  return (
    Number.isFinite(projectedPoint.x) &&
    Number.isFinite(projectedPoint.y) &&
    Number.isFinite(projectedPoint.z) &&
    projectedPoint.z >= -1 &&
    projectedPoint.z <= 1
  );
}

function projectSketchPointToScreen(
  point: SketchPoint2D,
  sketchSession: SketchSessionState,
  camera: ViewportCamera,
  viewportRect: DOMRectReadOnly,
): ScreenPoint {
  const worldPoint = mapSketchPointToWorld(sketchSession.plane, point);
  const projectedPoint = new THREE.Vector3(...worldPoint).project(camera);
  return {
    x: ((projectedPoint.x + 1) / 2) * viewportRect.width,
    y: ((-projectedPoint.y + 1) / 2) * viewportRect.height,
    depth: projectedPoint.z,
    visible: hasVisibleProjectedDepth(projectedPoint),
  };
}

function projectSketchPointToClip(
  point: SketchPoint2D,
  sketchSession: SketchSessionState,
  camera: ViewportCamera,
  viewportRect: DOMRectReadOnly,
): ClipPoint {
  const clip = new THREE.Vector4(
    ...mapSketchPointToWorld(sketchSession.plane, point),
    1,
  )
    .applyMatrix4(camera.matrixWorldInverse)
    .applyMatrix4(camera.projectionMatrix);
  return {
    x: ((clip.x / clip.w + 1) / 2) * viewportRect.width,
    y: ((-clip.y / clip.w + 1) / 2) * viewportRect.height,
    depth: clip.z / clip.w,
    w: clip.w,
  };
}

/**
 * Screen distance from the pointer to the image of a sketch-plane box: its
 * four corners projected, which bound a convex quadrilateral containing the
 * image of every point of the box while all corners lie in front of the
 * camera (a projective map keeps lines and convexity there). 0 when any
 * corner is behind the camera (no pruning: conservative).
 */
function screenDistanceToSketchBox(
  pointer: { x: number; y: number },
  bounds: { readonly min: SketchPoint2D; readonly max: SketchPoint2D },
  sketchSession: SketchSessionState,
  camera: ViewportCamera,
  viewportRect: DOMRectReadOnly,
) {
  const clip = new THREE.Vector4();
  const corners: { x: number; y: number }[] = [];
  for (const point of [
    bounds.min,
    [bounds.max[0], bounds.min[1]],
    bounds.max,
    [bounds.min[0], bounds.max[1]],
  ] satisfies SketchPoint2D[]) {
    clip
      .set(...mapSketchPointToWorld(sketchSession.plane, point), 1)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    if (!(clip.w > 0)) return 0;
    corners.push({
      x: ((clip.x / clip.w + 1) / 2) * viewportRect.width,
      y: ((-clip.y / clip.w + 1) / 2) * viewportRect.height,
    });
  }
  let left = false;
  let right = false;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]!;
    const end = corners[(index + 1) % corners.length]!;
    const side =
      (end.x - start.x) * (pointer.y - start.y) -
      (end.y - start.y) * (pointer.x - start.x);
    left ||= side > 0;
    right ||= side < 0;
    distance = Math.min(
      distance,
      getPointToSegmentDistance(pointer, start, end),
    );
  }
  // Inside (or on) the convex quadrilateral: no two edges disagree.
  return left && right ? distance : 0;
}

function getPointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projected =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
    lengthSquared;
  const clamped = Math.min(1, Math.max(0, projected));
  const closestX = start.x + segmentX * clamped;
  const closestY = start.y + segmentY * clamped;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

export function updatePointerFromClientPoint(
  pointer: THREE.Vector2,
  viewportRect: DOMRectReadOnly,
  clientX: number,
  clientY: number,
) {
  pointer.x = ((clientX - viewportRect.left) / viewportRect.width) * 2 - 1;
  pointer.y = -((clientY - viewportRect.top) / viewportRect.height) * 2 + 1;
}

export function isAnnotationTarget(
  target: PrimitiveRef | null,
): target is SketchConstraintRef | SketchDimensionRef {
  return target?.kind === "constraint" || target?.kind === "dimension";
}

export function getAnnotationHighlightTargets(
  annotations: readonly SketchAnnotationDescriptor[],
  selection: readonly PrimitiveRef[],
  hoverTarget: PrimitiveRef | null,
) {
  const activeAnnotations = annotations.filter((annotation) => {
    if (hoverTarget && primitiveRefEquals(annotation.target, hoverTarget)) {
      return true;
    }

    return selection.some((target) =>
      primitiveRefEquals(annotation.target, target),
    );
  });

  return activeAnnotations.flatMap(
    (annotation) => annotation.affectedGeometryRefs,
  );
}
