import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchConstraintDisplayTargetState } from "@/domain/editor/sketch-session";

export type ViewportRenderableOrigin = "document" | "preview";

export interface ViewportRenderableRecord {
  origin: ViewportRenderableOrigin;
  renderable: RenderableEntityRecord;
  sketchConstraintDisplay?: SketchConstraintDisplayTargetState;
}
