import { expect, test } from "@playwright/test";

import { recordAnnotationChips } from "./helpers/annotation-chip-frames";
import {
  expectGlideFollowed,
  glidePath,
  glideSamplingElement,
} from "./helpers/pointer-glide";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: a dimension chip dragged into the pick
// hint's reserved slot and released, through the real annotation layout and
// its DOM obstacles, which only the browser has. The slot is kept free for a
// hint that appears on hover, so to the user it is empty canvas: a chip
// dropped there stays where it was dropped (it draws over the hint, when
// one shows), at the release and after a reload.
test.use({ viewport: { width: 1440, height: 960 } });
test.setTimeout(180_000);

const chip = (id: string) => `[data-sketch-annotation-id="${id}"]`;
const leader = (id: string) => `[data-sketch-annotation-leader="${id}"]`;

/** Inside the pick hint's slot (canvas px: x 540-960, y 76-148). */
const IN_HINT_SLOT = { x: 700, y: 112 };
const HINT_SLOT = { left: 540, top: 76, right: 960, bottom: 148 };

test("a chip dropped into the pick hint's slot stays where it was dropped, at the release and after a reload", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 500, y: 380 });
  await workbench.clickViewportAt({ x: 760, y: 380 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt({ x: 630, y: 380 });
  await workbench.clickViewportAt({ x: 630, y: 330 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput
    .getByRole("button", { name: /^Commit$/ })
    .first()
    .click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(3);
  const [id] = await page.evaluate(() =>
    (
      window.__cadaraDebug?.getSketchSnapshot()?.definition?.dimensions ?? []
    ).map((dimension) => dimension.dimensionId as string),
  );
  expect(id, "premise: one dimension").toBeDefined();

  const canvas = (await workbench.viewport().boundingBox())!;
  const centreOf = async () => {
    const box = (await page.locator(chip(id!)).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const inHintSlot = (point: { x: number; y: number }) =>
    point.x - canvas.x > HINT_SLOT.left &&
    point.x - canvas.x < HINT_SLOT.right &&
    point.y - canvas.y > HINT_SLOT.top &&
    point.y - canvas.y < HINT_SLOT.bottom;
  const settle = () => workbench.waitForAnimationFrames(2);

  const grab = await centreOf();
  await page.mouse.move(grab.x + 40, grab.y + 30);
  await page.mouse.move(grab.x, grab.y, { steps: 8 });
  await settle();
  const target = { x: canvas.x + IN_HINT_SLOT.x, y: canvas.y + IN_HINT_SLOT.y };
  const drag = await glideSamplingElement(
    page,
    chip(id!),
    glidePath([grab, target]),
    settle,
    { press: true },
  );
  expectGlideFollowed(drag, {
    what: "the dragged chip",
    followsPointer: true,
    expectedOffset: { x: 0, y: 0 },
  });
  const dropped = await centreOf();
  expect(inHintSlot(dropped), "premise: dropped inside the hint slot").toBe(
    true,
  );

  const frames = await recordAnnotationChips(workbench, [id!], () =>
    page.mouse.up(),
  );
  const moves = frames.flatMap(({ x, y }, index) => {
    const moved = Math.hypot(x - dropped.x, y - dropped.y);
    return moved > 3
      ? [
          `frame ${index}: drawn ${moved.toFixed(1)} px from where it was dropped (${Math.round(x)}, ${Math.round(y)})`,
        ]
      : [];
  });
  expect(
    frames.length,
    "frames were recorded after the release",
  ).toBeGreaterThan(0);
  expect(
    moves.slice(0, 4),
    "after the release the chip stays where it was dropped",
  ).toEqual([]);
  await expect(page.locator(leader(id!))).toHaveCount(0);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  await workbench.reloadPreservingRepositoryStorage();
  await page
    .getByRole("button", { name: /^Select .*Double-click to reopen\.$/ })
    .filter({ hasText: /Sketch/ })
    .first()
    .dblclick({ timeout: 30_000 });
  await workbench.expectSketchSessionActive();
  await expect(page.locator(chip(id!))).toBeVisible({ timeout: 30_000 });
  await workbench.waitForAnimationFrames(3);
  const reopened = await centreOf();
  expect(
    Math.hypot(reopened.x - dropped.x, reopened.y - dropped.y),
    `after a reload the chip is drawn where it was dropped: (${Math.round(reopened.x)}, ${Math.round(reopened.y)}) vs (${Math.round(dropped.x)}, ${Math.round(dropped.y)})`,
  ).toBeLessThanOrEqual(3);
  await expect(page.locator(leader(id!))).toHaveCount(0);
});
