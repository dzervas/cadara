import { expect as baseExpect, test, type Page } from "@playwright/test";

import { readHistoryStrip, waitForCommittedAction } from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  glideClick,
  glidePress,
  openTopSketch,
} from "./helpers/mirror-workbench";
import { mixedSnapshot } from "./helpers/mixed-topology";

// Lane: e2e (docs/testing.md). Seam: specification §3 "Selection, drawing,
// dragging, and annotations", its selection steps (T17j3, T17q gap 2),
// through the real workbench with the production document repository on:
// authored geometry on a datum axis with overlapping construction, hover
// feedback, select, the repeated-click cycle with its wrap, and the Alt
// chooser (pick, Escape, the dismissing press, a single candidate). Every
// pointer path glides (`glideClick`/`glidePress`: several `mouse.move`
// steps, then a real press); the keyboard is real (Alt held through the
// click, Escape). No debug action: the selection is cleared by a blank
// click. Debug reads (hover target, editor selection, sketch snapshot) are
// assertions only. The pre-T17 rows `sketch-authored-first-picking`,
// `sketch-pick-cycle` and `sketch-pick-chooser` stay as regression rows;
// step → row map and mutants: T17j3.md.

test.use({ viewport: { width: 1440, height: 900 } });
// Overlays follow the pointer a few frames late under the full lane's load.
const expect = baseExpect.configure({ timeout: 10_000 });

const LINE_TOOL = "Create line geometry.";
const CONSTRUCTION_TOGGLE =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";
const NOTHING = "Nothing selected";

// Canvas coordinates of the T11c audit (1440×900, Top plane): the X axis
// runs along y ≈ 450. Both lines span x 850…1050 on it.
const LINE_FROM = { x: 850, y: 450 };
const LINE_TO = { x: 1050, y: 450 };
/** On the line, the construction line and the X axis: a 3-entry stack. */
const OVERLAP = { x: 950, y: 452 };
/** On the X axis only, away from both lines: a 1-entry stack. */
const AXIS_ONLY = { x: 1100, y: 452 };
/** On both lines, away from where the chooser opens. */
const DISMISS_ON_LINE = { x: 880, y: 452 };
/** Empty canvas: no candidate. */
const BLANK = { x: 1200, y: 700 };

const hint = (page: Page) => page.getByTestId("sketch-pick-hint");
const chooser = (page: Page) => page.getByTestId("sketch-pick-chooser");

/** A Line on the X axis; Escape ends the chain, a second leaves Line. */
async function drawAxisLine(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await workbench.activateTool(LINE_TOOL);
  await glideClick(workbench, LINE_FROM);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, LINE_TO),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect
    .poll(
      () => page.evaluate(() => window.__cadaraDebug?.getState()?.command),
      { message: "Line is left for Select" },
    )
    .toBe("sketch");
}

/** A gliding click with Alt held through it (real key and pointer events). */
async function altGlideClick(
  workbench: FeatureWorkbenchHarness,
  at: { x: number; y: number },
) {
  await workbench.page.keyboard.down("Alt");
  try {
    await glideClick(workbench, at);
  } finally {
    await workbench.page.keyboard.up("Alt");
  }
}

