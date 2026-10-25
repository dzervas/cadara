import { expect as baseExpect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";
import { openShortcutSettings } from "./helpers/shortcut-settings";

// Lane: e2e (docs/testing.md). Seam: multi-selection in the browser
// workbench (cadara-h026.1): viewport picking with the real click order
// (pointer-up, then `click`), the repeated-click cycle and its deselect
// entry in part and sketch mode, the sketch marquee gesture and its overlay,
// Escape and empty clicks, and the selection click setting. The selection
// reducer itself is covered in the logic lane (multi-selection.spec.ts).

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });
const expect = baseExpect.configure({ timeout: 10_000 });

// The base extrude's initial body-fit frame (viewport-solid-topology-picking).
const FACE_POINT = { x: 390, y: 265 };
const VERTEX_POINT = { x: 257, y: 351 };
const BLANK_POINT = { x: 1000, y: 200 };
/** On the edge and its face (probed): a two-entry part pick stack. */
const CYCLE_POINT = { x: 386, y: 252 };
const FACE = "face_body_feature_extrude-1_g6c121d31a8b2062a";
const EDGE = "edge_body_feature_extrude-1_gf733a84eddab6da7";
const VERTEX = "vertex_body_feature_extrude-1_gcacb85faae727c4a";
const NOTHING = "Nothing selected";

const selectionOf = (workbench: FeatureWorkbenchHarness) => () =>
  workbench.currentEditorSelection();
const count = (workbench: FeatureWorkbenchHarness) => () =>
  workbench.currentMachineSelectionCount();

test("part mode: clicks add faces, edges and vertices in order; a selected one clicked again is removed; Escape and an empty click clear", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory());

  await workbench.clickViewportAtReal(FACE_POINT);
  await expect.poll(selectionOf(workbench)).toContain(FACE);
  await workbench.clickViewportAtReal(VERTEX_POINT);
  await expect.poll(count(workbench)).toBe(2);
  const both = await workbench.currentEditorSelection();
  expect(both.indexOf(FACE), "Pick order: face, then vertex.").toBeLessThan(
    both.indexOf(VERTEX),
  );

  await workbench.clickViewportAtReal(FACE_POINT);
  await expect.poll(count(workbench)).toBe(1);
  expect(await workbench.currentEditorSelection()).toContain(VERTEX);

  await page.keyboard.press("Escape");
  await expect.poll(selectionOf(workbench)).toBe(NOTHING);

  await workbench.clickViewportAtReal(FACE_POINT);
  await workbench.clickViewportAtReal(VERTEX_POINT);
  await expect.poll(count(workbench)).toBe(2);
  await workbench.clickViewportAtReal(BLANK_POINT);
  await expect.poll(selectionOf(workbench)).toBe(NOTHING);
});

test("part mode: repeated clicks cycle the overlapping targets in place, then deselect, keeping the rest of the selection", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory());

  await workbench.clickViewportAtReal(VERTEX_POINT);
  await expect.poll(selectionOf(workbench)).toContain(VERTEX);

  // At CYCLE_POINT the edge overlaps its face: edge → face → deselect →
  // edge, each replacing only the cycle's own pick.
  for (const expected of [EDGE, FACE, null, EDGE, FACE]) {
    await workbench.clickViewportAtReal(CYCLE_POINT);
    if (expected === null) {
      await expect.poll(count(workbench)).toBe(1);
    } else {
      await expect.poll(selectionOf(workbench)).toContain(expected);
      expect(
        await workbench.currentMachineSelectionCount(),
        "The cycle replaces its own pick: never a second cycle target.",
      ).toBe(2);
    }
    expect(
      await workbench.currentEditorSelection(),
      "The vertex picked first stays selected.",
    ).toContain(VERTEX);
  }
});

test("the Shift-to-add setting: a plain click replaces, Shift+click adds or removes", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory());

  const modal = await openShortcutSettings(page);
  await modal.getByLabel("Selection click").selectOption("shiftToAdd");
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();

  await workbench.clickViewportAtReal(FACE_POINT);
  await expect.poll(selectionOf(workbench)).toContain(FACE);
  await workbench.clickViewportAtReal(VERTEX_POINT);
  await expect.poll(selectionOf(workbench)).toContain(VERTEX);
  expect(await workbench.currentMachineSelectionCount()).toBe(1);

  await page.keyboard.down("Shift");
  try {
    await workbench.clickViewportAtReal(FACE_POINT);
    await expect.poll(count(workbench)).toBe(2);
    await workbench.clickViewportAtReal(VERTEX_POINT);
    await expect.poll(count(workbench)).toBe(1);
  } finally {
    await page.keyboard.up("Shift");
  }
  expect(await workbench.currentEditorSelection()).toContain(FACE);
});

