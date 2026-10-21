import { expect, test, type Locator, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the workbench browser flow of the T14e
// Constraints panel (T-11/T-12, T-17, Q1/A-9): problems visible and listed
// first with their reason, list hover (linked highlight through the editor
// hover channel), select, delete and Undo, Show all through the visible
// switch, and the panel's real boxes against the view cube, notifications
// and annotation chips. The mouse glides (several `mouse.move` steps) so the
// DOM overlays under the pointer see the enter/leave sequence a user makes.
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

type ViewportPoint = { x: number; y: number };
type Rgb = readonly [number, number, number];
type Box = { x: number; y: number; width: number; height: number };

const listRows = (page: Page) => page.locator("[data-sketch-constraint-row]");
const showAllSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Show all constraints" });
const constraintGlyphs = (page: Page) =>
  page.locator('[data-sketch-annotation-kind="constraint"]');

async function openSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

/** Leaves the armed tool for Select (a chain's first Escape ends it). */
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

/** Two lines A (≈ (500, 325)) and B (≈ (500, 630)) with Parallel. */
async function parallelLines(workbench: SketchWorkbenchHarness) {
  await drawLine(
    workbench,
    { x: 400, y: 300 },
    { x: 600, y: 350 },
    "1 entities",
  );
  await drawLine(
    workbench,
    { x: 400, y: 600 },
    { x: 600, y: 660 },
    "2 entities",
  );
  await workbench.activateTool("Constrain two lines to remain parallel.");
  await workbench.clickViewportAt({ x: 500, y: 325 });
  await workbench.clickViewportAt({ x: 500, y: 630 });
  await leaveTool(workbench);
  await workbench.page.evaluate(() => window.__cadaraDebug?.clearSelection());
}

/** Glides the mouse from a canvas point onto a DOM element's centre. */
async function glideOnto(
  workbench: SketchWorkbenchHarness,
  from: ViewportPoint,
  target: Locator,
) {
  const canvas = (await workbench.viewport().boundingBox())!;
  const box = (await target.boundingBox())!;
  await workbench.page.mouse.move(canvas.x + from.x, canvas.y + from.y);
  await workbench.page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2,
    { steps: 10 },
  );
  await workbench.waitForAnimationFrames(3);
}

async function glideToCanvas(
  workbench: SketchWorkbenchHarness,
  point: ViewportPoint,
) {
  const box = (await workbench.viewport().boundingBox())!;
  await workbench.page.mouse.move(box.x + point.x + 40, box.y + point.y + 30);
  await workbench.page.mouse.move(box.x + point.x, box.y + point.y, {
    steps: 8,
  });
  await workbench.waitForAnimationFrames(3);
}

function intersects(left: Box, right: Box) {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a rendered box.");
  return box;
}

async function chipBoxes(page: Page) {
  const chips = page.locator("[data-sketch-annotation-kind]");
  const boxes: Box[] = [];
  for (let index = 0; index < (await chips.count()); index += 1) {
    const box = await chips.nth(index).boundingBox();
    if (box) boxes.push(box);
  }
  return boxes;
}

test("T14e T-17: a conflicting dimension stays visible with Show all off and nothing selected, and is listed first with its reason", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 400, y: 320 });
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await leaveTool(workbench);

  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  // A driving diameter, then a driving radius at the same size.
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await workbench.clickViewportAt({ x: 520, y: 250 });
  await expect(floatingInput).toBeVisible();
  const diameter = Number(
    await floatingInput.getByRole("textbox").inputValue(),
  );
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await leaveTool(workbench);
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", { name: /Radius Create circle radius dimensions/ })
    .click();
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await workbench.clickViewportAt({ x: 450, y: 400 });
  await expect(floatingInput).toBeVisible();
  await floatingInput.getByRole("switch", { name: "Make driving" }).check();
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await leaveTool(workbench);

  // The diameter edited to a conflicting value (retained, T13 D6).
  const diameterChip = page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label^="Diameter"]',
  );
  await diameterChip.dblclick();
  await expect(floatingInput).toBeVisible();
  await floatingInput.getByRole("textbox").fill((diameter * 1.5).toFixed(3));
  await floatingInput.getByRole("button", { name: "Save" }).click();
  await expect(floatingInput).toBeHidden();

  // Show all off, nothing selected, the pointer away from everything.
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await workbench.hoverViewportAt({ x: 900, y: 800 });
  await expect(showAllSwitch(page)).not.toBeChecked();
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toBe("Nothing selected");
  await expect(
    diameterChip,
    "the conflicting dimension stays visible",
  ).toBeVisible();
  await expect(diameterChip).toHaveAttribute(
    "style",
    /--workbench-shell-danger-text/,
  );

  const first = listRows(page).first();
  await expect(first, "the problem is listed first").toHaveAttribute(
    "data-sketch-constraint-problem",
    "",
  );
  await expect(first.locator("button").first()).toHaveAccessibleName(
    /^Diameter/,
  );
  await expect(
    first.locator("[data-sketch-constraint-problem-text]"),
    "with its status and the D7 reason",
  ).toHaveText(/^Conflict: .*(conflict|cannot be satisfied).*Undo\.$/);
  await expect(
    page.locator("[data-sketch-constraint-problem-count]"),
  ).toBeVisible();
});

