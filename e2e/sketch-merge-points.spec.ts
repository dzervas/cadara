import { expect, test } from "@playwright/test";

import {
  readHistoryStrip,
  selectRegionInViewport,
  waitForCommittedAction,
} from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { glideClick, glidePress } from "./helpers/mirror-workbench";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the T13j Merge Points tool in the real
// workbench: a near gap placed freely with Shift (T13h), the source and
// destination picks through the viewport pick stack, the destination label
// and floating Merge, Enter through the shortcut layer, the live region
// derivation worker, one labelled action with Undo/Redo, Finish and Extrude.
// Only the browser composes these.

const P = { x: 600, y: 540 };
const Q = { x: 840, y: 540 };
const R = { x: 720, y: 340 };
// 6 px left of and above P: a real near gap that crosses no side.
const GAP_END = { x: 594, y: 534 };

async function liveRegions(workbench: FeatureWorkbenchHarness) {
  return workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.liveRegions ?? null,
  );
}

async function expectRegionCount(
  workbench: FeatureWorkbenchHarness,
  count: number,
  message: string,
) {
  await expect
    .poll(
      async () => {
        const regions = await liveRegions(workbench);
        // T17e (B12): a count is only meaningful while regions are
        // current (an unavailable state counts 0), so the status is part
        // of the expectation.
        return regions?.status === "pending" ? null : regions;
      },
      { message, timeout: 30_000 },
    )
    .toEqual({ status: "current", count });
}

/** Hovers `at` and returns the hovered sketch point key (fails otherwise). */
async function hoveredPoint(
  workbench: FeatureWorkbenchHarness,
  at: { x: number; y: number },
) {
  await workbench.hoverViewportAt(at);
  await workbench.waitForAnimationFrames();
  let hovered = "";
  await expect
    .poll(
      async () => {
        hovered = await workbench.currentHoverTarget();
        return hovered;
      },
      { message: `a sketch point is hovered at ${JSON.stringify(at)}` },
    )
    .toMatch(/sketch_point_/);
  return hovered;
}

test("T13j: a Shift-placed near gap is merged source → destination; the region forms, extrudes, and Undo/Redo replay the merge", async ({
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

  await workbench.activateTool(
    "Merge two sketch points: the first into the second (the destination).",
  );
  const source = await hoveredPoint(workbench, GAP_END);
  await workbench.clickViewportAt(GAP_END);
  const destination = await hoveredPoint(workbench, P);
  expect(destination, "two distinct points").not.toBe(source);
  await workbench.clickViewportAt(P);

  // The destination is highlighted: it carries the selection accent and the
  // "Destination" label; a floating Merge confirms.
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toContain(destination.match(/sketch_point_[\w-]+/)![0]);
  const label = page.locator(
    '[data-sketch-viewport-overlay="referenceLabel"]',
    { hasText: /^Destination$/ },
  );
  await expect(label).toBeVisible();
  const floating = page.locator(
    '[data-sketch-viewport-floating-input="merge-points-confirm"]',
  );
  await expect(floating.getByRole("button", { name: "Merge" })).toBeVisible();
  // Review R-3: the popup occludes neither the label nor the destination.
  const labelBox = (await label.boundingBox())!;
  const popupBox = (await floating.boundingBox())!;
  const canvasBox = (await workbench.viewport().boundingBox())!;
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  expect(
    overlaps(labelBox, popupBox),
    `label ${JSON.stringify(labelBox)} vs popup ${JSON.stringify(popupBox)}`,
  ).toBe(false);
  const destinationOnScreen = {
    x: canvasBox.x + P.x - 6,
    y: canvasBox.y + P.y - 6,
    width: 12,
    height: 12,
  };
  expect(
    overlaps(destinationOnScreen, popupBox),
    "the popup leaves the destination point visible",
  ).toBe(false);
  await expect(floating.locator("input")).toHaveCount(0);
  await expectRegionCount(workbench, 0, "picking authors nothing");

  // Enter confirms: one "Merge Points" action, and the region forms.
  await page.keyboard.press("Enter");
  const undoMerge = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Merge Points" });
  await expect(undoMerge).toBeVisible({ timeout: 15_000 });
  await expect(floating).toBeHidden();
  await expectRegionCount(workbench, 1, "the merged join closes the triangle");

  await page.keyboard.press("Escape");
  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page
      .locator('[data-history-action-direction="redo"]')
      .filter({ hasText: "Merge Points" }),
  ).toBeVisible();
  await expectRegionCount(workbench, 0, "Undo reopens the gap");
  await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(undoMerge).toBeVisible();
  await expectRegionCount(workbench, 1, "Redo merges again");

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  await workbench.activateFeature("extrude");
  let regionTargets: string[] = [];
  await expect
    .poll(
      async () => {
        regionTargets = await page.evaluate(
          () =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
              ) ?? [],
        );
        return regionTargets.length;
      },
      { message: "The merged triangle publishes one region.", timeout: 15_000 },
    )
    .toBe(1);
  await selectRegionInViewport(workbench, regionTargets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);
});

