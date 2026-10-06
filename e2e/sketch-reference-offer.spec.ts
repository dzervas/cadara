import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

type LivePoint = { id: string; position: readonly [number, number] };

async function readLivePoints(page: import("@playwright/test").Page) {
  const snapshot = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snapshot) throw new Error("No live sketch snapshot.");
  return (snapshot as { points: LivePoint[] }).points;
}

async function openDimensionInput(
  workbench: SketchWorkbenchHarness,
  target: { x: number; y: number },
  placement: { x: number; y: number },
) {
  const page = workbench.page;
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt(target);
  await workbench.clickViewportAt(placement);
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  return floatingInput;
}

// T13e (D11) through the browser: with the rectangle's width dimensioned,
// the Dimension tool on the opposite side opens in Reference mode (measured
// value read-only, note, Make driving switch); committing authors a
// reference whose label reads "(value)", and the height still drags.
test("T13e: a determined opposite width is offered as a reference; committing shows (value) and the height still drags", async ({
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

  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 700, y: 500 });
  await workbench.clickViewportAt({ x: 900, y: 650 });
  await page.keyboard.press("Escape");
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 400, y: 320 });
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("5 entities staged");
  await page.keyboard.press("Escape");
  const drawn = (await readLivePoints(page)).slice(0, 4);
  const widthOf = (points: readonly LivePoint[]) =>
    Math.max(...points.map((point) => point.position[0])) -
    Math.min(...points.map((point) => point.position[0]));
  const heightOf = (points: readonly LivePoint[]) =>
    Math.max(...points.map((point) => point.position[1])) -
    Math.min(...points.map((point) => point.position[1]));
  const width = widthOf(drawn);
  const scale = width / 200;

  // The bottom width: independent, so the input opens driving.
  let floatingInput = await openDimensionInput(
    workbench,
    { x: 800, y: 650 },
    { x: 800, y: 700 },
  );
  await expect(floatingInput.getByRole("switch")).toHaveCount(0);
  await expect(floatingInput.locator("input")).toBeEditable();
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");

  // The top side is determined by the width: Reference mode.
  floatingInput = await openDimensionInput(
    workbench,
    { x: 800, y: 500 },
    { x: 800, y: 450 },
  );
  const value = floatingInput.locator("input:not([role='switch'])");
  expect(Number(await value.inputValue()), "the measured value").toBeCloseTo(
    width,
    4,
  );
  await expect(value).not.toBeEditable();
  await expect(
    floatingInput.locator("[data-floating-input-readout]"),
  ).toHaveText("Already determined by other requirements");
  const modeSwitch = floatingInput.getByRole("switch", {
    name: "Make driving",
  });
  await expect(modeSwitch).toBeVisible();
  await expect(modeSwitch).not.toBeChecked();
  await floatingInput.getByRole("button", { name: "Add reference" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");

  const reference = page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label*="reference"]',
  );
  await expect(reference).toHaveCount(1);
  await expect(reference).toHaveText(`(${width.toFixed(2)})`);
  await expect(
    page.getByRole("status").filter({ hasText: "conflicts with" }),
  ).toHaveCount(0);

  // The height still drags: the top-right corner up 80 px.
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");
  await page.mouse.move(box.x + 900, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 900, box.y + 420, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(3);
  const resized = (await readLivePoints(page)).slice(0, 4);
  expect(
    heightOf(resized) - heightOf(drawn),
    "the height grew by ~80 px",
  ).toBeCloseTo(80 * scale, 1);
  expect(widthOf(resized), "the width holds").toBeCloseTo(width, 4);
  await expect(reference).toHaveText(`(${width.toFixed(2)})`);
});
