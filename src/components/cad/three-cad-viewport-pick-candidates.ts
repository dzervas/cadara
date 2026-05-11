import * as THREE from "three";

import { type PrimitiveRef, primitiveRefEquals } from "@/core/editor/schema";
import {
  mapSketchPointToWorld,
  type SketchAnnotationDescriptor,
  type SketchSessionDisplayRenderable,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  collectSketchInteractionGeometry,
  flattenSketchInteractionCurve,
  isSketchInteractionCurveGeometry,
} from "@/domain/sketch-interaction/geometry";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
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
  const pointerX = clientX - viewportRect.left;
  const pointerY = clientY - viewportRect.top;

  if (!sketchSession) {
    return [];
  }

  return collectSketchInteractionGeometry(sketchSession).flatMap((geometry) => {
    if (
      !isSketchInteractionCurveGeometry(geometry) ||
      !acceptsTarget(geometry.target)
    ) {
      return [];
    }

    const points = flattenSketchInteractionCurve(geometry);
    if (points.length < 2) {
      return [];
    }

    const projected = projectSketchCurvePoints({
      points,
      sketchSession,
      camera,
      viewportRect,
    });
    if (projected.length < 2) {
      return [];
    }

    const distance = getPointToPolylineDistance(
      {
        x: pointerX,
        y: pointerY,
      },
      projected,
    );

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
        depth: projected.reduce(
          (nearest, point) => Math.min(nearest, point.depth),
          Number.POSITIVE_INFINITY,
        ),
        stableKey: `sketch-interaction:${geometry.id}`,
      }),
    ];
  });
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

function projectSketchCurvePoints({
  points,
  sketchSession,
  camera,
  viewportRect,
}: {
  points: readonly SketchPoint2D[];
  sketchSession: SketchSessionState;
  camera: ViewportCamera;
  viewportRect: DOMRectReadOnly;
}) {
  const projectedPoint = new THREE.Vector3();

  return points.flatMap((point) => {
    const worldPoint = mapSketchPointToWorld(sketchSession.plane, point);
    projectedPoint.set(worldPoint[0], worldPoint[1], worldPoint[2]);
    projectedPoint.project(camera);

    if (!hasVisibleProjectedDepth(projectedPoint)) {
      return [];
    }

    return [
      {
        x: ((projectedPoint.x + 1) / 2) * viewportRect.width,
        y: ((-projectedPoint.y + 1) / 2) * viewportRect.height,
        depth: projectedPoint.z,
      },
    ];
  });
}

function getPointToPolylineDistance(
  point: { x: number; y: number },
  polyline: readonly { x: number; y: number }[],
) {
  let distance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < polyline.length; index += 1) {
    distance = Math.min(
      distance,
      getPointToSegmentDistance(point, polyline[index - 1]!, polyline[index]!),
    );
  }

  return distance;
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