test("T14e: a list row highlights on hover (no click), selects on click, deletes, and Undo restores it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await parallelLines(workbench);
  const parallelRow = listRows(page).filter({
    has: page.getByRole("button", { name: /^Parallel/ }),
  });
  await expect(parallelRow).toHaveCount(1);
  await expect(
    constraintGlyphs(page),
    "premise: nothing selected, the Parallel glyph is hidden",
  ).toHaveCount(0);

  const lineB = { x: 500, y: 630 };
  await workbench.hoverViewportAt({ x: 900, y: 820 });
  await expect.poll(() => workbench.currentHoverTarget()).toBe("none");
  const unhighlighted = await crop(workbench, lineB);

  // Hover from the canvas onto the row (the canvas leave hands the hover over).
  await glideOnto(workbench, { x: 900, y: 820 }, parallelRow);
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "The row's hover reaches the editor and stays.",
      timeout: 10_000,
    })
    .toMatch(/constraint/);
  await expect
    .poll(
      async () => maxColorDistance(await crop(workbench, lineB), unhighlighted),
      {
        message: "Line B, an affected entity, is highlighted.",
        timeout: 10_000,
      },
    )
    .toBeGreaterThan(60);
  expect(
    await workbench.currentEditorSelection(),
    "No click happened: nothing is selected.",
  ).toBe("Nothing selected");

  // Click: the constraint is selected; its glyph shows as the active one.
  await parallelRow.getByRole("button", { name: /^Parallel/ }).click();
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toMatch(/constraint/);
  await expect(
    parallelRow.getByRole("button", { name: /^Parallel/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('[data-sketch-annotation-selection="active"]'),
  ).toHaveAttribute("data-sketch-annotation-glyph", "constraintParallel");

  // Delete from the row: one action; Undo restores it.
  await parallelRow.getByRole("button", { name: "Delete Parallel" }).click();
  await expect(parallelRow, "deleted").toHaveCount(0);
  await expect(listRows(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(parallelRow, "Undo restores it").toHaveCount(1);
});

test("T14e T-18: a glide from hovered geometry straight onto a row hands the hover to the row", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await parallelLines(workbench);
  const parallelRow = listRows(page).filter({
    has: page.getByRole("button", { name: /^Parallel/ }),
  });
  const canvas = (await workbench.viewport().boundingBox())!;
  const panel = await boxOf(page.locator("[data-sketch-constraint-list]"));
  const row = await boxOf(parallelRow);
  // A line ending just left of the panel, level with the row.
  const y = row.y + row.height / 2 - canvas.y;
  const edge = panel.x - canvas.x;
  // Shift suppresses inference, so no Horizontal row is added above it.
  await workbench.activateTool("Create line geometry.");
  await page.keyboard.down("Shift");
  await workbench.clickViewportAt({ x: edge - 300, y });
  await workbench.clickViewportAt({ x: edge - 3, y });
  await page.keyboard.up("Shift");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("3 entities staged");
  await leaveTool(workbench);
  await expect(parallelRow, "premise: the row did not move").toHaveCount(1);
  expect(await boxOf(parallelRow)).toEqual(row);
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());

  await glideToCanvas(workbench, { x: edge - 30, y });
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "premise: the canvas hovers the line",
      timeout: 10_000,
    })
    .not.toMatch(/^none$|constraint/);
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, {
    steps: 6,
  });
  await workbench.waitForAnimationFrames(4);
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "The row owns the hover after the canvas leave.",
      timeout: 10_000,
    })
    .toMatch(/constraint/);
});

