import { expect, test, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser workbench's overlap
// candidate chooser (T11e, T11-D6) and the hint's "Choose…" button (review
// A-8). Only a real browser carries the Alt modifier on `click`, traps focus
// in the Mantine menu, returns it to the canvas and orders the chooser's
// Escape before the window shortcut listener (review A-5(b)).
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 900 } });

const constructionToggle =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";
const offsetTool =
  "Offset a connected chain with a durable offset relationship.";
const construction = "sketch_entity_1_line";
const line = "sketch_entity_2_line";
const xAxis = "xAxis";
const at = { x: 950, y: 452 };
/** On the X axis, away from both lines: a 1-candidate stack. */
const axisOnly = { x: 1100, y: 452 };
/** Empty space: no candidate. */
const empty = { x: 1200, y: 700 };
/** On the line and the construction line, away from the chooser menu. */
const dismissOnLine = { x: 880, y: 452 };

test("Alt+click lists line, construction line and X axis in stack order; choosing X axis selects it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  // One candidate: Alt+click just selects it.
  await altClickViewportAt(workbench, axisOnly);
  await expectOnlySelected(workbench, xAxis);
  await expect(chooser(page)).toBeHidden();
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());

  await workbench.hoverViewportAt(at);
  await altClickViewportAt(workbench, at);
  await expect(chooser(page)).toBeVisible();
  await expect(chooser(page).getByRole("menuitem")).toHaveText([
    /^Line 2\s*Curve$/,
    /^Construction line 1\s*Construction$/,
    /^X axis\s*Reference$/,
  ]);
  expect(
    await workbench.currentEditorSelection(),
    "Opening the chooser selects nothing.",
  ).toBe("Nothing selected");

  const axisItem = chooser(page).getByRole("menuitem", { name: /X axis/ });
  await axisItem.hover();
  await expectHover(workbench, xAxis, "Hovering an item previews it.");
  await axisItem.click();
  await expect(chooser(page)).toBeHidden();
  await expectOnlySelected(workbench, xAxis);
  await expectCanvasFocused(page);
});

test("the hint's Choose… opens the same chooser after the pointer leaves over empty space; arrows and Enter pick", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  await workbench.hoverViewportAt(at);
  const hint = page.getByTestId("sketch-pick-hint");
  await expect(hint).toContainText("2 more here");
  // The hint keeps the last overlap over empty space (sticky, T11e).
  await workbench.hoverViewportAt(empty);
  await expect(hint).toContainText("2 more here");
  await hint.getByRole("button", { name: "Choose…" }).click();

  await expect(chooser(page)).toBeVisible();
  await expect(chooser(page).getByRole("menuitem")).toHaveText([
    /^Line 2/,
    /^Construction line 1/,
    /^X axis/,
  ]);
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(
    chooser(page).getByRole("menuitem", { name: /X axis/ }),
    "Three arrow presses reach the third item.",
  ).toBeFocused();
  await expectHover(workbench, xAxis, "The focused item is previewed.");
  await page.keyboard.press("Enter");
  await expect(chooser(page)).toBeHidden();
  await expectOnlySelected(workbench, xAxis);
  await expectCanvasFocused(page);
});

test("Escape closes the chooser without changing the selection or leaving the tool", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);
  await workbench.activateTool(offsetTool);
  const targets = page.getByText(/^Targets: \d+\/\d+$/);

  await workbench.hoverViewportAt(at);
  await workbench.clickViewportAt(at);
  await expectOnlySelected(workbench, line);
  await expect(targets).toHaveText("Targets: 1/1");

  await altClickViewportAt(workbench, at);
  await expect(chooser(page)).toBeVisible();
  await expect(
    chooser(page).getByRole("menuitem"),
    "Offset takes no datum axis: only eligible candidates are listed.",
  ).toHaveText([/^Line 2/, /^Construction line 1/]);

  await page.keyboard.press("Escape");
  await expect(chooser(page)).toBeHidden();
  await expectCanvasFocused(page);
  await expect(targets, "Offset is still active with its target.").toHaveText(
    "Targets: 1/1",
  );
  await expectOnlySelected(workbench, line);

  // T11e review R-1: Escape right after the Alt+click, before Mantine has
  // moved focus into the menu, is still the chooser's.
  await altClickViewportAt(workbench, at);
  await page.keyboard.press("Escape");
  await expect(chooser(page)).toBeHidden();
  await expect(
    targets,
    "An immediate Escape only closed the chooser.",
  ).toHaveText("Targets: 1/1");
  // Deterministically: Alt+click and Escape in one task, so the menu has
  // not even rendered (focus is still on the canvas).
  await altClickThenEscapeInOneTask(workbench, at);
  await expect(chooser(page)).toBeHidden();
  await expect(
    targets,
    "Escape in the same task as the Alt+click only closed the chooser.",
  ).toHaveText("Targets: 1/1");
  await expectOnlySelected(workbench, line);

  // The next Escape reaches the shortcut layer and leaves Offset.
  await page.keyboard.press("Escape");
  await expect(targets).toBeHidden();
});

