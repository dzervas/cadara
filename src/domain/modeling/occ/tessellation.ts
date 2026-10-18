import type {
  RenderPoint3D,
  RenderableEntityRecord,
} from "@/contracts/render/schema";
import type { BodyId } from "@/contracts/shared/ids";

export type OccTessellationTierId = "startup" | "normal" | "fine";

export interface OccTessellationTier {
  id: OccTessellationTierId;
  linearDeflectionModelUnits: number;
  angularDeflectionRadians: number;
  angularDeflectionDegreeEquivalent: number;
}

export type BodyLodProjection =
  | { kind: "orthographic"; halfHeightModelUnits: number; zoom: number }
  | { kind: "perspective"; verticalFovDegrees: number; zoom: number };

export interface BodyLodSelectionInput {
  cameraDistanceModelUnits: number;
  bodyRadiusModelUnits: number;
  projection?: BodyLodProjection;
}

export interface ViewportLodSelectionInput {
  cameraPosition: RenderPoint3D;
  renderables: readonly RenderableEntityRecord[];
  projection?: BodyLodProjection;
}

const EXISTING_OCC_ANGULAR_DEFLECTION_RADIANS = 0.5;

export function degreesToOccAngularDeflectionRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

function createTier(
  id: OccTessellationTierId,
  linearDeflectionModelUnits: number,
  angularDegreeEquivalent: number,
): OccTessellationTier {
  const convertedAngular = degreesToOccAngularDeflectionRadians(
    angularDegreeEquivalent,
  );
  const angularDeflectionRadians =
    id === "startup"
      ? Math.max(convertedAngular, EXISTING_OCC_ANGULAR_DEFLECTION_RADIANS)
      : convertedAngular;

  return {
    id,
    linearDeflectionModelUnits,
    angularDeflectionRadians,
    angularDeflectionDegreeEquivalent:
      angularDeflectionRadians * (180 / Math.PI),
  };
}

export const OCC_TESSELLATION_TIERS: Record<
  OccTessellationTierId,
  OccTessellationTier
> = {
  startup: createTier("startup", 0.75, 1.5),
  normal: createTier("normal", 0.25, 8),
  fine: createTier("fine", 0.1, 2),
};

export function getOccTessellationTier(
  tierId: OccTessellationTierId = "startup",
) {
  return OCC_TESSELLATION_TIERS[tierId];
}

export function selectBodyLodTier(
  input: BodyLodSelectionInput,
): OccTessellationTierId {
  const projection = input.projection;
  // O34: radius / visible half-height is the screen-space radius. Scale it
  // by tan(45deg / 2) to retain the existing radius/distance thresholds at
  // the viewport's default perspective FOV. Equal screen fractions therefore
  // select equal tiers, including orthographic zoom (which never moves the camera).
  const referenceHalfFovTangent = Math.tan(Math.PI / 8);
  const effectiveDistance =
    projection?.kind === "orthographic"
      ? projection.halfHeightModelUnits /
        projection.zoom /
        referenceHalfFovTangent
      : input.cameraDistanceModelUnits *
        (projection
          ? Math.tan((projection.verticalFovDegrees * Math.PI) / 360) /
            projection.zoom /
            referenceHalfFovTangent
          : 1);
  if (input.bodyRadiusModelUnits <= 0 || effectiveDistance <= 0) {
    return "startup";
  }

  const projectedSize = input.bodyRadiusModelUnits / effectiveDistance;

  if (projectedSize >= 0.18) {
    return "fine";
  }

  if (projectedSize >= 0.06) {
    return "normal";
  }

  return "startup";
}

export function selectViewportLodTierForRenderables(
  input: ViewportLodSelectionInput,
): OccTessellationTierId {
  const pointsByBodyId = new Map<BodyId, RenderPoint3D[]>();

  for (const renderable of input.renderables) {
    if (!renderable.ownerBodyId) {
      continue;
    }

    const points = pointsByBodyId.get(renderable.ownerBodyId) ?? [];
    points.push(...collectGeometryPoints(renderable));
    pointsByBodyId.set(renderable.ownerBodyId, points);
  }

  let selectedTier: OccTessellationTierId = "startup";

  for (const points of pointsByBodyId.values()) {
    const bounds = getPointBounds(points);
    if (!bounds) {
      continue;
    }

    const tier = selectBodyLodTier({
      bodyRadiusModelUnits: bounds.radius,
      cameraDistanceModelUnits: distance(input.cameraPosition, bounds.center),
      projection: input.projection,
    });
    selectedTier = maxTier(selectedTier, tier);
  }

  return selectedTier;
}

function collectGeometryPoints(
  renderable: RenderableEntityRecord,
): RenderPoint3D[] {
  switch (renderable.geometry.kind) {
    case "mesh":
      return [...renderable.geometry.vertexPositions];
    case "polyline":
      return [...renderable.geometry.points];
    case "marker":
      return [renderable.geometry.position];
  }
}

function getPointBounds(points: readonly RenderPoint3D[]) {
  if (points.length === 0) {
    return null;
  }

  const min: [number, number, number] = [
    points[0]![0],
    points[0]![1],
    points[0]![2],
  ];
  const max: [number, number, number] = [...min];

  for (const point of points) {
    min[0] = Math.min(min[0], point[0]);
    min[1] = Math.min(min[1], point[1]);
    min[2] = Math.min(min[2], point[2]);
    max[0] = Math.max(max[0], point[0]);
    max[1] = Math.max(max[1], point[1]);
    max[2] = Math.max(max[2], point[2]);
  }

  const center: RenderPoint3D = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius = Math.max(...points.map((point) => distance(point, center)));

  return {
    center,
    radius,
  };
}

function distance(left: RenderPoint3D, right: RenderPoint3D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function maxTier(left: OccTessellationTierId, right: OccTessellationTierId) {
  const rank: Record<OccTessellationTierId, number> = {
    startup: 0,
    normal: 1,
    fine: 2,
  };

  return rank[right] > rank[left] ? right : left;
}
