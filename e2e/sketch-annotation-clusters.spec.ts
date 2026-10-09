import { expect, test, type Locator, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the workbench browser flow of the T14f
// dense clusters (T-9, A-4, A-5): the projection feed's real screen extents
// switch the dense limit with hysteresis while the camera zooms, a collapsed
// hover preview and its `+N` stay pointer-passive over draggable geometry,
// and the expanded set survives a viewport click (render-phase state). Only
// the real page composes the camera, the DOM overlays and pointer routing.
// The mouse glides (several `mouse.move` steps) so the overlays under the
// pointer see the enter/leave sequence a user produces.
test.setTimeout(150_000);
test.use({ viewport: { width: 1440, height: 960 } });

type ViewportPoint = { x: number; y: number };

/** The fan's shared end point P and its eight 200 px lines L1…L8. */
const P = { x: 500, y: 330 };
const ANGLES = [25, 65, 115, 155, 205, 245, 295, 335];
const along = (origin: ViewportPoint, angle: number, length: number) => {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.round(origin.x + length * Math.cos(radians)),
    y: Math.round(origin.y - length * Math.sin(radians)),
  };
};

const layer = (page: Page) => page.locator("[data-sketch-annotation-layer]");
const showAllSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Show all constraints" });

/**
 * Eight lines from P; Parallel + Equal on each opposite pair (L1/L5, L2/L6,
 * L3/L7, L4/L8: 8 constraints anchored exactly at P + (18, −18)), and
 * Perpendicular + Equal on L1/L3 (2 more, between L1 and L3). Show all on,
 * the P cluster is 8 glyphs: 4 + `+4` at K = 4, 2 + `+6` at K = 2.
 */
