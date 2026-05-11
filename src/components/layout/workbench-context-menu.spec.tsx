import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
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

  expectTrue(
    markup.includes('aria-haspopup="menu"'),
    "Wrapped target should expose a menu popup affordance.",
  );
  expectTrue(
    markup.includes('aria-label="Body actions"'),
    "Menu dropdown should expose the provided accessible label.",
  );
  expectTrue(
    markup.includes("Rename"),
    "Menu should render rename item labels.",
  );
  expectTrue(
    markup.includes("Delete"),
    "Menu should render regular or danger item labels.",
  );
  expectTrue(
    markup.includes("Export"),
    "Menu should render disabled item labels.",
  );
  expectTrue(
    markup.includes("Ctrl+Z"),
    "Menu should render right-aligned shortcut hints for command entries.",
  );
  expectTrue(
    markup.includes("disabled"),
    "Disabled menu items should render as disabled controls.",
  );

  const source = await Bun.file(
    new URL("./workbench-context-menu.tsx", import.meta.url),
  ).text();
  expectTrue(
    source.includes("onPointerDown: handlePointerDown") &&
      source.includes("event.button !== 2"),
    "Context menus should support right-button pointer opening in addition to contextmenu events.",
  );
  expectTrue(
    source.includes("transitionProps={{ duration: 0 }}"),
    "Context menus should open without transition delay for pointer-triggered placement.",
  );
  expectTrue(
    source.includes('floatingStrategy="fixed"'),
    "Context menus should position the Mantine dropdown with fixed strategy to match the fixed anchor trigger.",
  );
  expectTrue(
    source.includes("createPortal(") && source.includes("document.body"),
    "Context menu anchor targets should portal to the document body so dropdown positioning stays in the viewport coordinate space.",
  );
});
