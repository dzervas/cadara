import type { EditorState } from "@/domain/editor/state-machine";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

export function isInitialOccRenderPending(
  machineState: Pick<EditorState, "snapshot">,
) {
  return machineState.snapshot === null;
}

export function hasNonEmptyCommittedGeometry(
  renderables: readonly ViewportRenderableRecord[],
) {
  return renderables.some(
    (entry) =>
      entry.origin === "document" &&
      entry.renderable.geometry.kind === "mesh" &&
      entry.renderable.geometry.triangleIndices.length > 0,
  );
}
