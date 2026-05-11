import { getToolById, type ToolId } from "@/core/tools/tool-registry";
import type { ToolCommandBehavior, ToolbarMode } from "@/core/tools/schema";

export function getToolCommandBehavior(
  toolId: ToolId,
): ToolCommandBehavior | null {
  const tool = getToolById(toolId);

  return "commandBehavior" in tool ? (tool.commandBehavior ?? null) : null;
}

export function resolveToolActivationMode(
  toolId: ToolId,
  currentMode: ToolbarMode,
): ToolbarMode {
  const tool = getToolById(toolId);
  const activationMode =
    "activationMode" in tool ? tool.activationMode : undefined;

  if (activationMode === "part" || activationMode === "sketch") {
    return activationMode;
  }

  if (activationMode === "preserve") {
    return currentMode;
  }

  if (tool.modes.length === 1) {
    return tool.modes[0]!;
  }

  return currentMode;
}
