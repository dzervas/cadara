/**
 * Spec support for region *consumers* that feed a known boundary directly
 * (OCC profiles, export, display, import). Records are shaped exactly as the
 * arrangement owner publishes them: declared-join corners keyed by their
 * point ids, forward line traversals over [0, 1], closed circles with no
 * vertices. Owner behaviour itself is covered by `region-extraction.spec.ts`.
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { declaredJoinVertexKey } from "@/contracts/sketch/region-identity";
import type {
  RegionBoundarySegmentRecord,
  RegionBoundaryVertex,
  SketchPoint2D,
} from "@/contracts/sketch/schema";

/** A corner declared by one authored point (a shared point id). */
export function declaredCornerForTest(
  pointId: SketchPointId,
  position: SketchPoint2D,
): RegionBoundaryVertex {
  return {
    kind: "declaredJoin",
    key: declaredJoinVertexKey([pointId]),
    pointIds: [pointId],
    portPointId: pointId,
    position,
    ballRadius: 0,
  };
}

/**
 * A closed polygon loop: `entityIds[i]` is the line authored from
 * `corners[i]` to `corners[i + 1]` (cyclically), traversed forward.
 */
export function lineLoopSegmentsForTest(
  corners: readonly { pointId: SketchPointId; position: SketchPoint2D }[],
  entityIds: readonly SketchEntityId[],
): RegionBoundarySegmentRecord[] {
  return entityIds.map((entityId, index) => {
    const start = corners[index]!;
    const end = corners[(index + 1) % corners.length]!;
    return {
      branch: { source: { kind: "entity", entityId }, spanId: "whole" },
      sourceParameterInterval: [0, 1],
      traversalDirection: "forward",
      start: declaredCornerForTest(start.pointId, start.position),
      end: declaredCornerForTest(end.pointId, end.position),
      sourceSegmentOrdinal: 0,
    };
  });
}

/** An unsplit full circle; outer loops run forward, holes in reverse. */
export function closedCircleSegmentForTest(
  entityId: SketchEntityId,
  traversalDirection: "forward" | "reverse" = "forward",
): RegionBoundarySegmentRecord {
  return {
    branch: { source: { kind: "entity", entityId }, spanId: "whole" },
    sourceParameterInterval: [0, 2 * Math.PI],
    traversalDirection,
    start: null,
    end: null,
    sourceSegmentOrdinal: 0,
  };
}
