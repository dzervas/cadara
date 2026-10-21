import { expect, test, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the workbench browser flow of the T14c
// annotation selection lifecycle (issue 10 "Sibling reselection defect"):
// pinned glyphs are DOM buttons over the WebGL canvas and blanks are canvas
// clicks, so only the real page proves that a sibling stays reachable after
// the first blank. The mouse glides (several `mouse.move` steps) so the
// overlays under the pointer see the enter/leave sequence a user produces.
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

type ViewportPoint = { x: number; y: number };

const parallelSelector = '[data-sketch-annotation-glyph="constraintParallel"]';
const equalSelector = '[data-sketch-annotation-glyph="constraintEqual"]';
const blankPoint = { x: 1000, y: 650 };

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

async function constrainLines(
  workbench: SketchWorkbenchHarness,
  tooltip: string,
  first: ViewportPoint,
  second: ViewportPoint,
) {
  await workbench.activateTool(tooltip);
  await workbench.clickViewportAt(first);
  await workbench.clickViewportAt(second);
  await leaveTool(workbench);
}

/** Glides onto a canvas point in several steps, then presses and releases. */
async function glideClick(
  workbench: SketchWorkbenchHarness,
  point: ViewportPoint,
) {
  const box = (await workbench.viewport().boundingBox())!;
  await workbench.page.mouse.move(box.x + point.x + 40, box.y + point.y + 30);
  await workbench.page.mouse.move(box.x + point.x, box.y + point.y, {
    steps: 8,
  });
  await workbench.waitForAnimationFrames(2);
  await workbench.page.mouse.down();
  await workbench.page.mouse.up();
  await workbench.waitForAnimationFrames(3);
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

async function expectInteractiveGlyphs(page: Page, message: string) {
  for (const selector of [parallelSelector, equalSelector]) {
    await expect(page.locator(selector), message).toHaveCount(1);
    await expect(page.locator(selector), message).toHaveAttribute(
      "data-sketch-annotation-interactive",
      "true",
    );
  }
}

test("T14c: select a line, one of its constraints, blank, a sibling constraint, then blank twice hides them", async ({
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
    { x: 600, y: 655 },
    "2 entities",
  );
  await constrainLines(
    workbench,
    "Constrain two lines to remain parallel.",
    { x: 500, y: 325 },
    { x: 500, y: 628 },
  );
  await constrainLines(
    workbench,
    "Constrain two lines to equal length or two circles to equal radius.",
    { x: 500, y: 325 },
    { x: 500, y: 628 },
  );
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect(
    page.locator(parallelSelector),
    "premise: nothing pinned without a selection",
  ).toHaveCount(0);

  // Select line A: both of its constraints are pinned.
  await glideClick(workbench, { x: 500, y: 325 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain("sketch_entity_1_line");
  await expectInteractiveGlyphs(page, "line A pins both constraints");

  // Select its Parallel.
  await glideClick(workbench, await annotationCentre(page, parallelSelector));
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(/constraint/);
  await expect(page.locator(parallelSelector)).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );

  // First blank: the Parallel is no longer active; both stay reachable.
  await glideClick(workbench, blankPoint);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .not.toMatch(/constraint|sketch_entity/);
  await expectInteractiveGlyphs(
    page,
    "after the first blank the siblings stay pinned and interactive",
  );
  await expect(page.locator(parallelSelector)).toHaveAttribute(
    "data-sketch-annotation-selection",
    "last",
  );

  // The sibling Equal is selectable directly.
  await glideClick(workbench, await annotationCentre(page, equalSelector));
  await expect(
    page.locator(equalSelector),
    "the sibling is selected",
  ).toHaveAttribute("data-sketch-annotation-selection", "active");
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(/constraint/);

  // Blank twice: the first keeps the context, the second clears it.
  await glideClick(workbench, blankPoint);
  await expectInteractiveGlyphs(page, "the first blank keeps the context");
  await glideClick(workbench, blankPoint);
  await expect(
    page.locator(parallelSelector),
    "the second blank hides the contextual constraints",
  ).toHaveCount(0);
  await expect(page.locator(equalSelector)).toHaveCount(0);
});

/** Interactive contextual glyphs as `glyph:selection` (`-` when neither). */
async function interactiveGlyphs(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-sketch-annotation-kind="constraint"]',
      ),
    ].map(
      (element) =>
        `${element.dataset.sketchAnnotationGlyph}:${element.dataset.sketchAnnotationInteractive}:${element.dataset.sketchAnnotationSelection ?? "-"}`,
    ),
  );
}

