import { expect, test } from "@playwright/test";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  glideClick,
  glidePress,
  openTopSketch,
  sketchSnapshot,
} from "./helpers/mirror-workbench";

// E2E lane: real pointer-following drafts and the toolbar/shortcut share Undo.
test("Spline draft: toolbar Undo and Ctrl+Z remove fit points before the completed line", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  const undo = page.locator('[data-tool-id="undo"]');
  await workbench.activateTool("Create spline geometry.");
  await page.keyboard.down("Shift");
  await glideClick(workbench, { x: 600, y: 500 });
  await page.keyboard.up("Shift");
  await expect(undo).toBeEnabled();
  await glidePress(page, undo);
  await expect(undo).toBeDisabled();

  await workbench.activateTool("Create line geometry.");
  await page.keyboard.down("Shift");
  await glideClick(workbench, { x: 950, y: 300 });
  await glideClick(workbench, { x: 950, y: 500 });
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => (await sketchSnapshot(page)).entities.length)
    .toBe(1);
  await workbench.activateTool("Create spline geometry.");
  await page.keyboard.down("Shift");
  for (const point of [
    { x: 550, y: 550 },
    { x: 650, y: 400 },
    { x: 800, y: 550 },
  ])
    await glideClick(workbench, point);
  await page.keyboard.up("Shift");
  await glidePress(page, undo);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sketchSnapshot(page)).entities.length)
    .toBe(2);
  expect((await sketchSnapshot(page)).points).toHaveLength(4);

  await page.keyboard.down("Shift");
  for (const point of [
    { x: 550, y: 650 },
    { x: 650, y: 600 },
    { x: 800, y: 650 },
  ])
    await glideClick(workbench, point);
  await page.keyboard.up("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  expect((await sketchSnapshot(page)).entities).toHaveLength(2);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () =>
      (await sketchSnapshot(page)).entities.map((entity) => entity.kind),
    )
    .toEqual(["lineSegment"]);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await sketchSnapshot(page)).entities.length)
    .toBe(0);
});
