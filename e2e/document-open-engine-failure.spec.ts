import { expect, test, type Page, type Route } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

function editorRefreshFailed(page: Page) {
  return page.evaluate(() =>
    JSON.stringify(window.__cadaraDebug?.getTrace() ?? null).includes(
      "effect.snapshotFailed",
    ),
  );
}

// Lane: e2e. Seam: the workbench's failure surfaces when the geometry engine
// fails to start (here its download answers 500; a 404 would be the retired
// kernel, which the update notification owns). The modeling service's
// initialization then throws, which says nothing about the stored history:
// the notice offers a reload, never the destructive "Reset stored history".
// Project discovery, the editor's refresh and local file sync hit the same
// failure; only the browser composes those surfaces with the notification
// column, so the single outcome is proven here.
test("a geometry engine that fails to start shows only the could-not-open notice, whose Reload recovers", async ({
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
  // The editor's refresh has failed with the same error by now; before the
  // fix, every other notice appeared within the same second.
  await expect.poll(() => editorRefreshFailed(page)).toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(1);
  for (const title of [
    "Project could not be",
    "Document refresh failed",
    "Local file sync restore failed",
  ])
    await expect(page.getByText(title)).toHaveCount(0);
  // Nothing covers the notice: a trial click hit-tests its Reload button.
  await notice
    .getByRole("button", { name: "Reload" })
    .click({ trial: true, timeout: 5_000 });

  await page.unroute("**/kernels/**/cadara-occ.wasm", failEngineDownload);
  await Promise.all([
    page.waitForEvent("load", { timeout: 60_000 }),
    notice.getByRole("button", { name: "Reload" }).click(),
  ]);
  await new FeatureWorkbenchHarness(page).expectMachine("idle", 60_000);
  await expect(page.getByText("Document could not be opened")).toHaveCount(0);
});
