import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 960 } });

test("records a custom shortcut and applies it from the settings modal", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(modal).toBeVisible();

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
