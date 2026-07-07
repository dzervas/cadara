/**
 * Shared interior-point region selection.
 *
 * A single seam used by both apply-time deferred-reference resolution
 * (`orchestrator.ts`) and review-time selector verification
 * (`onshape/extrude-planner.ts`). Keeping the containment math in one place is
 * load-bearing: the planner only marks a region consumer `parametric` after
 * verifying the same interior-point rule the orchestrator later applies against
 * committed geometry, so the two must never diverge.
 *
 * Selection rule mirrors the interactive picker: the innermost region whose
 * outer loop contains the point and whose inner (void) loops do not.
 */
import type { SketchPointId } from "@/contracts/shared/ids";
import type {
  RegionRecord,
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";

/**
 * Minimal solved-sketch projection the selection math needs. `regions` are the
 * derived regions; `solvedPoints` maps authored point ids to solved positions;
 * `definition` provides circle geometry for circle-only regions whose loops
 * carry no boundary polygon.
 */
export interface RegionSelectionSketch {
  regions: readonly RegionRecord[];
  solvedPoints: ReadonlyMap<SketchPointId, SketchPoint2D>;
  definition: Pick<SketchDefinition, "entities">;
}

function pointInPolygon(
  point: readonly [number, number],
  polygon: readonly (readonly [number, number])[],
) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]![0];
    const yi = polygon[i]![1];
    const xj = polygon[j]![0];
    const yj = polygon[j]![1];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function circleLoopContainsPoint(
  sketch: RegionSelectionSketch,
  loop: RegionRecord["loops"][number],
  point: readonly [number, number],
) {
  if (loop.segments.length !== 1) {
    return false;
  }
  const source = loop.segments[0]?.source;
  if (!source || source.kind !== "entity") {
    return false;
  }
  const entity = sketch.definition.entities.find(
    (candidate) => candidate.entityId === source.entityId,
  );
  if (!entity || entity.kind !== "circle") {
    return false;
  }
  const center = sketch.solvedPoints.get(entity.centerPointId);
  if (!center) {
    return false;
  }
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  return Math.hypot(dx, dy) < entity.radius;
}

function loopPolygon(
  sketch: RegionSelectionSketch,
  region: RegionRecord,
  loopRole: "outer" | "inner",
) {
  const loop = region.loops.find((candidate) => candidate.role === loopRole);
  if (!loop) {
    return [] as readonly (readonly [number, number])[];
  }
  return loop.boundaryPointIds.flatMap((pointId) => {
    const point = sketch.solvedPoints.get(pointId);
    return point ? [point] : [];
  });
}

function estimateRegionArea(sketch: RegionSelectionSketch, region: RegionRecord) {
  const polygon = loopPolygon(sketch, region, "outer");
  if (polygon.length < 3) {
    // Circle-only regions carry no boundary polygon; approximate from radius.
    const outerLoop = region.loops.find((loop) => loop.role === "outer");
    const segment = outerLoop?.segments[0]?.source;
    if (segment && segment.kind === "entity") {
      const entity = sketch.definition.entities.find(
        (candidate) => candidate.entityId === segment.entityId,
      );
      if (entity && entity.kind === "circle") {
        return Math.PI * entity.radius * entity.radius;
      }
    }
    return 0;
  }
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    area += polygon[j]![0] * polygon[i]![1] - polygon[i]![0] * polygon[j]![1];
  }
  return Math.abs(area) / 2;
}

function regionContainsPoint(
  sketch: RegionSelectionSketch,
  region: RegionRecord,
  point: readonly [number, number],
) {
  const outer = loopPolygon(sketch, region, "outer");
  const outerLoop = region.loops.find((loop) => loop.role === "outer");
  const outerContains =
    outer.length >= 3
      ? pointInPolygon(point, outer)
      : outerLoop
        ? circleLoopContainsPoint(sketch, outerLoop, point)
        : false;
  if (!outerContains) {
    return false;
  }
  return !region.loops
    .filter((loop) => loop.role === "inner")
    .some((loop) => {
      const polygon = loop.boundaryPointIds.flatMap((pointId) => {
        const solved = sketch.solvedPoints.get(pointId);
        return solved ? [solved] : [];
      });
      return polygon.length >= 3
        ? pointInPolygon(point, polygon)
        : circleLoopContainsPoint(sketch, loop, point);
    });
}

/**
 * Select the innermost (smallest-area) closed region whose outer loop contains
 * the point and whose voids do not. Returns null when no region qualifies.
 */
export function selectInnermostContainingRegion(
  sketch: RegionSelectionSketch,
  point: readonly [number, number],
): RegionRecord | null {
  return (
    sketch.regions
      .filter(
        (region) => region.isClosed && regionContainsPoint(sketch, region, point),
      )
      .sort(
        (left, right) =>
          estimateRegionArea(sketch, left) - estimateRegionArea(sketch, right),
      )[0] ?? null
  );
}

/**
 * Count how many closed regions contain the point. Used by review-time
 * verification to reject ambiguous selectors (a point that lands in zero or in
 * multiple non-nested regions cannot stand in for one profile).
 */
export function countContainingRegions(
  sketch: RegionSelectionSketch,
  point: readonly [number, number],
): number {
  return sketch.regions.filter(
    (region) => region.isClosed && regionContainsPoint(sketch, region, point),
  ).length;
}
