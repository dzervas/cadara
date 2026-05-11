import * as THREE from "three";

import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SectionViewSession, Vec3 } from "@/core/section-view/session";
import {
  add,
  cross,
  dot,
  getSectionPlaneOrigin,
  getSectionPlaneSignedDistance,
  mapSectionPlanePointToWorld,
  normalize,
  projectPointToSectionPlane,
  scale,
  subtract,
} from "@/core/section-view/session";

export interface SectionCapRenderable {
  id: string;
  vertexPositions: Vec3[];
  vertexNormals: Vec3[];
  textureCoordinates: Array<readonly [number, number]>;
  triangleIndices: Array<readonly [number, number, number]>;
}

const SECTION_TOLERANCE = 1e-5;

export function createSectionClippingPlane(section: SectionViewSession) {
  const origin = getSectionPlaneOrigin(section);
  const normal = new THREE.Vector3(...section.plane.frame.normal);

  if (section.retainedSide === "negative") {
    normal.multiplyScalar(-1);
  }

  return new THREE.Plane().setFromNormalAndCoplanarPoint(
    normal,
    new THREE.Vector3(origin[0], origin[1], origin[2]),
  );
}

export function createSectionCapRenderables(
  renderables: readonly RenderableEntityRecord[],
  section: SectionViewSession,
): SectionCapRenderable[] {
  const faceRenderables = renderables.filter(
    (renderable) =>
      renderable.geometry.kind === "mesh" &&
      (renderable.binding.semanticClass === "bodyFace" ||
        renderable.binding.semanticClass === "planarFace"),
  );

  const groups = new Map<string, RenderableEntityRecord[]>();

  faceRenderables.forEach((renderable) => {
    const key =
      renderable.ownerBodyId ??
      (renderable.binding.target.kind === "face"
        ? renderable.binding.target.bodyId
        : renderable.id);
    const current = groups.get(key);

    if (current) {
      current.push(renderable);
      return;
    }

    groups.set(key, [renderable]);
  });

  return [...groups.entries()].flatMap(([groupKey, group]) =>
    buildSectionCapsForGroup(groupKey, group, section),
  );
}

export function resolveSectionDragOffset(input: {
  pointerRayOrigin: Vec3;
  pointerRayDirection: Vec3;
  section: SectionViewSession;
}): number | null {
  const axisDirection = normalize(input.section.plane.frame.normal);

  if (!axisDirection) {
    return null;
  }

  const axisOrigin = getSectionPlaneOrigin(input.section);
  const lineToRay = subtract(axisOrigin, input.pointerRayOrigin);
  const a = dot(axisDirection, axisDirection);
  const b = dot(axisDirection, input.pointerRayDirection);
  const c = dot(input.pointerRayDirection, input.pointerRayDirection);
  const d = dot(axisDirection, lineToRay);
  const e = dot(input.pointerRayDirection, lineToRay);
  const denominator = a * c - b * b;

  if (Math.abs(denominator) <= SECTION_TOLERANCE) {
    return dot(
      subtract(input.pointerRayOrigin, input.section.plane.frame.origin),
      axisDirection,
    );
  }

  return input.section.offset + (b * e - c * d) / denominator;
}

