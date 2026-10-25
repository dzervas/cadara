import { expect, test, type Locator, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the T14d annotation layout in the real
// workbench: label extents are estimated (no DOM measurement), so only the
// browser can pin the estimate against real DOM widths and prove that chips
// keep clear of each other, of the near-gap ring, of the Merge Points
// "Source"/"Destination" labels and of the sketch tool panel, and that a
// wheel over a chip reaches the camera controls on the canvas. The mouse
// glides (several `mouse.move` steps) wherever it ends over an overlay.
test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

type ViewportPoint = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

const chipSelector = '[data-sketch-annotation-kind="dimension"]';

async function openSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

async function leaveTool(workbench: SketchWorkbenchHarness) {
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
}

async function drawLine(
  workbench: SketchWorkbenchHarness,
  start: ViewportPoint,
  end: ViewportPoint,
  staged: string,
) {
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(start);
  await workbench.clickViewportAt(end);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain(`${staged} staged`);
  await leaveTool(workbench);
}

/** An aligned distance on the line under `pick`, its label placed at `place`. */
async function dimensionLine(
  workbench: SketchWorkbenchHarness,
  pick: ViewportPoint,
  place: ViewportPoint,
  count: number,
  value?: string,
) {
  const page = workbench.page;
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt(pick);
  await workbench.clickViewportAt(place);
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  if (value) {
    await floatingInput.locator("input").first().fill(value);
  }
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await leaveTool(workbench);
  await expect(page.locator(chipSelector)).toHaveCount(count);
}

/**
 * T14e: collapses the right-side Constraints list (its header stays), so the
 * canvas under the expanded list takes clicks again; returns the collapsed
 * panel's box.
 */
async function collapseConstraintList(page: Page) {
  await page
    .getByRole("button", { name: "Collapse the constraints list" })
    .click();
  const panel = page.locator("[data-sketch-constraint-list]");
  await expect(panel).toHaveAttribute("data-collapsed", "true");
  return (await panel.boundingBox())!;
}

async function boxes(locator: Locator) {
  const result: Box[] = [];
  for (const element of await locator.all()) {
    const box = await element.boundingBox();
    if (box) result.push(box);
  }
  return result;
}

/** The gap between two boxes (negative: they overlap). */
function separation(left: Box, right: Box) {
  return Math.max(
    right.x - (left.x + left.width),
    left.x - (right.x + right.width),
    right.y - (left.y + left.height),
    left.y - (right.y + right.height),
  );
}

function expectClear(left: Box, right: Box, message: string) {
  expect(separation(left, right), message).toBeGreaterThanOrEqual(0);
}

/**
 * T17j (D8): two chips keep the layout's 6 px gap
 * (`SKETCH_ANNOTATION_LAYOUT_GAP_PX`) with their real DOM widths, not just
 * no overlap (the width estimate covers each real chip, so the real gap is
 * at least the laid-out one).
 */
function expectLayoutGap(left: Box, right: Box, message: string) {
  expect(separation(left, right), message).toBeGreaterThanOrEqual(6);
}

/** Real chip widths against the T14d estimate (40 px frame + 7 px/char). */
async function expectEstimateCoversChips(page: Page) {
  const chips = await page.locator(chipSelector).all();
  for (const chip of chips) {
    const text = (await chip.innerText()).trim();
    const box = (await chip.boundingBox())!;
    const estimate = 40 + [...text].length * 7;
    expect(
      box.width,
      `the estimate covers the real "${text}" chip (${box.width} px)`,
    ).toBeLessThanOrEqual(estimate);
    expect(
      box.width,
      `the estimate is tight for "${text}" (${box.width} px vs ${estimate})`,
    ).toBeGreaterThanOrEqual(estimate - 8);
    expect(box.height).toBeLessThanOrEqual(32);
  }
}

async function expectChipsInsideCanvas(page: Page) {
  const canvas = (await page.locator("main canvas").first().boundingBox())!;
  for (const box of await boxes(page.locator(chipSelector))) {
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  }
}

test("T14d: two dimension chips on one anchor keep clear with real DOM widths; a wheel over a chip zooms the camera", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await drawLine(
    workbench,
    { x: 500, y: 380 },
    { x: 760, y: 380 },
    "1 entities",
  );
  await drawLine(
    workbench,
    { x: 500, y: 460 },
    { x: 760, y: 460 },
    "2 entities",
  );
  // Both labels placed on the middle line: one shared anchor.
  await dimensionLine(workbench, { x: 600, y: 380 }, { x: 630, y: 420 }, 1);
  await dimensionLine(workbench, { x: 600, y: 460 }, { x: 630, y: 420 }, 2);
  await workbench.waitForAnimationFrames(3);

  const chips = await boxes(page.locator(chipSelector));
  expect(chips).toHaveLength(2);
  expectLayoutGap(chips[0]!, chips[1]!, "the two chips keep the 6 px gap");
  await expectEstimateCoversChips(page);
  await expectChipsInsideCanvas(page);

  // A-7: drag the displaced chip 60 px down (away from the shared anchor).
  // It stays where it was grabbed and follows the drag; the layout never
  // re-places it onto its now free anchor under the pointer's side.
  const centres = chips.map((box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }));
  const displacedIndex = centres[0]!.x > centres[1]!.x ? 0 : 1;
  const grabbed = centres[displacedIndex]!;
  const dragged = page.locator(chipSelector).nth(displacedIndex);
  await page.mouse.move(grabbed.x + 30, grabbed.y + 30);
  await page.mouse.move(grabbed.x, grabbed.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.move(grabbed.x, grabbed.y + 30, { steps: 6 });
  await workbench.waitForAnimationFrames(4);
  const midDrag = (await dragged.boundingBox())!;
  await page.mouse.move(grabbed.x, grabbed.y + 60, { steps: 6 });
  await workbench.waitForAnimationFrames(4);
  const duringDrag = (await dragged.boundingBox())!;
  for (const box of [midDrag, duringDrag]) {
    expect(
      Math.abs(box.x + box.width / 2 - grabbed.x),
      "the dragged chip does not jump sideways onto its free anchor",
    ).toBeLessThan(3);
  }
  expect(
    Math.abs(duringDrag.y - midDrag.y - 30),
    "the dragged chip follows the drag",
  ).toBeLessThan(3);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  const afterDrag = await boxes(page.locator(chipSelector));
  expectLayoutGap(
    afterDrag[0]!,
    afterDrag[1]!,
    "after the drag the chips keep the 6 px gap",
  );

  // T14b review A-6: a wheel over an interactive chip zooms (out), so the
  // chips move toward the view centre; the chip is a control here.
  const chip = page.locator(chipSelector).first();
  await expect(chip).toHaveAttribute(
    "data-sketch-annotation-interactive",
    "true",
  );
  const before = (await chip.boundingBox())!;
  const centre = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  };
  await page.mouse.move(centre.x + 40, centre.y + 30);
  await page.mouse.move(centre.x, centre.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-sketch-annotation-kind]")
          ? "chip"
          : "other",
      centre,
    ),
    "premise: the wheel happens over the chip",
  ).toBe("chip");
  // Review R-3: the trusted wheel over the chip is default-prevented (no
  // page zoom on Ctrl+wheel / pinch), with and without Ctrl.
  await page.evaluate(() => {
    const record = window as unknown as { __t14dWheel: string[] };
    record.__t14dWheel = [];
    window.addEventListener("wheel", (event) => {
      if (event.isTrusted) {
        record.__t14dWheel.push(
          `${event.ctrlKey ? "ctrl" : "plain"}:${event.defaultPrevented}`,
        );
      }
    });
  });
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 40);
  await page.keyboard.up("Control");
  await workbench.waitForAnimationFrames(4);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, 400);
  await workbench.waitForAnimationFrames(20);
  expect(
    await page.evaluate(
      () => (window as unknown as { __t14dWheel: string[] }).__t14dWheel,
    ),
    "both trusted wheels over the chip were default-prevented",
  ).toEqual(["ctrl:true", "plain:true"]);
  const after = (await boxes(page.locator(chipSelector))).map((box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }));
  const moved = Math.max(
    ...after.map((point) => Math.hypot(point.x - centre.x, point.y - centre.y)),
  );
  expect(
    Math.min(
      ...after.map((point) =>
        Math.hypot(point.x - centre.x, point.y - centre.y),
      ),
    ),
    "the wheel over the chip zoomed: no chip is where it was",
  ).toBeGreaterThan(5);
  expect(moved).toBeGreaterThan(5);
});

