import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorkbenchContextMenu,
  type WorkbenchContextMenuEntry,
} from "@/components/layout/workbench-context-menu";
import { createShortcutCommandRegistry } from "@/core/shortcuts/commands";
import type { ShortcutCommandDefinition } from "@/core/shortcuts/commands";
import { createEffectiveKeymap } from "@/core/shortcuts/keymap";
import { ShortcutContext } from "@/hooks/shortcut-context";
import { workbenchTheme } from "@/theme/workbench-theme";

test("src/components/layout/workbench-context-menu.spec.tsx", async () => {
  const items: WorkbenchContextMenuEntry[] = [
    {
      kind: "item",
      id: "rename",
      label: "Rename",
      commandId: "editor.undo",
      onSelect: () => undefined,
    },
    {
      kind: "item",
      id: "delete",
      label: "Delete",
      danger: true,
      onSelect: () => undefined,
    },
    {
      kind: "divider",
      id: "divider",
    },
    {
      kind: "item",
      id: "export",
      label: "Export",
      disabled: true,
      onSelect: () => undefined,
    },
  ];

  const commands = [
    {
      id: "editor.undo",
      label: "Undo",
      category: "History",
      scope: "global",
      defaultShortcuts: ["mod+z"],
      customizable: true,
    },
  ] as const satisfies readonly ShortcutCommandDefinition[];
  const registry = createShortcutCommandRegistry(commands);
  const effectiveKeymap = createEffectiveKeymap(registry);
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ShortcutContext.Provider
        value={{
          activeScopes: ["global"],
          commands,
          effectiveKeymap,
          getPrimaryShortcut: (commandId) =>
            effectiveKeymap.get(commandId)?.[0] ?? null,
          registry,
          overrides: {},
          setCommandShortcuts: () => [],
          disableCommandShortcuts: () => undefined,
          resetCommandShortcuts: () => [],
          resetAllShortcuts: () => undefined,
          getConflictsForOverrides: () => [],
        }}
      >
        <WorkbenchContextMenu
          defaultOpened
          items={items}
          label="Body actions"
          withinPortal={false}
        >
          <button type="button">Part 1</button>
        </WorkbenchContextMenu>
      </ShortcutContext.Provider>
    </MantineProvider>,
  );

  expect(
    markup.includes('aria-haspopup="menu"'),
    "Wrapped target should expose a menu popup affordance.",
  ).toBeTruthy();
  expect(
    markup.includes('aria-label="Body actions"'),
    "Menu dropdown should expose the provided accessible label.",
  ).toBeTruthy();
  expect(
    markup.includes("Rename"),
    "Menu should render rename item labels.",
  ).toBeTruthy();
  expect(
    markup.includes("Delete"),
    "Menu should render regular or danger item labels.",
  ).toBeTruthy();
  expect(
    markup.includes("Export"),
    "Menu should render disabled item labels.",
  ).toBeTruthy();
  expect(
    markup.includes("Ctrl+Z"),
    "Menu should render right-aligned shortcut hints for command entries.",
  ).toBeTruthy();
  expect(
    markup.includes("disabled"),
    "Disabled menu items should render as disabled controls.",
  ).toBeTruthy();
});
