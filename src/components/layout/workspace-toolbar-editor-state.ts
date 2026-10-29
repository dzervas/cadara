import {
  getActiveSketchStyleToolId,
  isSketchConstructionSelected,
  isSketchSvgRenderingEnabled,
} from "@/core/editor/sketch-session";
import type { EditorContextValue } from "@/hooks/editor-context";

/**
 * The editor state the workspace toolbar renders from: the command and a
 * sketch session only through what it shows, so a drag move selects an equal
 * slice.
 */
export function selectToolbarEditorState({ state }: EditorContextValue) {
  const { sketchSession } = state;
  return {
    // The command object is rebuilt on every sketch drag move; the toolbar
    // shows only which tool it runs.
    activeToolId: state.activeCommand?.toolId ?? null,
    activeEditSession: state.activeEditSession,
    activeSketchPlaneEditSession: state.activeSketchPlaneEditSession,
    activeImportSession: state.activeImportSession,
    canUndo: state.history.canUndo,
    canRedo: state.history.canRedo,
    mode: state.mode,
    hasActiveSketchSession: sketchSession !== null,
    activeSketchStyleToolId: sketchSession
      ? getActiveSketchStyleToolId(sketchSession)
      : null,
    svgRenderingEnabled: sketchSession
      ? isSketchSvgRenderingEnabled(sketchSession)
      : false,
    sketchConstructionSelected:
      sketchSession !== null && isSketchConstructionSelected(sketchSession),
  };
}
