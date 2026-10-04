import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser workbench's repeated-click
// cycle over the sketch pick stack (T11d, T11-D4/D5, review R-1/R-2). Only a
// real browser orders pointer-up before `click` and reports `click.detail`.
// Playwright's repeated `mouse.click` always sends `detail` 1, so the
// double-click row uses `clickCount: 2`.
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

test("repeated single clicks cycle line → construction line → X axis and wrap; the hint teaches it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  await workbench.hoverViewportAt(at);
  await expectHover(workbench, line, "Hover previews the line first.");
  const hint = page.getByTestId("sketch-pick-hint");
  await expect(hint).toContainText("2 more here — click again to cycle");

  for (const [expected, next] of [
    [line, construction],
    [construction, xAxis],
    [xAxis, line],
    [line, construction],
  ] as const) {
    await workbench.clickViewportAt(at);
    await expectOnlySelected(workbench, expected);
    await expectHover(
      workbench,
      next,
      `After selecting ${expected} the hover previews ${next}, the next click's pick.`,
    );
  }
});

test("a real double click never advances the cycle", async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport canvas is not visible.");
  await page.mouse.click(box.x + at.x, box.y + at.y, { clickCount: 2 });
  // Its second click (`detail` 2) is connected selection on stack[0], the
  // line (whose chain also holds the construction line it shares end
  // points with); a cycle click would have selected the construction line
  // alone.
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "The double click selects the line's connected chain.",
      timeout: 10_000,
    })
    .toContain(line);
  expect(await workbench.currentEditorSelection()).not.toContain(xAxis);
  await expectHover(
    workbench,
    line,
    "After a double click the hover previews stack[0] again: the cycle was reset.",
  );

  // The next single click starts a fresh cycle at the line.
  await page.waitForTimeout(600);
  await workbench.clickViewportAt(at);
  await expectOnlySelected(workbench, line);
});

test("Offset targets: a cycle click replaces the last-added target instead of adding a second", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openOverlapSketch(workbench);
  await workbench.activateTool(offsetTool);
  const targets = page.getByText(/^Targets: \d+\/\d+$/);

  await workbench.hoverViewportAt(at);
  await expectHover(workbench, line, "Offset hover previews the line first.");
  await workbench.clickViewportAt(at);
  await expectOnlySelected(workbench, line);
  await expect(targets).toHaveText("Targets: 1/1");

  await workbench.clickViewportAt(at);
  await expectOnlySelected(workbench, construction);
  await expect(
    targets,
    "The construction line replaced the line: one Offset target, not two.",
  ).toHaveText("Targets: 1/1");

  // Offset takes no datum axis, so its cycle wraps past it to the line,
  // again replacing rather than toggling or appending.
  await workbench.clickViewportAt(at);
  await expectOnlySelected(workbench, line);
  await expect(targets).toHaveText("Targets: 1/1");
});

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
      message: `The click selects ${expected}.`,
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