function buildSectionCapsForGroup(
  groupKey: string,
  renderables: readonly RenderableEntityRecord[],
  section: SectionViewSession,
) {
  const segments = renderables.flatMap((renderable) => {
    if (renderable.geometry.kind !== "mesh") {
      return [];
    }

    const geometry = renderable.geometry;

    return geometry.triangleIndices.flatMap((triangle) => {
      const p0 = geometry.vertexPositions[triangle[0]];
      const p1 = geometry.vertexPositions[triangle[1]];
      const p2 = geometry.vertexPositions[triangle[2]];

      if (!p0 || !p1 || !p2) {
        return [];
      }

      const points = collectSectionTrianglePoints([p0, p1, p2], section);

      return points.length === 2 ? [[points[0], points[1]] as const] : [];
    });
  });

  const loops = buildSectionLoops(segments);

  return loops.flatMap((loop, index) => {
    const projected = loop.map((point) =>
      projectPointToSectionPlane(section.plane.frame, point),
    );

    if (Math.abs(getSignedLoopArea(projected)) <= SECTION_TOLERANCE) {
      return [];
    }

    const contour =
      getSignedLoopArea(projected) >= 0 ? projected : [...projected].reverse();
    const triangles = THREE.ShapeUtils.triangulateShape(
      contour.map((point) => new THREE.Vector2(point[0], point[1])),
      [],
    );

    if (triangles.length === 0) {
      return [];
    }

    const vertexPositions = contour.map((point) =>
      mapSectionPlanePointToWorld(section.plane.frame, point, section.offset),
    );
    const normal =
      section.retainedSide === "positive"
        ? section.plane.frame.normal
        : scale(section.plane.frame.normal, -1);

    return [
      {
        id: `${groupKey}:section-cap:${index}`,
        vertexPositions,
        vertexNormals: vertexPositions.map(() => normal),
        textureCoordinates: contour.map(
          (point) => [point[0], point[1]] as const,
        ),
        triangleIndices: triangles.map(
          (triangle) => [triangle[0], triangle[1], triangle[2]] as const,
        ),
      },
    ];
  });
}

function collectSectionTrianglePoints(
  triangle: readonly [Vec3, Vec3, Vec3],
  section: SectionViewSession,
) {
  const distances = triangle.map((point) =>
    getSectionPlaneSignedDistance(section, point),
  );
  const [p0, p1, p2] = triangle;
  const [d0, d1, d2] = distances;

  if (
    (d0 > SECTION_TOLERANCE &&
      d1 > SECTION_TOLERANCE &&
      d2 > SECTION_TOLERANCE) ||
    (d0 < -SECTION_TOLERANCE &&
      d1 < -SECTION_TOLERANCE &&
      d2 < -SECTION_TOLERANCE)
  ) {
    return [];
  }

  const points = [
    ...collectSectionEdgePoints(p0, d0, p1, d1),
    ...collectSectionEdgePoints(p1, d1, p2, d2),
    ...collectSectionEdgePoints(p2, d2, p0, d0),
  ];

  return dedupeSectionPoints(points);
}

function collectSectionEdgePoints(
  start: Vec3,
  startDistance: number,
  end: Vec3,
  endDistance: number,
) {
  if (
    Math.abs(startDistance) <= SECTION_TOLERANCE &&
    Math.abs(endDistance) <= SECTION_TOLERANCE
  ) {
    return [start, end];
  }

  if (Math.abs(startDistance) <= SECTION_TOLERANCE) {
    return [start];
  }

  if (Math.abs(endDistance) <= SECTION_TOLERANCE) {
    return [end];
  }

  if (startDistance * endDistance > 0) {
    return [];
  }

  const t = startDistance / (startDistance - endDistance);
  return [add(start, scale(subtract(end, start), t))];
}

function dedupeSectionPoints(points: readonly Vec3[]) {
  const deduped: Vec3[] = [];

  for (const point of points) {
    if (deduped.some((entry) => pointsEqual(entry, point))) {
      continue;
    }

    deduped.push(point);
  }

  return deduped;
}

