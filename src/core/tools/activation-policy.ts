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

/**
 * A part-mode tool activated during a sketch would leave sketch mode and drop
 * the private draft (O23). Only Finish Sketch may end a sketch.
 */
export function toolLeavesSketch(toolId: ToolId) {
  return resolveToolActivationMode(toolId, "sketch") === "part";
}

/** Tools that only inspect the model stay usable in a read-only project. */
const INSPECTION_TOOL_IDS: ReadonlySet<ToolId> = new Set<ToolId>([
  "measure",
  "sectionView",
]);

/** Whether a tool can change the document (and so needs write permission). */
export function toolAuthorsDocument(toolId: ToolId) {
  return !INSPECTION_TOOL_IDS.has(toolId);
}