// The T13k near gap: a chain P → Q → R, then R → near P (Shift: free).
const P = { x: 600, y: 540 };
const Q = { x: 840, y: 540 };
const R = { x: 720, y: 340 };
const GAP_END = { x: 594, y: 534 };

test("T14d: a dimension chip anchored on the near-gap ring keeps clear of it, and of the Merge Source/Destination labels", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
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
  await leaveTool(workbench);
  // A line below P; its label placed so the chip anchor (dimension line
  // midpoint, 18 px up) is the ring centre.
  await drawLine(
    workbench,
    { x: 530, y: 640 },
    { x: 664, y: 640 },
    "4 entities",
  );
  await dimensionLine(workbench, { x: 560, y: 640 }, { x: 597, y: 555 }, 1);
  await workbench.waitForAnimationFrames(3);

  const ring = page.getByTestId("sketch-near-gap-glyph");
  await expect(ring, "premise: the near gap ring").toHaveCount(1);
  const ringBox = (await ring.boundingBox())!;
  const chip = page.locator(chipSelector);
  const chipBox = (await chip.boundingBox())!;
  expectClear(chipBox, ringBox, "the chip keeps clear of the near-gap ring");
  await expectEstimateCoversChips(page);

  // Merge… from the gap end: Source and Destination labels above the ends.
  await workbench.hoverViewportAt(GAP_END);
  const hint = page.getByTestId("sketch-near-gap-hint");
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "Merge…" }).click();
  const labels = page.locator(
    '[data-sketch-viewport-overlay="referenceLabel"]',
  );
  await expect(labels.filter({ hasText: /^Destination$/ })).toBeVisible();
  await workbench.waitForAnimationFrames(3);
  const mergedChip = (await chip.boundingBox())!;
  for (const label of await boxes(labels)) {
    expectClear(mergedChip, label, "the chip keeps clear of a merge label");
  }
  expectClear(mergedChip, (await ring.boundingBox())!, "and of the ring");
  // The labels and the ring never take the pointer (A4).
  for (const box of [...(await boxes(labels)), (await ring.boundingBox())!]) {
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      ),
    ).toBe("CANVAS");
  }
});