test("parts tree: click replaces, Ctrl+click toggles, Shift+click selects a range, Ctrl+Shift+click adds a range", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory());
  const tree = page.getByRole("complementary", { name: "Parts and objects" });
  const enabledRows = tree.locator(
    '[data-parts-tree-row]:not([data-hidden="true"]) button[aria-disabled="false"]:not([data-trail])',
  );
  await expect.poll(() => enabledRows.count()).toBeGreaterThanOrEqual(3);
  const row = (index: number) => enabledRows.nth(index);
  const ctrl = process.platform === "darwin" ? "Meta" : "Control";

  await row(0).click();
  await expect.poll(count(workbench)).toBe(1);
  await row(1).click();
  await expect.poll(count(workbench), "A plain click replaces.").toBe(1);
  await row(2).click({ modifiers: [ctrl] });
  await expect.poll(count(workbench), "Ctrl adds.").toBe(2);
  await row(2).click({ modifiers: [ctrl] });
  await expect.poll(count(workbench), "Ctrl again removes.").toBe(1);

  await row(0).click();
  await row(2).click({ modifiers: ["Shift"] });
  await expect.poll(count(workbench), "Shift: rows 0..2.").toBe(3);

  await row(1).click();
  await expect.poll(count(workbench)).toBe(1);
  await row(2).click({ modifiers: ["Shift"] });
  await expect.poll(count(workbench), "Shift replaces: rows 1..2.").toBe(2);
  await row(0).click({ modifiers: [ctrl] });
  await expect.poll(count(workbench)).toBe(3);
  await row(0).click({ modifiers: [ctrl] });
  await expect.poll(count(workbench)).toBe(2);
  await row(2).click();
  await row(0).click({ modifiers: [ctrl] });
  await expect.poll(count(workbench)).toBe(2);
  await row(1).click({ modifiers: [ctrl, "Shift"] });
  await expect
    .poll(count(workbench), "Ctrl+Shift adds rows 0..1 to row 2.")
    .toBe(3);
});

// Sketch coordinates on the Top plane (1440 × 900): the X axis runs along
// y ≈ 450 (the T11c audit frame).
const LINE_TOOL = "Create line geometry.";
const CONSTRUCTION_TOGGLE =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";

