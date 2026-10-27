import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";
import type { SketchDefinition, SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { clippedSolvedCubicSpanPoles } from "@/contracts/sketch/spline-geometry";
import { collectSketchSnapGeometries } from "@/core/sketch-snapping/snap-candidates";

/** Continue outward from a curve END using the same geometry the picker displays. */
export function getTangentArcSourceDirection(
  definition: SketchDefinition,
  entityId: SketchEntityId | null,
  point: SketchPoint,
  solvedSnapshot: SolvedSketchSnapshot | null,
): { direction: SketchPoint; center: SketchPoint | null } | null {
  if (!entityId) return null;
  const geometry = collectSketchSnapGeometries({ definition, projectedReferences: [], solvedSnapshot }).find(
    g => g.source.kind === "localEntity" && g.source.entityId === entityId,
  );
  const near = (p: SketchPoint) => Math.hypot(p[0] - point[0], p[1] - point[1]) <= 1e-6;
  let direction: SketchPoint | null = null;
  if (geometry?.kind === "lineSegment") {
    if (near(geometry.end)) direction = [geometry.end[0] - geometry.start[0], geometry.end[1] - geometry.start[1]];
    else if (near(geometry.start)) direction = [geometry.start[0] - geometry.end[0], geometry.start[1] - geometry.end[1]];
  } else if (geometry?.kind === "arc" && (near(geometry.start) || near(geometry.end))) {
    const sign = (geometry.sweepDirection === "counterClockwise" ? 1 : -1) * (near(geometry.end) ? 1 : -1);
    direction = [-(point[1] - geometry.center[1]) * sign, (point[0] - geometry.center[0]) * sign];
  } else if (geometry?.kind === "spline" && !geometry.isClosed) {
    const first = geometry.spans[0], last = geometry.spans.at(-1);
    const start = first && clippedSolvedCubicSpanPoles(first);
    const end = last && clippedSolvedCubicSpanPoles(last);
    if (end && near(end[3])) direction = [end[3][0] - end[2][0], end[3][1] - end[2][1]];
    else if (start && near(start[0])) direction = [start[0][0] - start[1][0], start[0][1] - start[1][1]];
  }
  if (!direction) return null;
  const length = Math.hypot(...direction);
  return length > 1e-10 ? { direction: [direction[0] / length, direction[1] / length], center: geometry?.kind === "arc" ? geometry.center : null } : null;
}
