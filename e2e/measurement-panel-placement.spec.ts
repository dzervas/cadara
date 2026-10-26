import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// Lane: e2e (docs/testing.md). Seam: where the workbench lays out the
// measure readout among the bottom overlays (state debugger, feature
// timeline) and the parts tree; only a browser lays these out. Repro
// (cadara-h026.4): the readout followed the fixed 360px state debugger, so
// it started at x = 388px at every size and sat mid/right on a 960px-wide
// viewport. Sketch mode shows the readout of the plain selection since
// cadara-h026.3, so its row asserts the same placement there.

test.setTimeout(120_000);

const MEASURE_TOOL = "Inspect geometric measurements.";
/** The overlays' left inset (VIEWPORT_OVERLAY_INSET_PX). */
const LEFT_INSET_PX = 16;

const readout = (page: Page) => page.locator("[data-measurement-panel]");
const command = (page: Page) =>
  page.evaluate(() => window.__cadaraDebug?.getState()?.command);

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} has no layout box.`);
  return found;
}

async function selectMeasureTarget(page: Page, pattern: RegExp) {
  const targets: readonly string[] = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.selectableTargets ?? [],
  );
  const target = targets.find((entry) => pattern.test(entry));
  if (!target) throw new Error(`No selectable target matches ${pattern}.`);
  expect(
    await page.evaluate((id) => window.__cadaraDebug?.selectTarget(id), target),
  ).toBe(true);
  await expect(readout(page)).toBeVisible({ timeout: 15_000 });
  return target;
}

/**
 * The readout's left edge is at the left inset, its bottom above the history
 * strip (part mode's "Feature timeline", sketch mode's "Sketch contents") in
 * the bottom band, the state debugger to its right; expanding the debugger
 * does not move it.
 */
async function expectBottomLeftPlacement(
  page: Page,
  history: "Feature timeline" | "Sketch contents",
) {
  const placement = async (state: string) => {
    const main = await box(page, "main");
    const panel = (await readout(page).boundingBox())!;
    const timeline = await page
      .getByRole("region", { name: history, exact: true })
      .boundingBox();
    const debuggerBox = await box(page, "[data-workbench-state-debugger]");
    expect(
      panel.x - main.x,
      `${state}: the readout starts at the left inset`,
    ).toBeCloseTo(LEFT_INSET_PX, 0);
    expect(
      panel.y + panel.height,
      `${state}: the readout sits above the ${history}`,
    ).toBeLessThanOrEqual(timeline!.y);
    expect(
      panel.y + panel.height,
      `${state}: the readout is in the bottom band`,
    ).toBeGreaterThan(main.y + main.height * 0.5);
    expect(
      debuggerBox.x,
      `${state}: the debugger stays visible, right of the readout`,
    ).toBeGreaterThanOrEqual(panel.x + panel.width);
    return panel;
  };

  const collapsed = await placement("debugger collapsed");
  // Test mode passes pointer events through the debugger: dispatch.
  await page
    .getByRole("button", { name: "Expand state debugger" })
    .dispatchEvent("click");
  await expect(page.locator("[data-workbench-state-debugger]")).toHaveAttribute(
    "data-expanded",
    "true",
  );
  expect(await placement("debugger expanded")).toEqual(collapsed);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 960, height: 600 },
]) {
  test(`cadara-h026.4: part mode, ${viewport.width}x${viewport.height}: the measure readout is pinned bottom-left, above the timeline, beside the debugger collapsed or expanded, and names its target without ids`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithBaseExtrudeFixture();
    await workbench.activateTool(MEASURE_TOOL);
    const face = await selectMeasureTarget(page, /\.face_/);

    await expectBottomLeftPlacement(page, "Feature timeline");

    const text = await readout(page).innerText();
    // "Face" until the kernel's exact measure names it "Planar face".
    expect(text).toMatch(/(Face|Planar face) · Extrude 1/);
    for (const id of face.split(".")) {
      expect(
        text,
        `the readout never shows the durable id ${id}`,
      ).not.toContain(id);
    }
    expect(text).not.toMatch(/Single target|Two targets/);
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 960, height: 600 },
]) {
  test(`cadara-h026.3: sketch mode, ${viewport.width}x${viewport.height}: the readout of a selected sketch line is pinned bottom-left, above the timeline, beside the debugger collapsed or expanded`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.open();
    await workbench.activateTool("Start a new sketch.");
    await page
      .getByRole("button", { name: /Top Plane/ })
      .first()
      .click();
    await workbench.expectSketchSessionActive();
    const canvas = await workbench.viewport().boundingBox();
    if (!canvas) throw new Error("Viewport canvas is not visible.");
    const at = (x: number) => ({
      x: canvas.width * x,
      y: canvas.height * 0.35,
    });
    await workbench.activateTool("Create line geometry.");
    await workbench.clickViewportAt(at(0.55));
    await workbench.clickViewportAt(at(0.75));
    await expect
      .poll(() => workbench.currentSketchSession())
      .toContain("1 entities staged");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(readout(page)).toHaveCount(0);

    await workbench.clickViewportAt(at(0.65));
    await expect(readout(page)).toBeVisible({ timeout: 15_000 });
    await expect(readout(page)).toContainText("Length");
    await expectBottomLeftPlacement(page, "Sketch contents");
  });
}

test("cadara-h026.4: with a long parts list the parts tree stops above the measure readout and regains its height when the readout closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const document: unknown = JSON.parse(
    await readFile("landing/examples/enclosure/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, document, "enclosure.cadara");
  await workbench.waitForRenderIdle(30_000);
  const tree = page.getByRole("complementary", { name: "Parts and objects" });
  await expect(
    tree.getByText("Black socket-head screw 4", { exact: true }),
  ).toBeAttached({ timeout: 60_000 });
  const readoutHeightVar = () =>
    page
      .locator("main")
      .evaluate((main) =>
        getComputedStyle(main)
          .getPropertyValue("--workbench-measure-readout-height")
          .trim(),
      );
  const treeAlone = (await tree.boundingBox())!;

  await workbench.activateTool(MEASURE_TOOL);
  await selectMeasureTarget(page, /\.face_/);
  await expect
    .poll(
      async () => {
        const panel = (await readout(page).boundingBox())!;
        const treeBox = (await tree.boundingBox())!;
        return treeBox.y + treeBox.height <= panel.y;
      },
      {
        message: "the tree's bottom edge is above the readout's top edge",
        timeout: 10_000,
      },
    )
    .toBe(true);
  const panel = (await readout(page).boundingBox())!;
  expect(
    Math.abs(Number.parseFloat(await readoutHeightVar()) - panel.height),
    "the published reserve is the readout's height",
  ).toBeLessThanOrEqual(1);
  expect(
    treeAlone.y + treeAlone.height,
    "without the reserve the tree would reach into the readout",
  ).toBeGreaterThan(panel.y);

  // Escape leaves the Measure tool, keeping the selection, whose plain
  // readout stays (cadara-h026.3); a second Escape clears the selection.
  await page.keyboard.press("Escape");
  await expect.poll(() => command(page), { timeout: 10_000 }).toBe("none");
  await expect(readout(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(readout(page)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(readoutHeightVar, { timeout: 10_000 }).toBe("0px");
  await expect
    .poll(async () => (await tree.boundingBox())!.height, { timeout: 10_000 })
    .toBeCloseTo(treeAlone.height, 0);
});
