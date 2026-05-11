import type { ToolActionBus } from "@/core/tools/tool-action-bus";
import { toolDefinitions, toolGroups } from "@/core/tools/tool-registry";

export function installConsoleLoggingSubscribers(actionBus: ToolActionBus) {
  const disposers = [
    ...Object.values(toolGroups).map((group) =>
      actionBus.subscribeToGroup(group.id, (event) => {
        console.log("tool-group-activated", event);
      }),
    ),
    ...toolDefinitions.map((tool) =>
      actionBus.subscribeToTool(tool.id, (event) => {
        console.log("tool-activated", event);
      }),
    ),
  ];

  return () => {
    disposers.forEach((dispose) => dispose());
  };
}