test("T14e T-11: Show all reveals hidden constraints, clickable when idle; it survives a tool switch", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await parallelLines(workbench);
  await workbench.activateTool(
    "Constrain a line parallel to the sketch horizontal axis.",
  );
  await workbench.clickViewportAt({ x: 500, y: 325 });
  await leaveTool(workbench);
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await workbench.hoverViewportAt({ x: 900, y: 820 });
  await expect(listRows(page), "premise: two constraints").toHaveCount(2);
  await expect(constraintGlyphs(page), "hidden with Show all off").toHaveCount(
    0,
  );

  await showAllSwitch(page).check({ force: true });
  await expect(showAllSwitch(page)).toBeChecked();
  await expect(constraintGlyphs(page)).toHaveCount(2);
  for (const glyph of await constraintGlyphs(page).all()) {
    await expect(glyph).toHaveAttribute(
      "data-sketch-annotation-interactive",
      "true",
    );
  }

  // Clickable when idle: a click on the glyph selects its constraint.
  const parallel = page.locator(
    '[data-sketch-annotation-glyph="constraintParallel"]',
  );
  const canvas = (await workbench.viewport().boundingBox())!;
  const glyphBox = await boxOf(parallel);
  await glideToCanvas(workbench, {
    x: glyphBox.x + glyphBox.width / 2 - canvas.x,
    y: glyphBox.y + glyphBox.height / 2 - canvas.y,
  });
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toMatch(/constraint/);
  await expect(parallel).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );

  // A tool switch keeps Show all; the glyphs stay visible but passive.
  await workbench.activateTool("Create line geometry.");
  await expect(showAllSwitch(page)).toBeChecked();
  await expect(constraintGlyphs(page)).toHaveCount(2);
  for (const glyph of await constraintGlyphs(page).all()) {
    await expect(glyph).toHaveAttribute(
      "data-sketch-annotation-interactive",
      "false",
    );
  }
  await leaveTool(workbench);
  await expect(constraintGlyphs(page).first()).toHaveAttribute(
    "data-sketch-annotation-interactive",
    "true",
  );

  // Off again: the context rules apply (nothing selected after the blank).
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await showAllSwitch(page).uncheck({ force: true });
  await expect(constraintGlyphs(page)).toHaveCount(0);
});

test("T14e T-12: the panel overlaps neither the view cube, a notification nor any annotation chip", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const panel = page.locator("[data-sketch-constraint-list]");
  const cubeColumn = page.getByTestId("view-cube").locator("..");
  await expect(panel).toBeVisible();

  // A line under the panel's right-side area with a length dimension whose
  // chip is anchored there.
  await drawLine(
    workbench,
    { x: 1080, y: 420 },
    { x: 1380, y: 420 },
    "1 entities",
  );
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt({ x: 1100, y: 420 });
  await workbench.clickViewportAt({ x: 1100, y: 380 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await leaveTool(workbench);
  const chip = page.locator('[data-sketch-annotation-kind="dimension"]');

  // Premise: with the list collapsed the chip renders where the expanded
  // panel will be.
  await page
    .getByRole("button", { name: "Collapse the constraints list" })
    .click();
  await expect(panel).toHaveAttribute("data-collapsed", "true");
  await page
    .getByRole("button", { name: "Expand the constraints list" })
    .focus();
  await workbench.waitForAnimationFrames(4);
  await expect(chip).toHaveCount(1);
  const collapsedChip = await boxOf(chip);
  await page
    .getByRole("button", { name: "Expand the constraints list" })
    .click();
  await expect(panel).toHaveAttribute("data-collapsed", "false");
  await workbench.waitForAnimationFrames(4);
  const panelBox = await boxOf(panel);
  expect(
    intersects(collapsedChip, panelBox),
    "premise: the collapsed-state chip lies where the expanded panel is",
  ).toBe(true);
  await expect
    .poll(
      async () =>
        (await chipBoxes(page)).some((box) => intersects(box, panelBox)),
      { message: "No chip overlaps the expanded panel.", timeout: 5_000 },
    )
    .toBe(false);

  // Show all with every constraint drawn: still no chip over the panel.
  await showAllSwitch(page).check({ force: true });
  await workbench.waitForAnimationFrames(4);
  expect(
    (await chipBoxes(page)).filter((box) => intersects(box, panelBox)),
  ).toEqual([]);

  // The view cube column is above the panel, beside it in nothing.
  const cubeBox = await boxOf(cubeColumn);
  expect(intersects(cubeBox, panelBox), "the cube and the panel").toBe(false);
  expect(panelBox.y).toBeGreaterThanOrEqual(cubeBox.y + cubeBox.height);

  // A real notification (right-click Report bug downloads the diagnostics).
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Report bug" })
    .click({ button: "right" });
  await download;
  const notification = page.locator("[data-notification-type]");
  await expect(notification).toBeVisible({ timeout: 10_000 });
  await workbench.waitForAnimationFrames(4);
  const notificationBox = await boxOf(notification);
  const panelWithNotification = await boxOf(panel);
  expect(
    intersects(notificationBox, panelWithNotification),
    "the notification and the panel",
  ).toBe(false);
  expect(
    intersects(notificationBox, cubeBox),
    "the notification and the cube",
  ).toBe(false);
  expect(
    (await chipBoxes(page)).filter((box) =>
      intersects(box, panelWithNotification),
    ),
  ).toEqual([]);
});

/** A 32 × 32 frame crop centred on a canvas point. */
async function crop(workbench: SketchWorkbenchHarness, point: ViewportPoint) {
  await workbench.waitForAnimationFrames(4);
  const box = (await workbench.viewport().boundingBox())!;
  return readPixels(
    workbench.page,
    await workbench.page.screenshot({
      scale: "css",
      clip: {
        x: Math.round(box.x + point.x - 16),
        y: Math.round(box.y + point.y - 16),
        width: 32,
        height: 32,
      },
    }),
  );
}

function maxColorDistance(left: Rgb[][], right: Rgb[][]) {
  let max = 0;
  left.forEach((row, y) =>
    row.forEach((pixel, x) => {
      const other = right[y]![x]!;
      max = Math.max(
        max,
        Math.hypot(
          pixel[0] - other[0],
          pixel[1] - other[1],
          pixel[2] - other[2],
        ),
      );
    }),
  );
  return max;
}

/** Decodes a PNG screenshot in the page into rows of RGB pixels. */
async function readPixels(page: Page, png: Buffer): Promise<Rgb[][]> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    return Array.from({ length: image.height }, (_, y) =>
      Array.from({ length: image.width }, (_, x) => {
        const index = (y * image.width + x) * 4;
        return [data[index]!, data[index + 1]!, data[index + 2]!] as const;
      }),
    );
  }, png.toString("base64"));
}

