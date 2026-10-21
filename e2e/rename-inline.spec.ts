import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { openShortcutSettings } from "./helpers/shortcut-settings";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

test("parts menu renames a body inline with Enter and Undo restores its label", async ({
  page,
}) => {
  await new FeatureWorkbenchHarness(page).openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  const bodyTarget = FEATURE_FIXTURE.body;
  const row = page.locator(`[data-parts-tree-target="body:${bodyTarget}"]`);
  const labelButton = row.locator("button").first();
  const original = await labelButton.innerText();
  await labelButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = row.getByRole("textbox", { name: `Rename ${original}` });
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      input.evaluate(
        (element: HTMLInputElement) =>
          element.selectionStart === 0 &&
          element.selectionEnd === element.value.length,
      ),
    )
    .toBe(true);
  await page.keyboard.type("Mount plate");
  await input.press("Enter");
  await expect(labelButton).toHaveText("Mount plate", { timeout: 10_000 });
  const undo = page
    .locator('[data-history-actions="contextual"]')
    .getByRole("button", { name: "Undo Rename Body", exact: true });
  await expect(undo).toBeEnabled({ timeout: 10_000 });
  await undo.click();
  await expect(labelButton).toHaveText(original, { timeout: 10_000 });
});

test("configured context.rename opens the focused row and Escape cancels without changing history", async ({
  page,
}) => {
  await new FeatureWorkbenchHarness(page).openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  const bodyTarget = FEATURE_FIXTURE.body;
  const modal = await openShortcutSettings(page);
  const shortcutRow = modal.locator('[data-shortcut-command="context.rename"]');
  await shortcutRow
    .getByRole("button", { name: "Record", exact: true })
    .click();
  await page.keyboard.press("F2");
  await shortcutRow.getByRole("button", { name: "Save", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  const row = page.locator(`[data-parts-tree-target="body:${bodyTarget}"]`);
  const labelButton = row.locator("button").first();
  const original = await labelButton.innerText();
  const actions = page.locator('[data-history-actions="contextual"]');
  const before = await actions.allTextContents();
  await labelButton.focus();
  await labelButton.press("F2");
  const input = row.getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill("Discard this name");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  // Move focus away too: cancellation must not commit through blur.
  await page.getByPlaceholder("Search tools").focus();
  await expect(labelButton).toHaveText(original);
  await expect(actions).toHaveText(before);

  const history = page.getByRole("button", {
    name: "Select Extrude 1. Double-click to reopen.",
    exact: true,
  });
  await history.focus();
  await history.press("F2");
  const historyInput = page.getByRole("textbox", { name: "Rename Extrude 1" });
  await expect(historyInput).toBeFocused();
  await historyInput.press("Escape");
  await expect(history).toBeVisible();
});

test("history menu commits on blur and rejects empty names without a mutation", async ({
  page,
}) => {
  await new FeatureWorkbenchHarness(page).openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  const history = page.getByRole("button", {
    name: "Select Extrude 1. Double-click to reopen.",
    exact: true,
  });
  await history.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Rename Extrude 1" });
  await expect(input).toBeFocused();
  await input.fill("Raised pad");
  await page.getByPlaceholder("Search tools").focus();
  const renamed = page.getByRole("button", {
    name: "Select Raised pad. Double-click to reopen.",
    exact: true,
  });
  await expect(renamed).toBeVisible({ timeout: 10_000 });
  const actions = page.locator('[data-history-actions="contextual"]');
  await expect(
    actions.getByRole("button", { name: "Undo Edit Extrude", exact: true }),
  ).toBeEnabled({ timeout: 10_000 });
  const before = await actions.allTextContents();
  await renamed.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const empty = page.getByRole("textbox", { name: "Rename Raised pad" });
  await empty.fill("   ");
  await empty.press("Enter");
  await expect(
    page.getByText("Name cannot be empty.", { exact: true }),
  ).toBeVisible();
  await expect(renamed).toBeVisible();
  await expect(actions).toHaveText(before);
});
