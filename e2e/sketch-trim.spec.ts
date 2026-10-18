import { expect, test } from "@playwright/test";

import { waitForCommittedAction } from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  glideClick,
  glidePress,
  hoverUntil,
  placeFreely,
  sketchSnapshot,
} from "./helpers/mirror-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the Trim tool in the real workbench →
// the exact edit-intersection query in the dedicated derivation worker's
// `editQuery` lane → one labelled authored action (T10g-1). Trim's authored
// result, Undo/Redo and published regions are proven browserless in
// src/application/semantic/sketch-trim-regions.spec.ts.

async function expectStaged(
  workbench: FeatureWorkbenchHarness,
  count: number,
  timeout = 15_000,
) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout })
    .toContain(`${count} entities staged`);
}

// T17f (D3; T17b0 P-6). Seam: the dimension chip's label drag (one "Move
// Dimension Label" action) and then the Trim tool's exact edit query, with a
// gliding pointer and committed-history waits. A label placement does not
// change the solve, so Trim still has the accepted solve of the sketch and
// applies (base: "Trim needs a solved sketch; …" and nothing authored).
test("T17f: after moving a dimension label, Trim applies at once (one 'Trim' action)", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await glidePress(
    page,
    page.getByRole("button", { name: /Top Plane/ }).first(),
  );
  await workbench.expectSketchSessionActive();
  // A horizontal line crossed by two verticals, placed freely (Shift).
  for (const [a, b] of [
    [
      { x: 400, y: 500 },
      { x: 800, y: 500 },
    ],
    [
      { x: 500, y: 420 },
      { x: 500, y: 580 },
    ],
    [
      { x: 700, y: 420 },
      { x: 700, y: 580 },
    ],
  ] as const) {
    await workbench.activateTool("Create line geometry.");
    await placeFreely(workbench, [a, b]);
  }
  await expectStaged(workbench, 3);
  // An aligned distance on the horizontal line.
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await glideClick(workbench, { x: 600, y: 500 });
  await glideClick(workbench, { x: 600, y: 440 });
  const floating = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floating).toBeVisible();
  await floating.locator("input").fill("20");
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    glidePress(page, floating.getByRole("button", { name: "Commit" })),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // A gliding drag of the dimension's chip: one "Move Dimension Label".
  const chip = page
    .locator('[data-sketch-annotation-kind="dimension"]')
    .first();
  await expect(chip).toBeVisible();
  const chipBox = (await chip.boundingBox())!;
  const centre = {
    x: chipBox.x + chipBox.width / 2,
    y: chipBox.y + chipBox.height / 2,
  };
  await waitForCommittedAction(page, "Move Dimension Label", async () => {
    await page.mouse.move(centre.x + 30, centre.y + 30);
    await page.mouse.move(centre.x, centre.y, { steps: 8 });
    await workbench.waitForAnimationFrames(2);
    await page.mouse.down();
    await page.mouse.move(centre.x, centre.y - 60, { steps: 10 });
    await workbench.waitForAnimationFrames(2);
    await page.mouse.up();
  });

  // Trim the horizontal line's left piece: it applies.
  await workbench.activateTool("Trim sketch segments.");
  const target = await hoverUntil(
    workbench,
    { x: 440, y: 500 },
    /sketch_entity_/,
  );
  const entities = async () => (await sketchSnapshot(page)).entities.length;
  const before = await sketchSnapshot(page);
  const horizontal = before.entities[0]!;
  const point = (snapshot: typeof before, id: string) =>
    snapshot.points.find((entry) => entry.id === id)!.position;
  await waitForCommittedAction(page, "Trim", () =>
    glideClick(workbench, target),
  );
  await expect(
    page.getByText(/Trim needs a solved sketch/),
    "no 'needs a solved sketch' refusal",
  ).toHaveCount(0);
  expect(await entities(), "an end trim keeps one shortened line").toBe(
    before.entities.length,
  );
  const after = await sketchSnapshot(page);
  const kept = after.entities.find((entity) => entity.id === horizontal.id)!;
  const cutter = after.entities[1]!;
  expect(
    point(after, kept.pointIds![0]!)[0],
    "the new end is tied to the first crossing, including the dimension solve",
  ).toBeCloseTo(point(after, cutter.pointIds![0]!)[0], 6);
  expect(kept.pointIds![0]!, "the clicked end is replaced").not.toBe(
    horizontal.pointIds![0],
  );
  expect(kept.pointIds![1]!, "the opposite endpoint is retained").toBe(
    horizontal.pointIds![1],
  );
});
