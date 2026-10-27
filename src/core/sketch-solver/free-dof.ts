import { solveDraggedPointFrameWithRebuild } from "./drag-candidates";
import { findComponentForPoint } from "./drag-target-frame";
import { getPoint, length, subtract } from "./solver-geometry";
import type { SketchCompiledSolveSession } from "./system-types";
import type { SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

// D6 (minimum-motion-sketch-drag): decide constrained-movement feedback from the
// grabbed target's available degrees of freedom, not from cursor reachability.
// The dragged point has a free DOF iff it can be moved in SOME direction while
// the hard constraints stay satisfied. We probe the four axis directions with
// tiny throwaway drag frames (no session mutation): in 2D any non-degenerate DOF
// line has a component along +x or +y, so an axis probe that moves the point
// proves mobility. A fully constrained target moves in none of them.
export const DRAG_DOF_PROBE_DISTANCE = 1e-2;

export const DRAG_DOF_PROBE_MOVE_FRACTION = 0.25;

export function sketchDraggedPointHasFreeDof(
  session: SketchCompiledSolveSession,
  pointId: SketchPointId,
): boolean {
  if (session.disposed) {
    return false;
  }
  const record = session.program.system.pointRecords.get(pointId);
  if (!record) {
    return false;
  }
  const component = findComponentForPoint(session.program, pointId);
  const current = getPoint(
    session.program.system.parameterProjection.projectValues(session.values),
    record,
  );
  const probe = DRAG_DOF_PROBE_DISTANCE;
  const moveThreshold = probe * DRAG_DOF_PROBE_MOVE_FRACTION;
  const directions: readonly SketchPoint2D[] = [
    [probe, 0],
    [-probe, 0],
    [0, probe],
    [0, -probe],
  ];
  for (const direction of directions) {
    // [TECH] G16‴: each probe frame is a solve from the session's values.
    const frame = solveDraggedPointFrameWithRebuild({
      session,
      component,
      dragTarget: {
        kind: "sketchPoint",
        pointId,
        position: [current[0] + direction[0], current[1] + direction[1]],
      },
    });
    if (!frame || !frame.accepted) {
      continue;
    }
    if (
      length(
        subtract(
          getPoint(
            session.program.system.parameterProjection.projectValues(
              frame.values,
            ),
            record,
          ),
          current,
        ),
      ) > moveThreshold
    ) {
      return true;
    }
  }
  return false;
}
