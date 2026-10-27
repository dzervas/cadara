import { setSketchSnapScale } from "./drawing-commit";
import type { SketchSessionState } from "./types";

/**
 * Test-only seam (T13f, plan review R-6): snapping needs a measured screen
 * scale (T13-D13), which only the viewport supplies. Specs whose draws rely
 * on snapping set one explicitly; specs that place freely at exact
 * coordinates set none.
 */

/**
 * The scale specs use: the 12 px point radius covers 0.18 sketch units, the
 * fixed point tolerance before T13f (curves 0.15, alignments 0.12).
 */
export const SPEC_SKETCH_UNITS_PER_PIXEL = 0.015;

export function withSketchSnapScale<Session extends SketchSessionState>(
  session: Session,
  sketchUnitsPerPixel: number,
): Session {
  return setSketchSnapScale(session, sketchUnitsPerPixel) as Session;
}
