import { test, expect } from "vitest";

import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
  getToolCommandId,
} from "@/core/shortcuts/commands";

test("src/core/shortcuts/commands.spec.ts", () => {
  const registry = createShortcutCommandRegistry();

  expect(
    registry.get(getToolCommandId("line"))?.label,
    "Tool commands should derive labels from tool definitions.",
  ).toBe("Line");
  expect(
    registry.get(getToolCommandId("line"))?.scope,
    "Tool commands should derive sketch scope from tool modes.",
  ).toBe("sketch");
  expect(
    registry.get("editor.cancel")?.defaultShortcuts.includes("escape"),
    "Non-tool editor commands should be declared independently from tools.",
  ).toBeTruthy();
  expect(
    getShortcutCommandDefinitions().some(
      (command) => command.id === "context.rename",
    ),
    "Context menu actions should be addressable as commands for shortcut reference coverage.",
  ).toBeTruthy();
});
