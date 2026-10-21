import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

type LivePoint = { id: string; position: readonly [number, number] };

async function readLivePoints(page: import("@playwright/test").Page) {
  const snapshot = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snapshot) throw new Error("No live sketch snapshot.");
  return (snapshot as { points: LivePoint[] }).points;
}

// T13d through the browser: a deliberate diameter blocks the rim; Make
// reference in its edit popup frees it and the "(value)" label follows the
// drag; Make driving holds the rim again; Undo restores the reference.
test("T13d: Make reference frees the rim and its measured label follows; Make driving holds it again; Undo", async ({
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

  // A rectangle (so the sketch has several entities) and a circle.
  await workbench.openToolMenu("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 700, y: 500 });
  await workbench.clickViewportAt({ x: 900, y: 650 });
  await page.keyboard.press("Escape");
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 400, y: 320 });
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("5 entities staged");
  await page.keyboard.press("Escape");
  const centre = (await readLivePoints(page))[4]!;
  // Top plane, origin at the viewport centre (720, 480): sketch units per px.
  const scale = Math.abs(centre.position[0] / (400 - 720));

  // A driving diameter, committed at its measured value.
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt({ x: 470, y: 320 });
  await workbench.clickViewportAt({ x: 520, y: 250 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  const diameter = Number(
    await floatingInput.getByRole("textbox").inputValue(),
  );
  expect(diameter, "premise: measured prefill").toBeCloseTo(140 * scale, 2);
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();
  await page.keyboard.press("Escape");

  const glyph = page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label^="Diameter"]',
  );
  await expect(glyph).toHaveCount(1);
  await expect(glyph).not.toContainText("(");
  const labelValue = async () =>
    Number((await glyph.innerText()).replace(/[()]/g, "").trim());

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");
  const rimDrag = async (fromX: number, toX: number) => {
    await page.mouse.move(box.x + fromX, box.y + 320);
    await workbench.waitForAnimationFrames(2);
    await page.mouse.down();
    await page.mouse.move(box.x + toX, box.y + 320, { steps: 8 });
    await workbench.waitForAnimationFrames(6);
  };
  const cue = page.locator('[data-testid="sketch-drag-feedback-cue"]');

  // Driving: the rim is held.
  await rimDrag(470, 540);
  await expect(cue, "the driving diameter blocks the rim").not.toHaveCount(0);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  expect(await labelValue()).toBeCloseTo(diameter, 2);

  // Make reference: one action from the edit popup.
  await glyph.dblclick();
  await expect(floatingInput).toBeVisible();
  await expect(
    floatingInput.getByRole("switch", { name: "Make driving" }),
  ).toBeChecked();
  await floatingInput.getByRole("switch", { name: "Make driving" }).click();
  await expect(floatingInput).toBeHidden();
  await expect(glyph).toHaveAttribute("aria-label", /reference diameter$/);
  await expect(glyph).toContainText(`(${diameter.toFixed(2)})`);

  // The rim is free and the reference value follows it.
  await rimDrag(470, 540);
  await expect(cue, "a reference does not hold the rim").toHaveCount(0);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  await expect
    .poll(labelValue, { timeout: 5_000 })
    .toBeGreaterThan(diameter * 1.5);
  const grown = await labelValue();
  expect(grown, "the measured diameter follows the drag").toBeCloseTo(
    280 * scale,
    1,
  );
  expect((await readLivePoints(page))[4]!.position, "the centre stays").toEqual(
    centre.position,
  );

  // Make driving: the popup shows the measured value read-only.
  await glyph.dblclick();
  await expect(floatingInput).toBeVisible();
  await expect(floatingInput).toContainText("Diameter (reference)");
  await expect(
    floatingInput.locator("[data-floating-input-readout]"),
  ).toHaveText(`Measured ${grown.toFixed(2)} mm`);
  await expect(
    floatingInput.getByRole("switch", { name: "Make driving" }),
  ).not.toBeChecked();
  await expect(
    floatingInput.getByRole("button", { name: "Save", exact: true }),
  ).toBeHidden();
  await floatingInput.getByRole("switch", { name: "Make driving" }).check();
  await expect(floatingInput).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Constraints" }).getByRole("button", {
      name: /^Diameter.*reference diameter$/,
    }),
    "conversion is staged until Save",
  ).toBeVisible();
  await floatingInput
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(floatingInput).toBeHidden();
  await expect(glyph).not.toContainText("(");
  expect(await labelValue()).toBeCloseTo(grown, 2);

  // Driving again: the rim is held.
  await rimDrag(540, 600);
  await expect(cue, "the driving diameter holds the rim again").not.toHaveCount(
    0,
  );
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  expect(await labelValue()).toBeCloseTo(grown, 2);

  // Undo returns to the reference at the grown size.
  await page.keyboard.press("Control+z");
  await expect(glyph).toContainText(`(${grown.toFixed(2)})`);
  await expect(glyph).toHaveAttribute("aria-label", /reference diameter$/);
});
