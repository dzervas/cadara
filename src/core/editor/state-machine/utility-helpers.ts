import type { ToolId } from "@/core/tools/tool-registry";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchPlaneSupportRef } from "@/contracts/shared/sketch-plane";
import type { CommandSessionId, RequestId } from "@/contracts/shared/ids";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import type {
  EditorCommandToolId,
  EditorState,
  SketchEditorState,
} from "./types";

export function nextCommandSessionId(
  state: EditorState,
  toolId: EditorCommandToolId,
) {
  return `command_${toolId}-${state.nextCommandSequence}` as CommandSessionId;
}

/**
 * T17h: a constraint or dimension commit disarms its tool (the session's
 * `activeTool` becomes null); the command follows, so the toolbar shows
 * Select again, as after Escape (it kept the disarmed tool pressed). A
 * T16f routed edit (Dimension or Fix on a mirror copy opening the shared
 * driver) also leaves no active tool while its popup is open, but re-arms
 * the tool at every end, so the command keeps the tool (review R-1).
 */
export function commandAfterSketchToolCommit(
  state: SketchEditorState,
  session: SketchSessionState,
  command: SketchEditorState["command"] = state.command,
): SketchEditorState["command"] {
  return state.session.activeTool !== null &&
    session.activeTool === null &&
    !session.activeAnnotationEdit?.shared
    ? { ...command, toolId: "sketch", phase: "editing" }
    : command;
}

export function nextRequestId(state: EditorState, scope: string) {
  return `request_${scope}-${state.nextRequestSequence}` as RequestId;
}

export function deriveSketchPointFromWorld(
  _plane: SketchSessionState["plane"],
  point: readonly [number, number],
) {
  return point;
}

export function assertSketchPlaneSupport(
  target: PrimitiveRef,
): SketchPlaneSupportRef {
  if (target.kind === "construction" || target.kind === "face") {
    return target;
  }

  throw new Error(
    "Sketch commits require a construction plane or planar face target.",
  );
}

export function isFeatureTool(
  toolId: EditorCommandToolId,
): toolId is Extract<
  ToolId,
  | "extrude"
  | "revolve"
  | "fillet"
  | "shell"
  | "plane"
  | "sweep"
  | "loft"
  | "chamfer"
  | "hole"
  | "thicken"
  | "combine"
  | "split"
  | "deleteSolid"
  | "mirror"
  | "transform"
  | "linearPattern"
  | "circularPattern"
> {
  return (
    toolId === "extrude" ||
    toolId === "revolve" ||
    toolId === "fillet" ||
    toolId === "shell" ||
    toolId === "plane" ||
    toolId === "sweep" ||
    toolId === "loft" ||
    toolId === "chamfer" ||
    toolId === "hole" ||
    toolId === "thicken" ||
    toolId === "combine" ||
    toolId === "split" ||
      toolId === "deleteSolid" ||
      toolId === "mirror" ||
      toolId === "transform" ||
      toolId === "linearPattern" ||
      toolId === "circularPattern"
  );
}

export function isPassiveSketchTool(
  toolId: ToolId,
): toolId is Extract<ToolId, "fill" | "stroke"> {
  return toolId === "fill" || toolId === "stroke";
}
