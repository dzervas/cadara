import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  expectGlideFollowed,
  glidePath,
  glideSamplingElement,
} from "./helpers/pointer-glide";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// cadara-bmy0 (E2E: pointer drag of a DOM chip over the canvas, which only
// the browser has). The enclosure example dimensions every coordinate to the
// sketch origin (pointDatumDistance). Before the fix those chips had no drag
// handle: a press landed on the chip, nothing captured the pointer, and the
// label never moved. Now a gliding drag moves the label in 2D (along its
// dimension line and across it), the placement persists, and a chip the
// layout displaced draws a leader to its line and stays where it is dropped.
const HORIZONTAL_19 =
  "dimension_3_horizontal-distance_643a22bd-0795-444d-a28f-bb1826962e3b";
const VERTICAL_19 =
  "dimension_7_vertical-distance_4566627b-961d-49cf-8a52-b8055514f475";

async function centreOf(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Glides onto the chip's centre `from`, presses, glides by `delta` and
 * releases. cadara-3wp6: the chip (`chipId`) is sampled after every step and
 * at every drawn frame, and its centre must stay on the pointer.
 */
async function glideDrag(
  page: Page,
  chipId: string,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  frames: () => Promise<void>,
) {
  await page.mouse.move(from.x + 40, from.y + 30);
  await page.mouse.move(from.x, from.y, { steps: 8 });
  await frames();
  const recording = await glideSamplingElement(
    page,
    `[data-sketch-annotation-id="${chipId}"]`,
    glidePath([from, { x: from.x + delta.x, y: from.y + delta.y }]),
    frames,
    { press: true },
  );
  await page.mouse.up();
  expectGlideFollowed(recording, {
    what: "the dragged chip",
    followsPointer: true,
    expectedOffset: { x: 0, y: 0 },
  });
}

test("cadara-bmy0: a point-to-origin dimension label drags in 2D, persists its place along the line, and a displaced chip keeps a leader", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const document: unknown = JSON.parse(
    await readFile("landing/examples/enclosure/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, document, "enclosure.cadara");
  await workbench.waitForRenderIdle(60_000);
  await page
    .getByRole("button", {
      name: "Select Front connector openings. Double-click to reopen.",
    })
    .first()
    .dblclick({ timeout: 60_000 });
  await workbench.expectMachine("editingSketch", 60_000);

  const frames = () => workbench.waitForAnimationFrames(3);
  const chip = page.locator(`[data-sketch-annotation-id="${HORIZONTAL_19}"]`);
  await expect(chip).toBeVisible({ timeout: 30_000 });

  // Tied to this fixture's layout at the default viewport: the vertical
  // 19.00 chip overlaps the 3.00 chip on its anchor, so the layout moves it
  // and it draws a leader (leader rendering itself is pinned by the UI spec).
  const vertical = page.locator(`[data-sketch-annotation-id="${VERTICAL_19}"]`);
  const verticalLeader = page.locator(
    `[data-sketch-annotation-leader="${VERTICAL_19}"]`,
  );
  await expect(
    verticalLeader,
    "premise: the layout-displaced vertical 19.00 keeps a leader to its line",
  ).toBeAttached();
  // A displaced chip dropped in free space stays where it was dropped (no
  // jump by its old displacement on release) and needs no leader any more.
  const verticalBefore = await centreOf(vertical);
  const verticalDelta = { x: 100, y: 130 };
  await glideDrag(page, VERTICAL_19, verticalBefore, verticalDelta, frames);
  await frames();
  await expect
    .poll(
      async () => {
        const after = await centreOf(vertical);
        return Math.hypot(
          after.x - verticalBefore.x - verticalDelta.x,
          after.y - verticalBefore.y - verticalDelta.y,
        );
      },
      { message: "the displaced chip stays where it was dropped" },
    )
    .toBeLessThan(3);
  await expect(verticalLeader, "on its anchor: no leader").toHaveCount(0);

  const before = await centreOf(chip);
  // Drag along the (horizontal) dimension line and across it in one gesture.
  const delta = { x: -50, y: 100 };
  await glideDrag(page, HORIZONTAL_19, before, delta, frames);

  await expect
    .poll(
      async () => {
        const after = await centreOf(chip);
        return Math.hypot(
          after.x - before.x - delta.x,
          after.y - before.y - delta.y,
        );
      },
      {
        message: "the label followed the pointer along and across its line",
        timeout: 10_000,
      },
    )
    .toBeLessThan(3);

  const placement = await page.evaluate((id) => {
    const definition = window.__cadaraDebug?.getSketchSnapshot()?.definition;
    const dimension = definition?.dimensions.find(
      (candidate) => candidate.dimensionId === id,
    );
    return dimension?.kind === "pointDatumDistance"
      ? dimension.annotationPlacement
      : null;
  }, HORIZONTAL_19);
  expect(placement, "the place along the line is persisted").toMatchObject({
    kind: "dimensionLine",
    offset: expect.any(Number),
    labelPosition: expect.any(Number),
  });
});

async function drawLine(
  workbench: SketchWorkbenchHarness,
  start: { x: number; y: number },
  end: { x: number; y: number },
  staged: string,
) {
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(start);
  await workbench.clickViewportAt(end);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain(`${staged} staged`);
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
}

/** A Distance dimension on `picks`, its label placed at `place`. */
async function dimension(
  workbench: SketchWorkbenchHarness,
  picks: readonly { x: number; y: number }[],
  place: { x: number; y: number },
) {
  const page = workbench.page;
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  for (const pick of picks) await workbench.clickViewportAt(pick);
  await workbench.clickViewportAt(place);
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
}

// cadara-bmy0 review: an angle label's placement keeps it on its bisector, so
// a layout-displaced angle chip keeps its displacement while dragged instead
// of snapping onto the bisector when the drag starts.
test("cadara-bmy0: a layout-displaced angle chip does not jump when its drag starts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  // Line A horizontal; line B rising at about 34° and meeting A's extension
  // at (400, 380), so the angle's bisector runs through about (620, 313).
  await drawLine(
    workbench,
    { x: 500, y: 380 },
    { x: 760, y: 380 },
    "1 entities",
  );
  await drawLine(
    workbench,
    { x: 520, y: 300 },
    { x: 760, y: 140 },
    "2 entities",
  );
  // A's length first, its chip at about (630, 301); then the angle, whose
  // chip lands on the same spot and is moved off it by the layout.
  await dimension(workbench, [{ x: 700, y: 380 }], { x: 630, y: 319 });
  await dimension(
    workbench,
    [
      { x: 700, y: 380 },
      { x: 640, y: 220 },
    ],
    { x: 620, y: 313 },
  );
  const angle = page.locator(
    '[data-sketch-annotation-kind="dimension"][data-sketch-annotation-glyph="dimensionAngle"]',
  );
  await expect(angle).toHaveCount(1);
  const angleId = (await angle.getAttribute("data-sketch-annotation-id"))!;
  await expect(
    page.locator(`[data-sketch-annotation-leader="${angleId}"]`),
    "premise: the layout moved the angle chip off its anchor",
  ).toBeAttached();

  const grabbed = await centreOf(angle);
  await page.mouse.move(grabbed.x + 40, grabbed.y + 30);
  await page.mouse.move(grabbed.x, grabbed.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  // Past the 6 px drag threshold, outward along the bisector (about 17°).
  const step = { x: 12, y: -4 };
  await page.mouse.move(grabbed.x + step.x, grabbed.y + step.y, { steps: 4 });
  await workbench.waitForAnimationFrames(4);
  const during = await centreOf(angle);
  await page.mouse.up();
  expect(
    Math.hypot(during.x - grabbed.x - step.x, during.y - grabbed.y - step.y),
    "the dragged angle chip stays by the pointer (no snap onto its bisector)",
  ).toBeLessThan(6);
});