test("T14d: a dimension chip under the sketch tool panel moves clear of it when a tool shows the panel", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  // Below the tool panel (top 76, ~155 px tall at this width); the label
  // placed so the chip's top half reaches into the panel's rect.
  await drawLine(
    workbench,
    { x: 300, y: 288 },
    { x: 500, y: 288 },
    "1 entities",
  );
  await dimensionLine(workbench, { x: 340, y: 288 }, { x: 400, y: 248 }, 1);
  const chip = page.locator(chipSelector);
  const idleChip = (await chip.boundingBox())!;

  await workbench.activateTool("Create line geometry.");
  const panel = page.locator(".mantine-Paper-root", {
    hasText: "Pick line start",
  });
  await expect(panel.first(), "premise: the tool panel shows").toBeVisible();
  await workbench.waitForAnimationFrames(3);
  const panelBox = (await panel.first().boundingBox())!;
  expect(
    separation(idleChip, panelBox),
    "premise: the chip's idle place is under the panel's rect",
  ).toBeLessThan(0);
  const chipBox = (await chip.boundingBox())!;
  expectClear(chipBox, panelBox, "the chip is not under the tool panel");
  await expectChipsInsideCanvas(page);
});

/** Middle-button pan of the sketch view by `delta` (screen px). */
async function pan(
  workbench: SketchWorkbenchHarness,
  from: ViewportPoint,
  delta: ViewportPoint,
) {
  const page = workbench.page;
  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + from.x + delta.x, box.y + from.y + delta.y, {
    steps: 12,
  });
  await page.mouse.up({ button: "middle" });
  await workbench.waitForAnimationFrames(20);
}

async function chromeBoxes(page: Page) {
  return {
    timeline: (await page
      .locator("[data-history-mode]")
      .first()
      .boundingBox())!,
    tabs: (await page.getByRole("tablist").first().boundingBox())!,
    parts: (await page.getByLabel("Parts and objects").first().boundingBox())!,
    // The right column: the cube and the projection selector under it.
    viewCube: (await page
      .getByTestId("view-cube")
      .locator("..")
      .boundingBox())!,
  };
}

