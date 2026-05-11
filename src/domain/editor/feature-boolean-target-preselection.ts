import type {
  RenderableEntityRecord,
  RenderPoint3D,
} from "@/contracts/render/schema";
import type { BodyId } from "@/contracts/shared/ids";
import type {
  FeatureBooleanOperation,
  ModelingDocumentSettings,
} from "@/contracts/modeling/schema";
import type { AdvancedSolidOperationIntent } from "@/contracts/modeling/advanced-solid";
import type {
  FeatureDraftPatch,
  FeatureEditSessionState,
} from "@/core/feature-authoring/definition";
import { getFeatureAuthoringDefinition } from "@/core/feature-authoring/registry";

export type PreviewBodyRelationshipKind =
  | "intersects"
  | "coplanarContact"
  | "none"
  | "unknown";

export interface PreviewBodyRelationship {
  kind: PreviewBodyRelationshipKind;
  bodyId: BodyId | null;
}

interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

interface PlaneSample {
  bodyId: BodyId | null;
  normal: [number, number, number];
  point: RenderPoint3D;
  bounds: Bounds3;
  projectedBounds: Bounds2;
}

interface Bounds2 {
  min: [number, number];
  max: [number, number];
}

interface CandidateScore {
  bodyId: BodyId;
  score: number;
}

const DEFAULT_TOLERANCE = 0.001;

export function classifyPreviewBooleanTarget(input: {
  previewRenderables: readonly RenderableEntityRecord[];
  bodyRenderables: readonly RenderableEntityRecord[];
  candidateBodyIds: readonly BodyId[];
  settings?: Pick<
    ModelingDocumentSettings,
    "modelingTolerance" | "angularToleranceRadians"
  > | null;
}): PreviewBodyRelationship {
  const candidateBodyIds = [...new Set(input.candidateBodyIds)].sort();
  if (candidateBodyIds.length === 0) {
    return { kind: "none", bodyId: null };
  }

  const tolerance = input.settings?.modelingTolerance ?? DEFAULT_TOLERANCE;
  const angularTolerance = input.settings?.angularToleranceRadians ?? 0.0001;
  const previewMeshes = input.previewRenderables.filter(
    (record) => record.geometry.kind === "mesh",
  );
  const bodyMeshesByBodyId = groupBodyMeshes(
    input.bodyRenderables,
    candidateBodyIds,
  );

  if (previewMeshes.length === 0) {
    return { kind: "unknown", bodyId: null };
  }

  const intersectingCandidates: CandidateScore[] = [];
  for (const bodyId of candidateBodyIds) {
    const bodyMeshes = bodyMeshesByBodyId.get(bodyId) ?? [];
    const score = scoreIntersectingBounds(previewMeshes, bodyMeshes, tolerance);
    if (score !== null) {
      intersectingCandidates.push({ bodyId, score });
    }
  }

  const intersectingBodyId = selectBestCandidate(
    intersectingCandidates,
    tolerance,
  );
  if (intersectingBodyId === "ambiguous") {
    return { kind: "unknown", bodyId: null };
  }
  if (intersectingBodyId) {
    return { kind: "intersects", bodyId: intersectingBodyId };
  }

  const previewPlanes = previewMeshes.flatMap((record) =>
    createPlaneSample(record, null),
  );
  const coplanarCandidates: CandidateScore[] = [];
  for (const bodyId of candidateBodyIds) {
    const score = scoreCoplanarContact(
      previewPlanes,
      (bodyMeshesByBodyId.get(bodyId) ?? []).flatMap((record) =>
        createPlaneSample(record, bodyId),
      ),
      tolerance,
      angularTolerance,
    );
    if (score !== null) {
      coplanarCandidates.push({ bodyId, score });
    }
  }

  const coplanarBodyId = selectBestCandidate(coplanarCandidates, tolerance);
  if (coplanarBodyId === "ambiguous") {
    return { kind: "unknown", bodyId: null };
  }
  if (coplanarBodyId) {
    return { kind: "coplanarContact", bodyId: coplanarBodyId };
  }

  return bodyMeshesByBodyId.size === 0
    ? { kind: "unknown", bodyId: null }
    : { kind: "none", bodyId: null };
}

export function applyFeatureBooleanTargetPreselection(
  session: FeatureEditSessionState,
  relationship: PreviewBodyRelationship,
): FeatureEditSessionState {
  if (
    session.mode !== "create" ||
    session.booleanTargetPreselection.operationManuallyChanged ||
    session.booleanTargetPreselection.targetManuallyChanged
  ) {
    return session;
  }

  const patch = createPreselectionPatch(session.featureType, relationship);
  if (!patch) {
    return session;
  }

  const definition = getFeatureAuthoringDefinition(session.featureType);
  return {
    ...session,
    draft: definition.applyPatch(session.draft, patch as never) as never,
  } as FeatureEditSessionState;
}

