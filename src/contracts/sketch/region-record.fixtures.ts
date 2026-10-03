/**
 * Spec support for region *consumers* that feed a known boundary directly
 * (OCC profiles, export, display, import). Records are shaped exactly as the
 * arrangement owner publishes them: declared-join corners keyed by their
 * point ids, forward line traversals over [0, 1], closed circles with no
 * vertices. Owner behaviour itself is covered by `region-extraction.spec.ts`.
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { declaredJoinVertexKey } from "@/contracts/sketch/region-identity";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type { SketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import type { SketchArrangementInput } from "@/contracts/sketch/region-extraction";
import type {
  RegionBoundarySegmentRecord,
  RegionBoundaryVertex,
  RegionRecord,
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

/**
 * A committed sketch snapshot row holding arrangement-derived `regions`
 * together with the pair they were derived from (`input`), as the kernel
 * adapter commits it: the record consumers (measure, export) resolve.
 */
export function sketchSnapshotRecordForTest(
  input: SketchArrangementInput,
  regions: RegionRecord[],
  plane: SketchPlaneDefinition,
): SketchSnapshotRecord {
  const ownership = {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: null,
    ownerSketchId: input.sketchId,
    ownerBodyId: null,
  };
  return {
    ...ownership,
    sketchId: input.sketchId,
    label: "Sketch",
    plane,
    sketch: {
      ...ownership,
      sketchId: input.sketchId,
      label: "Sketch",
      planeSupport: plane.support,
      definition: input.definition,
      solvedSnapshot: input.solvedSnapshot,
      derivedValidity: { state: "current", diagnostics: [] },
      projectedReferences: [...input.projectedReferences],
      regions,
    },
  } as SketchSnapshotRecord;
}

/** Consumer fixture geometry (T10e): closed-form areas and lengths. */
export const ROUNDED_RECTANGLE_FOR_TEST = { w: 10, h: 6, r: 1.5 } as const;

/** A 10 × 6 rectangle with r = 1.5 corner arcs (lines + quarter arcs). */
export function addRoundedRectangleForTest(sketch: SketchFixture) {
  const { w, h, r } = ROUNDED_RECTANGLE_FOR_TEST;
  const at: [string, number, number][] = [
    ["a", r, 0],
    ["b", w - r, 0],
    ["c", w, r],
    ["d", w, h - r],
    ["e", w - r, h],
    ["f", r, h],
    ["g", 0, h - r],
    ["h", 0, r],
    ["k1", w - r, r],
    ["k2", w - r, h - r],
    ["k3", r, h - r],
    ["k4", r, r],
  ];
  at.forEach(([name, x, y]) => sketch.point(name, x, y));
  sketch.line("l1", "a", "b");
  sketch.arc("a1", "k1", "b", "c");
  sketch.line("l2", "c", "d");
  sketch.arc("a2", "k2", "d", "e");
  sketch.line("l3", "e", "f");
  sketch.arc("a3", "k3", "f", "g");
  sketch.line("l4", "g", "h");
  sketch.arc("a4", "k4", "h", "a");
}

/** An open 3-point spline arch from (0, 0) to (6, 0) closed by a line. */
export function addSplineLobeForTest(sketch: SketchFixture) {
  sketch.point("A", 0, 0);
  sketch.point("M", 2, 4);
  sketch.point("B", 6, 0);
  sketch.spline("arch", ["A", "M", "B"], "open");
  sketch.line("chord", "B", "A");
}

/** Concentric circles R = 5 and r = 2 about (1, −1): one annulus region. */
export function addCircleAnnulusForTest(sketch: SketchFixture) {
  sketch.point("o", 1, -1);
  sketch.circle("outer", "o", 5);
  sketch.circle("hole", "o", 2);
}
