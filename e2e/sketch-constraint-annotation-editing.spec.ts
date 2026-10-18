import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

test("T14a review B-1: gliding the mouse to the placement point and clicking on the preview handle shows the value input", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  const canvas = page.locator("main canvas").first();
  await workbench.activateTool("Create line geometry.");
  await canvas.click({ position: { x: 560, y: 460 }, force: true });
  await canvas.click({ position: { x: 760, y: 460 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await canvas.click({ position: { x: 560, y: 460 }, force: true });
  await canvas.click({ position: { x: 760, y: 460 }, force: true });

  // A mouse user glides to the placement point; the preview (and its drag
  // handle) follows the pointer, so the click lands on the handle.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 700, box.y + 470);
  await page.mouse.move(box.x + 660, box.y + 400, { steps: 12 });
  await workbench.waitForAnimationFrames(3);
  await page.evaluate(() => {
    window.addEventListener(
      "pointerdown",
      (event) => {
        (window as unknown as { __pointerdownHandle: string | null })
          .__pointerdownHandle = (event.target as Element).getAttribute(
          "data-sketch-viewport-drag-handle",
        );
      },
      { capture: true, once: true },
    );
  });
  await page.mouse.down();
  await page.mouse.up();

  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __pointerdownHandle: string | null })
          .__pointerdownHandle,
    ),
    "The click lands on the preview's drag handle.",
  ).not.toBe(null);
  await expect(
    page.locator("[data-sketch-viewport-floating-input]"),
  ).toBeVisible();
});

test("committed distance annotation input keeps Backspace local and saves durable value edits", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  const canvas = page.locator("main canvas").first();

  await workbench.activateTool("Create line geometry.");
  await canvas.click({ position: { x: 360, y: 260 }, force: true });
  await canvas.click({ position: { x: 460, y: 320 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await canvas.click({ position: { x: 360, y: 260 }, force: true });
  await canvas.click({ position: { x: 460, y: 320 }, force: true });
  await canvas.click({ position: { x: 420, y: 240 }, force: true });

  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill("24");
  await floatingInput.getByRole("button", { name: "Commit" }).click();

  const distanceGlyph = page
    .locator('[data-sketch-annotation-kind="dimension"]')
    .first();
  await expect(distanceGlyph).toBeVisible();

  await distanceGlyph.dblclick();
  await expect(floatingInput).toBeVisible();

  const editInput = floatingInput.locator("input");
  await expect(editInput).toHaveValue("24");
  await editInput.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await editInput.press("Backspace");

  await expect(distanceGlyph).toBeVisible();
  await expect(floatingInput).toBeVisible();

  await floatingInput.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter a value before saving.")).toBeVisible();
  await expect(distanceGlyph).toBeVisible();

  await editInput.fill("31");
  await floatingInput.getByRole("button", { name: "Save" }).click();

  await expect(floatingInput).toBeHidden();
  await expect(distanceGlyph).toHaveAttribute("aria-label", /31\.00/);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  const committedDimensionValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (!serialized) {
      return [];
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            dimensions?: Array<{ kind: string; value?: { source?: string; value?: number } }>;
          };
        };
      }>;
    };

    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.dimensions?.map(
          (dimension) => dimension.value?.value ?? null,
        ) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(committedDimensionValues).toContain(31);
});

type LivePoint = { id: string; position: readonly [number, number] };

async function readLivePoints(page: import("@playwright/test").Page) {
  const snapshot = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snapshot) throw new Error("No live sketch snapshot.");
  return (snapshot as { points: LivePoint[] }).points;
}

/** Opens the Distance variant on `target`, places it, returns the open input. */
async function openDimensionInput(
  workbench: SketchWorkbenchHarness,
  target: { x: number; y: number },
  placement: { x: number; y: number },
) {
  const page = workbench.page;
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt(target);
  await workbench.clickViewportAt(placement);
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  return floatingInput;
}