// --- T14e review B-1, A-3, A-7, R-2 ----------------------------------------

const fabLocator = (page: Page) =>
  page.locator("[data-workbench-variables-fab]");
const panelLocator = (page: Page) =>
  page.locator("[data-sketch-constraint-list]");

/**
 * A rectangle and two lines with Parallel and Horizontal (≥ 6 list rows),
 * stacked downwards from `origin` in a `width`-wide strip clear of the left
 * tool panel and the right-side column.
 */
async function denseSketch(
  workbench: SketchWorkbenchHarness,
  origin: ViewportPoint,
  width: number,
) {
  const page = workbench.page;
  await workbench.openToolMenu("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt(origin);
  await workbench.clickViewportAt({ x: origin.x + width, y: origin.y + 50 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await leaveTool(workbench);
  const a = { x: origin.x, y: origin.y + 80 };
  const b = { x: origin.x, y: origin.y + 130 };
  await drawLine(workbench, a, { x: a.x + width, y: a.y + 8 }, "5 entities");
  await drawLine(workbench, b, { x: b.x + width, y: b.y + 8 }, "6 entities");
  await workbench.activateTool("Constrain two lines to remain parallel.");
  await workbench.clickViewportAt({ x: a.x + width / 2, y: a.y + 4 });
  await workbench.clickViewportAt({ x: b.x + width / 2, y: b.y + 4 });
  await leaveTool(workbench);
  await workbench.activateTool(
    "Constrain a line parallel to the sketch horizontal axis.",
  );
  await workbench.clickViewportAt({ x: a.x + width / 2, y: a.y + 4 });
  await leaveTool(workbench);
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
}

/** The panel stays in the window, above the FAB; a gliding click opens Variables over it. */
async function expectPanelBoundedAndVariablesReachable(
  workbench: SketchWorkbenchHarness,
) {
  const page = workbench.page;
  const window = page.viewportSize()!;
  const panel = await boxOf(panelLocator(page));
  const fab = await boxOf(fabLocator(page));
  expect(panel.y, "the panel starts inside the window").toBeGreaterThanOrEqual(
    0,
  );
  expect(
    panel.y + panel.height,
    "the panel ends inside the window",
  ).toBeLessThanOrEqual(window.height);
  expect(
    panel.y + panel.height,
    "the panel ends above the Variables FAB (and the bottom stack under it)",
  ).toBeLessThanOrEqual(fab.y);

  await glideToCanvas(workbench, { x: 600, y: 120 });
  await page.mouse.move(fab.x + fab.width / 2, fab.y + fab.height / 2, {
    steps: 10,
  });
  expect(
    await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x!, y!)
          ?.closest("[data-workbench-variables-fab]") !== null,
      [fab.x + fab.width / 2, fab.y + fab.height / 2],
    ),
    "the FAB is topmost under the pointer",
  ).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
  const variables = page.locator("[data-workbench-variables-panel]");
  await expect(variables, "the FAB opened Variables").toBeVisible();
  const open = await boxOf(variables);
  const overlap = {
    x: Math.max(open.x, panel.x),
    y: Math.max(open.y, panel.y),
    r: Math.min(open.x + open.width, panel.x + panel.width),
    b: Math.min(open.y + open.height, panel.y + panel.height),
  };
  expect(
    overlap.r > overlap.x && overlap.b > overlap.y,
    "premise: they overlap",
  ).toBe(true);
  expect(
    await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x!, y!)
          ?.closest("[data-workbench-variables-panel]") !== null,
      [(overlap.x + overlap.r) / 2, (overlap.y + overlap.b) / 2],
    ),
    "the open Variables panel draws over the Constraints panel",
  ).toBe(true);
  await fabLocator(page).click();
  await expect(variables).toBeHidden();
}

