import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchConstraintDisplayTargetState } from "@/domain/editor/sketch-session";

export type ViewportRenderableOrigin = "document" | "preview";

export interface ViewportRenderableRecord {
  origin: ViewportRenderableOrigin;
  renderable: RenderableEntityRecord;
  sketchConstraintDisplay?: SketchConstraintDisplayTargetState;
  /**
   * [TECH] G19 (T08b-g5c): a committed sketch curve that is a non-accepted
   * offset output (its relationship failed or is not certified). Part mode
   * draws it with the danger tint; it stays pickable.
   */
  offsetOutputValidity?: "invalid";
}
