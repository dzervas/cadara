import * as THREE from "three";

import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import type {
  RenderableEntityRecord,
  RenderMeshGeometry,
} from "@/contracts/render/schema";
import type { ViewportRenderableOrigin } from "@/core/workspace/viewport-renderables";
import type { ViewportCamera } from "@/infrastructure/viewport/viewport-projection";
import type { SketchPickStackCandidate } from "@/core/sketch-interaction/pick-stack";
import { SKETCH_POINT_RADII_PX } from "@/core/sketch-interaction/screen-radii";
import { workbenchGeometryHighlightColors } from "@/theme/workbench-theme";

export type WorkspaceSemanticClass =
  | RenderableEntityRecord["binding"]["semanticClass"]
  | "sketchReference"
  | "sketchImage";

export interface CollectedBindings {
  pickables: THREE.Object3D[];
  targetToObjects: Map<string, THREE.Object3D[]>;
}

export interface PickResult {
  pickId: string | null;
  target: PrimitiveRef;
  renderable: RenderableEntityRecord | null;
}

export interface PickCandidate extends PickResult {
  source: "raycast" | "projected";
  semanticClass: WorkspaceSemanticClass;
  priority: number;
  rayDistance: number | null;
  screenDistance: number | null;
  depth: number;
  stableKey: string;
}

export interface PickResolutionOptions {
  wireOcclusionTolerance?: number;
  sameLayerTolerance?: number;
}

interface HighlightMaterialBaseline {
  color: number;
  opacity: number;
}

export interface RenderableMaterialDisplayOptions {
  transparent?: boolean;
  opacity?: number;
  color?: number;
  flat?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
}

/** The part of a renderable its material depends on. */
export interface RenderableMaterialSource {
  binding: Pick<RenderableEntityRecord["binding"], "semanticClass">;
}

type HighlightRole = "faceHoverPerimeter";

export const MARKER_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 12, 12);
const PICK_PROXY_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 16);
const SEEDED_DATUM_CONSTRUCTION_IDS = new Set([
  "construction_plane-xy",
  "construction_plane-yz",
  "construction_plane-xz",
]);
const VISIBLE_MARKER_SCALE_FACTOR = 0.44;
const MARKER_PICK_SCALE_FACTOR = 1.45;
/**
 * Line band in world units: the sketch-mode raycast band, and the cap of
 * the part-mode band (T17-19).
 */
export const DEFAULT_LINE_PICK_THRESHOLD = 0.75;
/**
 * Part-mode line pick radius in screen pixels (T17-19): a curve or edge is
 * hit within this many pixels of the pointer at its own depth, capped at
 * `DEFAULT_LINE_PICK_THRESHOLD` world units. Zoomed in, the band keeps its
 * size on screen, so regions between close curves become pickable; zoomed
 * out, it stays the former world band, so small faces and regions are
 * never harder to pick than before (T17f2 review R-1). 21 px is the
 * former band at the default camera (orthographic, 32-unit frustum, zoom 1)
 * on a 900 px tall canvas (measured, T17f2 M-0).
 */
export const DEFAULT_LINE_PICK_RADIUS_PX = 21;
export const DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX = 48;
export const DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX = 56;
/** Sketch display points (T11-D2); feature vertices keep the radii above. */
export const DEFAULT_SKETCH_POINT_PICK_ENTER_RADIUS_PX =
  SKETCH_POINT_RADII_PX.enter;
export const DEFAULT_SKETCH_POINT_PICK_EXIT_RADIUS_PX =
  SKETCH_POINT_RADII_PX.exit;

/**
 * Projected feature (model) vertex radii: in sketch mode they are reference
 * points beside sketch points and use the sketch point radii (T11c review
 * ADV-3); part mode keeps 48/56 px, except over a pickable face, where
 * `resolveAllCandidates` limits them to `DEFAULT_LINE_PICK_RADIUS_PX`
 * (21 px, the uncapped line-band radius) in every part-mode tool, Measure
 * included (cadara-1lzw).
 */
export function getProjectedFeatureVertexPickRadii(inSketchSession: boolean) {
  return inSketchSession
    ? {
        enterRadius: DEFAULT_SKETCH_POINT_PICK_ENTER_RADIUS_PX,
        exitRadius: DEFAULT_SKETCH_POINT_PICK_EXIT_RADIUS_PX,
      }
    : {
        enterRadius: DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
        exitRadius: DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
      };
}
export const DEFAULT_WIRE_OCCLUSION_TOLERANCE = 0.01;
const DEFAULT_SAME_LAYER_TOLERANCE = 0.004;
const PICK_DISTANCE_EPSILON = 1e-9;

export const SURFACE_COLORS = {
  bodyFace: 0xf1eee4,
  body: 0xf1eee4,
  planarFace: 0xf1eee4,
  region: 0x93dff2,
  featureEdge: 0x86b6da,
  featureVertex: 0x86b6da,
  sketchCurve: 0x8db7d6,
  sketchPoint: 0x8db7d6,
  sketchReference: 0xf0c56c,
  construction: 0xb6d6ff,
  sketchImage: 0xffffff,
} as const;

export const GEOMETRY_HIGHLIGHT_COLORS = {
  hover: workbenchGeometryHighlightColors.hover.hex,
  selected: workbenchGeometryHighlightColors.selected.hex,
  hoverEmissive: workbenchGeometryHighlightColors.hoverEmissive.hex,
  selectedEmissive: workbenchGeometryHighlightColors.selectedEmissive.hex,
} as const;

export function applyWireMaterialDepthPolicy<
  TMaterial extends THREE.Material | THREE.Material[],
>(material: TMaterial): TMaterial {
  const materials = Array.isArray(material) ? material : [material];

  materials.forEach((entry) => {
    entry.depthTest = true;
    entry.depthWrite = false;
  });

  return material;
}

/**
 * The GPU geometry of a render mesh. Positions and normals are uploaded as
 * they are. The index is copied: three-mesh-bvh reorders a geometry's index
 * in place when it builds the tree, and the snapshot's triangle order must
 * stay as delivered for picking, measurement and mesh reuse.
 */