async function topIsChrome(page: Page, box: Box) {
  return page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest("[data-sketch-annotation-layer]") === null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

test("T14d review B-1: panned off-screen, dimension chips are not pulled onto the Actions strip, timeline, tabs or parts panel; the chrome keeps the pointer", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await drawLine(
    workbench,
    { x: 500, y: 380 },
    { x: 760, y: 380 },
    "1 entities",
  );
  await drawLine(
    workbench,
    { x: 500, y: 460 },
    { x: 760, y: 460 },
    "2 entities",
  );
  await dimensionLine(workbench, { x: 600, y: 380 }, { x: 630, y: 420 }, 1);
  await dimensionLine(workbench, { x: 600, y: 460 }, { x: 630, y: 420 }, 2);

  // Re-review RR-1: first onto the history Actions strip, which draws above
  // the timeline's box (the chips' anchors land just above the band, inside
  // the strip); then down past the bottom edge; then left past the parts
  // panel.
  const strip = page.locator("[data-history-actions]");
  await expect(strip, "premise: the Actions strip shows").toBeVisible();
  const stripBox = (await strip.boundingBox())!;
  const chipBox = (await boxes(page.locator(chipSelector)))[0]!;
  const toStrip = {
    x: stripBox.x + 120 - (chipBox.x + chipBox.width / 2),
    y: stripBox.y + 12 - (chipBox.y + chipBox.height / 2),
  };
  for (const [label, delta] of [
    ["onto the Actions strip", toStrip],
    ["down", { x: -toStrip.x, y: 560 - toStrip.y }],
    ["left", { x: -1100, y: -560 }],
  ] as const) {
    await pan(workbench, { x: 1000, y: 300 }, delta);
    const chrome = {
      ...(await chromeBoxes(page)),
      actions: (await strip.boundingBox())!,
    };
    for (const chip of await boxes(page.locator(chipSelector))) {
      for (const [name, box] of Object.entries(chrome)) {
        expectClear(chip, box, `${label}: no chip over the ${name}`);
      }
    }
    // Every Actions strip button keeps the pointer.
    for (const button of await strip.locator("button").all()) {
      expect(
        await topIsChrome(page, (await button.boundingBox())!),
        `${label}: an Actions strip button takes the pointer`,
      ).toBe(true);
    }
    // Under each chrome bar's centre and its left end the chrome is on top.
    for (const name of ["timeline", "tabs"] as const) {
      const box = chrome[name];
      for (const x of [box.x + 40, box.x + box.width / 2]) {
        expect(
          await topIsChrome(page, {
            x,
            y: box.y,
            width: 0,
            height: box.height,
          }),
          `${label}: the ${name} takes the pointer at x ${x}`,
        ).toBe(true);
      }
    }
  }
});

test("T14d review B-1: a chip anchored beside the view-cube column keeps clear of it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const canvas = (await workbench.viewport().boundingBox())!;
  const column = (await chromeBoxes(page)).viewCube;
  const left = column.x - canvas.x;
  const bottom = column.y - canvas.y + column.height;
  // T14e: the Constraints list sits under the column; collapsed, the line
  // goes just below its header (at least 60 px under the column, as before).
  const panel = await collapseConstraintList(page);
  const lineY = Math.max(bottom + 60, panel.y - canvas.y + panel.height + 20);
  // A line under the column, its midpoint 10 px left of it; the label placed
  // so the chip anchor (midpoint, 18 px up) is level with the column: the
  // chip at its anchor would overlap the column by about 24 px.
  await drawLine(
    workbench,
    { x: left - 60, y: lineY },
    { x: left + 40, y: lineY },
    "1 entities",
  );
  await dimensionLine(
    workbench,
    { x: left - 40, y: lineY },
    { x: left - 40, y: bottom - 20 },
    1,
  );
  await workbench.waitForAnimationFrames(3);
  const chip = (await page.locator(chipSelector).boundingBox())!;
  expectClear(
    chip,
    (await chromeBoxes(page)).viewCube,
    "the chip clears the cube",
  );
  expect(
    await topIsChrome(page, (await chromeBoxes(page)).viewCube),
    "the column keeps the pointer",
  ).toBe(true);
});

test("T14d review R-1: an expression chip clamped at the right edge stays on one line", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  // T14e: the expanded Constraints list covers this right-edge strip.
  await collapseConstraintList(page);
  await drawLine(
    workbench,
    { x: 1360, y: 420 },
    { x: 1436, y: 420 },
    "1 entities",
  );
  await dimensionLine(
    workbench,
    { x: 1380, y: 420 },
    { x: 1400, y: 400 },
    1,
    "1+1.5",
  );
  await workbench.waitForAnimationFrames(3);
  const chip = page.locator(chipSelector);
  await expect(chip).toContainText("ƒ");
  const canvas = (await workbench.viewport().boundingBox())!;
  const box = (await chip.boundingBox())!;
  const span = (await chip.locator("span.font-mono").boundingBox())!;
  expect(span.height, "one line of 11 px text").toBeLessThanOrEqual(12);
  expect(box.height).toBeLessThanOrEqual(32);
  await expectEstimateCoversChips(page);
  expect(
    box.x + box.width,
    "clamped at the right edge (8 px inset)",
  ).toBeGreaterThan(canvas.x + canvas.width - 10);
});