test.describe("at 1280×720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("T14e review B-1/A-3/A-7: the panel fills the column above the FAB and scrolls; Variables opens over it; keyboard Delete keeps focus; a viewport selection scrolls its row into view", async ({
    page,
  }) => {
    const workbench = new SketchWorkbenchHarness(page);
    await openSketch(workbench);
    await denseSketch(workbench, { x: 600, y: 260 }, 300);
    const rows = listRows(page);
    expect(await rows.count(), "premise: ≥ 6 rows").toBeGreaterThanOrEqual(6);
    const list = panelLocator(page).locator("ul");
    await expectPanelBoundedAndVariablesReachable(workbench);
    expect(
      await list.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
      "the list scrolls in the height left",
    ).toBe(true);

    // A-7: a glyph selected in the viewport scrolls its (hidden) row into view.
    await showAllSwitch(page).check({ force: true });
    await workbench.hoverViewportAt({ x: 600, y: 600 });
    const visibleInList = async (row: Locator) => {
      const [r, l] = [await boxOf(row), await boxOf(list)];
      return r.y >= l.y - 1 && r.y + r.height <= l.y + l.height + 1;
    };
    let target: { row: Locator; glyph: Locator } | null = null;
    for (let index = (await rows.count()) - 1; index >= 0; index -= 1) {
      const row = rows.nth(index);
      const name = await row
        .locator("button")
        .first()
        .getAttribute("aria-label");
      const glyph = page.locator(
        `button[data-sketch-annotation-kind][aria-label="${name}"]`,
      );
      if ((await glyph.count()) === 1 && !(await visibleInList(row))) {
        target = { row, glyph };
        break;
      }
    }
    expect(target, "premise: a hidden row whose glyph renders").not.toBeNull();
    const canvas = (await workbench.viewport().boundingBox())!;
    const glyphBox = await boxOf(target!.glyph);
    await glideToCanvas(workbench, {
      x: glyphBox.x + glyphBox.width / 2 - canvas.x,
      y: glyphBox.y + glyphBox.height / 2 - canvas.y,
    });
    await page.mouse.down();
    await page.mouse.up();
    await expect(target!.row).toHaveAttribute(
      "data-sketch-constraint-selected",
      "",
    );
    await expect
      .poll(() => visibleInList(target!.row), {
        message: "the selected row is scrolled into the list's view",
      })
      .toBe(true);

    // Re-review AR-1: a list click's marker is used once. A clicked in the
    // list, then B and A again in the viewport: the list scrolls back to A.
    const clickGlyph = async (glyph: Locator) => {
      const box = await boxOf(glyph);
      await glideToCanvas(workbench, {
        x: box.x + box.width / 2 - canvas.x,
        y: box.y + box.height / 2 - canvas.y,
      });
      await page.mouse.down();
      await page.mouse.up();
    };
    await list.evaluate((element) => {
      element.scrollTop = 0;
    });
    let first: { row: Locator; glyph: Locator } | null = null;
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      const name = await row
        .locator("button")
        .first()
        .getAttribute("aria-label");
      const glyph = page.locator(
        `button[data-sketch-annotation-kind][aria-label="${name}"]`,
      );
      if ((await glyph.count()) === 1 && (await visibleInList(row))) {
        first = { row, glyph };
        break;
      }
    }
    expect(first, "premise: a visible row whose glyph renders").not.toBeNull();
    await first!.row.locator("button").first().click();
    await expect(first!.row).toHaveAttribute(
      "data-sketch-constraint-selected",
      "",
    );
    await clickGlyph(target!.glyph);
    await expect(target!.row).toHaveAttribute(
      "data-sketch-constraint-selected",
      "",
    );
    await expect
      .poll(() => visibleInList(first!.row), {
        message: "premise: B scrolled A out of the list's view",
      })
      .toBe(false);
    await clickGlyph(first!.glyph);
    await expect(first!.row).toHaveAttribute(
      "data-sketch-constraint-selected",
      "",
    );
    await expect
      .poll(() => visibleInList(first!.row), {
        message:
          "A, selected again in the viewport, is scrolled back into view",
      })
      .toBe(true);

    // A-3: a keyboard Delete moves focus to the row that takes its place.
    await list.evaluate((element) => {
      element.scrollTop = 0;
    });
    const firstDeletable = rows.filter({
      has: page.getByRole("button", { name: /^Delete / }),
    });
    const deleted = firstDeletable.first();
    const deletedId = await deleted.getAttribute("data-sketch-constraint-row");
    const ids = await rows.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-sketch-constraint-row"),
      ),
    );
    const nextId = ids[ids.indexOf(deletedId) + 1]!;
    await deleted.getByRole("button", { name: /^Delete / }).focus();
    await page.keyboard.press("Enter");
    await expect(rows.filter({ has: page.locator("button") })).toHaveCount(
      ids.length - 1,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement
              ?.closest("[data-sketch-constraint-row]")
              ?.getAttribute("data-sketch-constraint-row") ?? "outside",
        ),
      )
      .toBe(nextId);
  });
});

