import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the Extend and Split tools in the real
// workbench → the exact edit-intersection query in the derivation worker's
// `editQuery` lane → one labelled authored action (T10g-2) → Undo/Redo.
// Only the browser composes the module worker, the session and the kernel.

async function expectStaged(
  workbench: FeatureWorkbenchHarness,
  count: number,
  timeout = 15_000,
) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout })
    .toContain(`${count} entities staged`);
}

/** Hovers along `points` and clicks the first one whose hover target is a line entity. */
async function clickLine(
  workbench: FeatureWorkbenchHarness,
  points: readonly { x: number; y: number }[],
) {
  for (const point of points) {
    await workbench.hoverViewportAt(point);
    await workbench.waitForAnimationFrames();
    if (/sketch_entity_\d+_line/.test(await workbench.currentHoverTarget())) {
      await workbench.clickViewportAt(point);
      return;
    }
  }
  throw new Error(`No line is hoverable along ${JSON.stringify(points)}.`);
}

const across = (fixed: number, from: number, to: number, vertical: boolean) =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    vertical ? { x: from + index, y: fixed } : { x: fixed, y: from + index },
  );

/** A horizontal line y = 450 from x = 500 to 800 and a vertical line at `x`. */
async function twoLines(page: Page, x: number) {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 500, y: 450 });
  await workbench.clickViewportAt({ x: 800, y: 450 });
  await expectStaged(workbench, 1);
  await page.keyboard.press("Escape");
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x, y: 300 });
  await workbench.clickViewportAt({ x, y: 600 });
  await expectStaged(workbench, 2);
  await page.keyboard.press("Escape");
  return workbench;
}

for (const [tool, label, boundaryX, entities] of [
  ["Extend a sketch curve to a supported boundary.", "Extend", 1000, 2],
  ["Split a sketch curve at a supported boundary.", "Split", 650, 3],
] as const)
  test(`${label} a line by a line: one '${label}' action; Undo and Redo replay it`, async ({
    page,
  }) => {
    const workbench = await twoLines(page, boundaryX);
    await workbench.activateTool(tool);
    // Target (the horizontal line, away from the boundary), then boundary.
    await clickLine(workbench, across(575, 444, 456, false));
    await clickLine(workbench, across(520, boundaryX - 6, boundaryX + 6, true));
    const undoAction = page
      .locator('[data-history-action-direction="undo"]')
      .filter({ hasText: label });
    await expect(undoAction).toBeVisible({ timeout: 60_000 });
    await expectStaged(workbench, entities);

    await page.keyboard.press("Escape");
    const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
    await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page
        .locator('[data-history-action-direction="redo"]')
        .filter({ hasText: label }),
    ).toBeVisible();
    await expectStaged(workbench, 2);
    await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(undoAction).toBeVisible();
    await expectStaged(workbench, entities);
  });
