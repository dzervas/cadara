import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { getPartsObjectMenuEntries } from "@/components/layout/parts-object-menu.helpers";
import { WorkbenchContextMenu } from "@/components/layout/workbench-context-menu";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import { createShortcutCommandRegistry } from "@/core/shortcuts/commands";
import { createEffectiveKeymap } from "@/core/shortcuts/keymap";
import { ShortcutContext } from "@/hooks/shortcut-context";
import { workbenchTheme } from "@/theme/workbench-theme";

function renderBodyMenu(appearance: BodyAppearance | null) {
  const registry = createShortcutCommandRegistry([]);
  const effectiveKeymap = createEffectiveKeymap(registry);
  const items = getPartsObjectMenuEntries({
    canChangeSketchPlane: false,
    label: "Extrude 2",
    onObjectDelete: () => undefined,
    onObjectExport: () => undefined,
    onRenameTarget: () => undefined,
    target: { kind: "body", bodyId: "body_feature_extrude-2" },
    ...(appearance
      ? {
          bodyColor: {
            appearance,
            onChoosePaletteSlot: () => undefined,
            onOpenCustomColor: () => undefined,
          },
        }
      : {}),
  });

  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ShortcutContext.Provider
        value={{
          pointingDevice: "mouse" as const,
          setPointingDevice: () => undefined,
          activeScopes: ["global"],
          commands: [],
          effectiveKeymap,
          getPrimaryShortcut: () => null,
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
          label="Extrude 2 actions"
          withinPortal={false}
        >
          <button type="button">Extrude 2</button>
        </WorkbenchContextMenu>
      </ShortcutContext.Provider>
    </MantineProvider>,
  );
}

function swatches(markup: string) {
  return [
    ...markup.matchAll(
      /role="menuitemradio" aria-checked="(true|false)" aria-label="([^"]+)"/g,
    ),
  ].map(([, checked, name]) => `${name}${checked === "true" ? "*" : ""}`);
}

test("cadara-01k: a body's context menu leads with the six palette swatches (its slot checked) and Custom color…, above the regular actions", () => {
  const markup = renderBodyMenu({ kind: "palette", slot: 1 });

  expect(swatches(markup)).toEqual([
    "Natural",
    "Berry*",
    "Jade",
    "Violet",
    "Coral",
    "Aqua",
  ]);
  const order = ['aria-label="Body color"', "Custom color…", "Rename", "Delete", "Export"].map(
    (text) => markup.indexOf(text),
  );
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("cadara-01k: a custom colour checks Custom color… and shows its colour instead of the rainbow; no swatch is checked", () => {
  const markup = renderBodyMenu({ kind: "custom", hex: "#2f6f8f" });

  expect(swatches(markup).some((name) => name.endsWith("*"))).toBe(false);
  expect(markup).toMatch(/aria-checked="true"[^>]*>[\s\S]*?background:#2f6f8f/);
  expect(markup).not.toContain("--workbench-color-custom-swatch");
});

test("cadara-01k: rows without a body colour (sketches, planes) have no colour section", () => {
  const markup = renderBodyMenu(null);

  expect(markup).not.toContain('aria-label="Body color"');
  expect(markup).not.toContain("Custom color…");
  expect(markup).toContain("Rename");
});
