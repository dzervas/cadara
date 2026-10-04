import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the Trim tool in the real workbench →
// the exact edit-intersection query in the dedicated derivation worker's
// `editQuery` lane → one labelled authored action (T10g-1) → Undo/Redo →
// Finish (kernel publish + regions) → the extrude feature's region list.
// Only the browser composes the module worker, the session and the kernel.

const REGION_TARGET = /^sketch_.+\.region_[0-9a-f]{32}$/;

async function expectStaged(
  workbench: FeatureWorkbenchHarness,
  count: number,
  timeout = 15_000,
) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout })
    .toContain(`${count} entities staged`);
}

async function regionTargets(page: Page) {
  return page.evaluate(
    (pattern) =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          new RegExp(pattern).test(target),
        ) ?? [],
    REGION_TARGET.source,
  );
}

test("T10g-3b: a spline arch closed by a line and crossed by two lines: Trim removes the arch between them (one 'Trim' action, two spline pieces), Undo and Redo replay it, and the two outer regions remain", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  // A 3-point native spline arch closed by a line snapped to both its ends.
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 540, y: 620 });
  await workbench.clickViewportAt({ x: 760, y: 360 });
  await workbench.clickViewportAt({ x: 980, y: 620 });
  await expectStaged(workbench, 1);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 980, y: 620 });
  await workbench.clickViewportAt({ x: 540, y: 620 });
  await expectStaged(workbench, 2);
  // Two lines crossing the arch and its closing line: three regions.
  for (const [x, count] of [
    [640, 3],
    [880, 4],
  ] as const) {
    await workbench.activateTool("Create line geometry.");
    await workbench.clickViewportAt({ x, y: 330 });
    await workbench.clickViewportAt({ x, y: 680 });
    await expectStaged(workbench, count);
  }

  await workbench.activateTool("Trim sketch segments.");
  let clicked = false;
  // The arch's curve body (not one of its fit points).
  const archEntity = /\.sketch_entity_[^.]*spline/i;
  for (let y = 350; y <= 440 && !clicked; y += 2) {
    await workbench.hoverViewportAt({ x: 700, y });
    await workbench.waitForAnimationFrames();
    if (archEntity.test(await workbench.currentHoverTarget())) {
      await workbench.clickViewportAt({ x: 700, y });
      clicked = true;
      // The arch keeps its two outside pieces (one new spline entity).
      await expectStaged(workbench, 5, 60_000);
    }
  }
  expect(clicked, "the arch is hoverable between the two lines").toBe(true);
  const undoTrim = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Trim" });
  await expect(undoTrim).toBeVisible();

  await page.keyboard.press("Escape");
  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expectStaged(workbench, 4);
  await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
  await expectStaged(workbench, 5);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  await expect
    .poll(async () => (await regionTargets(page)).length, {
      message:
        "After the Trim the two outer regions remain (three before: the middle one lost its arch).",
      timeout: 30_000,
    })
    .toBe(2);
});

test("a rectangle crossed by a line: Trim removes the line inside it (one 'Trim' action), Undo and Redo replay it, and the rectangle is one region", async ({
  page,
}, testInfo) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 640, y: 420 });
  await workbench.clickViewportAt({ x: 860, y: 580 });
  await expectStaged(workbench, 4);
  // A line crossing the top and bottom sides: it splits the rectangle in two.
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 801, y: 350 });
  await workbench.clickViewportAt({ x: 801, y: 650 });
  await expectStaged(workbench, 5);

  await workbench.activateTool("Trim sketch segments.");
  let clicked = false;
  for (let x = 794; x <= 808 && !clicked; x += 1) {
    await workbench.hoverViewportAt({ x, y: 540 });
    await workbench.waitForAnimationFrames();
    if (/line/i.test(await workbench.currentHoverTarget())) {
      const started = Date.now();
      await workbench.clickViewportAt({ x, y: 540 });
      clicked = true;
      // The crossing line keeps its two outside pieces (one new entity).
      await expectStaged(workbench, 6, 60_000);
      testInfo.annotations.push({
        type: "first-trim-click-to-applied-ms",
        description: String(Date.now() - started),
      });
    }
  }
  expect(clicked, "the crossing line is hoverable inside the rectangle").toBe(
    true,
  );
  const undoTrim = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Trim" });
  await expect(undoTrim).toBeVisible();

  await page.keyboard.press("Escape");
  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expectStaged(workbench, 5);
  await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
  await expectStaged(workbench, 6);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  await expect
    .poll(async () => (await regionTargets(page)).length, {
      message:
        "After the Trim the rectangle is one region (two before: the line split it).",
      timeout: 30_000,
    })
    .toBe(1);
});
