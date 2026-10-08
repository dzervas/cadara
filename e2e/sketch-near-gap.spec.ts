import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the T13k near-gap warning (D26) in the
// real workbench: the passive glyph projected over the canvas without
// intercepting it, the hover through the viewport pick stack, the hint
// chip and its Merge… arming the T13j tool through the editor reducer,
// Enter through the shortcut layer, the live region worker, and Undo.
// Only the browser composes these.

const P = { x: 600, y: 540 };
const Q = { x: 840, y: 540 };
const R = { x: 720, y: 340 };
// 6 px left of and above P: a near gap (8.5 px < 12 px) that crosses no side.
const GAP_END = { x: 594, y: 534 };

async function expectRegionCount(
  workbench: FeatureWorkbenchHarness,
  count: number,
  message: string,
) {
  await expect
    .poll(
      async () => {
        const regions = await workbench.page.evaluate(
          () => window.__cadaraDebug?.getSketchSnapshot()?.liveRegions ?? null,
        );
        return regions?.status === "pending" ? null : (regions?.count ?? null);
      },
      { message, timeout: 30_000 },
    )
    .toBe(count);
}

test("T13k: a near gap shows a passive glyph; hovering its end offers Merge…, which stages the merge for Enter; Undo brings the gap back; the ring follows zoom", async ({
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

  // A Line chain P → Q → R, then R → near P placed freely with Shift.
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(P);
  await workbench.clickViewportAt(Q);
  await workbench.clickViewportAt(R);
  await page.keyboard.down("Shift");
  await workbench.clickViewportAt(GAP_END);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("3 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expectRegionCount(workbench, 0, "premise: the near gap bounds nothing");

  // One glyph, centred between the two ends, that does not take the pointer.
  const glyph = page.getByTestId("sketch-near-gap-glyph");
  await expect(glyph).toHaveCount(1);
  const canvasBox = (await workbench.viewport().boundingBox())!;
  const glyphBox = (await glyph.boundingBox())!;
  const centre = {
    x: glyphBox.x + glyphBox.width / 2,
    y: glyphBox.y + glyphBox.height / 2,
  };
  expect(
    Math.abs(centre.x - (canvasBox.x + (P.x + GAP_END.x) / 2)),
  ).toBeLessThan(2);
  expect(
    Math.abs(centre.y - (canvasBox.y + (P.y + GAP_END.y) / 2)),
  ).toBeLessThan(2);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      centre,
    ),
    "the glyph never intercepts: the canvas is under the pointer",
  ).toBe("CANVAS");
  // Premise: hovering a joined corner (Q) shows no near-gap hint.
  await workbench.hoverViewportAt(Q);
  await expect
    .poll(() => workbench.currentHoverTarget())
    .toMatch(/sketch_point_/);
  await expect(page.getByTestId("sketch-near-gap-hint")).toHaveCount(0);

  // Hovering the gap end shows the hint, kept while moving onto the chip.
  await workbench.hoverViewportAt(GAP_END);
  await expect
    .poll(() => workbench.currentHoverTarget())
    .toMatch(/sketch_point_/);
  const source = (await workbench.currentHoverTarget()).match(
    /sketch_point_[\w-]+/,
  )![0];
  const hint = page.getByTestId("sketch-near-gap-hint");
  await expect(hint).toBeVisible();
  // P is the start of the first line (review Q3: the partner's role).
  await expect(hint).toContainText(/^Near gap to Line 1 start — not joined/);
  await hint.getByRole("button", { name: "Merge…" }).click();

  // Armed and staged: the partner is the labelled destination, the
  // floating Merge waits, and nothing has merged yet.
  const label = page.locator(
    '[data-sketch-viewport-overlay="referenceLabel"]',
    { hasText: /^Destination$/ },
  );
  await expect(label).toBeVisible();
  const floating = page.locator(
    '[data-sketch-viewport-floating-input="merge-points-confirm"]',
  );
  await expect(floating.getByRole("button", { name: "Merge" })).toBeVisible();
  // T13j's destination accent: the editor selection holds the destination,
  // the partner at P (not the hovered source), labelled just above P.
  const selection = await workbench.currentEditorSelection();
  expect(selection).toMatch(/sketch_point_/);
  expect(selection, "the hovered end is the source").not.toContain(source);
  const labelBox = (await label.boundingBox())!;
  expect(
    Math.abs(labelBox.x + labelBox.width / 2 - (canvasBox.x + P.x)),
    "the Destination label is centred on P",
  ).toBeLessThan(2);
  await expect(hint, "the hint hides while a tool is active").toBeHidden();
  const undoMerge = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Merge Points" });
  await expect(undoMerge, "Merge… itself merges nothing").toHaveCount(0);
  await expect(glyph).toHaveCount(1);
  await expectRegionCount(workbench, 0, "nothing merged before the confirm");

  // Enter confirms: merged, the glyph is gone, the region forms.
  await page.keyboard.press("Enter");
  await expect(undoMerge).toBeVisible({ timeout: 15_000 });
  await expect(glyph).toHaveCount(0);
  await expectRegionCount(workbench, 1, "the merged join closes the triangle");

  // Undo brings the gap and its glyph back.
  await page.keyboard.press("Escape");
  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page
      .locator('[data-history-action-direction="redo"]')
      .filter({ hasText: "Merge Points" }),
  ).toBeVisible();
  await expectRegionCount(workbench, 0, "Undo reopens the gap");
  await expect(glyph).toHaveCount(1);

  // Review R2: the threshold is in screen px and follows the camera. Zoom
  // in about P: the ring grows with the gap, then goes once it passes
  // 12 px. Zoom back out past the start: the ring returns, smaller, on the
  // gap's two ends.
  // Last, since it moves the camera off the fixed screen points above.
  await workbench.hoverViewportAt(P);
  const start = (await glyph.boundingBox())!;
  let ticks = 0;
  let lastWidth = start.width;
  for (; ticks < 20 && (await glyph.count()) > 0; ticks += 1) {
    await page.mouse.wheel(0, -120);
    await workbench.waitForAnimationFrames(6);
    // boundingBox would wait for a glyph that is gone (also if it goes
    // between the count and the read, while damping settles).
    const box =
      (await glyph.count()) > 0
        ? await glyph.boundingBox({ timeout: 1_000 }).catch(() => null)
        : null;
    if (box) {
      expect(box.width, "zooming in widens the gap").toBeGreaterThan(lastWidth);
      lastWidth = box.width;
    }
  }
  await expect(glyph, "past 12 px on screen: no near gap").toHaveCount(0);
  expect(ticks, "premise: it took several zoom steps").toBeGreaterThan(1);
  for (let i = 0; i < ticks + 3; i += 1) await page.mouse.wheel(0, 120);
  await workbench.waitForAnimationFrames(10);
  await expect(glyph, "zoomed back out: the ring returns").toHaveCount(1);
  const zoomedOut = (await glyph.boundingBox())!;
  expect(zoomedOut.width, "further out than at the start").toBeLessThan(
    start.width,
  );
  const pointIds = (await glyph.getAttribute("data-point-ids"))!.split(" ");
  await workbench.hoverViewportAt({
    x: zoomedOut.x + zoomedOut.width / 2 - canvasBox.x,
    y: zoomedOut.y + zoomedOut.height / 2 - canvasBox.y,
  });
  await expect
    .poll(
      async () => {
        const hovered = await workbench.currentHoverTarget();
        return pointIds.some((pointId) => hovered.includes(pointId));
      },
      { message: "the returned ring sits on the gap's ends" },
    )
    .toBe(true);
});