export function isBooleanOperationPatch(patch: FeatureDraftPatch) {
  return (
    Object.hasOwn(patch, "operation") || Object.hasOwn(patch, "operationIntent")
  );
}

export function isBooleanTargetPatch(patch: FeatureDraftPatch) {
  return (
    Object.hasOwn(patch, "booleanScope") ||
    Object.hasOwn(patch, "booleanTargetBodyId") ||
    Object.hasOwn(patch, "booleanTargetBodyIds") ||
    Object.hasOwn(patch, "targetBodyTargets")
  );
}

export function featureSupportsBooleanTargetPreselection(
  featureType: FeatureEditSessionState["featureType"],
) {
  return (
    featureType === "extrude" ||
    featureType === "revolve" ||
    featureType === "sweep" ||
    featureType === "loft" ||
    featureType === "thicken"
  );
}

export function featurePreviewSupportsAutomaticBooleanTargetPreselection(
  featureType: FeatureEditSessionState["featureType"],
) {
  return featureType === "extrude" || featureType === "revolve";
}

function createPreselectionPatch(
  featureType: FeatureEditSessionState["featureType"],
  relationship: PreviewBodyRelationship,
): FeatureDraftPatch | null {
  if (featureType === "extrude" || featureType === "revolve") {
    const operation = basicOperationForRelationship(relationship);
    return operation === "newBody" || !relationship.bodyId
      ? { operation, booleanScope: { kind: "standalone" } }
      : { operation, booleanTargetBodyId: relationship.bodyId };
  }

  if (
    featureType === "sweep" ||
    featureType === "loft" ||
    featureType === "thicken"
  ) {
    const operationIntent =
      advancedOperationIntentForRelationship(relationship);
    return operationIntent === "create" || !relationship.bodyId
      ? { operationIntent, targetBodyTargets: [] }
      : {
          operationIntent,
          targetBodyTargets: [{ kind: "body", bodyId: relationship.bodyId }],
        };
  }

  return null;
}

function basicOperationForRelationship(
  relationship: PreviewBodyRelationship,
): FeatureBooleanOperation {
  if (relationship.kind === "intersects") {
    return "cut";
  }
  if (relationship.kind === "coplanarContact") {
    return "join";
  }
  return "newBody";
}

function advancedOperationIntentForRelationship(
  relationship: PreviewBodyRelationship,
): AdvancedSolidOperationIntent {
  if (relationship.kind === "intersects") {
    return "subtract";
  }
  if (relationship.kind === "coplanarContact") {
    return "add";
  }
  return "create";
}

function groupBodyMeshes(
  renderables: readonly RenderableEntityRecord[],
  candidateBodyIds: readonly BodyId[],
) {
  const candidateBodyIdSet = new Set(candidateBodyIds);
  const grouped = new Map<BodyId, RenderableEntityRecord[]>();
  for (const record of renderables) {
    if (
      record.geometry.kind !== "mesh" ||
      !record.ownerBodyId ||
      !candidateBodyIdSet.has(record.ownerBodyId)
    ) {
      continue;
    }

    const records = grouped.get(record.ownerBodyId) ?? [];
    records.push(record);
    grouped.set(record.ownerBodyId, records);
  }

  return grouped;
}

function scoreIntersectingBounds(
  previewMeshes: readonly RenderableEntityRecord[],
  bodyMeshes: readonly RenderableEntityRecord[],
  tolerance: number,
) {
  let bestScore: number | null = null;
  for (const preview of previewMeshes) {
    const previewBounds = boundsFromRenderable(preview);
    if (!previewBounds) {
      continue;
    }

    for (const body of bodyMeshes) {
      const bodyBounds = boundsFromRenderable(body);
      if (!bodyBounds) {
        continue;
      }

      const overlaps = axisOverlaps(previewBounds, bodyBounds);
      if (overlaps.every((overlap) => overlap > tolerance)) {
        const score = overlaps[0]! * overlaps[1]! * overlaps[2]!;
        bestScore = Math.max(bestScore ?? score, score);
      }
    }
  }

  return bestScore;
}

function scoreCoplanarContact(
  previewPlanes: readonly PlaneSample[],
  bodyPlanes: readonly PlaneSample[],
  tolerance: number,
  angularTolerance: number,
) {
  let bestScore: number | null = null;
  for (const preview of previewPlanes) {
    for (const body of bodyPlanes) {
      const normalDot = Math.abs(dot(preview.normal, body.normal));
      if (normalDot < Math.cos(angularTolerance)) {
        continue;
      }

      if (
        Math.abs(distanceToPlane(preview.point, body.point, body.normal)) >
        tolerance
      ) {
        continue;
      }

      const overlap = bounds2Overlap(
        preview.projectedBounds,
        body.projectedBounds,
      );
      if (overlap <= tolerance * tolerance) {
        continue;
      }

      bestScore = Math.max(bestScore ?? overlap, overlap);
    }
  }

  return bestScore;
}

