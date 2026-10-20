import { sketchDiagnosticMessage } from "./helpers/sketch-workbench";
import { expect, test, type Page } from "@playwright/test";

import { glideDoubleClick } from "./helpers/acceptance";
import { openDocumentCopy, saveDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { dangerColor, glidePress, type Rgb } from "./helpers/mirror-workbench";
import { createRectangleProfileOperationHistory } from "./helpers/modeling-fixtures";

test.use({ viewport: { width: 1440, height: 960 } });

type Vec = readonly [number, number];
type CadaraDocument = {
  sketches: Array<{
    sketchId: string;
    definition: {
      pointIds: string[];
      points: Array<{ pointId: string; position: Vec }>;
      entities: Array<{
        entityId: string;
        kind: string;
        label: string;
        startPointId?: string;
        endPointId?: string;
      }>;
      constraintIds: string[];
      constraints: Array<Record<string, unknown>>;
    };
  }>;
};
type ScreenPoint = { x: number; y: number };

// Lane: e2e (docs/testing.md). Seam: T17d2 (T17d review R-1; issue 03 "one
// accepted geometry for display, selection, measurement and modeling";
// specification §5 "stale display is marked") in the real workbench: an
// invalid sketch (the sketch-invalid-persistence flow: two conflicting Fix
// requirements on one corner, opened from a file) is re-entered, Finished,
// and drawn in part mode by the production OCC snapshot → viewport
// composition → scene. Its sides are drawn where the same sketch is drawn
// when it is valid (its held, authored geometry, the geometry sketch mode
// shows), in the danger tint, and they are hoverable there. The rules are
// pinned by the logic and UI rows (`rejected-sketch-consumers.spec.ts`,
// `viewport-renderables.spec.ts`, `three-cad-viewport-style.spec.ts`).
// Every pointer path glides; waits are on the machine state and the
// committed revision.

const sketchButton = (page: Page) =>
  page
    .getByRole("button", { name: /Select .*Double-click to reopen\./ })
    .first();

const revision = (page: Page) =>
  page.evaluate(() => window.__cadaraDebug?.getState()?.revision ?? "");

/** Re-enter the sketch from the tree, then Finish it (a new revision). */
async function reenterAndFinish(
  workbench: FeatureWorkbenchHarness,
  expectStatus: string | null,
) {
  const page = workbench.page;
  await glideDoubleClick(page, sketchButton(page));
  await workbench.expectSketchSessionActive();
  if (expectStatus)
    await expect(
      sketchDiagnosticMessage(page).filter({ hasText: expectStatus }),
    ).toBeVisible({ timeout: 15_000 });
  const before = await revision(page);
  await glidePress(
    page,
    page
      .locator(
        'button[aria-label="Finish Sketch"], button[data-tool-tooltip="Finish Sketch"]',
      )
      .first(),
  );
  await expect
    .poll(
      () => page.evaluate(() => window.__cadaraDebug?.getState()?.machineState),
      { timeout: 60_000 },
    )
    .toBe("idle");
  await expect
    .poll(() => revision(page), {
      message: "Finish committed a new revision",
      timeout: 30_000,
    })
    .not.toBe(before);
}

/** The projected centres of the sketch's sides (viewport-surface pixels). */
async function sideCentres(
  workbench: FeatureWorkbenchHarness,
  targets: readonly string[],
) {
  await workbench.waitForAnimationFrames(4);
  return workbench.page.evaluate(
    (ids) => ids.map((id) => window.__cadProjectToScreen?.(id) ?? null),
    targets,
  );
}

/** A (2r × 2r) crop centred on a viewport-surface point, as RGB rows. */
async function cropAt(
  workbench: FeatureWorkbenchHarness,
  at: ScreenPoint,
  radius = 6,
): Promise<Rgb[][]> {
  const page = workbench.page;
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const png = await page.screenshot({
    scale: "css",
    clip: {
      x: Math.round(surface.x + at.x - radius),
      y: Math.round(surface.y + at.y - radius),
      width: radius * 2,
      height: radius * 2,
    },
  });
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

/**
 * How strongly a crop leans towards the danger red: the largest projection
 * of (pixel − neutral grey of the same brightness) onto the danger red's own
 * hue direction. Thin antialiased strokes blend with the background, so the
 * hue, not an exact colour match, carries the tint.
 */
function dangerLean(crop: Rgb[][], danger: Rgb) {
  const mean = (danger[0] + danger[1] + danger[2]) / 3;
  const hue = danger.map((channel) => channel - mean);
  const norm = Math.hypot(...hue);
  return Math.max(
    ...crop.flat().map((pixel) => {
      const grey = (pixel[0] + pixel[1] + pixel[2]) / 3;
      return (
        pixel.reduce(
          (sum, channel, index) => sum + (channel - grey) * hue[index]!,
          0,
        ) / norm
      );
    }),
  );
}

/**
 * Glides onto points along the drawn side from `start` to `end` (its
 * projected corners), up to 3 px off it, until `targetId` is hovered; the
 * hover targets seen, or null once it is hovered.
 */
async function hoverSide(
  workbench: FeatureWorkbenchHarness,
  start: ScreenPoint,
  end: ScreenPoint,
  targetId: string,
) {
  const page = workbench.page;
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const normal = {
    x: -(end.y - start.y) / length,
    y: (end.x - start.x) / length,
  };
  const seen: string[] = [];
  for (const t of [0.5, 0.35, 0.65, 0.2, 0.8])
    for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
      const x = start.x + (end.x - start.x) * t + normal.x * offset;
      const y = start.y + (end.y - start.y) * t + normal.y * offset;
      await page.mouse.move(surface.x + x, surface.y + y, { steps: 4 });
      await workbench.waitForAnimationFrames(2);
      const hovered = await workbench.currentHoverTarget();
      seen.push(hovered);
      if (hovered === targetId) return null;
    }
  return [...new Set(seen)];
}

/** For each side: null when it is hovered along its corners, else what was. */
async function hoverSides(
  workbench: FeatureWorkbenchHarness,
  sketchId: string,
  sides: CadaraDocument["sketches"][number]["definition"]["entities"],
) {
  const cornerOf = (pointId: string) =>
    workbench.page.evaluate(
      (id) => window.__cadProjectToScreen?.(id) ?? null,
      `${sketchId}.${pointId}`,
    );
  const results: (string[] | null)[] = [];
  for (const side of sides) {
    const [start, end] = [
      await cornerOf(side.startPointId!),
      await cornerOf(side.endPointId!),
    ];
    expect(start && end, `${side.label}: its corners are drawn`).toBeTruthy();
    results.push(
      await hoverSide(workbench, start!, end!, `${sketchId}.${side.entityId}`),
    );
  }
  await workbench.clearHoverByLeavingViewport();
  await expect
    .poll(() => workbench.currentHoverTarget(), { timeout: 10_000 })
    .toBe("none");
  await workbench.waitForAnimationFrames(4);
  return results;
}

test("T17d2: after Finish, part mode draws an invalid sketch's sides where they are held (as sketch mode shows them), in the danger tint, and hovers them there; the valid sketch is the control", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    createRectangleProfileOperationHistory(),
  );
  await workbench.openWithRepository();
  const valid = await saveDocumentCopy<CadaraDocument>(page);
  const sketch = valid.sketches[0]!;
  const corner = sketch.definition.pointIds[0]!;
  const sides = sketch.definition.entities.filter(
    (entity) => entity.kind === "lineSegment",
  );
  expect(sides, "premise: a rectangle").toHaveLength(4);
  const targets = sides.map((side) => `${sketch.sketchId}.${side.entityId}`);

  // Control: the valid sketch, re-entered and Finished, in part mode.
  await openDocumentCopy(page, valid, "valid.cadara");
  await reenterAndFinish(workbench, null);
  const held = await sideCentres(workbench, targets);
  expect(held.every(Boolean), "premise: every side is drawn").toBe(true);
  // The sides the valid sketch is hoverable along (a side seen through a
  // construction plane may be picked as the plane).
  const hoverable = (await hoverSides(workbench, sketch.sketchId, sides)).map(
    (seen) => seen === null,
  );
  expect(
    sides.filter(
      (side, index) =>
        hoverable[index] &&
        (side.startPointId === corner || side.endPointId === corner),
    ).length,
    "premise: a side at the conflicting corner is hoverable",
  ).toBeGreaterThan(0);
  // How far the valid sides' crops lean to the danger red (the background
  // may, e.g. under an axis line): the baseline for the tint.
  const danger = await dangerColor(page);
  const baseline: number[] = [];
  for (const at of held)
    baseline.push(dangerLean(await cropAt(workbench, at!), danger));

  // The same authored sketch with a conflicting pair of Fix requirements on
  // one corner: its solve is rejected, the sketch is invalid.
  const invalid = structuredClone(valid);
  const definition = invalid.sketches[0]!.definition;
  definition.constraintIds.push(
    "constraint_conflicting_t17d2_a",
    "constraint_conflicting_t17d2_b",
  );
  definition.constraints.push(
    {
      constraintId: "constraint_conflicting_t17d2_a",
      kind: "fixPoint",
      label: "Conflicting point requirement A",
      pointId: corner,
      position: [0, 0],
    },
    {
      constraintId: "constraint_conflicting_t17d2_b",
      kind: "fixPoint",
      label: "Conflicting point requirement B",
      pointId: corner,
      position: [100, 0],
    },
  );
  await openDocumentCopy(page, invalid, "invalid.cadara");
  await reenterAndFinish(
    workbench,
    "Conflicting point requirement A, Conflicting point requirement B conflict. The sketch is invalid; profiles from it are blocked.",
  );

  // Part mode: every side is drawn where it is held (where the valid
  // sketch's side is), not where the rejected solve put it.
  const drawn = await sideCentres(workbench, targets);
  for (const [index, at] of drawn.entries()) {
    const side = sides[index]!.label;
    expect(at, `${side} is drawn`).not.toBeNull();
    expect(
      Math.hypot(at!.x - held[index]!.x, at!.y - held[index]!.y),
      `${side} is drawn at its held place`,
    ).toBeLessThan(1);
    expect(
      dangerLean(await cropAt(workbench, at!), danger),
      `${side} is drawn in the danger tint (valid: lean ${baseline[index]})`,
    ).toBeGreaterThan(baseline[index]! + 8);
  }
  // Picking follows the drawn geometry: each side is hovered along where
  // it is held (between its corner markers, drawn at the held corners),
  // as the valid sketch's is.
  const seen = await hoverSides(workbench, sketch.sketchId, sides);
  for (const [index, side] of sides.entries())
    if (hoverable[index])
      expect(seen[index], `${side.label} is hovered where drawn`).toBeNull();
});