export function createRenderMeshBufferGeometry(mesh: RenderMeshGeometry) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.vertexPositions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.triangleIndices.slice(), 1));
  if (mesh.vertexNormals) {
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(mesh.vertexNormals, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  return geometry;
}

export function createMeshBoundaryLineSegmentsGeometry(
  geometry: RenderMeshGeometry,
) {
  const boundaryEdges = collectMeshBoundaryEdges(geometry);
  const positions = new Float32Array(boundaryEdges.length * 2 * 3);
  const vertexPositions = geometry.vertexPositions;

  boundaryEdges.forEach(([start, end], edgeIndex) => {
    const offset = edgeIndex * 6;
    positions.set(vertexPositions.subarray(start * 3, start * 3 + 3), offset);
    positions.set(vertexPositions.subarray(end * 3, end * 3 + 3), offset + 3);
  });

  const bufferGeometry = new THREE.BufferGeometry();
  bufferGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  bufferGeometry.computeBoundingSphere();
  return bufferGeometry;
}

/**
 * The mesh's boundary edges (used by one triangle) as vertex index pairs, in
 * the order their first use appears. Vertices at the same position are one
 * vertex here, so a seam that duplicates vertices is not a boundary.
 */
function collectMeshBoundaryEdges(geometry: RenderMeshGeometry) {
  const positions = geometry.vertexPositions;
  const vertexCount = positions.length / 3;
  const { weldedIds, weldedCount } = weldRenderMeshVertices(positions);

  // Edge key (welded end ids) -> edge slot; slots are in first-use order.
  const slotByKey = new Map<number, number>();
  const counts: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const indices = geometry.triangleIndices;
  const addEdge = (start: number, end: number) => {
    if (start >= vertexCount || end >= vertexCount) {
      return;
    }
    const startId = weldedIds[start]!;
    const endId = weldedIds[end]!;
    const key =
      Math.min(startId, endId) * weldedCount + Math.max(startId, endId);
    const slot = slotByKey.get(key);
    if (slot !== undefined) {
      counts[slot]! += 1;
      return;
    }
    slotByKey.set(key, counts.length);
    counts.push(1);
    starts.push(start);
    ends.push(end);
  };
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const a = indices[offset]!;
    const b = indices[offset + 1]!;
    const c = indices[offset + 2]!;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const boundary: (readonly [number, number])[] = [];
  counts.forEach((count, slot) => {
    if (count === 1) boundary.push([starts[slot]!, ends[slot]!]);
  });
  return boundary;
}

/** One id per vertex, from 0; vertices at equal positions share it. */
function weldRenderMeshVertices(positions: Float32Array) {
  const vertexCount = positions.length / 3;
  const order = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1)
    order[vertex] = vertex;
  const compare = (left: number, right: number) =>
    positions[left * 3]! - positions[right * 3]! ||
    positions[left * 3 + 1]! - positions[right * 3 + 1]! ||
    positions[left * 3 + 2]! - positions[right * 3 + 2]!;
  order.sort(compare);
  const weldedIds = new Uint32Array(vertexCount);
  let id = 0;
  for (let rank = 1; rank < vertexCount; rank += 1) {
    if (compare(order[rank - 1]!, order[rank]!) !== 0) id += 1;
    weldedIds[order[rank]!] = id;
  }
  return { weldedIds, weldedCount: vertexCount === 0 ? 0 : id + 1 };
}

/**
 * World units per screen pixel at `point` for a viewport `viewportHeight`
 * pixels tall: constant for an orthographic camera, proportional to the
 * point's view depth for a perspective one.
 */
export function getWorldUnitsPerPixelAt(
  camera: ViewportCamera,
  viewportHeight: number,
  point: THREE.Vector3,
) {
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom / viewportHeight;
  }

  const depth = Math.max(
    point
      .clone()
      .sub(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld))
      .dot(camera.getWorldDirection(new THREE.Vector3())),
    camera.near,
  );

  return (
    (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
    camera.zoom /
    viewportHeight
  );
}

/**
 * `raycaster.intersectObjects(objects, true)` for part mode (T17-19), except
 * that a line (`THREE.Line` and its subclasses) is hit only where the ray
 * passes within its band: `linePickRadiusPx` screen pixels at the depth of
 * its closest point, capped at `maxLineThreshold` world units. Each line is
 * raycast with `Line.threshold` set to the band at its farthest
 * bounding-sphere depth, and each hit is kept only within the band at its
 * own depth (under a perspective camera the pixel band grows with depth).
 * The band is measured from the ray, which off the view axis is a close,
 * slightly generous stand-in for the on-screen distance. Meshes raycast
 * unchanged. Unlike three, a `raycast()` returning `false` does not stop
 * the descent (nothing in the scene returns it). The scene has no
 * `THREE.Points`.
 */
export function intersectObjectsWithLinePickRadius(input: {
  raycaster: THREE.Raycaster;
  objects: readonly THREE.Object3D[];
  camera: ViewportCamera;
  viewportHeight: number;
  linePickRadiusPx: number;
  maxLineThreshold: number;
}): THREE.Intersection<THREE.Object3D>[] {
  const { raycaster, camera, viewportHeight, linePickRadiusPx } = input;
  const intersections: THREE.Intersection<THREE.Object3D>[] = [];
  const onRay = new THREE.Vector3();
  const bandAt = (point: THREE.Vector3) =>
    Math.min(
      input.maxLineThreshold,
      linePickRadiusPx * getWorldUnitsPerPixelAt(camera, viewportHeight, point),
    );
  const visit = (object: THREE.Object3D) => {
    if (object.layers.test(raycaster.layers)) {
      if (object instanceof THREE.Line) {
        if (!object.geometry.boundingSphere) {
          object.geometry.computeBoundingSphere();
        }
        const sphere = object.geometry.boundingSphere!.clone();
        sphere.applyMatrix4(object.matrixWorld);
        raycaster.params.Line.threshold = bandAt(
          sphere.center.addScaledVector(
            camera.getWorldDirection(new THREE.Vector3()),
            sphere.radius,
          ),
        );
        const lineHits: THREE.Intersection<THREE.Object3D>[] = [];
        object.raycast(raycaster, lineHits);
        intersections.push(
          ...lineHits.filter(
            (hit) =>
              hit.point.distanceTo(raycaster.ray.at(hit.distance, onRay)) <=
              bandAt(hit.point),
          ),
        );
      } else {
        object.raycast(raycaster, intersections);
      }
    }

    object.children.forEach(visit);
  };

  input.objects.forEach(visit);
  return intersections.sort((left, right) => left.distance - right.distance);
}