// T14c review R-2 (T-6/R-9): in a reopened sketch the rectangle's interior
// is a live region. With a constraint active, the first interior click is
// the first-stage blank (siblings stay); the second selects the region and
// drops the context.
test("T14c R-9: with a constraint active, the first interior click keeps the siblings; the second selects the region", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await workbench.openToolMenu("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 640, y: 420 });
  await workbench.clickViewportAt({ x: 860, y: 580 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await leaveTool(workbench);
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  await page
    .getByRole("button", { name: /^Select .*Double-click to reopen\.$/ })
    .filter({ hasText: /Sketch/ })
    .first()
    .dblclick();
  await workbench.expectSketchSessionActive();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                target.includes(".region_"),
              ).length ?? 0,
        ),
      {
        message: "premise: the reopened rectangle has a live region",
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(0);

  const interior = { x: 750, y: 500 };
  await glideClick(workbench, { x: 750, y: 420 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain("sketch_entity");
  const glyphSelector =
    '[data-sketch-annotation-kind="constraint"][data-sketch-annotation-interactive="true"]';
  await expect(page.locator(glyphSelector).first()).toBeVisible();
  const siblings = (await interactiveGlyphs(page)).length;
  await glideClick(workbench, await annotationCentre(page, glyphSelector));
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(/constraint/);

  await glideClick(workbench, interior);
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "the first interior click only clears the constraint",
      timeout: 10_000,
    })
    .not.toMatch(/constraint|region_|sketch_entity/);
  const kept = await interactiveGlyphs(page);
  expect(kept, "the siblings stay pinned and interactive").toHaveLength(
    siblings,
  );
  expect(kept.every((glyph) => glyph.includes(":true:"))).toBe(true);
  expect(
    kept.filter((glyph) => glyph.endsWith(":last")),
    "the cleared constraint is the subdued last",
  ).toHaveLength(1);

  await glideClick(workbench, interior);
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "the second interior click selects the region",
      timeout: 10_000,
    })
    .toContain(".region_");
  await expect(
    page.locator('[data-sketch-annotation-kind="constraint"]'),
    "the context is dropped",
  ).toHaveCount(0);
});

// T14c review A-3 (T-2): clicking an annotation resets the repeated-click
// pick cycle and clears the sticky overlap hint.
test("T14c T-2: an annotation click clears the sticky overlap hint and the next click starts a fresh cycle", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  // A construction line under an ordinary line, both on the X axis.
  await workbench.activateTool(
    "Toggle sketch geometry construction-only or mark new sketch geometry as construction.",
  );
  await drawLine(
    workbench,
    { x: 850, y: 450 },
    { x: 1050, y: 450 },
    "1 entities",
  );
  await drawLine(
    workbench,
    { x: 850, y: 450 },
    { x: 1050, y: 450 },
    "2 entities",
  );
  await workbench.activateTool(
    "Constrain a line parallel to the sketch horizontal axis.",
  );
  await glideClick(workbench, { x: 950, y: 452 });
  await leaveTool(workbench);
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());

  const at = { x: 950, y: 452 };
  const hint = page.getByTestId("sketch-pick-hint");
  await glideClick(workbench, at);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain("sketch_entity_2_line");
  await expect(hint, "premise: the click left the sticky hint").toBeVisible();

  const glyphSelector =
    '[data-sketch-annotation-glyph="constraintHorizontal"][data-sketch-annotation-interactive="true"]';
  await glideClick(workbench, await annotationCentre(page, glyphSelector));
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(/constraint/);
  await expect(hint, "the annotation click cleared the hint").toBeHidden();

  await glideClick(workbench, at);
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "a fresh cycle picks stack[0] (the line), not the next entry",
      timeout: 10_000,
    })
    .toContain("sketch_entity_2_line");
  expect(await workbench.currentEditorSelection()).not.toContain(
    "sketch_entity_1_line",
  );
});
