import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchConstraintDisplayTargetState } from "@/domain/editor/sketch-session";

export type ViewportRenderableOrigin = "document" | "preview";

export interface ViewportRenderableRecord {
  origin: ViewportRenderableOrigin;
  renderable: RenderableEntityRecord;
  sketchConstraintDisplay?: SketchConstraintDisplayTargetState;
  /** Other-sketch context while editing; never changes picking or persisted state. */
  isInactiveSketch?: boolean;
  /**
   * A committed sketch curve or point that is not current geometry, drawn
   * with the danger tint when `invalid` (it stays pickable):
   * - [TECH] G19 (T08b-g5c): a non-accepted offset output (its relationship
   *   failed or is not certified) is `invalid`;
   * - T17d2: every curve and point of a sketch whose derived validity is not
   *   current takes that state (its held geometry is drawn). `stale` keeps
   *   the normal colour, as a stale output does in sketch mode (U-A).
   */
  sketchGeometryValidity?: "invalid" | "stale";
}