export function collectRaycastPickCandidates(
  intersections: THREE.Intersection<THREE.Object3D>[],
): PickCandidate[] {
  return intersections.flatMap((intersection) => {
    if (getBoundPickExcluded(intersection.object)) {
      return [];
    }

    const target = getBoundTarget(intersection.object);
    const semanticClass = getBoundSemanticClass(intersection.object);
    const origin = getBoundRenderableOrigin(intersection.object);

    if (!target || !semanticClass || !origin) {
      return [];
    }

    const pickId = getBoundPickId(intersection.object) ?? null;
    const renderable = getBoundRenderableRecord(intersection.object) ?? null;

    return [
      {
        source: "raycast",
        pickId,
        target,
        priority:
          getBoundPickPriority(intersection.object) ?? Number.POSITIVE_INFINITY,
        semanticClass,
        renderable,
        rayDistance: intersection.distance,
        screenDistance: null,
        depth: Number.isFinite(intersection.distance)
          ? intersection.distance
          : Number.POSITIVE_INFINITY,
        stableKey: getStablePickKey({
          pickId,
          target,
          semanticClass,
          renderable,
        }),
      },
    ];
  });
}

export function createProjectedPickCandidate({
  pickId,
  target,
  renderable = null,
  semanticClass,
  priority = Number.POSITIVE_INFINITY,
  screenDistance,
  depth,
  stableKey,
}: {
  pickId: string | null;
  target: PrimitiveRef;
  renderable?: RenderableEntityRecord | null;
  semanticClass: WorkspaceSemanticClass;
  priority?: number;
  screenDistance: number;
  depth: number;
  stableKey?: string;
}): PickCandidate {
  return {
    source: "projected",
    pickId,
    target,
    renderable,
    semanticClass,
    priority,
    rayDistance: null,
    screenDistance,
    depth,
    stableKey:
      stableKey ??
      getStablePickKey({
        pickId,
        target,
        semanticClass,
        renderable,
      }),
  };
}

export function shouldIncludeProjectedPickCandidate({
  target,
  currentHoverTarget,
  screenDistance,
  enterRadius = DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
  exitRadius = DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
}: {
  target: PrimitiveRef;
  currentHoverTarget: PrimitiveRef | null;
  screenDistance: number;
  enterRadius?: number;
  exitRadius?: number;
}) {
  const radius =
    currentHoverTarget && primitiveRefEquals(currentHoverTarget, target)
      ? exitRadius
      : enterRadius;

  return screenDistance <= radius;
}

/**
 * Drops the projected feature-vertex candidates a body face hides
 * (cadara-1lzw). A projected vertex is picked within a screen radius of the
 * pointer, not on the pointer ray, so the pointer's raycast cannot occlude
 * it, and it outranks any raycast face; without this, vertices behind a
 * body (e.g. a disk's bottom rim, seen through its top face from an oblique
 * camera) were picked through it. Each vertex is raycast along its own
 * camera ray against the body face meshes in `objects`; it is hidden when a
 * face lies more than `wireOcclusionTolerance` in front of it (the tolerance
 * edges get against the face under the pointer), so vertices on the
 * boundary of a visible face stay. Other candidates pass unchanged.
 */