test("§3 E2E-3 selection: authored geometry on the X datum axis over a coincident construction line; hover shows the authored line first and offers the overlap; a click selects it; repeated clicks cycle line → construction → axis and wrap; a blank click clears; Alt+click opens the stack-ordered chooser (pick, Escape, the dismissing press select nothing else; one candidate is selected directly); nothing is recorded", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.expectWorkspaceInRepository();
  await openTopSketch(workbench);

  // Step 1: a construction line on the X axis, then an ordinary line over
  // it (the toggle marks only the next geometry). The construction line is
  // entity 1, so its stable key would win if the class order regressed.
  await workbench.activateTool(CONSTRUCTION_TOGGLE);
  await drawAxisLine(workbench);
  await drawAxisLine(workbench);
  const snap = await mixedSnapshot(page);
  const definition = (
    snap as unknown as {
      definition: {
        entities: { entityId: string; isConstruction: boolean }[];
      };
    }
  ).definition;
  expect(
    definition.entities.map((entity) => entity.isConstruction),
    "premise: a construction line, then an ordinary line",
  ).toEqual([true, false]);
  const [construction, line] = definition.entities.map(
    (entity) => entity.entityId,
  ) as [string, string];
  for (const point of snap.points)
    expect(
      Math.abs(point.position[1]),
      "premise: both lines lie on the X datum axis",
    ).toBeLessThan(1e-9);
  const strip = await readHistoryStrip(page);
  const canvas = (await workbench.viewport().boundingBox())!;

  const hovered = () => workbench.currentHoverTarget();
  const selected = () => workbench.currentEditorSelection();
  /** Exactly `expected` (one of line, construction, xAxis) is selected. */
  const expectOnly = async (expected: string, message: string) => {
    await expect
      .poll(selected, { message })
      .toMatch(new RegExp(`\\.${expected}$`));
    for (const other of [line, construction, "xAxis"].filter(
      (entry) => entry !== expected,
    ))
      expect(await selected(), `${message}: only ${expected}`).not.toContain(
        other,
      );
  };
  const expectHover = (expected: string, message: string) =>
    expect.poll(hovered, { message }).toMatch(new RegExp(`\\.${expected}$`));
  /**
   * A barrier on state, not time: glide to blank canvas and wait until the
   * hover is cleared there; every earlier pointer and key event has been
   * handled by then, so a wrong selection would already show.
   */
  const settle = async () => {
    await page.mouse.move(canvas.x + BLANK.x, canvas.y + BLANK.y, {
      steps: 8,
    });
    await expect
      .poll(hovered, { message: "the hover left the stack" })
      .toBe("none");
  };

  // Step 2: hover feedback. Over the overlap the authored line is the hover
  // target (authored first, over the construction line and the axis), and
  // the hint offers the other two; hovering selects nothing.
  await glideClick(workbench, BLANK);
  await expect.poll(selected).toBe(NOTHING);
  await page.mouse.move(canvas.x + OVERLAP.x, canvas.y + OVERLAP.y, {
    steps: 8,
  });
  await expectHover(line, "hover shows the authored line first");
  await expect(hint(page)).toContainText("2 more here — click again to cycle");
  expect(await selected(), "hovering selects nothing").toBe(NOTHING);

  // Step 3: the first click selects the authored line only; the hover now
  // previews what the next click picks.
  await glideClick(workbench, OVERLAP);
  await expectOnly(line, "the first click selects the authored line");
  await expectHover(construction, "then the hover previews the next pick");

  // Step 4: repeated clicks on the spot cycle through the stack and wrap.
  for (const [expected, next] of [
    [construction, "xAxis"],
    ["xAxis", line],
    [line, construction],
  ] as const) {
    await glideClick(workbench, OVERLAP);
    await expectOnly(expected, `the cycle selects ${expected}`);
    await expectHover(next, `after ${expected} the hover previews ${next}`);
  }

  // Step 5: a blank click clears the selection; the next click on the
  // overlap starts again at the authored line.
  await glideClick(workbench, BLANK);
  await expect
    .poll(selected, { message: "a blank click clears" })
    .toBe(NOTHING);
  await glideClick(workbench, OVERLAP);
  await expectOnly(line, "after the clear the cycle restarts at the line");
  await glideClick(workbench, BLANK);
  await expect.poll(selected).toBe(NOTHING);

  // Step 6: Alt+click on a single candidate just selects it (no chooser).
  await altGlideClick(workbench, AXIS_ONLY);
  await expectOnly("xAxis", "Alt+click on one candidate selects it");
  await expect(chooser(page)).toBeHidden();
  await glideClick(workbench, BLANK);
  await expect.poll(selected).toBe(NOTHING);

  // Step 7: Alt+click on the overlap opens the chooser in stack order and
  // selects nothing; gliding over an item previews it; pressing it selects
  // exactly that and focus returns to the canvas.
  await altGlideClick(workbench, OVERLAP);
  await expect(chooser(page)).toBeVisible();
  await expect(chooser(page).getByRole("menuitem")).toHaveText([
    /^Line 2\s*Curve$/,
    /^Construction line 1\s*Construction$/,
    /^X axis\s*Reference$/,
  ]);
  expect(await selected(), "opening the chooser selects nothing").toBe(NOTHING);
  const axisItem = chooser(page).getByRole("menuitem", { name: /X axis/ });
  const item = (await axisItem.boundingBox())!;
  await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, {
    steps: 10,
  });
  await expectHover("xAxis", "the item under the pointer is previewed");
  await glidePress(page, axisItem);
  await expect(chooser(page)).toBeHidden();
  await expectOnly("xAxis", "choosing X axis selects it");
  const canvasFocused = () =>
    page.evaluate(() => document.activeElement?.tagName);
  await expect
    .poll(canvasFocused, { message: "focus returns to the canvas" })
    .toBe("CANVAS");

  // Step 8: Escape closes the chooser and changes nothing.
  await altGlideClick(workbench, OVERLAP);
  await expect(chooser(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser(page)).toBeHidden();
  await expect.poll(canvasFocused).toBe("CANVAS");
  await settle();
  await expectOnly("xAxis", "Escape kept the selection");

  // Step 9: the canvas press that dismisses an open chooser, on the lines,
  // only closes it: the selection stays the axis.
  await altGlideClick(workbench, OVERLAP);
  await expect(chooser(page)).toBeVisible();
  await glideClick(workbench, DISMISS_ON_LINE);
  await expect(chooser(page)).toBeHidden();
  await settle();
  await expectOnly("xAxis", "the dismissing press selected nothing else");
  await expect.poll(canvasFocused).toBe("CANVAS");

  // Selection, hover and the chooser are not actions.
  expect(await readHistoryStrip(page), "nothing is recorded").toEqual(strip);
});
