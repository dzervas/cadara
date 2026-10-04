import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser workbench's sketch pick
// stack (T11c): the audit's `axis` scenario (F4) with its coordinates and
// viewport. An authored line on the X axis is hovered and selected by the
// first click, exactly on it and 4 px off; a coincident construction line
// does not take it either (drawn first, so its stable key would win if the
// class order regressed; review REQUIRED-2).
test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 900 } });

const constructionToggle =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";

test("an authored line on the X axis wins the first click over the axis", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const line = "sketch_entity_1_line";
  await openTopPlaneSketch(workbench);
  await drawAxisLine(workbench, "1 entities staged");

  await workbench.hoverViewportAt({ x: 950, y: 450 });
  await expect
    .poll(() => workbench.currentHoverTarget(), { timeout: 10_000 })
    .toContain(line);
  await workbench.clickViewportAt({ x: 950, y: 450 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain(line);
  const lineSelection = await workbench.currentEditorSelection();
  expect(
    lineSelection,
    "The first click on the line over the X axis selects only the line.",
  ).not.toContain("xAxis");

  await clearSelection(workbench);
  await workbench.clickViewportAt({ x: 950, y: 454 });
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "4 px off the axis the first click still selects only the line.",
      timeout: 10_000,
    })
    .toBe(lineSelection);
});

test("an ordinary line beats a coincident construction line drawn before it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopPlaneSketch(workbench);

  // Entity 1: the construction line; its stable key sorts first.
  await workbench.activateTool(constructionToggle);
  await drawAxisLine(workbench, "1 entities staged");
  // Entity 2: the ordinary line over it (Escape cleared the construction
  // modifier; activating the toggle again would arm it again).
  await drawAxisLine(workbench, "2 entities staged");

  await clearSelection(workbench);
  await workbench.clickViewportAt({ x: 950, y: 452 });
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message:
        "The ordinary line (entity 2) beats the coincident construction line (entity 1) and the axis.",
      timeout: 10_000,
    })
    .toContain("sketch_entity_2_line");
  const selection = await workbench.currentEditorSelection();
  expect(selection, "Only the ordinary line is selected.").not.toContain(
    "sketch_entity_1_line",
  );
  expect(selection, "The axis is not selected.").not.toContain("xAxis");
});

async function openTopPlaneSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
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

async function clearSelection(workbench: SketchWorkbenchHarness) {
  await workbench.page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toBe("Nothing selected");
}