export function dropFaceHiddenProjectedVertexCandidates(input: {
  candidates: readonly PickCandidate[];
  objects: readonly THREE.Object3D[];
  camera: ViewportCamera;
  layers: THREE.Layers;
  wireOcclusionTolerance?: number;
}): PickCandidate[] {
  const tolerance =
    input.wireOcclusionTolerance ?? DEFAULT_WIRE_OCCLUSION_TOLERANCE;
  const raycaster = new THREE.Raycaster();
  raycaster.layers.mask = input.layers.mask;
  // three-mesh-bvh: the nearest hit per mesh is enough here.
  (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly =
    true;
  const hits: THREE.Intersection<THREE.Object3D>[] = [];
  const point = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  // World bounding spheres, computed once: three's Mesh.raycast would
  // re-derive each per call, which dominates on models with thousands of
  // faces (cadara-1lzw review).
  let faceMeshes: { mesh: THREE.Mesh; sphere: THREE.Sphere }[] | null = null;
  const collectFaceMeshes = () => {
    const meshes = new Set<THREE.Mesh>();
    const visit = (object: THREE.Object3D) => {
      if (
        object instanceof THREE.Mesh &&
        object.layers.test(raycaster.layers) &&
        !getBoundPickExcluded(object)
      ) {
        const semanticClass = getBoundSemanticClass(object);

        if (semanticClass && isOccludingFaceSemanticClass(semanticClass)) {
          meshes.add(object);
        }
      }

      object.children.forEach(visit);
    };
    input.objects.forEach(visit);
    return [...meshes].map((mesh) => {
      if (!mesh.geometry.boundingSphere) {
        mesh.geometry.computeBoundingSphere();
      }

      return {
        mesh,
        sphere: mesh.geometry
          .boundingSphere!.clone()
          .applyMatrix4(mesh.matrixWorld),
      };
    });
  };
  const isFaceHit = ({
    mesh,
    sphere,
  }: {
    mesh: THREE.Mesh;
    sphere: THREE.Sphere;
  }) => {
    if (
      !raycaster.ray.intersectsSphere(sphere) ||
      raycaster.ray.origin.distanceTo(sphere.center) - sphere.radius >
        raycaster.far
    ) {
      return false;
    }

    hits.length = 0;
    mesh.raycast(raycaster, hits);
    return hits.length > 0;
  };

  return input.candidates.filter((candidate) => {
    const geometry = candidate.renderable?.geometry;

    if (
      candidate.source !== "projected" ||
      candidate.semanticClass !== "featureVertex" ||
      geometry?.kind !== "marker"
    ) {
      return true;
    }

    point.set(...geometry.position);
    const ndc = point.clone().project(input.camera);
    raycaster.setFromCamera(pointer.set(ndc.x, ndc.y), input.camera);
    raycaster.near = 0;
    // Any face hit nearer than this hides the vertex.
    raycaster.far =
      point.sub(raycaster.ray.origin).dot(raycaster.ray.direction) -
      tolerance -
      PICK_DISTANCE_EPSILON;

    faceMeshes ??= collectFaceMeshes();
    return raycaster.far <= 0 || !faceMeshes.some(isFaceHit);
  });
}

export function resolveAllCandidates(
  candidates: PickCandidate[],
  acceptsTarget: ((target: PrimitiveRef) => boolean) | null = null,
  options: PickResolutionOptions = {},
): PickResult | null {
  const wireOcclusionTolerance =
    options.wireOcclusionTolerance ?? DEFAULT_WIRE_OCCLUSION_TOLERANCE;
  const sameLayerTolerance =
    options.sameLayerTolerance ?? DEFAULT_SAME_LAYER_TOLERANCE;
  const resolvedHits = [...candidates]
    .sort((left, right) =>
      comparePickCandidates(left, right, {
        sameLayerTolerance,
        wireOcclusionTolerance,
      }),
    )
    .filter(createUniqueHitFilter());

  const nearestOccludingFaceDistance =
    getNearestOccludingFaceDistance(resolvedHits);
  // cadara-1lzw: over a pickable face, a projected feature vertex wins only
  // within `DEFAULT_LINE_PICK_RADIUS_PX` (21 px, the uncapped line-band
  // radius; the actual edge band can be narrower: world cap, Measure's
  // 3.4 px), not its 48 px off-body radius, so the face between a face's
  // corners stays pickable. Applies to every tool, Measure included.
  const isOverPickableFace = resolvedHits.some(
    (hit) =>
      hit.source === "raycast" &&
      isOccludingFaceSemanticClass(hit.semanticClass) &&
      hit.rayDistance === nearestOccludingFaceDistance &&
      getAcceptedPickTarget(hit, acceptsTarget) !== null,
  );

  for (const hit of resolvedHits) {
    if (
      isBehindNearestFace(
        hit,
        nearestOccludingFaceDistance,
        wireOcclusionTolerance,
        isWireSemanticClass,
      ) ||
      (isOverPickableFace &&
        hit.source === "projected" &&
        hit.semanticClass === "featureVertex" &&
        getSortableScreenDistance(hit) > DEFAULT_LINE_PICK_RADIUS_PX)
    ) {
      continue;
    }

    const acceptedTarget = getAcceptedPickTarget(hit, acceptsTarget);

    if (!acceptedTarget) {
      continue;
    }

    return {
      pickId: hit.pickId,
      target: acceptedTarget,
      renderable: hit.renderable,
    };
  }

  return null;
}

/**
 * Maps viewport candidates to the sketch pick-stack input (T11c, review
 * R-3); `resolveSketchPickStack` orders them. Kept from `resolveAllCandidates`:
 * wires behind the nearest body face are dropped, and topology hits carry
 * their owner body for eligibility mapping. The stack orders by class
 * first, so the same occlusion also drops ray-picked regions, reference
 * images and construction planes behind the nearest body face: nothing is
 * picked through a body (T11c review REQUIRED-1, ADV-2); coplanar ones
 * (within the tolerance) stay. Background datum planes are
 * dropped when a click on them counts as empty (`excludeBackgroundDatumPlanes`),
 * so an empty stack clears the selection. Screen-space candidates use their
 * px distance, raycast-only ones their ray distance.
 */
export function toSketchPickStackCandidates(
  candidates: readonly PickCandidate[],
  options: PickResolutionOptions & { excludeBackgroundDatumPlanes: boolean },
): (SketchPickStackCandidate & { pick: PickCandidate })[] {
  const wireOcclusionTolerance =
    options.wireOcclusionTolerance ?? DEFAULT_WIRE_OCCLUSION_TOLERANCE;
  const nearestOccludingFaceDistance =
    getNearestOccludingFaceDistance(candidates);

  return candidates.flatMap((pick) =>
    isBehindNearestFace(
      pick,
      nearestOccludingFaceDistance,
      wireOcclusionTolerance,
      isSketchOccludedSemanticClass,
    ) ||
    (options.excludeBackgroundDatumPlanes &&
      pick.renderable !== null &&
      isSeededDatumPlaneRenderable(pick.renderable))
      ? []
      : [
          {
            key: pick.stableKey,
            target: pick.target,
            ownerBodyTarget: getOwnerBodyTarget(pick),
            metric: pick.screenDistance === null ? "ray" : "screen",
            distance:
              pick.screenDistance ??
              pick.rayDistance ??
              Number.POSITIVE_INFINITY,
            depth: pick.depth,
            pick,
          },
        ],
  );
}

export function getNearestOccludingFaceDistance(hits: readonly PickCandidate[]) {
  return hits.reduce<number | null>((nearest, hit) => {
    if (
      !isOccludingFaceSemanticClass(hit.semanticClass) ||
      hit.rayDistance === null
    ) {
      return nearest;
    }

    return nearest === null
      ? hit.rayDistance
      : Math.min(nearest, hit.rayDistance);
  }, null);
}

function isBehindNearestFace(
  hit: PickCandidate,
  nearestOccludingFaceDistance: number | null,
  wireOcclusionTolerance: number,
  isOccluded: (semanticClass: WorkspaceSemanticClass) => boolean,
) {
  return (
    nearestOccludingFaceDistance !== null &&
    isOccluded(hit.semanticClass) &&
    hit.rayDistance !== null &&
    hit.rayDistance - nearestOccludingFaceDistance >
      wireOcclusionTolerance + PICK_DISTANCE_EPSILON
  );
}

export function updateWorkspaceHighlight(
  targetToObjects: Map<string, THREE.Object3D[]>,
  selection: PrimitiveRef[],
  hoverTarget: PrimitiveRef | null,
  relatedActiveTargets: readonly PrimitiveRef[] = [],
) {
  for (const objects of targetToObjects.values()) {
    for (const object of objects) {
      const material = getObjectMaterial(object);
      const semanticClass = getBoundSemanticClass(object);
      const origin = getBoundRenderableOrigin(object);

      if (!material || !semanticClass || !origin) {
        continue;
      }

      const target = getBoundTarget(object);

      if (!target) {
        continue;
      }

      const isSelected = selection.some((entry) =>
        targetActivatesBoundTarget(entry, target),
      );
      const isHovered =
        hoverTarget !== null && targetActivatesBoundTarget(hoverTarget, target);
      const isRelatedActive = relatedActiveTargets.some((entry) =>
        targetActivatesBoundTarget(entry, target),
      );
      applyRenderableState(
        material,
        semanticClass,
        origin,
        isSelected || isHovered || isRelatedActive,
        isSelected,
        getBoundHighlightRole(object),
      );
    }
  }
}

function getAcceptedPickTarget(
  hit: PickCandidate,
  acceptsTarget: ((target: PrimitiveRef) => boolean) | null,
): PrimitiveRef | null {
  if (!acceptsTarget || acceptsTarget(hit.target)) {
    return hit.target;
  }

  const ownerBodyTarget = getOwnerBodyTarget(hit);
  return ownerBodyTarget && acceptsTarget(ownerBodyTarget)
    ? ownerBodyTarget
    : null;
}

function getOwnerBodyTarget(hit: PickCandidate): PrimitiveRef | null {
  switch (hit.target.kind) {
    case "face":
    case "edge":
    case "vertex":
    case "loop":
      return { kind: "body", bodyId: hit.target.bodyId };
    default:
      return hit.renderable?.ownerBodyId
        ? { kind: "body", bodyId: hit.renderable.ownerBodyId }
        : null;
  }
}

function targetActivatesBoundTarget(
  activeTarget: PrimitiveRef,
  boundTarget: PrimitiveRef,
) {
  return (
    primitiveRefEquals(activeTarget, boundTarget) ||
    (activeTarget.kind === "body" &&
      isBodyTopologyTarget(boundTarget) &&
      activeTarget.bodyId === boundTarget.bodyId)
  );
}

function isBodyTopologyTarget(target: PrimitiveRef) {
  return (
    target.kind === "face" ||
    target.kind === "edge" ||
    target.kind === "vertex" ||
    target.kind === "loop"
  );
}

function applyRenderableState(
  material: THREE.Material | THREE.Material[] | THREE.LineBasicMaterial,
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
  isActive: boolean,
  isSelected: boolean,
  highlightRole: HighlightRole | null = null,
) {
  const materials = Array.isArray(material) ? material : [material];
  const shouldShowFaceHoverPerimeter =
    highlightRole === "faceHoverPerimeter" && isActive && !isSelected;
  const shouldHighlightFaceSurface =
    highlightRole !== "faceHoverPerimeter" &&
    (!isFaceSemanticClass(semanticClass) || isSelected || !isActive);
  const materialIsActive =
    shouldShowFaceHoverPerimeter ||
    (shouldHighlightFaceSurface && (isActive || isSelected));

  for (const entry of materials) {
    if (
      !(entry instanceof THREE.MeshStandardMaterial) &&
      !(entry instanceof THREE.MeshBasicMaterial) &&
      !(entry instanceof THREE.LineBasicMaterial)
    ) {
      continue;
    }

    const color = getHighlightColor(semanticClass, isActive, isSelected);
    const baseline = getHighlightMaterialBaseline(entry);

    entry.color.setHex(materialIsActive ? color : baseline.color);

    if (entry instanceof THREE.MeshStandardMaterial) {
      entry.emissive.setHex(
        materialIsActive && isSelected
          ? GEOMETRY_HIGHLIGHT_COLORS.selectedEmissive
          : materialIsActive && isActive
            ? GEOMETRY_HIGHLIGHT_COLORS.hoverEmissive
            : getRenderableMeshEmissive(semanticClass, origin),
      );
      entry.emissiveIntensity =
        materialIsActive && isSelected
          ? 0.32
          : materialIsActive && isActive
            ? 0.24
            : getRenderableMeshEmissiveIntensity(semanticClass, origin);
      entry.opacity = materialIsActive
        ? getRenderableMeshOpacity(semanticClass, origin, isActive, isSelected)
        : baseline.opacity;
    } else if (entry instanceof THREE.MeshBasicMaterial) {
      entry.opacity = materialIsActive
        ? getRenderableMeshOpacity(semanticClass, origin, isActive, isSelected)
        : baseline.opacity;
    } else {
      entry.opacity = materialIsActive
        ? getRenderableLineOpacity(semanticClass, origin, isActive, isSelected)
        : baseline.opacity;
    }
  }
}

function getHighlightMaterialBaseline(
  material:
    | THREE.MeshStandardMaterial
    | THREE.MeshBasicMaterial
    | THREE.LineBasicMaterial,
): HighlightMaterialBaseline {
  const existing = material.userData.highlightBaseline as
    | HighlightMaterialBaseline
    | undefined;
  if (existing) {
    return existing;
  }

  const baseline = {
    color: material.color.getHex(),
    opacity: material.opacity,
  };
  material.userData.highlightBaseline = baseline;
  return baseline;
}

function getRenderableBaseColor(semanticClass: WorkspaceSemanticClass) {
  switch (semanticClass) {
    case "body":
      return SURFACE_COLORS.body;
    case "bodyFace":
      return SURFACE_COLORS.bodyFace;
    case "planarFace":
      return SURFACE_COLORS.planarFace;
    case "region":
      return SURFACE_COLORS.region;
    case "featureEdge":
      return SURFACE_COLORS.featureEdge;
    case "featureVertex":
      return SURFACE_COLORS.featureVertex;
    case "sketchCurve":
      return SURFACE_COLORS.sketchCurve;
    case "sketchPoint":
      return SURFACE_COLORS.sketchPoint;
    case "sketchReference":
      return SURFACE_COLORS.sketchReference;
    case "construction":
      return SURFACE_COLORS.construction;
    case "sketchImage":
      return SURFACE_COLORS.sketchImage;
  }
}

function getHighlightColor(
  semanticClass: WorkspaceSemanticClass,
  isActive: boolean,
  isSelected: boolean,
) {
  if (semanticClass === "sketchImage") {
    return getRenderableBaseColor(semanticClass);
  }

  if (isSelected) {
    return GEOMETRY_HIGHLIGHT_COLORS.selected;
  }

  if (isActive) {
    return GEOMETRY_HIGHLIGHT_COLORS.hover;
  }

  return getRenderableBaseColor(semanticClass);
}

export function isSeededDatumPlaneRenderable(
  renderable: RenderableEntityRecord,
) {
  return (
    renderable.binding.target.kind === "construction" &&
    SEEDED_DATUM_CONSTRUCTION_IDS.has(renderable.binding.target.constructionId)
  );
}

function isWireSemanticClass(semanticClass: WorkspaceSemanticClass) {
  return (
    semanticClass === "featureEdge" ||
    semanticClass === "featureVertex" ||
    semanticClass === "sketchCurve" ||
    semanticClass === "sketchPoint" ||
    semanticClass === "sketchReference"
  );
}

function isSketchOccludedSemanticClass(semanticClass: WorkspaceSemanticClass) {
  return (
    isWireSemanticClass(semanticClass) ||
    semanticClass === "region" ||
    semanticClass === "sketchImage" ||
    semanticClass === "construction"
  );
}

function isFaceSemanticClass(semanticClass: WorkspaceSemanticClass) {
  return semanticClass === "body" || semanticClass === "bodyFace" || semanticClass === "planarFace";
}

function isOccludingFaceSemanticClass(semanticClass: WorkspaceSemanticClass) {
  return semanticClass === "body" || semanticClass === "bodyFace" || semanticClass === "planarFace";
}

function getInteractionSortRank(semanticClass: WorkspaceSemanticClass) {
  switch (semanticClass) {
    case "featureVertex":
    case "sketchPoint":
      return 0;
    case "featureEdge":
    case "sketchCurve":
    case "sketchReference":
      return 1;
    case "region":
      return 2;
    case "body":
    case "bodyFace":
    case "planarFace":
      return 3;
    case "construction":
    case "sketchImage":
      return 4;
  }
}

function createUniqueHitFilter() {
  const seen = new Set<string>();

  return (hit: PickCandidate) => {
    const key =
      hit.pickId ??
      hit.renderable?.id ??
      `${hit.semanticClass}:${getPrimitiveRefKey(hit.target)}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  };
}

function comparePickCandidates(
  left: PickCandidate,
  right: PickCandidate,
  options: {
    sameLayerTolerance: number;
    wireOcclusionTolerance: number;
  },
) {
  if (left.source !== right.source) {
    const rankDelta =
      getInteractionSortRank(left.semanticClass) -
      getInteractionSortRank(right.semanticClass);

    if (rankDelta !== 0) {
      return rankDelta;
    }

    if (!isProjectedPointCandidate(left) && !isProjectedPointCandidate(right)) {
      return left.source === "raycast" ? -1 : 1;
    }
  }

  if (left.source === "projected" || right.source === "projected") {
    const rankDelta =
      getInteractionSortRank(left.semanticClass) -
      getInteractionSortRank(right.semanticClass);

    if (rankDelta !== 0) {
      return rankDelta;
    }

    const screenDistanceDelta =
      getSortableScreenDistance(left) - getSortableScreenDistance(right);

    if (screenDistanceDelta !== 0) {
      return screenDistanceDelta;
    }

    const depthDelta = left.depth - right.depth;

    if (depthDelta !== 0) {
      return depthDelta;
    }

    const priorityDelta = left.priority - right.priority;

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.stableKey.localeCompare(right.stableKey);
  }

  const leftDistance = left.rayDistance ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.rayDistance ?? Number.POSITIVE_INFINITY;
  const distanceDelta = leftDistance - rightDistance;
  const layerTolerance = getRayLayerTolerance(left, right, options);

  if (Math.abs(distanceDelta) > layerTolerance + PICK_DISTANCE_EPSILON) {
    return distanceDelta;
  }

  const rankDelta =
    getInteractionSortRank(left.semanticClass) -
    getInteractionSortRank(right.semanticClass);

  if (rankDelta !== 0) {
    return rankDelta;
  }

  const priorityDelta = left.priority - right.priority;

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return left.stableKey.localeCompare(right.stableKey);
}

function isProjectedPointCandidate(candidate: PickCandidate) {
  return (
    candidate.source === "projected" &&
    (candidate.semanticClass === "featureVertex" ||
      candidate.semanticClass === "sketchPoint")
  );
}

function getRayLayerTolerance(
  left: PickCandidate,
  right: PickCandidate,
  options: {
    sameLayerTolerance: number;
    wireOcclusionTolerance: number;
  },
) {
  const isFaceWirePair =
    (isOccludingFaceSemanticClass(left.semanticClass) &&
      isWireSemanticClass(right.semanticClass)) ||
    (isWireSemanticClass(left.semanticClass) &&
      isOccludingFaceSemanticClass(right.semanticClass));

  return isFaceWirePair
    ? Math.max(options.sameLayerTolerance, options.wireOcclusionTolerance)
    : options.sameLayerTolerance;
}

function getSortableScreenDistance(candidate: PickCandidate) {
  return candidate.screenDistance ?? Number.POSITIVE_INFINITY;
}

function getStablePickKey(hit: {
  pickId: string | null;
  target: PrimitiveRef;
  semanticClass: WorkspaceSemanticClass;
  renderable: RenderableEntityRecord | null;
}) {
  return [
    hit.pickId ?? "",
    hit.renderable?.id ?? "",
    hit.semanticClass,
    getPrimitiveRefKey(hit.target),
  ].join(":");
}

function getBaseMeshOpacity(semanticClass: WorkspaceSemanticClass) {
  return semanticClass === "region" ? 0.22 : 1;
}

export function getRenderableRenderOrder(
  renderable: RenderableEntityRecord,
  origin: ViewportRenderableOrigin,
) {
  if (renderable.geometry.kind === "mesh") {
    return origin === "preview" ? 5 : 2;
  }

  if (renderable.geometry.kind === "polyline") {
    return origin === "preview" ? 6 : 3;
  }

  return origin === "preview" ? 7 : 4;
}

export function createRenderableMeshMaterial(
  renderable: RenderableMaterialSource,
  origin: ViewportRenderableOrigin,
  displayOptions: RenderableMaterialDisplayOptions = {},
) {
  const semanticClass = renderable.binding.semanticClass;
  const color = displayOptions.color ?? getRenderableBaseColor(semanticClass);
  const defaultPolygonOffset = getDefaultRenderableMeshPolygonOffset(
    semanticClass,
    origin,
  );
  const sharedOptions = {
    color,
    transparent:
      displayOptions.transparent ??
      (origin === "preview" ||
        semanticClass === "region" ||
        semanticClass === "construction"),
    opacity:
      displayOptions.opacity ??
      getRenderableMeshOpacity(semanticClass, origin, false, false),
    side: THREE.DoubleSide,
    depthWrite:
      !displayOptions.transparent &&
      !displayOptions.flat &&
      origin !== "preview" &&
      semanticClass !== "construction",
    polygonOffset: true,
    polygonOffsetFactor:
      displayOptions.polygonOffsetFactor ?? defaultPolygonOffset.factor,
    polygonOffsetUnits:
      displayOptions.polygonOffsetUnits ?? defaultPolygonOffset.units,
  };

  if (displayOptions.flat) {
    return new THREE.MeshBasicMaterial(sharedOptions);
  }

  return new THREE.MeshStandardMaterial({
    ...sharedOptions,
    metalness: 0.02,
    roughness:
      semanticClass === "region" ? 0.9 : origin === "preview" ? 0.7 : 0.76,
    emissive: getRenderableMeshEmissive(semanticClass, origin),
    emissiveIntensity: getRenderableMeshEmissiveIntensity(
      semanticClass,
      origin,
    ),
  });
}

function getDefaultRenderableMeshPolygonOffset(
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
) {
  if (semanticClass === "region") {
    return { factor: -2, units: -2 };
  }

  if (origin === "preview") {
    return { factor: -1, units: -1 };
  }

  return { factor: 1, units: 1 };
}

export function createRenderableLineMaterial(
  renderable: RenderableMaterialSource,
  origin: ViewportRenderableOrigin,
  displayOptions: RenderableMaterialDisplayOptions = {},
) {
  return applyWireMaterialDepthPolicy(
    new THREE.LineBasicMaterial({
      color:
        displayOptions.color ??
        getRenderableBaseColor(renderable.binding.semanticClass),
      transparent: displayOptions.transparent ?? true,
      opacity:
        displayOptions.opacity ??
        getRenderableLineOpacity(
          renderable.binding.semanticClass,
          origin,
          false,
          false,
        ),
    }),
  );
}

export function createRenderableMarkerMaterial(
  renderable: RenderableMaterialSource,
  origin: ViewportRenderableOrigin,
  displayOptions: RenderableMaterialDisplayOptions = {},
) {
  if (displayOptions.flat) {
    return new THREE.MeshBasicMaterial({
      color:
        displayOptions.color ??
        getRenderableBaseColor(renderable.binding.semanticClass),
      transparent: displayOptions.transparent ?? origin === "preview",
      opacity: displayOptions.opacity ?? (origin === "preview" ? 0.72 : 1),
      depthWrite: !displayOptions.transparent && origin !== "preview",
    });
  }

  return new THREE.MeshStandardMaterial({
    color:
      displayOptions.color ??
      getRenderableBaseColor(renderable.binding.semanticClass),
    transparent: displayOptions.transparent ?? origin === "preview",
    opacity: displayOptions.opacity ?? (origin === "preview" ? 0.72 : 1),
    metalness: 0.08,
    roughness: 0.34,
    emissive: origin === "preview" ? 0x244a63 : 0x1c3245,
    emissiveIntensity: origin === "preview" ? 0.16 : 0.12,
    depthWrite: !displayOptions.transparent && origin !== "preview",
  });
}

function getRenderableMeshEmissive(
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
) {
  if (semanticClass === "sketchReference") {
    return origin === "preview" ? 0x5a3d12 : 0x4a3511;
  }

  if (semanticClass === "region") {
    return origin === "preview" ? 0x173643 : 0x10252d;
  }

  return origin === "preview" ? 0x2f5570 : 0x343028;
}

function getRenderableMeshEmissiveIntensity(
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
) {
  if (semanticClass === "sketchReference") {
    return origin === "preview" ? 0.22 : 0.2;
  }

  if (semanticClass === "region") {
    return origin === "preview" ? 0.12 : 0.08;
  }

  return origin === "preview" ? 0.12 : 0.08;
}

function getRenderableMeshOpacity(
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
  isActive: boolean,
  isSelected: boolean,
) {
  if (semanticClass === "sketchImage") {
    return isSelected ? 0.7 : isActive ? 0.62 : 0.55;
  }

  if (semanticClass === "sketchReference") {
    return isSelected ? 1 : isActive ? 0.92 : 0.82;
  }

  if (semanticClass === "construction") {
    if (origin === "preview") {
      return isSelected ? 0.34 : isActive ? 0.26 : 0.18;
    }

    return isSelected ? 0.28 : isActive ? 0.2 : 0.12;
  }

  if (semanticClass === "region") {
    if (origin === "preview") {
      return isSelected ? 0.52 : isActive ? 0.42 : 0.32;
    }

    return isSelected ? 0.44 : isActive ? 0.34 : 0.22;
  }

  if (origin === "preview") {
    return isSelected ? 0.58 : isActive ? 0.48 : 0.34;
  }

  return getBaseMeshOpacity(semanticClass);
}

function getRenderableLineOpacity(
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
  isActive: boolean,
  isSelected: boolean,
) {
  if (semanticClass === "sketchReference") {
    return isSelected ? 1 : isActive ? 0.88 : 0.7;
  }

  if (semanticClass === "construction") {
    if (origin === "preview") {
      return isSelected ? 0.92 : isActive ? 0.74 : 0.56;
    }

    return isSelected ? 0.85 : isActive ? 0.62 : 0.4;
  }

  if (origin === "preview") {
    return isSelected ? 0.96 : isActive ? 0.86 : 0.72;
  }

  return isSelected ? 1 : isActive ? 0.98 : 0.94;
}

function getObjectMaterial(object: THREE.Object3D) {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    return object.material;
  }

  return null;
}

export function bindRenderableObject(
  object: THREE.Object3D,
  pickId: string | null,
  target: PrimitiveRef,
  semanticClass: WorkspaceSemanticClass,
  origin: ViewportRenderableOrigin,
  renderable?: RenderableEntityRecord,
) {
  object.name = object.name || getPrimitiveRefLabel(target);
  object.userData.target = target;
  object.userData.semanticClass = semanticClass;
  object.userData.renderableOrigin = origin;
  object.userData.pickPriority = renderable?.binding.pickPriority;
  if (renderable) {
    object.userData.renderableRecord = renderable;
  }

  if (pickId !== null) {
    object.userData.pickId = pickId;
  }
}

/**
 * Undoes `bindRenderableObject` and `excludeRenderableObjectFromRaycastPicking`
 * on an object that stays mounted after its renderable lost (or changed) its
 * pick target: `collectBindings` then no longer picks or highlights it,
 * exactly as a freshly mounted unbound object.
 */
export function unbindRenderableObject(object: THREE.Object3D) {
  object.name = "";
  delete object.userData.target;
  delete object.userData.semanticClass;
  delete object.userData.renderableOrigin;
  delete object.userData.pickPriority;
  delete object.userData.renderableRecord;
  delete object.userData.pickId;
  delete object.userData.pickExcluded;
}

export function bindFaceHoverPerimeterObject(
  object: THREE.Object3D,
  target: PrimitiveRef,
  semanticClass: Extract<WorkspaceSemanticClass, "bodyFace" | "planarFace">,
  origin: ViewportRenderableOrigin,
) {
  bindRenderableObject(object, null, target, semanticClass, origin);
  object.userData.highlightRole = "faceHoverPerimeter" satisfies HighlightRole;
  object.userData.pickExcluded = true;
}

export function excludeRenderableObjectFromRaycastPicking(
  object: THREE.Object3D,
) {
  object.userData.pickExcluded = true;
}

function getBoundPickId(object: THREE.Object3D) {
  return findBoundValue<string>(object, "pickId");
}

function getBoundPickExcluded(object: THREE.Object3D) {
  return findBoundValue<boolean>(object, "pickExcluded") === true;
}

function getBoundPickPriority(object: THREE.Object3D) {
  return findBoundValue<number>(object, "pickPriority");
}

export function getBoundTarget(object: THREE.Object3D) {
  return findBoundValue<PrimitiveRef>(object, "target");
}

export function getBoundRenderableRecord(object: THREE.Object3D) {
  return findBoundValue<RenderableEntityRecord>(object, "renderableRecord");
}

function getBoundSemanticClass(object: THREE.Object3D) {
  return findBoundValue<WorkspaceSemanticClass>(object, "semanticClass");
}

function getBoundRenderableOrigin(object: THREE.Object3D) {
  return findBoundValue<ViewportRenderableOrigin>(object, "renderableOrigin");
}

function getBoundHighlightRole(object: THREE.Object3D) {
  return findBoundValue<HighlightRole>(object, "highlightRole") ?? null;
}

function findBoundValue<T>(object: THREE.Object3D, key: string) {
  let current: THREE.Object3D | null = object;

  while (current) {
    const value = current.userData[key] as T | undefined;

    if (value !== undefined) {
      return value;
    }

    current = current.parent;
  }

  return undefined;
}

export function createMarkerPickProxy(
  position: readonly [number, number, number],
  displayRadius: number,
) {
  const material = createInvisiblePickMaterial();
  const mesh = new THREE.Mesh(PICK_PROXY_SPHERE_GEOMETRY, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.scale.setScalar(getBaseMarkerPickRadius(displayRadius));
  return mesh;
}

export function createInvisiblePickMaterial() {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  material.colorWrite = false;
  return material;
}

export function getVisibleMarkerRadius(displayRadius: number) {
  return Math.max(displayRadius * VISIBLE_MARKER_SCALE_FACTOR, Number.EPSILON);
}

export function collectBindings(
  root: THREE.Object3D | null,
): CollectedBindings | null {
  if (!root) {
    return null;
  }

  const pickables: THREE.Object3D[] = [];
  const targetToObjects = new Map<string, THREE.Object3D[]>();

  root.traverse((object) => {
    if (
      !getBoundPickExcluded(object) &&
      (object.userData.pickId !== undefined ||
        object.userData.target !== undefined)
    ) {
      pickables.push(object);
    }

    if (object.userData.highlightExcluded === true) {
      return;
    }

    const target = getBoundTarget(object);

    if (
      !target ||
      !(object instanceof THREE.Mesh || object instanceof THREE.Line)
    ) {
      return;
    }

    const key = getPrimitiveRefKey(target);
    const entries = targetToObjects.get(key) ?? [];
    entries.push(object);
    targetToObjects.set(key, entries);
  });

  return {
    pickables,
    targetToObjects,
  };
}

function getBaseMarkerPickRadius(displayRadius: number) {
  return Math.max(
    displayRadius * MARKER_PICK_SCALE_FACTOR,
    displayRadius,
    Number.EPSILON,
  );
}
