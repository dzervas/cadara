import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the Split tool in the real workbench →
// pointer picking of the target and of the boundary crossing → one labelled
// authored action → Undo/Redo of selectable pieces. The line-by-line Extend
// and Split rows moved to the semantic session
// (src/application/semantic/sketch-extend-split.spec.ts, cadara-d17.6), which
// proves the authored result only: the hover-picking of a target line and its
// boundary line is now unproven in the browser.

async function expectStaged(
  workbench: FeatureWorkbenchHarness,
  count: number,
  timeout = 15_000,
) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout })
    .toContain(`${count} entities staged`);
}

// T13m (user decision Q1): Split of an arc and of a spline. The boundary
// click is the pick (the last sketch pointer); each piece is its own
// selectable entity; Undo restores the curve, Redo the pieces.

/** Hovers along `points` and returns the first point (and its entity id) whose hover target matches `pattern`. */
async function findEntity(
  workbench: FeatureWorkbenchHarness,
  points: readonly { x: number; y: number }[],
  pattern: RegExp,
) {
  for (const point of points) {
    await workbench.hoverViewportAt(point);
    await workbench.waitForAnimationFrames();
    const entity = /sketch_entity_[^.\s,"]+/.exec(
      await workbench.currentHoverTarget(),
    )?.[0];
    if (entity && pattern.test(entity)) return { point, entity };
  }
  throw new Error(
    `No ${pattern} is hoverable along ${JSON.stringify(points)}.`,
  );
}

async function newSketch(page: Page) {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  return workbench;
}

/** Splits the curve found along `target` by the line found along `boundary`, then checks the pieces and Undo/Redo. */
async function splitAndCheck(
  page: Page,
  workbench: FeatureWorkbenchHarness,
  curve: RegExp,
  target: readonly { x: number; y: number }[],
  boundary: readonly { x: number; y: number }[],
  pieces: readonly (readonly { x: number; y: number }[])[],
) {
  await workbench.activateTool("Split a sketch curve at a supported boundary.");
  const picked = await findEntity(workbench, target, curve);
  await workbench.clickViewportAt(picked.point);
  const line = await findEntity(workbench, boundary, /line/);
  await workbench.clickViewportAt(line.point);
  const undoSplit = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Split" });
  await expect(undoSplit).toBeVisible({ timeout: 60_000 });
  await expectStaged(workbench, 3);
  await page.keyboard.press("Escape");

  // Each piece is its own entity, hoverable and selectable.
  const found = [];
  for (const along of pieces) {
    const piece = await findEntity(workbench, along, curve);
    await workbench.clickViewportAt(piece.point);
    await expect
      .poll(() => workbench.currentEditorSelection())
      .toContain(piece.entity);
    found.push(piece.entity);
  }
  expect(new Set(found).size, "two distinct pieces").toBe(2);
  expect(found.some((entity) => /split-/.test(entity))).toBe(true);

  await page.keyboard.press("Escape");
  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page
      .locator('[data-history-action-direction="redo"]')
      .filter({ hasText: "Split" }),
  ).toBeVisible();
  await expectStaged(workbench, 2);
  // The restored curve is one entity again: both former pieces hover it.
  const restored = await Promise.all(
    [pieces[0]!, pieces[1]!].map(
      async (along) => (await findEntity(workbench, along, curve)).entity,
    ),
  );
  expect(restored[0]).toBe(restored[1]);
  await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(undoSplit).toBeVisible();
  await expectStaged(workbench, 3);
}

/** Points (x, y0…y1) every 2 px. */
const column = (x: number, y0: number, y1: number) =>
  Array.from({ length: Math.floor((y1 - y0) / 2) + 1 }, (_, index) => ({
    x,
    y: y0 + 2 * index,
  }));

test("T13m: Split an arc by a line: one 'Split' action, two selectable arcs; Undo restores the arc, Redo the pieces", async ({
  page,
}) => {
  const workbench = await newSketch(page);
  // A 3-point arc (start, through, end) (640,520) → (750,430) → (860,520):
  // centre ≈ (750, 542.2), radius ≈ 112.2.
  await workbench.activateTool(
    "Create an arc from center, start, and end points.",
  );
  await page.getByRole("menuitem", { name: /3-Point Arc/ }).click();
  for (const position of [
    { x: 640, y: 520 },
    { x: 750, y: 430 },
    { x: 860, y: 520 },
  ])
    await workbench.clickViewportAt(position);
  await expectStaged(workbench, 1);
  await page.keyboard.press("Escape");
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 720, y: 380 });
  await workbench.clickViewportAt({ x: 720, y: 600 });
  await expectStaged(workbench, 2);
  await page.keyboard.press("Escape");

  await splitAndCheck(
    page,
    workbench,
    /arc/i,
    column(820, 430, 460),
    column(720, 540, 590),
    [column(820, 430, 460), column(660, 460, 490)],
  );
});

test("T13m: Split a spline by a line: one 'Split' action, two selectable splines; Undo restores the spline, Redo the pieces", async ({
  page,
}) => {
  const workbench = await newSketch(page);
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 540, y: 620 });
  await workbench.clickViewportAt({ x: 760, y: 360 });
  await workbench.clickViewportAt({ x: 980, y: 620 });
  // Enter finalizes the spline (T11i); a tool switch would discard it.
  await page.keyboard.press("Enter");
  await expectStaged(workbench, 1);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 700, y: 330 });
  await workbench.clickViewportAt({ x: 700, y: 680 });
  await expectStaged(workbench, 2);
  await page.keyboard.press("Escape");

  await splitAndCheck(
    page,
    workbench,
    /spline/i,
    column(880, 380, 500),
    column(700, 600, 660),
    [column(880, 380, 500), column(620, 400, 560)],
  );
});

test("T13m: the boundary click picks the crossing: a line crossed twice by a circle is split where the circle was clicked (the far crossing)", async ({
  page,
}) => {
  const workbench = await newSketch(page);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 500, y: 450 });
  await workbench.clickViewportAt({ x: 800, y: 450 });
  await expectStaged(workbench, 1);
  await page.keyboard.press("Escape");
  // Centre (650,470), radius 100: it crosses the line at x ≈ 552 and 748.
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 650, y: 470 });
  await workbench.clickViewportAt({ x: 650, y: 370 });
  await expectStaged(workbench, 2);
  await page.keyboard.press("Escape");

  await workbench.activateTool("Split a sketch curve at a supported boundary.");
  const line = await findEntity(workbench, column(620, 444, 456), /line/);
  await workbench.clickViewportAt(line.point);
  // The circle's rim near the right crossing (angle ≈ 31° above +x).
  const rim = Array.from({ length: 13 }, (_, index) => {
    const angle = ((25 + index) * Math.PI) / 180;
    return {
      x: Math.round(650 + 100 * Math.cos(angle)),
      y: Math.round(470 - 100 * Math.sin(angle)),
    };
  });
  const circle = await findEntity(workbench, rim, /circle/);
  await workbench.clickViewportAt(circle.point);
  await expect(
    page
      .locator('[data-history-action-direction="undo"]')
      .filter({ hasText: "Split" }),
  ).toBeVisible({ timeout: 60_000 });
  await expectStaged(workbench, 3);
  await page.keyboard.press("Escape");
  // Cut at x ≈ 748: x = 600 and 700 are still the original line, 780 the piece.
  const at = async (x: number) =>
    (await findEntity(workbench, column(x, 444, 456), /line/)).entity;
  expect(await at(600)).toBe(line.entity);
  expect(await at(700)).toBe(line.entity);
  expect(await at(780)).toMatch(/split-line/);
});
