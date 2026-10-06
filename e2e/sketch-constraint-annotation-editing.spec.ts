import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

/**
 * T13a: primitives author no sizes, so a dimension is added deliberately
 * through the visible Dimension tool family (variant menu item, target
 * click on the geometry, placement click, typed value, Commit).
 */
async function addDimensionWithTool(
  workbench: SketchWorkbenchHarness,
  variant: RegExp,
  target: { x: number; y: number },
  placement: { x: number; y: number },
  value: string,
) {
  const page = workbench.page;
  const canvas = page.locator("main canvas").first();
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page.getByRole("menuitem", { name: variant }).click();
  await canvas.click({ position: target, force: true });
  await canvas.click({ position: placement, force: true });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill(value);
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");
}

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
            dimensions?: Array<{ kind: string; value?: number | { source?: string; value?: number } }>;
          };
        };
      }>;
    };

    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.dimensions?.map((dimension) =>
          typeof dimension.value === "number"
            ? dimension.value
            : (dimension.value?.value ?? null),
        ) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(committedDimensionValues).toContain(31);
});

test("edited rectangle width annotation solves and still finishes the sketch", async ({
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

  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await canvas.click({ position: { x: 700, y: 500 }, force: true });
  await canvas.click({ position: { x: 900, y: 650 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
    "T13a: the Rectangle tool authors no width/height.",
  ).toHaveCount(0);

  // T13a: dimension the width deliberately on the bottom side (line length).
  await addDimensionWithTool(
    workbench,
    /Distance Create aligned distance dimensions/,
    { x: 800, y: 650 },
    { x: 800, y: 700 },
    "4.8",
  );

  const widthGlyph = page
    .locator('[data-sketch-annotation-kind="dimension"]')
    .first();
  await expect(widthGlyph).toBeVisible();

  await widthGlyph.dblclick();

  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill("31");
  await floatingInput.getByRole("button", { name: "Save" }).click();

  await expect(floatingInput).toBeHidden();
  await expect(widthGlyph).toHaveAttribute("aria-label", /31\.00/);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  const committedWidthValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (!serialized) {
      return [];
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            dimensions?: Array<{ axis?: string; kind: string; value?: number | { source?: string; value?: number } }>;
          };
        };
      }>;
    };

    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.dimensions?.filter(
          (dimension) => dimension.kind === "lineLength",
        )
        .map((dimension) =>
          typeof dimension.value === "number"
            ? dimension.value
            : (dimension.value?.value ?? null),
        ) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(committedWidthValues).toContain(31);
});

test("edited rectangle height annotation solves and still finishes the sketch", async ({
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

  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await canvas.click({ position: { x: 700, y: 500 }, force: true });
  await canvas.click({ position: { x: 900, y: 650 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
    "T13a: the Rectangle tool authors no width/height.",
  ).toHaveCount(0);

  // T13a: dimension the height deliberately on the right side (line length).
  await addDimensionWithTool(
    workbench,
    /Distance Create aligned distance dimensions/,
    { x: 900, y: 575 },
    { x: 950, y: 575 },
    "3.6",
  );

  const heightGlyph = page
    .locator('[data-sketch-annotation-kind="dimension"]')
    .first();
  await expect(heightGlyph).toBeVisible();

  await heightGlyph.dblclick();

  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill("29");
  await floatingInput.getByRole("button", { name: "Save" }).click();

  await expect(floatingInput).toBeHidden();
  await expect(heightGlyph).toHaveAttribute("aria-label", /29\.00/);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  const committedHeightValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (!serialized) {
      return [];
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            dimensions?: Array<{ axis?: string; kind: string; value?: number | { source?: string; value?: number } }>;
          };
        };
      }>;
    };

    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.dimensions?.filter(
          (dimension) => dimension.kind === "lineLength",
        )
        .map((dimension) =>
          typeof dimension.value === "number"
            ? dimension.value
            : (dimension.value?.value ?? null),
        ) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(committedHeightValues).toContain(29);
});

// T13a (review A-10): the radius is added deliberately with the Radius tool.
test("edited circle radius annotation solves and still finishes the sketch", async ({
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

  await workbench.activateTool("Create circular geometry.");
  await canvas.click({ position: { x: 430, y: 320 }, force: true });
  await canvas.click({ position: { x: 500, y: 320 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
    "T13a: the Circle tool authors no radius.",
  ).toHaveCount(0);
  await addDimensionWithTool(
    workbench,
    /Radius Create circle radius dimensions/,
    { x: 500, y: 320 },
    { x: 540, y: 260 },
    "1.7",
  );

  const radiusGlyph = page
    .locator('[data-sketch-annotation-glyph="dimensionRadius"]')
    .first();
  await expect(radiusGlyph).toBeVisible();

  await radiusGlyph.dblclick();

  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill("18");
  await floatingInput.getByRole("button", { name: "Save" }).click();

  await expect(floatingInput).toBeHidden();
  await expect(radiusGlyph).toHaveAttribute("aria-label", /18\.00/);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  const committedRadiusValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (!serialized) {
      return [];
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            dimensions?: Array<{ kind: string; value?: number | { source?: string; value?: number } }>;
            entities?: Array<{ kind: string; radius?: number }>;
          };
        };
      }>;
    };

    const definition = payload.entries
      ?.filter((entry) => entry.kind === "commitSketch")
      .at(-1)?.payload?.definition;
    return {
      dimensionValues:
        definition?.dimensions
          ?.filter((dimension) => dimension.kind === "circleRadius")
          .map((dimension) =>
            typeof dimension.value === "number"
              ? dimension.value
              : (dimension.value?.value ?? null),
          ) ?? [],
      entityRadii:
        definition?.entities
          ?.filter((entity) => entity.kind === "circle")
          .map((entity) => entity.radius ?? null) ?? [],
    };
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(committedRadiusValues.dimensionValues).toContain(18);
  expect(committedRadiusValues.entityRadii).toContain(18);
});

// T13a: circles dimension as diameter by default; the Dimension tool's
// diameter edits like any other dimension.
test("edited circle diameter annotation (added with the Dimension tool) solves and still finishes the sketch", async ({
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

  await workbench.activateTool("Create circular geometry.");
  await canvas.click({ position: { x: 430, y: 320 }, force: true });
  await canvas.click({ position: { x: 500, y: 320 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
    "T13a: the Circle tool authors no size.",
  ).toHaveCount(0);
  await addDimensionWithTool(
    workbench,
    /Distance Create aligned distance dimensions/,
    { x: 500, y: 320 },
    { x: 540, y: 260 },
    "3.4",
  );

  const diameterGlyph = page
    .locator('[data-sketch-annotation-glyph="dimensionRadius"]')
    .first();
  await expect(diameterGlyph).toBeVisible();

  await diameterGlyph.dblclick();

  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill("18");
  await floatingInput.getByRole("button", { name: "Save" }).click();

  await expect(floatingInput).toBeHidden();
  await expect(diameterGlyph).toHaveAttribute("aria-label", /18\.00/);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  const committedDimensions = await page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            dimensions?: Array<{
              kind: string;
              value?: number | { source?: string; value?: number };
            }>;
          };
        };
      }>;
    };
    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.dimensions?.map((dimension) => [
          dimension.kind,
          typeof dimension.value === "number"
            ? dimension.value
            : (dimension.value?.value ?? null),
        ]) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(committedDimensions).toEqual([["diameter", 18]]);
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
  expect(
    Number(await floatingInput.locator("input").inputValue()),
    "measured radius prefill",
  ).toBeCloseTo(diameter / 2, 4);
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
