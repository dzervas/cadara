import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1280, height: 900 } });

test("right-clicking a committed feature history item opens its context menu", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.openWithBaseExtrudeFixture();

  const featureHistoryItem = page.getByRole("button", {
    name: "Select Extrude 1. Double-click to reopen.",
  });
  await expect(featureHistoryItem).toBeVisible({ timeout: 30_000 });

  await featureHistoryItem.click({ button: "right", force: true });

  const menu = page.getByRole("menu", { name: "Extrude 1 actions" });
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await expect(menu.getByText("Edit", { exact: true })).toBeVisible();
  await expect(menu.getByText("Roll To End", { exact: true })).toBeVisible();
  await expect(menu.getByText("Delete", { exact: true })).toBeVisible();
});