function buildSectionLoops(segments: readonly (readonly [Vec3, Vec3])[]) {
  const nodes = new Map<string, Vec3>();
  const adjacency = new Map<string, Set<string>>();

  segments.forEach(([start, end]) => {
    const startKey = getSectionPointKey(start);
    const endKey = getSectionPointKey(end);

    if (startKey === endKey) {
      return;
    }

    nodes.set(startKey, start);
    nodes.set(endKey, end);
    getOrCreateSet(adjacency, startKey).add(endKey);
    getOrCreateSet(adjacency, endKey).add(startKey);
  });

  const visitedEdges = new Set<string>();
  const loops: Vec3[][] = [];

  for (const [startKey, neighbors] of adjacency) {
    for (const nextKey of neighbors) {
      const initialEdgeKey = getEdgeKey(startKey, nextKey);

      if (visitedEdges.has(initialEdgeKey)) {
        continue;
      }

      const loopKeys = [startKey];
      let previousKey = startKey;
      let currentKey = nextKey;

      visitedEdges.add(initialEdgeKey);

      while (currentKey !== startKey) {
        loopKeys.push(currentKey);
        const currentNeighbors = [...(adjacency.get(currentKey) ?? [])];
        const candidateKey =
          currentNeighbors.find(
            (neighborKey) =>
              neighborKey !== previousKey &&
              !visitedEdges.has(getEdgeKey(currentKey, neighborKey)),
          ) ??
          currentNeighbors.find((neighborKey) => neighborKey !== previousKey);

        if (!candidateKey) {
          loopKeys.length = 0;
          break;
        }

        visitedEdges.add(getEdgeKey(currentKey, candidateKey));
        previousKey = currentKey;
        currentKey = candidateKey;
      }

      if (loopKeys.length >= 3) {
        loops.push(loopKeys.map((key) => nodes.get(key)!).filter(Boolean));
      }
    }
  }

  return loops;
}

function getOrCreateSet(map: Map<string, Set<string>>, key: string) {
  const existing = map.get(key);

  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  map.set(key, created);
  return created;
}

function getSectionPointKey(point: Vec3) {
  return [
    Math.round(point[0] / SECTION_TOLERANCE),
    Math.round(point[1] / SECTION_TOLERANCE),
    Math.round(point[2] / SECTION_TOLERANCE),
  ].join(":");
}

function getEdgeKey(startKey: string, endKey: string) {
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function pointsEqual(left: Vec3, right: Vec3) {
  return (
    Math.abs(left[0] - right[0]) <= SECTION_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= SECTION_TOLERANCE &&
    Math.abs(left[2] - right[2]) <= SECTION_TOLERANCE
  );
}

function getSignedLoopArea(points: readonly (readonly [number, number])[]) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    if (!current || !next) {
      continue;
    }

    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
}

export function createSectionHatchTexture(spacing = 8, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create section hatch texture.");
  }

  context.clearRect(0, 0, size, size);
  const rootStyles = getComputedStyle(document.documentElement);
  context.strokeStyle =
    rootStyles.getPropertyValue("--workbench-shell-text").trim() || "black";
  context.lineWidth = 2;
  context.globalAlpha = 0.55;

  for (let offset = 0; offset <= size; offset += spacing) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, size);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function getSectionRenderableBounds(
  renderables: readonly RenderableEntityRecord[],
) {
  const bounds = new THREE.Box3();
  let hasGeometry = false;

  renderables.forEach((renderable) => {
    switch (renderable.geometry.kind) {
      case "mesh":
        renderable.geometry.vertexPositions.forEach((point) => {
          bounds.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]));
          hasGeometry = true;
        });
        break;
      case "polyline":
        renderable.geometry.points.forEach((point) => {
          bounds.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]));
          hasGeometry = true;
        });
        break;
      case "marker":
        bounds.expandByPoint(
          new THREE.Vector3(
            renderable.geometry.position[0],
            renderable.geometry.position[1],
            renderable.geometry.position[2],
          ),
        );
        hasGeometry = true;
        break;
    }
  });

  return hasGeometry ? bounds : null;
}

export function getSectionPlaneBasis(
  frame: SectionViewSession["plane"]["frame"],
) {
  const normal = new THREE.Vector3(...frame.normal);
  const xAxis = new THREE.Vector3(...frame.xAxis);
  const yAxis = new THREE.Vector3(...frame.yAxis);
  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  return { normal, xAxis, yAxis, matrix };
}

export function getSectionLoopNormal(loop: readonly Vec3[]) {
  let normal: Vec3 = [0, 0, 0];

  for (let index = 0; index < loop.length; index += 1) {
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];

    if (!current || !next) {
      continue;
    }

    normal = add(normal, cross(current, next));
  }

  return normalize(normal);
}