// T13c (D5–D7) through the browser: deliberate sizing with measured prefill,
// a width-only rectangle, a blocked rim, then a confirmed conflicting edit is
// retained, highlighted and explained, and Undo restores a solved sketch.
test("T13c: measured prefill, width-only rectangle, blocked rim, retained and explained conflicting diameter edit, Undo", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 700, y: 500 });
  await workbench.clickViewportAt({ x: 900, y: 650 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await page.keyboard.press("Escape");
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 400, y: 320 });
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("5 entities staged");
  await page.keyboard.press("Escape");

  const drawn = await readLivePoints(page);
  expect(drawn, "premise: 4 corners and the centre").toHaveLength(5);
  const corners = drawn.slice(0, 4);
  const centre = drawn[4]!;
  // Top plane, origin at the viewport centre (720, 480): sketch units per px.
  const scale = centre.position[0] / (400 - 720);
  const xs = corners.map((corner) => corner.position[0]);
  const width = Math.max(...xs) - Math.min(...xs);

  // D5: the circle's Dimension input opens with its measured diameter.
  let floatingInput = await openDimensionInput(
    workbench,
    { x: 470, y: 320 },
    { x: 520, y: 250 },
  );
  await expect(floatingInput).toContainText("Diameter");
  const diameter = Number(await floatingInput.locator("input").inputValue());
  expect(diameter, "measured diameter prefill").toBeCloseTo(2 * 70 * scale, 2);
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");

  // D5: the bottom side's Length input opens with the measured width.
  floatingInput = await openDimensionInput(
    workbench,
    { x: 800, y: 650 },
    { x: 800, y: 700 },
  );
  expect(
    Number(await floatingInput.locator("input").inputValue()),
    "measured width prefill",
  ).toBeCloseTo(width, 4);
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");
  const dimensionGlyphs = page.locator(
    '[data-sketch-annotation-kind="dimension"]',
  );
  await expect(dimensionGlyphs).toHaveCount(2);
  const sized = await readLivePoints(page);
  for (const [index, point] of drawn.entries()) {
    expect(
      sized[index]!.position[0],
      "untouched commits move nothing",
    ).toBeCloseTo(point.position[0], 6);
    expect(sized[index]!.position[1]).toBeCloseTo(point.position[1], 6);
  }

  // Width-only: dragging the top-right corner up changes the height only.
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");
  await page.mouse.move(box.x + 900, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 900, box.y + 420, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(3);
  const resized = (await readLivePoints(page)).slice(0, 4);
  const ys = (points: readonly LivePoint[]) =>
    points.map((point) => point.position[1]);
  const height = (points: readonly LivePoint[]) =>
    Math.max(...ys(points)) - Math.min(...ys(points));
  const widthOf = (points: readonly LivePoint[]) =>
    Math.max(...points.map((point) => point.position[0])) -
    Math.min(...points.map((point) => point.position[0]));
  expect(
    height(resized) - height(corners),
    "the height grew by ~80 px",
  ).toBeCloseTo(80 * Math.abs(scale), 1);
  expect(widthOf(resized), "the width dimension holds").toBeCloseTo(width, 4);

  // The diameter blocks a rim drag (cue during, nothing moves).
  const centreBefore = (await readLivePoints(page))[4]!;
  await page.mouse.move(box.x + 470, box.y + 320);
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.move(box.x + 560, box.y + 320, { steps: 8 });
  await workbench.waitForAnimationFrames(6);
  await expect(
    page.locator('[data-testid="sketch-drag-feedback-cue"]'),
    "the blocked rim drag shows the cue",
  ).not.toHaveCount(0);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  expect((await readLivePoints(page))[4]!.position).toEqual(
    centreBefore.position,
  );

  // A consistent Radius dimension (prefill untouched), then the diameter is
  // edited to a conflicting value: retained, highlighted and explained.
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", { name: /Radius Create circle radius dimensions/ })
    .click();
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await workbench.clickViewportAt({ x: 450, y: 400 });
  await expect(floatingInput).toBeVisible();
  // T13e (D11): the radius is determined by the diameter, so the input opens
  // in Reference mode; Make driving authors the redundant driving radius.
  const radiusValue = floatingInput.locator("input:not([role='switch'])");
  expect(
    Number(await radiusValue.inputValue()),
    "measured radius prefill",
  ).toBeCloseTo(diameter / 2, 4);
  await floatingInput.getByRole("switch", { name: "Make driving" }).check();
  await expect(radiusValue).toBeEditable();
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dimensionGlyphs).toHaveCount(3);
  const explanation = page
    .getByRole("status")
    .filter({ hasText: "profiles from it are blocked" });
  await expect(explanation, "premise: still solved").toHaveCount(0);

  const diameterGlyph = page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label^="Diameter"]',
  );
  await diameterGlyph.dblclick();
  await expect(floatingInput).toBeVisible();
  const conflicting = (diameter * 1.5).toFixed(3);
  await floatingInput.locator("input").fill(conflicting);
  await floatingInput.getByRole("button", { name: "Save" }).click();
  await expect(floatingInput, "the conflicting edit is committed").toBeHidden();
  await expect(diameterGlyph).toHaveAttribute(
    "aria-label",
    new RegExp(`${Number(conflicting).toFixed(2).replace(".", "\\.")}`),
  );
  await expect(diameterGlyph, "highlighted as conflicting").toHaveAttribute(
    "style",
    /--workbench-shell-danger-text/,
  );
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText(
    /^Diameter \d+ \([\d.]+ mm\) conflicts with Radius \d+ \([\d.]+ mm\)\./,
  );
  await expect(explanation).toContainText(
    "Change or delete one of them, or Undo.",
  );

  // Undo restores the solved sketch.
  await page.keyboard.press("Control+z");
  await expect(explanation).toHaveCount(0);
  await expect(diameterGlyph).toHaveAttribute(
    "aria-label",
    new RegExp(`${diameter.toFixed(2).replace(".", "\\.")}`),
  );
  await expect(diameterGlyph).not.toHaveAttribute(
    "style",
    /--workbench-shell-danger-text/,
  );
});
