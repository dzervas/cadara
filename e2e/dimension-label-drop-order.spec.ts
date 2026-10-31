import { expect, test, type Page } from "@playwright/test";

import { recordAnnotationChips } from "./helpers/annotation-chip-frames";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: a dimension chip dropped onto another
// chip, then the editor's undo, a sketch reopen or a reload, through the real
// annotation layout and the persisted document. Which of
// two chips sharing an anchor keeps it is decided by the layout from the
// committed placements (user-placed first, then the latest drop), which only
// the browser renders. The row records both chips at every frame and DOM
// change after the undo: each may only be drawn where it was before the drag
// or where the drop left it, and both must end where they were before the
// drag.
test.use({ viewport: { width: 1440, height: 960 } });
test.setTimeout(180_000);

const chip = (id: string) => `[data-sketch-annotation-id="${id}"]`;
type Point = { x: number; y: number };

async function centreOf(page: Page, id: string): Promise<Point> {
  const box = (await page.locator(chip(id)).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function leaveTool(workbench: SketchWorkbenchHarness) {
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
}

/**
 * Two horizontal lines and their length dimensions, both labels placed by
 * the Dimension tool on one anchor between the lines: the lower id keeps the
 * anchor, the higher id is displaced.
 */
async function twoChipsOnOneAnchor(
  workbench: SketchWorkbenchHarness,
  open = () => workbench.open(),
) {
  const page = workbench.page;
  await open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  for (const [index, y] of [380, 460].entries()) {
    await workbench.activateTool("Create line geometry.");
    await workbench.clickViewportAt({ x: 500, y });
    await workbench.clickViewportAt({ x: 760, y });
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${index + 1} entities staged`);
    await leaveTool(workbench);
  }
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  for (const y of [380, 460]) {
    await workbench.openToolMenu("Create point-to-point distance dimensions.");
    await page
      .getByRole("menuitem", {
        name: /Distance Create aligned distance dimensions/,
      })
      .click();
    await workbench.clickViewportAt({ x: 600, y });
    await workbench.clickViewportAt({ x: 630, y: 420 });
    await expect(floatingInput).toBeVisible();
    await floatingInput
      .getByRole("button", { name: /^Commit$/ })
      .first()
      .click();
    await expect(floatingInput).toBeHidden();
    await leaveTool(workbench);
  }
  const ids = await page.evaluate(() =>
    (
      window.__cadaraDebug?.getSketchSnapshot()?.definition?.dimensions ?? []
    ).map((dimension) => dimension.dimensionId as string),
  );
  expect(ids, "premise: two dimensions").toHaveLength(2);
  await workbench.waitForAnimationFrames(3);
  const [lower, higher] = [...ids].sort() as [string, string];
  return { lower, higher };
}

/** Presses on `id`'s centre, moves 60 px down, then onto `onto`, releases. */
async function dropChip(
  workbench: SketchWorkbenchHarness,
  id: string,
  onto: Point,
) {
  const page = workbench.page;
  const from = await centreOf(page, id);
  await page.mouse.move(from.x + 40, from.y + 30);
  await page.mouse.move(from.x, from.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 60, { steps: 12 });
  await page.mouse.move(onto.x, onto.y, { steps: 12 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  for (let round = 0; round < 6; round += 1) {
    await workbench.waitForAnimationFrames(2);
  }
}

const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= 3;

test("undoing a chip's drop onto another chip puts both chips back where they were before the drag", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const { lower, higher } = await twoChipsOnOneAnchor(workbench);
  const before = {
    [lower]: await centreOf(page, lower),
    [higher]: await centreOf(page, higher),
  };
  expect(
    near(before[lower]!, before[higher]!),
    "premise: the higher-id chip is displaced off the shared anchor",
  ).toBe(false);

  await dropChip(workbench, higher, before[lower]!);
  const dropped = {
    [lower]: await centreOf(page, lower),
    [higher]: await centreOf(page, higher),
  };
  expect(
    near(dropped[higher]!, before[lower]!) &&
      !near(dropped[lower]!, before[lower]!),
    "premise: the dropped chip took the anchor and displaced the other",
  ).toBe(true);

  const frames = await recordAnnotationChips(workbench, [lower, higher], () =>
    page.keyboard.press("Control+z"),
  );
  expect(frames.length, "frames were recorded after the undo").toBeGreaterThan(
    0,
  );
  const strays = frames.flatMap(({ id, x, y }, index) =>
    near({ x, y }, before[id]!) || near({ x, y }, dropped[id]!)
      ? []
      : [
          `frame ${index}: ${id === lower ? "the covered chip" : "the dropped chip"} drawn at (${Math.round(x)}, ${Math.round(y)})`,
        ],
  );
  expect(
    strays.slice(0, 4),
    "after the undo each chip is only drawn where it was before the drag or where the drop left it",
  ).toEqual([]);
  for (const id of [lower, higher]) {
    const last = frames.filter((frame) => frame.id === id).at(-1)!;
    expect(
      near(last, before[id]!),
      `${id === lower ? "the covered chip" : "the dropped chip"} is back where it was before the drag: (${Math.round(last.x)}, ${Math.round(last.y)}) vs (${Math.round(before[id]!.x)}, ${Math.round(before[id]!.y)})`,
    ).toBe(true);
  }
});

const leader = (id: string) => `[data-sketch-annotation-leader="${id}"]`;

async function reopenSketch(workbench: SketchWorkbenchHarness) {
  await workbench.page
    .getByRole("button", { name: /^Select .*Double-click to reopen\.$/ })
    .filter({ hasText: /Sketch/ })
    .first()
    .dblclick({ timeout: 30_000 });
  await workbench.expectSketchSessionActive();
  await workbench.waitForAnimationFrames(3);
}

// The drop order is authored data: after the sketch is finished and reopened,
// or the page reloaded, the chip dropped last still holds the shared anchor
// and the chip it was dropped on is still drawn displaced (with a leader).
for (const after of ["a sketch reopen", "a reload"] as const) {
  test(`a chip dropped onto another chip keeps the shared anchor after ${after}`, async ({
    page,
  }) => {
    const workbench = new SketchWorkbenchHarness(page);
    const { lower, higher } = await twoChipsOnOneAnchor(
      workbench,
      after === "a reload"
        ? () => workbench.openWithRepository()
        : () => workbench.open(),
    );
    await expect(
      page.locator(leader(higher)),
      "premise: the higher-id chip is displaced off the shared anchor",
    ).toBeAttached();
    await dropChip(workbench, higher, await centreOf(page, lower));
    await expect(
      page.locator(leader(lower)),
      "premise: the dropped chip took the anchor and displaced the other",
    ).toBeAttached();
    await expect(page.locator(leader(higher))).toHaveCount(0);

    await workbench.activateTool("Exit the active sketch.");
    await workbench.expectMachine("idle");
    if (after === "a reload") {
      await workbench.reloadPreservingRepositoryStorage();
    }
    await reopenSketch(workbench);
    await expect(page.locator(chip(higher))).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(leader(lower)),
      `after ${after}, the chip it was dropped on is still displaced`,
    ).toBeAttached();
    await expect(
      page.locator(leader(higher)),
      `after ${after}, the dropped chip still holds the shared anchor`,
    ).toHaveCount(0);
  });
}