test("T14d review R-2: hovering an overlap shows the hint without moving any chip or covering one", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  // A chip anchored in the hint's slot (top row, right of the tool panel).
  await drawLine(
    workbench,
    { x: 600, y: 230 },
    { x: 760, y: 230 },
    "1 entities",
  );
  await dimensionLine(workbench, { x: 640, y: 230 }, { x: 680, y: 200 }, 1);
  // A rectangle: hovering its corner stacks a point and two lines.
  await workbench.openToolMenu("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 700, y: 500 });
  await workbench.clickViewportAt({ x: 900, y: 650 });
  await leaveTool(workbench);
  await workbench.clearHoverByLeavingViewport();
  await workbench.waitForAnimationFrames(4);
  const before = await boxes(page.locator(chipSelector));

  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(box.x + 740, box.y + 540);
  await page.mouse.move(box.x + 700, box.y + 500, { steps: 8 });
  const hint = page.getByTestId("sketch-pick-hint");
  await expect(hint, "premise: the overlap hint shows").toBeVisible();
  await workbench.waitForAnimationFrames(4);
  expect(
    await boxes(page.locator(chipSelector)),
    "the hint appearing moved no chip",
  ).toEqual(before);
  const hintBox = (await hint.boundingBox())!;
  for (const chip of before) {
    expectClear(chip, hintBox, "no chip under the hint");
  }
});

// The T13k near-gap fixture (P, Q, R, GAP_END above) again.
test("T14d re-review RR-2: hovering a near-gap end shows both hint chips, one line each, inside the reserved slot; no chip covers either", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  // A chip anchored in the hint slot.
  await drawLine(
    workbench,
    { x: 600, y: 230 },
    { x: 760, y: 230 },
    "1 entities",
  );
  await dimensionLine(workbench, { x: 640, y: 230 }, { x: 680, y: 200 }, 1);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(P);
  await workbench.clickViewportAt(Q);
  await workbench.clickViewportAt(R);
  await page.keyboard.down("Shift");
  await workbench.clickViewportAt(GAP_END);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await leaveTool(workbench);
  await workbench.clearHoverByLeavingViewport();
  await workbench.waitForAnimationFrames(4);
  const before = await boxes(page.locator(chipSelector));

  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(box.x + GAP_END.x + 30, box.y + GAP_END.y + 30);
  await page.mouse.move(box.x + GAP_END.x, box.y + GAP_END.y, { steps: 8 });
  const pickHint = page.getByTestId("sketch-pick-hint");
  const nearGapHint = page.getByTestId("sketch-near-gap-hint");
  await expect(pickHint, "premise: the overlap hint shows").toBeVisible();
  await expect(nearGapHint, "premise: the near-gap hint shows").toBeVisible();
  await workbench.waitForAnimationFrames(4);

  const topInset = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--workbench-viewport-overlay-top",
      ),
    ),
  );
  const hints = [
    (await pickHint.boundingBox())!,
    (await nearGapHint.boundingBox())!,
  ];
  for (const hint of [pickHint, nearGapHint]) {
    const label = (await hint.locator("span").first().boundingBox())!;
    expect(label.height, "each hint label is one line").toBeLessThanOrEqual(18);
  }
  expect(
    Math.max(...hints.map((hint) => hint.y + hint.height)),
    "the hint column ends inside the reserved 72 px slot",
  ).toBeLessThanOrEqual(box.y + topInset + 72);
  expect(
    await boxes(page.locator(chipSelector)),
    "the hints appearing moved no chip",
  ).toEqual(before);
  for (const chip of before) {
    for (const hint of hints) {
      expectClear(chip, hint, "no chip over a hint chip");
    }
  }
  for (const button of [
    nearGapHint.getByRole("button", { name: "Merge…" }),
    pickHint.getByRole("button", { name: "Choose…" }),
  ]) {
    expect(
      await topIsChrome(page, (await button.boundingBox())!),
      "the hint's button takes the pointer",
    ).toBe(true);
  }
});
