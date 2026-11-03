import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e. Real numeric typing and overlay bounds require the browser.
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);
test("fillet radius accepts a leading zero and its editor clears the preview corner", async ({
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
  for (const point of [
    { x: 760, y: 580 },
    { x: 1060, y: 340 },
    { x: 1100, y: 280 },
  ]) {
    await workbench.clickViewportAt(point);
  }
  await expect
    .poll(() => workbench.currentSketchSession())
    .toContain("2 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await workbench.clickViewportAt({ x: 910, y: 460 });
  await workbench.clickViewportAt({ x: 1080, y: 310 });
  await expect.poll(() => workbench.currentMachineSelectionCount()).toBe(2);
  await workbench.activateTool("Round a supported sketch corner.");
  const editor = page.locator("[data-sketch-viewport-floating-input]");
  await expect(editor).toBeVisible();
  const radius = page.getByLabel("Radius", { exact: true });
  await radius.fill("");
  for (const [key, draft] of [
    ["0", "0"],
    [".", "0."],
    ["1", "0.1"],
    ["5", "0.15"],
  ]) {
    await radius.pressSequentially(key!);
    // Keep going on the baseline to capture both independent regressions.
    expect.soft(await radius.inputValue()).toBe(draft);
  }
  const typed = await radius.inputValue();
  await page.screenshot({ path: ".scratch/cadara-tx5f/compare/typing.png" });
  // Also capture the editor with a valid preview, even on the unfixed tree.
  await radius.fill("0.15");
  await radius.press("Tab");
  await expect(editor).toBeVisible();
  await expect(editor.locator("input")).toHaveValue("0.15");
  await page.screenshot({ path: ".scratch/cadara-tx5f/compare/preview.png" });
  const bounds = await editor.boundingBox();
  const viewport = await workbench.viewport().boundingBox();
  if (!bounds || !viewport)
    throw new Error("Missing editor or viewport bounds");
  // Filleting trims the internal joint, leaving these two outer endpoints
  // unchanged. They delimit this fixture's projected preview envelope.
  expect(bounds.y).toBeGreaterThanOrEqual(viewport.y + 76);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    viewport.y + viewport.height - 100,
  );
  const preview = {
    left: viewport.x + 760,
    right: viewport.x + 1100,
    top: viewport.y + 280,
    bottom: viewport.y + 580,
  };
  expect.soft(typed, "Intermediate 0 and 0. must remain editable").toBe("0.15");
  expect(
    bounds.x >= preview.right + 6 ||
      bounds.x + bounds.width <= preview.left - 6 ||
      bounds.y >= preview.bottom + 6 ||
      bounds.y + bounds.height <= preview.top - 6,
    "The floating editor must leave the projected preview envelope visible",
  ).toBe(true);
});