async function buildDenseFan(workbench: SketchWorkbenchHarness) {
  const page = workbench.page;
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  for (const [index, angle] of ANGLES.entries()) {
    await workbench.activateTool("Create line geometry.");
    await workbench.hoverViewportAtReal(P);
    await workbench.waitForAnimationFrames(3);
    await workbench.clickViewportAt(P);
    await workbench.hoverViewportAtReal(along(P, angle, 200));
    await workbench.waitForAnimationFrames(3);
    await workbench.clickViewportAt(along(P, angle, 200));
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${index + 1} entities staged`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await workbench.waitForAnimationFrames(2);
  }
  const constrain = [
    ["Constrain two lines to remain parallel.", 0, 4],
    ["Constrain two lines to equal length.", 0, 4],
    ["Constrain two lines to remain parallel.", 1, 5],
    ["Constrain two lines to equal length.", 1, 5],
    ["Constrain two lines to remain parallel.", 2, 6],
    ["Constrain two lines to equal length.", 2, 6],
    ["Constrain two lines to remain parallel.", 3, 7],
    ["Constrain two lines to equal length.", 3, 7],
    ["Constrain two lines to remain perpendicular.", 0, 2],
    ["Constrain two lines to equal length.", 0, 2],
  ] as const;
  for (const [tool, first, second] of constrain) {
    await workbench.activateTool(tool);
    await workbench.clickViewportAt(along(P, ANGLES[first]!, 100));
    await workbench.clickViewportAt(along(P, ANGLES[second]!, 100));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await workbench.waitForAnimationFrames(2);
  }
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect(
    page.locator("[data-sketch-constraint-row]"),
    "premise: the 10 constraints are authored",
  ).toHaveCount(10);
  await expect(
    page.locator(
      "[data-sketch-constraint-row][data-sketch-constraint-problem]",
    ),
    "premise: none is a problem (problems are never clustered)",
  ).toHaveCount(0);
}

async function setShowAll(workbench: SketchWorkbenchHarness, on: boolean) {
  const toggle = showAllSwitch(workbench.page);
  if ((await toggle.isChecked()) !== on) {
    await toggle.click({ force: true });
  }
  await expect(toggle).toBeChecked({ checked: on });
  await workbench.waitForAnimationFrames(3);
}

/** The layer's dense state and the `+N` count of the P cluster. */
async function denseState(page: Page, clusterKey: string) {
  return layer(page).evaluate((element, key) => {
    const chip = element.querySelector(
      `[data-sketch-annotation-cluster="${key}"]`,
    );
    return {
      limit: Number(
        element.getAttribute("data-sketch-annotation-pinned-limit"),
      ),
      extent: Number(
        element.getAttribute("data-sketch-annotation-pinned-extent"),
      ),
      overflow: chip
        ? Number(chip.getAttribute("data-sketch-annotation-overflow"))
        : 0,
      glyphs: element.querySelectorAll("[data-sketch-annotation-kind]").length,
    };
  }, clusterKey);
}

/** The single `+N` chip of the fan's P cluster (Show all on, K = 4). */
async function pClusterKey(page: Page) {
  const chips = page.locator("[data-sketch-annotation-overflow]");
  await expect(chips, "one dense cluster (P) at K = 4").toHaveCount(1);
  return (await chips.first().getAttribute("data-sketch-annotation-cluster"))!;
}

/**
 * P's screen position: the P cluster's lowest-id glyph ("Equal 10") sits on
 * its anchor, which is P + (18, −18) screen px (Show all on).
 */
async function screenP(page: Page) {
  const box = (await layer(page)
    .getByRole("button", { name: /^Equal 10:/ })
    .boundingBox())!;
  return {
    x: box.x + box.width / 2 - 18,
    y: box.y + box.height / 2 + 18,
  };
}

async function zoomStep(
  workbench: SketchWorkbenchHarness,
  at: ViewportPoint,
  deltaY: number,
) {
  await workbench.page.mouse.move(at.x, at.y);
  await workbench.page.mouse.wheel(0, deltaY);
  await workbench.waitForAnimationFrames(3);
}

/** Every rendered label: accessible name (or kind) and its box. */
async function labelSnapshot(page: Page) {
  return layer(page).evaluate((element) =>
    [...element.children].map((child) => {
      const box = child.getBoundingClientRect();
      return `${child.getAttribute("aria-label") ?? child.getAttribute("data-sketch-annotation-kind")}@${Math.round(box.x)},${Math.round(box.y)}`;
    }),
  );
}

async function glideClickOnto(
  workbench: SketchWorkbenchHarness,
  from: ViewportPoint,
  target: Locator,
) {
  const box = (await target.boundingBox())!;
  await workbench.page.mouse.move(from.x, from.y);
  await workbench.page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2,
    { steps: 10 },
  );
  await workbench.waitForAnimationFrames(2);
  await workbench.page.mouse.down();
  await workbench.page.mouse.up();
  await workbench.waitForAnimationFrames(3);
}

test("T14f: a dense endpoint collapses to 4 + `+4`, to 2 + `+6` below 150 px and back to 4 only above 170 px", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);

  const key = await pClusterKey(page);
  const start = await denseState(page, key);
  expect(start.limit, "K = 4 at 200 px lines").toBe(4);
  expect(
    Math.abs(start.extent - 200),
    "the extent is the drawn lines' 200 px screen length",
  ).toBeLessThanOrEqual(6);
  expect(start.overflow, "4 of the 8 P glyphs behind `+4`").toBe(4);
  expect(start.glyphs, "4 P glyphs + the 2 L1/L3 glyphs").toBe(6);

  // Zoom out in small steps until K drops.
  const out: Awaited<ReturnType<typeof denseState>>[] = [];
  for (let step = 0; step < 40; step += 1) {
    await zoomStep(workbench, await screenP(page), 40);
    const state = await denseState(page, key);
    out.push(state);
    if (state.limit === 2) break;
  }
  const dropped = out.at(-1)!;
  expect(dropped.limit, "K dropped while zooming out").toBe(2);
  expect(dropped.extent, "only below 150 px").toBeLessThan(150);
  expect(dropped.overflow, "2 of the 8 P glyphs remain: `+6`").toBe(6);
  const bandOut = out.filter(
    (state) => state.extent >= 150 && state.extent <= 170,
  );
  expect(bandOut.length, "premise: a sample inside the band").toBeGreaterThan(
    0,
  );
  for (const state of bandOut) {
    expect(state, "inside the band on the way out K stays 4").toMatchObject({
      limit: 4,
      overflow: 4,
    });
  }

  // Zoom back in: K stays 2 through the band and returns above 170 px.
  const back: Awaited<ReturnType<typeof denseState>>[] = [];
  for (let step = 0; step < 40; step += 1) {
    await zoomStep(workbench, await screenP(page), -40);
    const state = await denseState(page, key);
    back.push(state);
    if (state.limit === 4) break;
  }
  const restored = back.at(-1)!;
  expect(restored.limit, "K returned while zooming in").toBe(4);
  expect(restored.extent, "only above 170 px").toBeGreaterThan(170);
  expect(restored.overflow).toBe(4);
  const bandBack = back.filter(
    (state) => state.extent >= 150 && state.extent <= 170,
  );
  expect(bandBack.length, "premise: a sample inside the band").toBeGreaterThan(
    0,
  );
  for (const state of bandBack) {
    expect(state, "inside the band on the way in K stays 2").toMatchObject({
      limit: 2,
      overflow: 6,
    });
  }
});

test("T14f: geometry drags under a collapsed hover preview; its passive `+N` is not a canvas hole", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);
  const key = await pClusterKey(page);
  // Zoom out until the lines are about 100 px: L1's preview context is
  // small (K = 2) and its four glyphs (P: Parallel 9, Equal 10; between L1
  // and L3: Perpendicular 17, Equal 18) are within one cluster.
  for (let step = 0; step < 60; step += 1) {
    if ((await denseState(page, key)).extent <= 105) break;
    await zoomStep(workbench, await screenP(page), 40);
  }
  expect((await denseState(page, key)).extent).toBeLessThanOrEqual(105);
  const p = await screenP(page);
  await setShowAll(workbench, false);
  await expect(layer(page), "premise: nothing pinned").toHaveCount(0);

  // L1 and L3 each preview four glyphs (their opposite pair's Parallel and
  // Equal at P, the L1/L3 Perpendicular and Equal between them): one
  // cluster at K = 2. Hover each well away from P and take the first point
  // on it (≥ 20 px from P, so the line is the pick) under a passive preview
  // element (a glyph or the `+N`, which ranks above preview glyphs, review
  // A-5); where the layout puts them decides which line has one.
  const passive = page.locator(
    '[data-sketch-annotation-layer] > [data-sketch-annotation-visibility="preview"]',
  );
  let pressed: { press: ViewportPoint; entity: string } | null = null;
  for (const lineIndex of [0, 2]) {
    const entity = `sketch_entity_${lineIndex + 1}_line`;
    const far = along(p, ANGLES[lineIndex]!, 85);
    await page.mouse.move(far.x + 30, far.y + 30);
    await page.mouse.move(far.x, far.y, { steps: 8 });
    await workbench.waitForAnimationFrames(3);
    await expect.poll(() => workbench.currentHoverTarget()).toContain(entity);
    await expect(
      page.locator("[data-sketch-annotation-overflow]"),
      "premise: the hover preview is collapsed",
    ).toHaveCount(1);
    const boxes = await passive.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    );
    const distance = Array.from({ length: 31 }, (_, index) => 20 + index * 2)
      .map((length) => along(p, ANGLES[lineIndex]!, length))
      .find((point) =>
        boxes.some(
          (box) =>
            point.x >= box.left + 2 &&
            point.x <= box.right - 2 &&
            point.y >= box.top + 2 &&
            point.y <= box.bottom - 2,
        ),
      );
    if (distance) {
      pressed = { press: distance, entity };
      break;
    }
  }
  expect(
    pressed,
    "premise: a collapsed preview covers L1 or L3 somewhere",
  ).not.toBeNull();
  const { press, entity } = pressed!;
  await page.mouse.move(press.x, press.y, { steps: 10 });
  await workbench.waitForAnimationFrames(3);
  await expect.poll(() => workbench.currentHoverTarget()).toContain(entity);

  const previews = page.locator(
    '[data-sketch-annotation-kind][data-sketch-annotation-visibility="preview"]',
  );
  await expect(previews, "K = 2 preview glyphs").toHaveCount(2);
  const chip = page.locator("[data-sketch-annotation-overflow]");
  await expect(chip, "one collapsed preview cluster").toHaveCount(1);
  await expect(chip).toHaveAttribute("data-sketch-annotation-overflow", "2");
  await expect(chip).toHaveAttribute(
    "data-sketch-annotation-visibility",
    "preview",
  );
  await expect(chip).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.locator("[data-sketch-annotation-layer] button"),
  ).toHaveCount(0);

  // The passive `+N` is not a hole: the canvas is topmost at its centre.
  const chipBox = (await chip.boundingBox())!;
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 },
    ),
    "the canvas owns the pointer under the passive `+N`",
  ).toBe("CANVAS");

  // The press point is on L1 under a passive preview element.
  const covering = await passive.evaluateAll(
    (elements, point) =>
      elements.filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          point.x >= box.left &&
          point.x <= box.right &&
          point.y >= box.top &&
          point.y <= box.bottom
        );
      }).length,
    press,
  );
  expect(
    covering,
    "premise: a collapsed preview covers the press",
  ).toBeGreaterThanOrEqual(1);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      press,
    ),
  ).toBe("CANVAS");

  const before = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.points ?? [],
  );
  await page.mouse.down();
  await page.mouse.move(press.x + 12, press.y + 26, { steps: 8 });
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  const after = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.points ?? [],
  );
  expect(
    after.some((point, index) => {
      const old = before[index];
      return (
        !old ||
        Math.hypot(
          point.position[0] - old.position[0],
          point.position[1] - old.position[1],
        ) > 1e-6
      );
    }),
    "the press under the preview dragged the geometry",
  ).toBe(true);
  expect(
    await workbench.currentEditorSelection(),
    "no annotation was selected",
  ).not.toContain("constraint");
});

test("T14f: a viewport click never changes the expanded set or moves a label; the pinned `+N` is a passive control for now", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);
  const key = await pClusterKey(page);
  const parallel15 = layer(page).getByRole("button", { name: /^Parallel 15:/ });
  await expect(parallel15, "premise: Parallel 15 is collapsed").toHaveCount(0);

  // Select the collapsed Parallel 15 from the list: it is expanded (active).
  await page
    .locator("[data-sketch-constraint-row]")
    .filter({ hasText: "Parallel 15" })
    .getByRole("button")
    .first()
    .click();
  await workbench.waitForAnimationFrames(3);
  await expect(parallel15).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
  expect((await denseState(page, key)).overflow).toBe(4);
  const listed = await labelSnapshot(page);

  // Click an expanded sibling in the viewport: Parallel 15 is no longer
  // active or last, yet stays expanded, and nothing moves.
  const equal12 = layer(page).getByRole("button", { name: /^Equal 12:/ });
  await glideClickOnto(workbench, { x: 900, y: 600 }, equal12);
  await expect(equal12).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
  await expect(parallel15, "Parallel 15 stays expanded").toHaveCount(1);
  await expect(parallel15).not.toHaveAttribute(
    "data-sketch-annotation-selection",
  );
  expect(await labelSnapshot(page), "no label moved").toEqual(listed);

  // The pinned `+N` is a named, focusable button; activating it does
  // nothing yet (the wheel is T14g): no selection change, nothing moves.
  const chip = layer(page).getByRole("button", { name: "4 more constraints" });
  await expect(chip).toHaveAttribute("data-sketch-annotation-cluster", key);
  const selection = await workbench.currentEditorSelection();
  await glideClickOnto(workbench, { x: 900, y: 600 }, chip);
  expect(await workbench.currentEditorSelection()).toEqual(selection);
  expect(await labelSnapshot(page), "the `+N` press moved nothing").toEqual(
    listed,
  );
  await chip.focus();
  await page.keyboard.press("Enter");
  await workbench.waitForAnimationFrames(2);
  expect(await workbench.currentEditorSelection()).toEqual(selection);
});

/** The interactive glyphs' names (label part), in DOM order. */
async function expandedNames(page: Page) {
  return layer(page)
    .locator("button[data-sketch-annotation-kind]")
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element.getAttribute("aria-label") ?? "").replace(/:.*$/, ""),
      ),
    );
}

test("T14f review R-1: a hovered glyph that collapses under a zoom drops its hover (and linked highlight)", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);
  const key = await pClusterKey(page);
  // Into the band (K stays 4) so that the next small zoom out drops K.
  for (let step = 0; step < 40; step += 1) {
    if ((await denseState(page, key)).extent <= 158) break;
    await zoomStep(workbench, await screenP(page), 40);
  }
  expect(await denseState(page, key)).toMatchObject({ limit: 4, overflow: 4 });

  // Hover the 4th expanded P glyph (it collapses first at K = 2).
  const parallel13 = layer(page).getByRole("button", { name: /^Parallel 13:/ });
  const box = (await parallel13.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(at.x + 60, at.y + 60);
  await page.mouse.move(at.x, at.y, { steps: 10 });
  await workbench.waitForAnimationFrames(3);
  await expect
    .poll(() => workbench.currentHoverTarget())
    .toContain("constraint");
  const row13 = page
    .locator("[data-sketch-constraint-row]")
    .filter({ hasText: "Parallel 13" });
  await expect(
    row13,
    "premise: the hovered glyph's list row shows the linked hover",
  ).toHaveClass(/bg-\[var\(--cad-surface-overlay\)\]/);

  // Wheel out without moving the pointer until K = 2.
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.wheel(0, 15);
    await workbench.waitForAnimationFrames(3);
    if ((await denseState(page, key)).limit === 2) break;
  }
  expect((await denseState(page, key)).limit).toBe(2);
  await expect(parallel13, "the hovered glyph collapsed").toHaveCount(0);
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "the stale annotation hover is cleared",
    })
    .toBe("none");
  await expect(row13, "no linked hover highlight remains").not.toHaveClass(
    /bg-\[var\(--cad-surface-overlay\)\]/,
  );
});

test("T14f review R-2: deleting an expanded glyph and Undo restore the original expanded set", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);
  const key = await pClusterKey(page);
  const original = await expandedNames(page);
  const originalLabels = [...(await labelSnapshot(page))].sort();
  expect(original.slice(0, 4), "premise: the lowest ids expanded").toEqual([
    "Equal 10",
    "Parallel 11",
    "Equal 12",
    "Parallel 13",
  ]);
  await page
    .locator("[data-sketch-constraint-row]")
    .filter({ hasText: "Parallel 11" })
    .getByRole("button", { name: /^Delete Parallel 11/ })
    .click();
  await expect(
    layer(page).getByRole("button", { name: /^Parallel 11:/ }),
  ).toHaveCount(0);
  await expect(
    layer(page).getByRole("button", { name: /^Equal 14:/ }),
    "premise: the next id fills the slot",
  ).toHaveCount(1);
  expect((await denseState(page, key)).overflow).toBe(3);

  await page.keyboard.press("Control+z");
  await expect(
    page.locator("[data-sketch-constraint-row]"),
    "Undo restores the constraint",
  ).toHaveCount(10);
  await expect(
    layer(page).getByRole("button", { name: /^Parallel 11:/ }),
    "the restored glyph is expanded again",
  ).toHaveCount(1);
  expect(
    [...(await expandedNames(page))].sort(),
    "the original expanded glyphs",
  ).toEqual([...original].sort());
  expect(
    [...(await labelSnapshot(page))].sort(),
    "the original picture: every label where it was",
  ).toEqual(originalLabels);
  expect((await denseState(page, key)).overflow).toBe(4);
});

test("T14f review A-1: a new context in the band takes the 160 px rule, not the previous context's K", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);
  const key = await pClusterKey(page);
  // Zoom out into the lower half of the band: Show all's context keeps
  // K = 4 there by hysteresis.
  for (let step = 0; step < 40; step += 1) {
    if ((await denseState(page, key)).extent < 159) break;
    await zoomStep(workbench, await screenP(page), 15);
  }
  const band = await denseState(page, key);
  expect(band.extent).toBeGreaterThanOrEqual(150);
  expect(band.extent).toBeLessThan(160);
  expect(band.limit, "premise: hysteresis kept K = 4 for Show all").toBe(4);
  const p = await screenP(page);
  await setShowAll(workbench, false);

  // Select L2 (same length, a new context): fresh, below 160 px → K = 2.
  const onL2 = along(p, ANGLES[1]!, band.extent * 0.6);
  await page.mouse.move(onL2.x + 30, onL2.y + 30);
  await page.mouse.move(onL2.x, onL2.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.up();
  await workbench.waitForAnimationFrames(3);
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toContain("sketch_entity_2_line");
  await expect(layer(page)).toHaveAttribute(
    "data-sketch-annotation-pinned-limit",
    "2",
  );
  expect(
    Math.abs(
      Number(
        await layer(page).getAttribute("data-sketch-annotation-pinned-extent"),
      ) - band.extent,
    ),
    "the same extent as the Show all context",
  ).toBeLessThanOrEqual(2);
});
