import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import type { RenderPoint3D, RenderableEntityRecord } from "@/contracts/render/schema";
import type { BodyId } from "@/contracts/shared/ids";

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
  // x, y, z per point of each body.
  const coordinatesByBodyId = new Map<BodyId, number[]>();

  for (const renderable of input.renderables) {
    if (!renderable.ownerBodyId) {
      continue;
    }

    const coordinates = coordinatesByBodyId.get(renderable.ownerBodyId) ?? [];
    appendGeometryCoordinates(coordinates, renderable);
    coordinatesByBodyId.set(renderable.ownerBodyId, coordinates);
  }

  let selectedTier: OccTessellationTierId = "startup";

  for (const coordinates of coordinatesByBodyId.values()) {
    const bounds = getPointBounds(coordinates);
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

function appendGeometryCoordinates(
  coordinates: number[],
  renderable: RenderableEntityRecord,
) {
  switch (renderable.geometry.kind) {
    case "mesh":
      for (const value of renderable.geometry.vertexPositions) {
        coordinates.push(value);
      }
      return;
    case "polyline":
      for (const point of renderable.geometry.points) {
        coordinates.push(point[0], point[1], point[2]);
      }
      return;
    case "marker":
      coordinates.push(...renderable.geometry.position);
      return;
  }
}

function getPointBounds(coordinates: readonly number[]) {
  if (coordinates.length === 0) {
    return null;
  }

  const min: [number, number, number] = [
    coordinates[0]!,
    coordinates[1]!,
    coordinates[2]!,
  ];
  const max: [number, number, number] = [...min];

  for (let offset = 0; offset < coordinates.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, coordinates[offset + axis]!);
      max[axis] = Math.max(max[axis]!, coordinates[offset + axis]!);
    }
  }

  const center: RenderPoint3D = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  let radius = 0;
  for (let offset = 0; offset < coordinates.length; offset += 3) {
    radius = Math.max(
      radius,
      Math.hypot(
        coordinates[offset]! - center[0],
        coordinates[offset + 1]! - center[1],
        coordinates[offset + 2]! - center[2],
      ),
    );
  }

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
