import { expect, test, type Page } from "@playwright/test";

import {
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import {
  cropPixels,
  entityTarget,
  glideClick,
  glidePress,
  hoverUntil,
  maxColorDistance,
  openTopSketch,
  placeFreely,
  sketchSnapshot,
} from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T17c4 (T17c review F-A) the Offset tool
// on a lone open spline in the real workbench: gliding pick → staged preview
// (the shell is its only output) → the floating Create input anchored on it →
// the preview's background certification (derivation worker) → one
// "Commit Offset" action → the live solve's certified shell; Undo/Redo. The
// preview drawing and anchor are pinned by the logic row
// (`sketch-offset-live-cutover.spec.ts`, row 8c).

const OFFSET_TOOL =
  "Offset a connected chain with a durable offset relationship.";
// Viewport 1440×960, top plane (origin at (720, 480), Y up): an arch.
const SPLINE = [
  { x: 600, y: 560 },
  { x: 720, y: 440 },
  { x: 840, y: 560 },
] as const;
const PREVIEW_APEX = { x: 720, y: 419 } as const;

/** The live solve's offset shells and their publication (debug read). */
const shellsOf = (page: Page) =>
  page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.offsetShells ?? null,
  );

test("T17c4: a lone open spline offsets: the preview shows the floating Create input, Create commits one Commit Offset action whose shell certifies; Undo/Redo", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await openTopSketch(workbench);
  await workbench.activateTool("Create spline geometry.");
  await placeFreely(workbench, SPLINE, true);
  const drawn = await sketchSnapshot(page);
  expect(
    drawn.entities.map((entity) => entity.kind),
    "premise: one open spline alone",
  ).toEqual(["spline"]);
  const spline = drawn.entities[0]!;

  await workbench.activateTool(OFFSET_TOOL);
  // The outward preview's apex: 0.5 above the arch's apex (≈ 41.7 px per
  // unit), clear of the seed, its handle and the floating input above it.
  await workbench.clearHoverByLeavingViewport();
  const before = await cropPixels(workbench, PREVIEW_APEX, 6);
  await glideClick(
    workbench,
    await hoverUntil(workbench, { x: 660, y: 470 }, entityTarget(spline.id)),
  );
  await page.getByRole("textbox", { name: "Distance" }).fill("0.5");
  const canvas = (await workbench.viewport().boundingBox())!;
  // Outside the arch.
  await page.mouse.move(canvas.x + 720, canvas.y + 400, { steps: 8 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        maxColorDistance(before, await cropPixels(workbench, PREVIEW_APEX, 6)),
      { message: "the shell preview is drawn", timeout: 15_000 },
    )
    .toBeGreaterThan(60);
  // Create may be pressed before the certification lands; the commit then
  // waits for it (U-G3). The worker's check may take a while on a loaded lane.
  await waitForCommittedAction(
    page,
    "Commit Offset",
    () =>
      glidePress(page, floatingInput.getByRole("button", { name: "Create" })),
    { timeout: 60_000 },
  );
  const created = await sketchSnapshot(page);
  const shell = created.entities.find(
    (entity) => entity.kind === "derivedPiecewiseCubic",
  );
  expect(
    created.entities.map((entity) => entity.kind),
    "the spline and its offset shell",
  ).toEqual(["spline", "derivedPiecewiseCubic"]);
  expect(created.derivedRelationships).toMatchObject([{ kind: "offset" }]);
  await expect
    .poll(() => shellsOf(page), {
      message: "the live solve certifies the committed shell",
      timeout: 60_000,
    })
    .toEqual([{ entityId: shell!.id, publication: "certified" }]);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 5_000 })
    .toMatch(/collecting|editing/);

  await waitForUndoneAction(page, "Commit Offset", () =>
    page.keyboard.press("Control+z"),
  );
  const undone = await sketchSnapshot(page);
  expect(undone.entities.map((entity) => entity.id)).toEqual([spline.id]);
  expect(undone.derivedRelationships).toEqual([]);
  await waitForRedoneAction(page, "Commit Offset", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  expect(
    (await sketchSnapshot(page)).entities.map((entity) => entity.id),
  ).toEqual(created.entities.map((entity) => entity.id));
  await expect
    .poll(() => shellsOf(page), {
      message: "the redone shell certifies again",
      timeout: 60_000,
    })
    .toEqual([{ entityId: shell!.id, publication: "certified" }]);
});

// T17f (T17c4 finding and review A-2). Seam: the Offset tool's panel
// Distance, its floating Create input and the Enter key, with a gliding
// pointer and a committed-history wait. The popup follows the Distance set
// in the panel (base: it kept "1" while Create used 0.5), and Enter in it is
// its Create: one "Commit Offset", its shell drawn at that distance (base:
// Enter did nothing).
test("T17f: the floating input follows the panel's Distance, and Enter in it creates the offset at that distance", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await openTopSketch(workbench);
  await workbench.activateTool("Create spline geometry.");
  await placeFreely(workbench, SPLINE, true);
  const spline = (await sketchSnapshot(page)).entities[0]!;
  await workbench.activateTool(OFFSET_TOOL);
  await workbench.clearHoverByLeavingViewport();
  const before = await cropPixels(workbench, PREVIEW_APEX, 6);
  await glideClick(
    workbench,
    await hoverUntil(workbench, { x: 660, y: 470 }, entityTarget(spline.id)),
  );
  const floatingInput = page.locator(
    '[data-sketch-viewport-floating-input="offset-distance-input"]',
  );
  await expect(floatingInput).toBeVisible({ timeout: 15_000 });
  await expect(floatingInput.locator("input")).toHaveValue("1");
  await page.getByRole("textbox", { name: "Distance" }).fill("0.5");
  await expect(
    floatingInput.locator("input"),
    "the popup shows the panel's distance",
  ).toHaveValue("0.5");

  // Focus the popup's field (as after a pick) and press Enter.
  await glidePress(page, floatingInput.locator("input"));
  await expect(floatingInput.locator("input")).toBeFocused();
  await waitForCommittedAction(
    page,
    "Commit Offset",
    () => page.keyboard.press("Enter"),
    { timeout: 60_000 },
  );
  // The committed shell runs 0.5 above the arch's apex (a shell at 1
  // would pass ≈ 21 px higher).
  await workbench.clearHoverByLeavingViewport();
  await expect
    .poll(
      async () =>
        maxColorDistance(before, await cropPixels(workbench, PREVIEW_APEX, 6)),
      { message: "the shell is drawn 0.5 above the apex", timeout: 15_000 },
    )
    .toBeGreaterThan(60);
});
