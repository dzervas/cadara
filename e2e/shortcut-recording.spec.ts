import { expect, test } from "@playwright/test";
import { openShortcutSettings } from "./helpers/shortcut-settings";

test.use({ viewport: { width: 1440, height: 960 } });

test("records a custom shortcut and applies it from the settings modal", async ({
  page,
}) => {
  await page.goto("/app");

  const modal = await openShortcutSettings(page);

  const focusSearchRow = modal.locator(
    '[data-shortcut-command="editor.focusSearch"]',
  );
  await expect(
    focusSearchRow.locator('[data-shortcut-current="editor.focusSearch"]'),
  ).toContainText("Ctrl+K");

  await focusSearchRow.getByRole("button", { name: "Record" }).click();
  await expect(
    focusSearchRow.locator('[data-shortcut-current="editor.focusSearch"]'),
  ).toContainText("Recording");

  await page.keyboard.press("Q");
  await expect(
    focusSearchRow.locator('[data-shortcut-current="editor.focusSearch"]'),
  ).toContainText("Q");

  await focusSearchRow.getByRole("button", { name: "Save" }).click();
  await expect(
    focusSearchRow.locator('[data-shortcut-current="editor.focusSearch"]'),
  ).toContainText("Q");

  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();

  await page.keyboard.press("Q");
  await expect(page.getByPlaceholder("Search tools")).toBeFocused();
});

test("settings Escape close does not wait for animation frames", async ({
  page,
}) => {
  const start = new Date("2026-10-21T12:00:00Z");
  await page.clock.install({ time: start });
  await page.goto("/app");
  const modal = await openShortcutSettings(page);

  // Model a busy browser that cannot deliver Mantine's exit-animation frames.
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});
