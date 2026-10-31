import { expect, test, type Route } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// Lane: e2e. Seam: the workbench's restore notice when the geometry engine
// fails to start (here its download answers 500; a 404 would be the retired
// kernel, which the update notification owns). The modeling service's
// initialization then throws, which says nothing about the stored history:
// the notice offers a reload, never the destructive "Reset stored history".
test("a geometry engine that fails to start offers Reload instead of resetting stored history", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failEngineDownload = (route: Route) =>
    route.fulfill({ status: 500, body: "Internal error" });
  await page.route("**/kernels/**/cadara-occ.wasm", failEngineDownload);
  await page.goto("/app");

  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Document could not be opened" });
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect(notice).toContainText("Failed to download the geometry engine");
  await expect(page.getByText("History restore failed")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reset stored history" }),
  ).toHaveCount(0);

  await page.unroute("**/kernels/**/cadara-occ.wasm", failEngineDownload);
  await Promise.all([
    page.waitForEvent("load", { timeout: 60_000 }),
    notice.getByRole("button", { name: "Reload" }).click(),
  ]);
  await new FeatureWorkbenchHarness(page).expectMachine("idle", 60_000);
  await expect(page.getByText("Document could not be opened")).toHaveCount(0);
});
