import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import type {
  SketchSessionState,
  SketchSessionDisplayRenderable,
} from "./sketch-session/types";
import { getSketchSessionDisplayRenderables } from "./sketch-session/display";
export function mergeSketchRenderables<
  T extends RenderableEntityRecord | ViewportRenderableRecord,
>(documentRenderables: T[], session: SketchSessionState | null) {
  if (!session) {
    return {
      documentRenderables,
      sketchDisplayRenderables: [],
    };
  }

  const activeSketchId = session.sketchId;
  const visibleDocumentRenderables = activeSketchId
    ? documentRenderables.filter(
        (entry) => !isActiveSketchRenderable(entry, activeSketchId),
      )
    : documentRenderables;

  return {
    documentRenderables: visibleDocumentRenderables,
    sketchDisplayRenderables: getSketchSessionDisplayRenderables(session),
  };
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
