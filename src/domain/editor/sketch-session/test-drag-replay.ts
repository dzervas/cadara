import { updateSketchGeometryDrag } from "./geometry-drag";
import type { SketchSessionState } from "./types";

// Preview budgets defer verdicts; the UI continues on the next pointer move.
export function updateSketchGeometryDragUntilSettled(
  session: SketchSessionState,
  point: Parameters<typeof updateSketchGeometryDrag>[1],
  options?: Parameters<typeof updateSketchGeometryDrag>[2],
): SketchSessionState {
  let updated = updateSketchGeometryDrag(session, point, options);
  for (let resumes = 0; updated.activeDrag?.pendingSolve && resumes < 16; resumes += 1)
    updated = updateSketchGeometryDrag(updated, point, options);
  if (updated.activeDrag?.pendingSolve)
    throw new Error("Sketch drag replay did not resolve its cursor goal within 16 resumes.");
  return updated;
}
