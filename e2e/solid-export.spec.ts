import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1280, height: 900 } });

test("solid STL export downloads through the browser worker path", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.openWithBaseExtrudeFixture();

  const bodyRow = page
    .locator("[data-parts-tree-row]")
    .filter({ hasText: "feature_extrude-1" })
    .first();
  await expect(bodyRow).toBeVisible({ timeout: 30_000 });
  await bodyRow.click({ button: "right", force: true });

  await page.getByRole("menuitem", { name: "Export" }).click();
  await expect(
    page.getByRole("dialog", { name: "Export feature_extrude-1" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("radio", { name: "STL" })).toBeChecked();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("feature-extrude-1.stl");

  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Could not read exported STL file.");
  }

  const bytes = await readFile(downloadPath);
  expect(bytes.byteLength).toBeGreaterThan(84);
  expect(bytes.subarray(0, 24).toString("utf8")).toContain(
    "cadara binary stl export",
  );
});