// T17f (T17-9′; Mirror parity, T16d review R-1/A-4; issue 04 :49). Seam:
// the Merge Points confirm popup, the workbench Enter and Escape routes
// and the history strip, with a gliding pointer. A refused pick after a
// staged pair (the other end of the source's line) keeps the popup, and Enter
// merges what it shows (base: the popup vanished while Enter still
// merged). Escape first drops the picks and keeps Merge Points armed with
// no history entry, then leaves the tool (base: one Escape left it).
test("T17f: a refused pick keeps the Merge popup and Enter merges it; Escape drops the picks first, then leaves Merge Points", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  const command = () =>
    page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? null);
  const floating = page.locator(
    '[data-sketch-viewport-floating-input="merge-points-confirm"]',
  );
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await glidePress(
    page,
    page.getByRole("button", { name: /Top Plane/ }).first(),
  );
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create line geometry.");
  for (const at of [P, Q, R]) await glideClick(workbench, at);
  await page.keyboard.down("Shift");
  await glideClick(workbench, GAP_END);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("3 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const history = await readHistoryStrip(page);

  await workbench.activateTool(
    "Merge two sketch points: the first into the second (the destination).",
  );
  const stage = async () => {
    await hoveredPoint(workbench, GAP_END);
    await glideClick(workbench, GAP_END);
    await hoveredPoint(workbench, P);
    await glideClick(workbench, P);
    await expect(floating.getByRole("button", { name: "Merge" })).toBeVisible();
  };
  // R and the source are both ends of the last line: a refused pair, so
  // the pick is not taken (T13j review A-4).
  const refusePick = async () => {
    await hoveredPoint(workbench, R);
    await glideClick(workbench, R);
    // The tool panel's validation (the status line repeats it).
    await expect(
      page
        .getByText(
          /^Both points are ends of .+; merging them would collapse it\.$/,
        )
        .first(),
    ).toBeVisible();
  };

  await stage();
  await refusePick();
  await expect(floating, "the popup stays with the picks").toBeVisible();

  // First Escape: the picks (and the popup) go, Merge Points stays armed,
  // nothing is recorded.
  await page.keyboard.press("Escape");
  await expect(floating).toBeHidden();
  await expect.poll(command).toBe("sketchMergePoints");
  expect(await readHistoryStrip(page)).toEqual(history);

  // Staged again, refused again: Enter merges the pair the popup shows.
  await stage();
  await refusePick();
  await expect(floating).toBeVisible();
  await waitForCommittedAction(page, "Merge Points", () =>
    page.keyboard.press("Enter"),
  );
  await expectRegionCount(workbench, 1, "the merged join closes the triangle");
  await expect(floating).toBeHidden();

  // No picks: Escape leaves the tool.
  await page.keyboard.press("Escape");
  await expect.poll(command).toBe("sketch");
});
