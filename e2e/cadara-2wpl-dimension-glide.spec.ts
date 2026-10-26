import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// cadara-2wpl (E2E: pointer routing between the canvas and the overlay
// layers, and the annotation layer's render order, which only the browser
// has). Since cadara-bmy0 a point-to-line or point-to-axis preview puts its
// label at the pointer's foot on its dimension line, so that line, and the
// 14 px drag handle drawn on it, runs under the pointer. The handle took
// the pointer moves the canvas feeds the preview: gliding along the line
// froze the label until the pointer slipped off the handle, then it jumped.
// And a committed chip the layout had displaced drew one frame back on its
// old anchor when its drag started.

test.use({ viewport: { width: 1440, height: 960 } });

type Point = { x: number; y: number };

const PREVIEW_LABEL = '[data-sketch-viewport-overlay="dimensionLine"]';

async function readCentre(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  }, selector);
}

/** A fresh Top-plane sketch with a vertical line and a horizontal line. */
async function openSketchWithLines(workbench: SketchWorkbenchHarness) {
  const page = workbench.page;
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  const box = (await page.locator("main canvas").first().boundingBox())!;
  const at = (point: Point) => ({ x: box.x + point.x, y: box.y + point.y });
  const glideClick = async (point: Point) => {
    const target = at(point);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await workbench.waitForAnimationFrames(2);
    await page.mouse.down();
    await page.mouse.up();
    await workbench.waitForAnimationFrames(2);
  };
  const line = async (start: Point, end: Point, staged: string) => {
    await workbench.activateTool("Create line geometry.");
    await glideClick(start);
    await glideClick(end);
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${staged} staged`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await workbench.waitForAnimationFrames(2);
  };
  await line({ x: 900, y: 200 }, { x: 900, y: 420 }, "1 entities");
  await line({ x: 450, y: 300 }, { x: 600, y: 300 }, "2 entities");
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  return { at, glideClick };
}

/**
 * Glides from `from` to `to` in small steps (each settled) and returns, per
 * step, the preview label's centre minus the pointer.
 */
async function glidePreview(
  workbench: SketchWorkbenchHarness,
  at: (point: Point) => Point,
  from: Point,
  to: Point,
) {
  const page = workbench.page;
  const start = at(from);
  await page.mouse.move(start.x, start.y, { steps: 6 });
  await workbench.waitForAnimationFrames(3);
  const offsets: Point[] = [];
  for (let step = 0; step <= 30; step += 1) {
    const pointer = at({
      x: from.x + ((to.x - from.x) * step) / 30,
      y: from.y + ((to.y - from.y) * step) / 30,
    });
    await page.mouse.move(pointer.x, pointer.y);
    await workbench.waitForAnimationFrames(2);
    const label = await readCentre(page, PREVIEW_LABEL);
    expect(label, `the preview label is drawn at step ${step}`).not.toBeNull();
    offsets.push({ x: label!.x - pointer.x, y: label!.y - pointer.y });
  }
  return offsets;
}

function expectLabelAtPointer(offsets: readonly Point[]) {
  // The label sits at the pointer, its chip 18 px above it (the label
  // offset); a frozen label falls behind the gliding pointer.
  for (const [step, offset] of offsets.entries()) {
    expect(
      Math.hypot(offset.x, offset.y + 18),
      `step ${step}: the label follows the pointer (offset ${Math.round(offset.x)}, ${Math.round(offset.y)})`,
    ).toBeLessThan(8);
  }
}

test("cadara-2wpl: a point-to-line distance preview follows a pointer gliding along its dimension line", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new SketchWorkbenchHarness(page);
  const { at, glideClick } = await openSketchWithLines(workbench);
  // The vertical line, then the horizontal line's end (600, 300): the
  // dimension line runs horizontally through the pointer, from the point's
  // foot on the vertical line to the point.
  await glideClick({ x: 900, y: 320 });
  await glideClick({ x: 600, y: 300 });
  await expect
    .poll(() => page.locator(PREVIEW_LABEL).textContent())
    .toContain("Point-line");
  expectLabelAtPointer(
    await glidePreview(workbench, at, { x: 650, y: 360 }, { x: 860, y: 360 }),
  );
});

test("cadara-2wpl: a point-to-axis distance preview follows a pointer gliding along its dimension line", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new SketchWorkbenchHarness(page);
  const { at, glideClick } = await openSketchWithLines(workbench);
  // The horizontal line's end (600, 300), then the X axis left of the
  // origin (the viewport centre, 720 × 480): the dimension line runs
  // vertically through the pointer, from the point's foot on the axis.
  await glideClick({ x: 600, y: 300 });
  await glideClick({ x: 400, y: 480 });
  await expect
    .poll(() => page.locator(PREVIEW_LABEL).textContent())
    .toContain("Point-line");
  expectLabelAtPointer(
    await glidePreview(workbench, at, { x: 650, y: 330 }, { x: 650, y: 450 }),
  );
});

// The enclosure example's vertical 19.00 chip overlaps the 3.00 chip on its
// anchor, so the layout displaces it (the cadara-bmy0 drag row's premise).
const VERTICAL_19 =
  "dimension_7_vertical-distance_4566627b-961d-49cf-8a52-b8055514f475";

test("cadara-2wpl: a layout-displaced dimension chip stays with the pointer from the first frame of its drag and back over its anchor", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const enclosure: unknown = JSON.parse(
    await readFile("landing/examples/enclosure/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, enclosure, "enclosure.cadara");
  await workbench.waitForRenderIdle(60_000);
  await page
    .getByRole("button", {
      name: "Select Front connector openings. Double-click to reopen.",
    })
    .first()
    .dblclick({ timeout: 60_000 });
  await workbench.expectMachine("editingSketch", 60_000);
  const selector = `[data-sketch-annotation-id="${VERTICAL_19}"]`;
  await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(`[data-sketch-annotation-leader="${VERTICAL_19}"]`),
    "premise: the layout displaced the chip off its anchor",
  ).toBeAttached();

  const grabbed = (await readCentre(page, selector))!;
  // The chip's own anchor (where it would sit undisplaced): the leader's end
  // on the dimension line plus the (0, -18) label offset.
  const grabAnchor = await page.evaluate((id) => {
    const leader = document.querySelector<SVGLineElement>(
      `[data-sketch-annotation-leader="${id}"]`,
    )!;
    const origin = leader.ownerSVGElement!.getBoundingClientRect();
    return {
      x: origin.x + Number(leader.getAttribute("x2")),
      y: origin.y + Number(leader.getAttribute("y2")) - 18,
    };
  }, VERTICAL_19);
  expect(
    Math.hypot(grabAnchor.x - grabbed.x, grabAnchor.y - grabbed.y),
    "premise: the chip is drawn well off its anchor",
  ).toBeGreaterThan(20);
  await page.mouse.move(grabbed.x + 40, grabbed.y + 30);
  await page.mouse.move(grabbed.x, grabbed.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  // Every committed position of the chip, read as React writes it, with the
  // pointer at that moment: a chip drawn for a single frame is caught too.
  await page.evaluate((selector) => {
    const recorder = window as unknown as {
      __chipTrack: { chip: Point; pointer: Point }[];
      __chipPointer: Point;
    };
    recorder.__chipTrack = [];
    window.addEventListener(
      "pointermove",
      (event) => {
        recorder.__chipPointer = { x: event.clientX, y: event.clientY };
      },
      { capture: true },
    );
    const record = () => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      if (box && recorder.__chipPointer) {
        recorder.__chipTrack.push({
          chip: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          pointer: recorder.__chipPointer,
        });
      }
    };
    new MutationObserver(record).observe(
      document.querySelector("[data-sketch-annotation-layer]")!,
      { attributes: true, subtree: true, childList: true },
    );
  }, selector);
  await page.mouse.down();
  await page.mouse.move(grabbed.x + 60, grabbed.y + 50, { steps: 24 });
  await workbench.waitForAnimationFrames(4);
  // Back over the anchor the drag started from: the label is now placed
  // there, and the chip with it, not at its old displacement from it.
  await page.mouse.move(grabAnchor.x, grabAnchor.y, { steps: 24 });
  await workbench.waitForAnimationFrames(4);
  const track = await page.evaluate(
    () =>
      (window as unknown as { __chipTrack: { chip: Point; pointer: Point }[] })
        .__chipTrack,
  );
  await page.mouse.up();
  expect(track.length, "premise: the drag moved the chip").toBeGreaterThan(5);
  for (const [index, { chip, pointer }] of track.entries()) {
    // Within the 6 px drag threshold the chip waits for the pointer.
    expect(
      Math.hypot(
        chip.x - grabbed.x - (pointer.x - grabbed.x),
        chip.y - grabbed.y - (pointer.y - grabbed.y),
      ),
      `position ${index}: the chip stays by the pointer (chip ${Math.round(chip.x)}, ${Math.round(chip.y)}; pointer ${Math.round(pointer.x)}, ${Math.round(pointer.y)})`,
    ).toBeLessThan(12);
  }
});