test("T11e review B-1: Undo or a tool key closes an open chooser and nothing gets selected", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  await workbench.hoverViewportAt(at);
  await altClickViewportAt(workbench, at);
  await expect(chooser(page)).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await expect(
    chooser(page),
    "Undo removed Line 2: the chooser listing it closed.",
  ).toBeHidden();
  expect(await workbench.currentEditorSelection()).toBe("Nothing selected");

  // Construction line + X axis are still an overlap.
  await workbench.hoverViewportAt(empty);
  await workbench.hoverViewportAt(at);
  await altClickViewportAt(workbench, at);
  await expect(chooser(page).getByRole("menuitem")).toHaveText([
    /^Construction line 1/,
    /^X axis/,
  ]);
  await page.keyboard.press("l");
  await expect(
    chooser(page),
    "Switching to Line closed the chooser.",
  ).toBeHidden();
  expect(await workbench.currentEditorSelection()).toBe("Nothing selected");
});

test("T11e re-review N-1: a camera change closes an open chooser and its hint; nothing is selected", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  await workbench.hoverViewportAt(at);
  await altClickViewportAt(workbench, at);
  await expect(chooser(page)).toBeVisible();
  // Wheel zoom over the canvas (the pointer is still at the overlap).
  await page.mouse.wheel(0, -300);
  await expect(
    chooser(page),
    "Its anchor no longer marks the geometry: the chooser closed.",
  ).toBeHidden();
  await expect(page.getByTestId("sketch-pick-hint")).toBeHidden();
  expect(await workbench.currentEditorSelection()).toBe("Nothing selected");
});

test("T11e review R-2: the canvas press that dismisses the chooser selects nothing and leaves tool targets alone", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  await workbench.hoverViewportAt(at);
  await altClickViewportAt(workbench, at);
  await expect(chooser(page)).toBeVisible();
  await workbench.clickViewportAt(dismissOnLine);
  await expect(chooser(page)).toBeHidden();
  await expectCanvasFocused(page);
  // Give a wrongly handled click time to select.
  await page.waitForTimeout(300);
  expect(
    await workbench.currentEditorSelection(),
    "No tool: the dismissing click on the line selected nothing.",
  ).toBe("Nothing selected");

  await workbench.activateTool(offsetTool);
  const targets = page.getByText(/^Targets: \d+\/\d+$/);
  await workbench.hoverViewportAt(at);
  await workbench.clickViewportAt(at);
  await expect(targets).toHaveText("Targets: 1/1");
  await altClickViewportAt(workbench, at);
  await expect(chooser(page)).toBeVisible();
  await workbench.clickViewportAt(dismissOnLine);
  await expect(chooser(page)).toBeHidden();
  await page.waitForTimeout(300);
  await expect(
    targets,
    "Offset: the dismissing click on the line did not toggle it off.",
  ).toHaveText("Targets: 1/1");
  await expectOnlySelected(workbench, line);
});

function chooser(page: Page) {
  return page.getByTestId("sketch-pick-chooser");
}

async function altClickViewportAt(
  workbench: SketchWorkbenchHarness,
  point: { x: number; y: number },
) {
  await workbench.page.keyboard.down("Alt");
  try {
    await workbench.clickViewportAt(point);
  } finally {
    await workbench.page.keyboard.up("Alt");
  }
}

/**
 * Alt+click and Escape dispatched in one browser task: the chooser opens
 * and the Escape arrives before React renders the menu or Mantine moves
 * focus into it (review R-1, deterministic).
 */
async function altClickThenEscapeInOneTask(
  workbench: SketchWorkbenchHarness,
  point: { x: number; y: number },
) {
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport canvas is not visible.");
  await workbench.page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector("main canvas");
      if (!canvas) throw new Error("No canvas.");
      const init = {
        clientX: x,
        clientY: y,
        button: 0,
        altKey: true,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      const pointer = { ...init, pointerId: 1, isPrimary: true };
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { ...pointer, buttons: 1 }),
      );
      canvas.dispatchEvent(new PointerEvent("pointerup", pointer));
      canvas.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { x: box.x + point.x, y: box.y + point.y },
  );
}

async function expectCanvasFocused(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName), {
      message: "Focus returns to the canvas.",
    })
    .toBe("CANVAS");
}

async function openOverlapSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  // Entity 1: the construction line; entity 2: the ordinary line over it;
  // both on the X axis (the T11c audit coordinates).
  await workbench.activateTool(constructionToggle);
  await drawAxisLine(workbench, "1 entities staged");
  await drawAxisLine(workbench, "2 entities staged");
  await workbench.page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toBe("Nothing selected");
}

/** A line from (850, 450) to (1050, 450), on the X axis; Escape leaves Line. */
async function drawAxisLine(workbench: SketchWorkbenchHarness, staged: string) {
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 850, y: 450 });
  await workbench.clickViewportAt({ x: 1050, y: 450 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain(staged);
  await workbench.page.keyboard.press("Escape");
}

async function expectHover(
  workbench: SketchWorkbenchHarness,
  expected: string,
  message: string,
) {
  await expect
    .poll(() => workbench.currentHoverTarget(), { message, timeout: 10_000 })
    .toContain(expected);
}

async function expectOnlySelected(
  workbench: SketchWorkbenchHarness,
  expected: string,
) {
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: `${expected} is selected.`,
      timeout: 10_000,
    })
    .toContain(expected);
  const selection = await workbench.currentEditorSelection();
  for (const other of [line, construction, xAxis].filter(
    (entry) => entry !== expected,
  )) {
    expect(selection, `Only ${expected} is selected.`).not.toContain(other);
  }
}
