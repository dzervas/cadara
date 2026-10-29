import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import type {
  SketchSessionState,
  SketchSessionDisplayRenderable,
} from "@/core/editor/sketch-session/types";

/**
 * The committed renderables an open sketch session does not replace: the
 * session draws its own sketch's curves, points and regions (its display
 * renderables), so the committed copies of that sketch are dropped. A new
 * sketch (no id yet) replaces nothing.
 */
export function withoutActiveSketchRenderables<
  T extends RenderableEntityRecord | ViewportRenderableRecord,
>(documentRenderables: T[], activeSketchId: SketchSessionState["sketchId"]) {
  return activeSketchId
    ? documentRenderables.filter(
        (entry) => !isActiveSketchRenderable(entry, activeSketchId),
      )
    : documentRenderables;
}

export type MergedSketchRenderables = {
  documentRenderables: Array<RenderableEntityRecord | ViewportRenderableRecord>;
  sketchDisplayRenderables: SketchSessionDisplayRenderable[];
};

function isActiveSketchRenderable(
  entry: RenderableEntityRecord | ViewportRenderableRecord,
  sketchId: NonNullable<SketchSessionState["sketchId"]>,
) {
  const renderable = "renderable" in entry ? entry.renderable : entry;
  const target = renderable.binding.target;

  return (
    (target.kind === "region" && target.sketchId === sketchId) ||
    (target.kind === "sketchEntity" && target.sketchId === sketchId) ||
    (target.kind === "sketchPoint" && target.sketchId === sketchId)
  );
}