function createPlaneSample(
  record: RenderableEntityRecord,
  bodyId: BodyId | null,
): PlaneSample[] {
  if (
    record.geometry.kind !== "mesh" ||
    record.binding.semanticClass !== "planarFace"
  ) {
    return [];
  }

  const bounds = boundsFromRenderable(record);
  if (!bounds) {
    return [];
  }

  const normal = findMeshNormal(
    record.geometry.vertexPositions,
    record.geometry.triangleIndices,
  );
  if (!normal) {
    return [];
  }

  const point = record.geometry.vertexPositions[0];
  if (!point) {
    return [];
  }

  return [
    {
      bodyId,
      normal,
      point,
      bounds,
      projectedBounds: projectBounds(bounds, normal),
    },
  ];
}

function boundsFromRenderable(record: RenderableEntityRecord): Bounds3 | null {
  if (
    record.geometry.kind !== "mesh" ||
    record.geometry.vertexPositions.length === 0
  ) {
    return null;
  }

  return boundsFromPoints(record.geometry.vertexPositions);
}

function boundsFromPoints(points: readonly RenderPoint3D[]): Bounds3 {
  const first = points[0]!;
  const bounds: Bounds3 = {
    min: [first[0], first[1], first[2]],
    max: [first[0], first[1], first[2]],
  };

  for (const point of points.slice(1)) {
    for (const axis of [0, 1, 2] as const) {
      bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
    }
  }

  return bounds;
}

function axisOverlaps(left: Bounds3, right: Bounds3): [number, number, number] {
  return [
    Math.min(left.max[0], right.max[0]) - Math.max(left.min[0], right.min[0]),
    Math.min(left.max[1], right.max[1]) - Math.max(left.min[1], right.min[1]),
    Math.min(left.max[2], right.max[2]) - Math.max(left.min[2], right.min[2]),
  ];
}

function bounds2Overlap(left: Bounds2, right: Bounds2) {
  const width =
    Math.min(left.max[0], right.max[0]) - Math.max(left.min[0], right.min[0]);
  const height =
    Math.min(left.max[1], right.max[1]) - Math.max(left.min[1], right.min[1]);
  return width > 0 && height > 0 ? width * height : 0;
}

function projectBounds(
  bounds: Bounds3,
  normal: [number, number, number],
): Bounds2 {
  const dominantAxis = dominantNormalAxis(normal);
  if (dominantAxis === 0) {
    return {
      min: [bounds.min[1], bounds.min[2]],
      max: [bounds.max[1], bounds.max[2]],
    };
  }
  if (dominantAxis === 1) {
    return {
      min: [bounds.min[0], bounds.min[2]],
      max: [bounds.max[0], bounds.max[2]],
    };
  }
  return {
    min: [bounds.min[0], bounds.min[1]],
    max: [bounds.max[0], bounds.max[1]],
  };
}

function dominantNormalAxis(normal: [number, number, number]) {
  const absolute = normal.map((value) => Math.abs(value)) as [
    number,
    number,
    number,
  ];
  if (absolute[0] >= absolute[1] && absolute[0] >= absolute[2]) {
    return 0;
  }
  return absolute[1] >= absolute[2] ? 1 : 2;
}

function findMeshNormal(
  points: readonly RenderPoint3D[],
  triangles: readonly (readonly [number, number, number])[],
) {
  for (const [aIndex, bIndex, cIndex] of triangles) {
    const a = points[aIndex];
    const b = points[bIndex];
    const c = points[cIndex];
    if (!a || !b || !c) {
      continue;
    }

    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    if (normal) {
      return normal;
    }
  }

  return null;
}

function selectBestCandidate(
  candidates: readonly CandidateScore[],
  tolerance: number,
): BodyId | "ambiguous" | null {
  if (candidates.length === 0) {
    return null;
  }

  const ranked = [...candidates].sort(
    (left, right) =>
      right.score - left.score || left.bodyId.localeCompare(right.bodyId),
  );
  const best = ranked[0]!;
  const second = ranked[1];
  if (
    second &&
    Math.abs(best.score - second.score) <=
      Math.max(tolerance, Math.abs(best.score) * 1e-6)
  ) {
    return "ambiguous";
  }

  return best.bodyId;
}

function subtract(
  left: RenderPoint3D,
  right: RenderPoint3D,
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: [number, number, number], right: [number, number, number]) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize(
  vector: [number, number, number],
): [number, number, number] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > 0
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : null;
}

function distanceToPlane(
  point: RenderPoint3D,
  planePoint: RenderPoint3D,
  planeNormal: [number, number, number],
) {
  return dot(subtract(point, planePoint), planeNormal);
}
