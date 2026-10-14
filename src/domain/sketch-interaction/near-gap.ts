import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { declaredJoinClasses } from "@/contracts/sketch/region-extraction";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import { getSketchMergePointRefusal } from "@/domain/sketch-editing/merge-points";
import { SKETCH_POINT_RADII_PX } from "@/domain/sketch-interaction/screen-radii";

export interface SketchScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * One open end of a near gap: its point, its one curve, which end of that
 * curve it is, and its screen position.
 */
export interface SketchNearGapEnd {
  readonly pointId: SketchPointId;
  readonly entityId: SketchEntityId;
  readonly role: "start" | "end";
  readonly screen: SketchScreenPoint;
}

export interface SketchNearGap {
  readonly a: SketchNearGapEnd;
  readonly b: SketchNearGapEnd;
  readonly distancePx: number;
}

/**
 * The [start, end] point ids of one curve (none for closed or end-less
 * kinds).
 */
export function curveEndPointIds(
  entity: SketchEntityDefinition,
): SketchPointId[] {
  switch (entity.kind) {
    case "lineSegment":
    case "arc":
    case "ellipticalArc":
    case "conic":
      return [entity.startPointId, entity.endPointId];
    case "bezierCurve":
      return [entity.controlPointIds[0]!, entity.controlPointIds.at(-1)!];
    case "spline": {
      if (entity.closure !== "open") return [];
      const occurrences = orderedSplineOccurrences(entity) ?? [];
      return occurrences.length < 2
        ? []
        : [occurrences[0]!.pointId, occurrences.at(-1)!.pointId];
    }
    default:
      return [];
  }
}

/**
 * T13k (D26): pairs of open ends that look joined on screen but are not.
 * An open end is a point used as a curve end by exactly one non-construction
 * curve; Point-tool points and points Merge Points refuses (driven, reference
 * image, centre or control roles) are not. Reference and projected points
 * are not local points, so they never appear. A pair is reported when its
 * ends lie on different curves, are not in one declared join class of the
 * topology owner (`declaredJoinClasses` on `solved`: satisfied `coincident`,
 * and satisfied `coincidentProjectedPoint` to one projected point or the
 * origin; review R1), and are within `thresholdPx` on screen (0 included).
 * Without a solve (`solved` null) joined-ness is unknown and nothing is
 * reported. `displayGeometry` holds
 * each point's displayed position (sketch-plane or world, whatever
 * `projectToScreen` takes). Passive: it reads
 * geometry and never changes it. O(ends²) per call.
 */
export function findNearGapEndpoints<TPosition = SketchPoint2D>(
  definition: SketchDefinition,
  solved: SolvedSketchSnapshot | null,
  displayGeometry: ReadonlyMap<SketchPointId, TPosition>,
  projectToScreen: (position: TPosition) => SketchScreenPoint | null,
  thresholdPx: number = SKETCH_POINT_RADII_PX.enter,
): SketchNearGap[] {
  if (!solved) return [];
  const curvesByEnd = new Map<
    SketchPointId,
    { entityId: SketchEntityId; role: "start" | "end" }[]
  >();
  const pointToolPointIds = new Set<SketchPointId>();
  for (const entity of definition.entities) {
    if (entity.kind === "point") pointToolPointIds.add(entity.pointId);
    if (entity.isConstruction) continue;
    for (const [index, pointId] of curveEndPointIds(entity).entries()) {
      const curves = curvesByEnd.get(pointId) ?? [];
      curves.push({
        entityId: entity.entityId,
        role: index === 0 ? "start" : "end",
      });
      curvesByEnd.set(pointId, curves);
    }
  }

  const classes = declaredJoinClasses(definition, solved);

  const ends: SketchNearGapEnd[] = [];
  for (const [pointId, curves] of curvesByEnd) {
    if (curves.length !== 1 || pointToolPointIds.has(pointId)) continue;
    if (getSketchMergePointRefusal(definition, pointId) !== null) continue;
    const position = displayGeometry.get(pointId);
    const screen = position ? projectToScreen(position) : null;
    if (screen) ends.push({ pointId, ...curves[0]!, screen });
  }

  const gaps: SketchNearGap[] = [];
  for (let i = 0; i < ends.length; i += 1) {
    const a = ends[i]!;
    for (let j = i + 1; j < ends.length; j += 1) {
      const b = ends[j]!;
      if (
        a.entityId === b.entityId ||
        classes.find(a.pointId) === classes.find(b.pointId)
      )
        continue;
      const distancePx = Math.hypot(
        a.screen.x - b.screen.x,
        a.screen.y - b.screen.y,
      );
      if (distancePx <= thresholdPx) gaps.push({ a, b, distancePx });
    }
  }
  return gaps;
}

/** The nearest near gap at `pointId`, oriented so `end` is that point's end. */
export function findSketchNearGapAt(
  gaps: readonly SketchNearGap[],
  pointId: SketchPointId,
): { end: SketchNearGapEnd; partner: SketchNearGapEnd } | null {
  let best: { end: SketchNearGapEnd; partner: SketchNearGapEnd } | null = null;
  let bestDistance = Infinity;
  for (const gap of gaps) {
    const oriented =
      gap.a.pointId === pointId
        ? { end: gap.a, partner: gap.b }
        : gap.b.pointId === pointId
          ? { end: gap.b, partner: gap.a }
          : null;
    if (oriented && gap.distancePx < bestDistance) {
      best = oriented;
      bestDistance = gap.distancePx;
    }
  }
  return best;
}

/**
 * The near-gap basis of a session (review R1): its authored definition and
 * the accepted live solve of exactly that definition, or null when there is
 * none (the sketch is not solved, so joined-ness is unknown; its failure
 * feedback is already shown) and no near gap is reported. The same rule as
 * `hasAcceptedLiveSolveOfDefinition`, over just the two fields it reads, so
 * the viewport can memoise on them.
 */
export function getSketchNearGapBasis(
  session: Pick<SketchSessionState, "definition" | "liveSolve">,
): {
  definition: SketchDefinition;
  solved: SolvedSketchSnapshot;
} | null {
  return session.liveSolve?.accepted &&
    session.liveSolve.sourceDefinition === session.definition
    ? {
        definition: session.definition,
        solved: session.liveSolve.solvedSnapshot,
      }
    : null;
}