test.describe("at 900×560", () => {
  test.use({ viewport: { width: 900, height: 560 } });

  test("T14e review B-1: at 900×560 the panel stays in the window above the FAB, and Variables opens over it", async ({
    page,
  }) => {
    const workbench = new SketchWorkbenchHarness(page);
    await openSketch(workbench);
    await denseSketch(workbench, { x: 540, y: 220 }, 56);
    await expectPanelBoundedAndVariablesReachable(workbench);
    // Recorded, not asserted: how much of the panel fits at this size.
    const panel = await boxOf(panelLocator(page));
    console.log(
      "panel-900x560",
      JSON.stringify({
        panel,
        switchVisible: await showAllSwitch(page).isVisible(),
        switchBox: await showAllSwitch(page).boundingBox(),
      }),
    );
  });
});

test("T14e review R-2: a failed history restore and a status message stack without overlap; the panel sits below both", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  // An unreadable stored history: the restore fails (an error notification
  // that stays until dismissed).
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cad.modeling.operationHistory.doc_workspace.v1",
      "{not json",
    );
  });
  await openSketch(workbench);
  const restore = page.locator('[data-notification-type="error"]');
  await expect(restore).toContainText("History restore failed", {
    timeout: 10_000,
  });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Report bug" })
    .click({ button: "right" });
  await download;
  const status = page.locator('[data-notification-type="info"]');
  await expect(status).toBeVisible({ timeout: 10_000 });
  await workbench.waitForAnimationFrames(4);

  const restoreBox = await boxOf(restore);
  const statusBox = await boxOf(status);
  const panel = await boxOf(panelLocator(page));
  const viewport = page.viewportSize()!;
  expect(intersects(restoreBox, statusBox), "restore and status").toBe(false);
  expect(
    statusBox.y,
    "the status stacks under the restore message",
  ).toBeGreaterThan(restoreBox.y + restoreBox.height - 1);
  // The grid keeps the notification right offset reserving the cube column.
  for (const box of [restoreBox, statusBox]) {
    expect(Math.round(viewport.width - (box.x + box.width))).toBe(152);
  }
  expect(
    panel.y,
    "the panel is below the lower notification and its gap",
  ).toBeGreaterThanOrEqual(statusBox.y + statusBox.height + 16 - 1);
  console.log("stack", JSON.stringify({ restoreBox, statusBox, panel }));
});