async function openTopSketch(workbench: FeatureWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

async function drawLine(
  workbench: FeatureWorkbenchHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  staged: string,
) {
  await workbench.activateTool(LINE_TOOL);
  await workbench.clickViewportAt(from);
  await workbench.clickViewportAt(to);
  await expect.poll(() => workbench.currentSketchSession()).toContain(staged);
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await expect
    .poll(() =>
      workbench.page.evaluate(() => window.__cadaraDebug?.getState()?.command),
    )
    .toBe("sketch");
}

async function clearSelection(workbench: FeatureWorkbenchHarness) {
  await workbench.page.keyboard.press("Escape");
  await expect.poll(selectionOf(workbench)).toBe(NOTHING);
}

test.describe("sketch mode", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sketch mode: clicks add lines, a selected line clicked again is removed; the cycle ends in a deselect entry and keeps other picks", async ({
    page,
  }) => {
    const workbench = new FeatureWorkbenchHarness(page);
    await openTopSketch(workbench);
    // Entity 1: a construction line on the X axis; entity 2: a line over it;
    // entity 3: a separate line above them.
    await workbench.activateTool(CONSTRUCTION_TOGGLE);
    await drawLine(
      workbench,
      { x: 850, y: 450 },
      { x: 1050, y: 450 },
      "1 entities staged",
    );
    await drawLine(
      workbench,
      { x: 850, y: 450 },
      { x: 1050, y: 450 },
      "2 entities staged",
    );
    await drawLine(
      workbench,
      { x: 850, y: 300 },
      { x: 1050, y: 300 },
      "3 entities staged",
    );
    await clearSelection(workbench);

    const construction = "sketch_entity_1_line";
    const line = "sketch_entity_2_line";
    const upper = "sketch_entity_3_line";
    const overlap = { x: 950, y: 452 };

    await workbench.clickViewportAt({ x: 950, y: 300 });
    await expect.poll(selectionOf(workbench)).toContain(upper);
    await workbench.clickViewportAt({ x: 900, y: 452 });
    await expect.poll(count(workbench)).toBe(2);
    expect(await workbench.currentEditorSelection()).toContain(line);
    await workbench.clickViewportAt({ x: 950, y: 300 });
    await expect.poll(count(workbench)).toBe(1);
    expect(
      await workbench.currentEditorSelection(),
      "The upper line was removed; the overlap line stays.",
    ).toContain(line);
    await workbench.clickViewportAt({ x: 950, y: 300 });
    await expect.poll(count(workbench)).toBe(2);
    // A click on blank canvas clears.
    await workbench.clickViewportAt({ x: 1200, y: 700 });
    await expect.poll(selectionOf(workbench)).toBe(NOTHING);

    await workbench.clickViewportAt({ x: 950, y: 300 });
    await expect.poll(selectionOf(workbench)).toContain(upper);
    // line → construction line → X axis → deselect → line, the upper line kept.
    for (const expected of [line, construction, "xAxis", null, line]) {
      await workbench.clickViewportAt(overlap);
      if (expected === null) {
        await expect.poll(count(workbench)).toBe(1);
      } else {
        await expect.poll(selectionOf(workbench)).toContain(expected);
        expect(await workbench.currentMachineSelectionCount()).toBe(2);
      }
      expect(await workbench.currentEditorSelection()).toContain(upper);
    }
  });

  test("sketch mode: a marquee from empty canvas selects enclosed geometry left to right and crossing geometry right to left; dragging a line still moves it", async ({
    page,
  }) => {
    const workbench = new FeatureWorkbenchHarness(page);
    await openTopSketch(workbench);
    await drawLine(
      workbench,
      { x: 800, y: 300 },
      { x: 1000, y: 300 },
      "1 entities staged",
    );
    await drawLine(
      workbench,
      { x: 800, y: 600 },
      { x: 1000, y: 600 },
      "2 entities staged",
    );
    await clearSelection(workbench);
    const upper = "sketch_entity_1_line";
    const lower = "sketch_entity_2_line";
    const box = await workbench.viewport().boundingBox();
    if (!box) throw new Error("Viewport canvas is not visible.");
    const marquee = page.locator("[data-selection-marquee]");

    const drag = async (
      from: { x: number; y: number },
      to: { x: number; y: number },
      mode: string,
    ) => {
      await page.mouse.move(box.x + from.x, box.y + from.y);
      await page.mouse.down();
      await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 12 });
      await expect(marquee).toBeVisible();
      await expect(marquee).toHaveAttribute("data-selection-marquee", mode);
      await page.mouse.up();
      await expect(marquee).toBeHidden();
    };

    // Left to right around the upper line only: it and its end points.
    await drag({ x: 760, y: 260 }, { x: 1040, y: 340 }, "enclosed");
    await expect.poll(selectionOf(workbench)).toContain(upper);
    expect(await workbench.currentMachineSelectionCount()).toBe(3);
    expect(await workbench.currentEditorSelection()).not.toContain(lower);
    await clearSelection(workbench);

    // Left to right over half of both lines: nothing fully inside but the
    // left end points.
    await drag({ x: 760, y: 260 }, { x: 900, y: 640 }, "enclosed");
    await expect.poll(count(workbench)).toBe(2);
    const ends = await workbench.currentEditorSelection();
    expect(ends).not.toContain(upper);
    expect(ends).not.toContain(lower);
    await clearSelection(workbench);

    // Right to left over the same box: the crossed lines too.
    await drag({ x: 900, y: 640 }, { x: 760, y: 260 }, "crossing");
    await expect.poll(count(workbench)).toBe(4);
    const crossed = await workbench.currentEditorSelection();
    expect(crossed).toContain(upper);
    expect(crossed).toContain(lower);
    await clearSelection(workbench);

    // A press on a line drags the line, never a marquee; its release keeps
    // the multi-selection and adds the dragged line.
    await workbench.clickViewportAt({ x: 900, y: 600 });
    await expect.poll(selectionOf(workbench)).toContain(lower);
    await page.mouse.move(box.x + 900, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 900, box.y + 360, { steps: 12 });
    await expect(marquee).toBeHidden();
    await page.mouse.up();
    await expect.poll(count(workbench)).toBe(2);
    const afterDrag = await workbench.currentEditorSelection();
    expect(afterDrag).toContain(upper);
    expect(afterDrag).toContain(lower);
  });
});
