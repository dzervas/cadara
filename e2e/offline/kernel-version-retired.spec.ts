import { expect, test } from "@playwright/test";

import { OCC_ASSET_BASE_PATH } from "../../src/infrastructure/occ/asset-version";
import { FeatureWorkbenchHarness } from "../helpers/feature-workbench";
import {
  reachable,
  startPreview,
  stopPreview,
} from "../helpers/offline-preview";

// Lane: e2e, offline sub-lane (docs/testing.md). Seam: an open tab whose
// kernel version a deploy retired. Every deploy publishes one
// /kernels/<version>/ directory and Workers answers any other version with
// 404 (asserted against the real router in e2e/production/landing-routing).
// `vite preview` falls back to HTML instead, so this row answers the kernel
// with that 404 itself. The tab is uncontrolled (a failed or blocked worker
// install), so no waiting worker raises the usual update prompt: the kernel
// worker, its client and the notification must turn the 404 into a reload
// outcome, and the tab must never request another kernel version. The
// document and project surfaces that see the same failure stay quiet.
test.use({ serviceWorkers: "block" });

test("a tab whose kernel version a deploy retired shows 'CADara was updated' and recovers on Reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = testInfo.project.use.baseURL!;
  const kernelRequests: string[] = [];
  const retired = async (route: import("@playwright/test").Route) => {
    kernelRequests.push(route.request().url());
    await route.fulfill({ status: 404, body: "Not found" });
  };
  await page.route("**/kernels/**", retired);
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    await page.goto(`${baseURL}/app`);
    const notice = page
      .getByRole("status")
      .filter({ hasText: "CADara was updated" });
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText("Reload to continue");
    // Every modeling call now fails with the retired kernel, including the
    // document's first snapshot. Once that failure reached the editor, the
    // restore, refresh, local-file-sync and project surfaces have all seen
    // it (without withholding, all five were already rendered at the first
    // check after this signal); none may offer its own recovery (above all
    // not the destructive "Reset stored history"): the reload is the only
    // outcome.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__cadaraDebug?.getTrace().entries ?? []).some(
              (entry) =>
                entry.kind === "effect-failed" &&
                entry.failure.type === "effect.snapshotFailed",
            ),
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    for (const surface of [
      "History restore failed",
      "Reset stored history",
      "Document could not be opened",
      "Document refresh failed",
      "Local file sync restore failed",
      "Project could not be saved",
    ])
      await expect(page.getByText(surface)).toHaveCount(0);
    expect(kernelRequests.length).toBeGreaterThan(0);
    for (const url of kernelRequests)
      expect(
        new URL(url).pathname,
        "the tab only ever asks for its own kernel version",
      ).toMatch(new RegExp(`^${OCC_ASSET_BASE_PATH}/cadara-occ\\.(?:js|wasm)$`));

    // The reload loads the deployed app, whose kernel the server publishes.
    await page.unroute("**/kernels/**", retired);
    await Promise.all([
      page.waitForEvent("load", { timeout: 60_000 }),
      notice.getByRole("button", { name: "Reload" }).click(),
    ]);
    await new FeatureWorkbenchHarness(page).expectMachine("idle", 60_000);
    await expect(
      page.getByRole("status").filter({ hasText: "CADara was updated" }),
    ).toHaveCount(0);
  } finally {
    await stopPreview(server, baseURL);
  }
});
