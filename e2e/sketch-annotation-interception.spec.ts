import { expect, test, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the workbench browser pointer flow over
// the sketch annotation layer (T14b: T-1, T-5/R-6, T-7, T-18/R-2). Whether a
// press reaches the canvas, and whether a hovered glyph highlights geometry,
// exist only in the real DOM stacking and the rendered WebGL frame. The mouse
// glides (several `mouse.move` steps) so DOM overlays under the pointer see
// the same enter/leave sequence a user produces.
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

type ViewportPoint = { x: number; y: number };
type Rgb = readonly [number, number, number];
type LivePoint = { id: string; position: readonly [number, number] };

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
  await expect
    .poll(
      () =>
        workbench.page.evaluate(
          () => window.__cadaraDebug?.getState()?.command ?? "",
        ),
      { message: "Line is left for Select.", timeout: 10_000 },
    )
    .toBe("sketch");
}

/** Glides the mouse onto a canvas point in several steps from 40 px away. */
async function glideTo(
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

/** Records the target of the next `pointerdown` (canvas or annotation). */
async function recordNextPointerdownTarget(page: Page) {
  await page.evaluate(() => {
    const record = window as unknown as { __t14bPointerdown?: string };
    record.__t14bPointerdown = "none";
    window.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target as Element;
        record.__t14bPointerdown = target.closest(
          "[data-sketch-annotation-kind]",
        )
          ? "annotation"
          : target.tagName;
      },
      { capture: true, once: true },
    );
  });
}

async function nextPointerdownTarget(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __t14bPointerdown?: string }).__t14bPointerdown,
  );
}

async function readLivePoints(workbench: SketchWorkbenchHarness) {
  const snapshot = await workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snapshot) throw new Error("No live sketch snapshot.");
  return (snapshot as { points: LivePoint[] }).points;
}

