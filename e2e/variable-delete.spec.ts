import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

test("hovering a variable reveals a dim delete control that removes it undoably", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await page.locator("[data-workbench-variables-fab]").click();
  await page.getByRole("button", { name: "Add variable" }).click();
  await expect(page.getByLabel("Variable name variable_1")).toHaveValue(
    "var1",
    { timeout: 30_000 },
  );
  await page.keyboard.press("Escape");
  // The new row takes the place of the Add button under the pointer.
  await page.mouse.move(0, 0);

  const row = page.locator('[data-variable-row="variable_1"]');
  const deleteButton = row.getByRole("button", {
    name: "Delete variable var1",
  });
  const opacity = () =>
    deleteButton.evaluate((element) => getComputedStyle(element).opacity);
  await expect.poll(opacity).toBe("0");

  await row.getByRole("button", { name: "Edit variable var1" }).hover();
  await expect.poll(opacity).toBe("1");

  await deleteButton.click();
  await expect(row).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(row).toBeVisible({ timeout: 30_000 });
});
