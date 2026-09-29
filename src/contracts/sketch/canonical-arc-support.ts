import type { SketchPoint2D } from "@/contracts/sketch/schema";

/**
 * The one support formula of a point-defined arc (T08b-e [TECH E7]): centre,
 * start and end points verbatim and radius = `Math.hypot(start − centre)`,
 * the solver's driven-arc projection `length(subtract(start, center))`
 * (`solver-core.ts`) and region input's `arcDraft`. The offset-chain
 * resolver builds its joint arcs with it; the tube certifier never trusts it
 * and certifies the arc with the radius it is given.
 */
export interface CanonicalArcSupport {
  readonly center: SketchPoint2D;
  readonly start: SketchPoint2D;
  readonly end: SketchPoint2D;
  readonly radius: number;
  readonly sweepDirection: "clockwise" | "counterClockwise";
}

export function canonicalArcSupport(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: CanonicalArcSupport["sweepDirection"],
): CanonicalArcSupport {
  return {
    center,
    start,
    end,
    radius: Math.hypot(start[0] - center[0], start[1] - center[1]),
    sweepDirection,
  };
}