async function annotationCentre(page: Page, selector: string) {
  const canvas = (await page.locator("main canvas").first().boundingBox())!;
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No rendered annotation ${selector}.`);
  return {
    x: Math.round(box.x + box.width / 2 - canvas.x),
    y: Math.round(box.y + box.height / 2 - canvas.y),
  };
}

const chipSelector = '[data-sketch-annotation-kind="dimension"]';

/** A circle with a driving diameter; returns its chip's canvas centre. */
async function addCircleWithDiameterChip(workbench: SketchWorkbenchHarness) {
  const page = workbench.page;
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 900, y: 480 });
  await workbench.clickViewportAt({ x: 1000, y: 480 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await leaveTool(workbench);
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt({ x: 1000, y: 480 });
  await workbench.clickViewportAt({ x: 1000, y: 380 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.getByRole("textbox").fill("5");
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await leaveTool(workbench);
  await expect(page.locator(chipSelector)).toHaveCount(1);
  return annotationCentre(page, chipSelector);
}

test("T14b R-1(i): a line under an arc's end-binding position is dragged by a press there; nothing intercepts it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);

  // A three-point arc: centre ≈ (750, 542). Base rendered its start binding
  // as an always-visible 110 px "Coincident" chip centred ≈ (713, 513)
  // (mid-radius + (18, −18), T14 plan review §1).
  await workbench.openToolMenu(
    "Create an arc from center, start, and end points.",
  );
  await page.getByRole("menuitem", { name: /3-Point Arc/ }).click();
  for (const point of [
    { x: 640, y: 520 },
    { x: 860, y: 520 },
    { x: 750, y: 430 },
  ]) {
    await workbench.clickViewportAt(point);
  }
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await leaveTool(workbench);
  const bindingPosition = { x: 713, y: 513 };
  await drawLine(
    workbench,
    { x: bindingPosition.x - 100, y: bindingPosition.y + 120 },
    { x: bindingPosition.x + 100, y: bindingPosition.y - 120 },
    "2 entities",
  );
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await workbench.hoverViewportAt({ x: 1200, y: 820 });

  const before = (await readLivePoints(workbench)).filter((point) =>
    point.id.includes("_line-"),
  );
  expect(before, "premise: the line's two ends").toHaveLength(2);
  await glideTo(workbench, bindingPosition);
  await recordNextPointerdownTarget(page);
  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(
    box.x + bindingPosition.x + 30,
    box.y + bindingPosition.y + 30,
    { steps: 6 },
  );
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();

  expect(
    await nextPointerdownTarget(page),
    "The press at the arc binding's position reaches the canvas.",
  ).toBe("CANVAS");
  await expect
    .poll(
      async () => {
        const after = await readLivePoints(workbench);
        return before.every((point) => {
          const moved = after.find((entry) => entry.id === point.id);
          return (
            moved !== undefined &&
            Math.hypot(
              moved.position[0] - point.position[0],
              moved.position[1] - point.position[1],
            ) > 0.3
          );
        });
      },
      { message: "Both line ends moved with the drag.", timeout: 10_000 },
    )
    .toBe(true);
  expect(
    await workbench.currentEditorSelection(),
    "No annotation was selected by the press.",
  ).not.toMatch(/dimension|constraint/);
});

test("T14b R-2: hovering a pinned glyph (geometry selected, idle) highlights every affected entity without a click", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
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

  // Select line A: its Parallel glyph is pinned.
  await workbench.clickViewportAt({ x: 500, y: 325 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain("sketch_entity_1_line");
  const selection = await workbench.currentEditorSelection();
  const glyphSelector = '[data-sketch-annotation-glyph="constraintParallel"]';
  await expect(page.locator(glyphSelector)).toHaveCount(1);
  const glyph = await annotationCentre(page, glyphSelector);

  // Line B (not selected) is solved parallel through ≈ (500, 630).
  const lineB = { x: 500, y: 630 };
  await workbench.hoverViewportAt({ x: 1200, y: 820 });
  await expect.poll(() => workbench.currentHoverTarget()).toBe("none");
  const unhighlighted = await crop(workbench, lineB);

  await glideTo(workbench, glyph);
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "The glyph's hover reaches the editor and stays.",
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
    "No click happened: the selection is unchanged.",
  ).toBe(selection);

  // Review A-2: arming Line by its shortcut with the pointer still on the
  // glyph turns it passive; the stale annotation hover clears without a move.
  await page.keyboard.press("l");
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "The passive glyph's hover is cleared.",
      timeout: 10_000,
    })
    .not.toMatch(/constraint/);
  await expect(page.locator(glyphSelector)).toHaveAttribute(
    "data-sketch-annotation-interactive",
    "false",
  );
});

test("T14b R-6: with a drawing tool armed, a click on a dimension chip over the canvas reaches the tool; the chip does nothing", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const chip = await addCircleWithDiameterChip(workbench);

  await workbench.activateTool("Create line geometry.");
  await glideTo(workbench, chip);
  await recordNextPointerdownTarget(page);
  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.down();
  await page.mouse.up();
  expect(
    await nextPointerdownTarget(page),
    "The press on the chip reaches the canvas.",
  ).toBe("CANVAS");
  await page.mouse.move(box.x + chip.x - 200, box.y + chip.y + 150, {
    steps: 8,
  });
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(() => workbench.currentSketchSession(), {
      message: "The Line tool placed a line starting at the chip.",
      timeout: 10_000,
    })
    .toContain("2 entities staged");
  expect(
    await workbench.currentEditorSelection(),
    "The chip was not selected.",
  ).not.toMatch(/dimension/);
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

test("T14b review R-1: a dimension chip's edit opens focused, Escape closes it, and chips are controls again", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const chip = await addCircleWithDiameterChip(workbench);
  const chipLocator = page.locator(chipSelector);

  await glideTo(workbench, chip);
  await page.mouse.dblclick(
    (await workbench.viewport().boundingBox())!.x + chip.x,
    (await workbench.viewport().boundingBox())!.y + chip.y,
  );
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await expect(
    floatingInput.getByRole("textbox"),
    "The edit input takes focus when it opens.",
  ).toBeFocused();
  await expect(chipLocator, "premise: passive while editing").toHaveAttribute(
    "data-sketch-annotation-interactive",
    "false",
  );

  await page.keyboard.press("Escape");
  await expect(floatingInput, "Escape closes the edit.").toBeHidden();
  await expect(chipLocator).toHaveAttribute(
    "data-sketch-annotation-interactive",
    "true",
  );

  // The chip is a control again: a label drag moves it.
  const box = (await workbench.viewport().boundingBox())!;
  const before = await annotationCentre(page, chipSelector);
  await glideTo(workbench, before);
  await page.mouse.down();
  await page.mouse.move(box.x + before.x + 40, box.y + before.y + 40, {
    steps: 8,
  });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const after = await annotationCentre(page, chipSelector);
        return Math.hypot(after.x - before.x, after.y - before.y);
      },
      { message: "The label drag moved the chip.", timeout: 10_000 },
    )
    .toBeGreaterThan(10);
});

test("T14b review A-3: a press in the same frame as entering a visible preview reaches the geometry under it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
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
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());

  // Hovering line A previews its Parallel glyph; line C runs under it.
  const glyphSelector = '[data-sketch-annotation-glyph="constraintParallel"]';
  const lineA = { x: 500, y: 325 };
  await glideTo(workbench, lineA);
  await expect(page.locator(glyphSelector)).toHaveCount(1);
  const glyph = await annotationCentre(page, glyphSelector);
  const linesAB = new Set(
    (await readLivePoints(workbench)).map((point) => point.id),
  );
  await drawLine(
    workbench,
    { x: glyph.x - 60, y: glyph.y - 80 },
    { x: glyph.x + 60, y: glyph.y + 80 },
    "3 entities",
  );
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());

  await glideTo(workbench, lineA);
  await expect(
    page.locator(glyphSelector),
    "premise: the preview is shown over line C",
  ).toHaveCount(1);
  const before = (await readLivePoints(workbench)).filter(
    (point) => !linesAB.has(point.id),
  );
  expect(before, "premise: line C's two ends").toHaveLength(2);
  await recordNextPointerdownTarget(page);
  const box = (await workbench.viewport().boundingBox())!;
  // Enter and press in the same frame (no wait between).
  await page.mouse.move(box.x + glyph.x, box.y + glyph.y);
  await page.mouse.down();
  await page.mouse.move(box.x + glyph.x + 30, box.y + glyph.y + 30, {
    steps: 6,
  });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();

  expect(
    await nextPointerdownTarget(page),
    "The press reaches the canvas, not the preview.",
  ).toBe("CANVAS");
  await expect
    .poll(
      async () => {
        const after = await readLivePoints(workbench);
        return before.every((point) => {
          const moved = after.find((entry) => entry.id === point.id);
          return (
            moved !== undefined &&
            Math.hypot(
              moved.position[0] - point.position[0],
              moved.position[1] - point.position[1],
            ) > 0.3
          );
        });
      },
      { message: "Both of line C's ends moved.", timeout: 10_000 },
    )
    .toBe(true);
  expect(await workbench.currentEditorSelection()).not.toMatch(/constraint/);
});
