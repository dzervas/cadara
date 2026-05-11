import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

test("keeps sketch preview interactions active after starting a sketch", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create line geometry.");
  await expect
    .poll(
      () =>
        page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? ""),
      { timeout: 10_000 },
    )
    .toBe("line");
  await workbench.waitForAnimationFrames(2);

  const canvas = page.locator("main canvas").first();
  await canvas.click({ position: { x: 360, y: 260 }, force: true });
  await canvas.click({ position: { x: 420, y: 320 }, force: true });

  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
});
