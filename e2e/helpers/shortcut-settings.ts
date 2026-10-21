import { expect, type Page } from "@playwright/test";

export async function openShortcutSettings(page: Page) {
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(modal).toBeVisible();
  await expect(modal.locator(":focus")).toBeFocused();
  return modal;
}
