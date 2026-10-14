import { expect, test } from "@playwright/test";

import { selectRegionInViewport } from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md) — the defect lives between the workbench's
// React tree and the R3F scene's own reconciler, so only the browser shows
// it. Seam: part-mode viewport picking right after the first Finish of a
// page session (T17c6 D-4, T17i D-4). Repro: open with the repository,
// enter a sketch straight away (the pointer never crosses the part-mode
// viewport), draw, Finish: every part-mode hover and press found nothing
// (idle, Measure, even the planes) until a feature was activated or the
// page reloaded, because the pick bindings were collected before the
// remounted scene was committed.
test("T17c6 D-4: right after the first Finish, with no part-mode hover before the sketch, the region is picked in the viewport and Measure measures it", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  await workbench.activateTool("Create rectangle geometry.");
  const surface = (await workbench.viewportSurface().boundingBox())!;
  for (const corner of [
    { x: 640, y: 420 },
    { x: 860, y: 580 },
  ]) {
    await page.mouse.move(surface.x + corner.x, surface.y + corner.y, {
      steps: 8,
    });
    await page.mouse.down();
    await page.mouse.up();
  }
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("entities staged");
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);

  const regions = () =>
    page.evaluate(
      () =>
        window.__cadaraDebug
          ?.getState()
          ?.selectableTargets.filter((target) =>
            /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
          ) ?? [],
    );
  await expect.poll(regions, { timeout: 30_000 }).toHaveLength(1);
  const [region] = await regions();

  // Idle part mode: the hover search reaches the region and a press selects it.
  const at = await selectRegionInViewport(workbench, region!);

  // The Measure tool picks it too: a press on the same place measures its area.
  await workbench.activateTool("Inspect geometric measurements.");
  await page.mouse.move(surface.x + at.x + 3, surface.y + at.y + 3, {
    steps: 4,
  });
  await page.mouse.move(surface.x + at.x, surface.y + at.y, { steps: 4 });
  await expect
    .poll(() => workbench.currentHoverTarget(), { timeout: 10_000 })
    .toBe(region);
  await page.mouse.down();
  await page.mouse.up();
  const panel = page.getByText("Measure", { exact: true }).locator("xpath=..");
  await expect(panel).toContainText(/Area\s*[\d.]+ mm²/, { timeout: 15_000 });
});
