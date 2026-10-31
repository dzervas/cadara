import { expect, test } from "@playwright/test";

import {
  expectGlideFollowed,
  glidePath,
  glideSamplingElement,
  type ViewportPoint,
} from "./helpers/pointer-glide";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser's pointer -> Distance
// preview label path (pointer inference, preview overlay projection, label
// DOM) across a reference-zone switch, which only the browser draws. The
// Distance tool switches its carrier by design when the pointer crosses a
// zone boundary (a point pair's aligned / horizontal / vertical zones, an
// angle's minor / major side); its label rides the pointer along every
// carrier, so the glide must stay continuous through each switch: the label
// keeps its offset to the pointer at every settled step and every drawn
// frame. The logic lane (dimension-placement-continuity.spec.ts) proves the
// placement math along the same kind of path.
test.use({ viewport: { width: 1440, height: 960 } });
test.setTimeout(180_000);

const LINE = "Create line geometry.";
const DIMENSION_MENU = "Create point-to-point distance dimensions.";
const DISTANCE = /Distance Create aligned distance dimensions/;
const PREVIEW_LABEL =
  '[data-sketch-viewport-overlay="dimensionLine"], [data-sketch-viewport-overlay="angleArc"]';

type Segment = readonly [from: ViewportPoint, to: ViewportPoint];

/** Horizontal line A. */
const A: Segment = [
  { x: 500, y: 380 },
  { x: 760, y: 380 },
];
/** Rising line meeting A's extension at (400, 380). */
const R: Segment = [
  { x: 520, y: 300 },
  { x: 760, y: 140 },
];
/** Slanted line D, centre (980, 315), 206 px long. */
const D: Segment = [
  { x: 900, y: 250 },
  { x: 1060, y: 380 },
];

const polar = (centre: ViewportPoint, radius: number, degrees: number) => ({
  x: centre.x + radius * Math.cos((degrees * Math.PI) / 180),
  y: centre.y - radius * Math.sin((degrees * Math.PI) / 180),
});

interface ZoneSwitchRow {
  name: string;
  geometry: readonly Segment[];
  picks: readonly ViewportPoint[];
  /** The preview's reference kinds or arc sides the glide must cross. */
  zones: readonly string[];
  glide: readonly ViewportPoint[];
}

const ROWS: readonly ZoneSwitchRow[] = [
  {
    name: "a point pair's preview label, gliding from the aligned zone through the horizontal into the vertical zone",
    geometry: [D],
    picks: D,
    zones: ["aligned", "horizontal", "vertical"],
    // 20 px beside D (aligned), above its centre (horizontal), right of it
    // (vertical), left of the Constraints panel.
    glide: [
      { x: 968, y: 331 },
      { x: 980, y: 140 },
      { x: 1130, y: 300 },
    ],
  },
  {
    name: "an angle's preview label, gliding from the minor side across line A onto the major side",
    geometry: [A, R],
    picks: [
      { x: 700, y: 380 },
      { x: 640, y: 220 },
    ],
    zones: ["minor", "major"],
    glide: [
      polar({ x: 400, y: 380 }, 180, 20),
      polar({ x: 400, y: 380 }, 180, -30),
    ],
  },
];

async function glideClick(
  workbench: SketchWorkbenchHarness,
  canvas: ViewportPoint,
  point: ViewportPoint,
) {
  const page = workbench.page;
  await page.mouse.move(canvas.x + point.x, canvas.y + point.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.up();
  await workbench.waitForAnimationFrames(2);
}

async function leaveTool(workbench: SketchWorkbenchHarness) {
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
}

for (const row of ROWS) {
  test(`${row.name} stays with the pointer through every switch`, async ({
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
    const box = (await workbench.viewport().boundingBox())!;
    const canvas = { x: box.x, y: box.y };
    const absolute = (point: ViewportPoint) => ({
      x: canvas.x + point.x,
      y: canvas.y + point.y,
    });
    const settle = () => workbench.waitForAnimationFrames(2);

    for (const [index, [from, to]] of row.geometry.entries()) {
      await workbench.activateTool(LINE);
      await glideClick(workbench, canvas, from);
      await glideClick(workbench, canvas, to);
      await expect
        .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
        .toContain(`${index + 1} entities staged`);
      await leaveTool(workbench);
    }
    await workbench.openToolMenu(DIMENSION_MENU);
    await page.getByRole("menuitem", { name: DISTANCE }).click();
    await settle();
    for (const pick of row.picks) await glideClick(workbench, canvas, pick);
    const start = absolute(row.glide[0]!);
    await page.mouse.move(start.x, start.y, { steps: 8 });
    await settle();
    await expect(
      page.locator(PREVIEW_LABEL).first(),
      "premise: the preview label shows",
    ).toBeVisible();

    // The zone of every settled step: the drawn arc's side, or the reference
    // kind the preview label names ("Aligned", "Horizontal", "Vertical").
    const zones = new Set<string>();
    const readZone = async () => {
      const zone = await page.evaluate(
        (selector) =>
          document
            .querySelector("[data-sketch-viewport-arc-side]")
            ?.getAttribute("data-sketch-viewport-arc-side") ??
          document
            .querySelector(selector)
            ?.textContent?.match(/Aligned|Horizontal|Vertical/)?.[0]
            ?.toLowerCase() ??
          null,
        PREVIEW_LABEL,
      );
      if (zone) zones.add(zone);
    };
    const glide = await glideSamplingElement(
      page,
      PREVIEW_LABEL,
      glidePath(row.glide.map(absolute)),
      async () => {
        await settle();
        await readZone();
      },
    );
    expect([...zones].sort(), "premise: the glide crosses the zones").toEqual(
      [...row.zones].sort(),
    );
    expectGlideFollowed(glide, {
      what: row.name,
      followsPointer: true,
    });
  });
}
