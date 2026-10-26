import { expect, test, type Page } from "@playwright/test";

import {
  expectGlideFollowed,
  glidePath,
  glideSamplingElement,
  type ViewportPoint,
} from "./helpers/pointer-glide";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// cadara-3wp6, lane: e2e (docs/testing.md). Seam: the browser's pointer →
// dimension label chip path (pointer inference, preview overlay projection,
// committed chip layout and drag capture), which only the browser has. The
// logic lane (dimension-placement-continuity.spec.ts) proves the placement
// math along the same kind of path. For every dimension kind the mouse glides
// step by step while the label is sampled after every settled step: (1) the
// Dimension tool's creation preview, before the placing click, never outruns
// the pointer (k = 1 plus 2 px per step of at most 8 px); (2) the committed
// chip, grabbed at its centre and dragged by a glide, keeps its centre on the
// pointer at every settled step (3 px) and at every frame it is drawn in
// between (12 px: one pointer step of lag plus the 6 px drag threshold).
// Paths stay inside one reference zone (aligned / horizontal / vertical,
// minor angle side) and off the geometry; crossing a zone boundary switches
// the carrier by design.
//
// On main xonwsmot (before cadara-2wpl) the creation rows for line length,
// point to line, point to axis, point to origin and the Horizontal /
// Vertical tools were red: the preview's 14 px drag handle sat under the
// pointer and swallowed every other move. Point to line and point to axis
// were green at kzsllyol (pre-wave), so those two are the wave's regression
// (cadara-bmy0 put their label at the pointer); line length and point to
// origin stuttered at kzsllyol already. cadara-2wpl fixed all of them. The
// fixed tools' zone crossing is a separate pre-existing defect, cadara-y3p6,
// pinned as expected-fail rows.
test.use({ viewport: { width: 1440, height: 960 } });
test.setTimeout(180_000);

const LINE = "Create line geometry.";
const CIRCLE = "Create circular geometry.";
const DIMENSION_MENU = "Create point-to-point distance dimensions.";
const DISTANCE = /Distance Create aligned distance dimensions/;
const HORIZONTAL = /Horizontal Create horizontal distance dimensions/;
const VERTICAL = /Vertical Create vertical distance dimensions/;
const RADIUS = /Radius Create circle radius dimensions/;
const PREVIEW_LABEL =
  '[data-sketch-viewport-overlay="dimensionLine"], [data-sketch-viewport-overlay="angleArc"]';

type Segment = readonly [tool: string, from: ViewportPoint, to: ViewportPoint];

const A: Segment = [LINE, { x: 500, y: 380 }, { x: 760, y: 380 }];
const C: Segment = [LINE, { x: 500, y: 560 }, { x: 760, y: 560 }];
/** Rising line meeting A's extension at (400, 380). */
const R: Segment = [LINE, { x: 520, y: 300 }, { x: 760, y: 140 }];
const D: Segment = [LINE, { x: 900, y: 250 }, { x: 1060, y: 380 }];
const CIRCLE_640: Segment = [CIRCLE, { x: 1000, y: 640 }, { x: 1060, y: 640 }];

/** The sketch origin: the canvas centre in the Top Plane view. */
const ORIGIN = "origin" as const;

const polar = (centre: ViewportPoint, radius: number, degrees: number) => ({
  x: centre.x + radius * Math.cos((degrees * Math.PI) / 180),
  y: centre.y - radius * Math.sin((degrees * Math.PI) / 180),
});
/** A point `along` D's length and `across` it (px, to its lower left). */
const besideD = (along: number, across: number) => ({
  x: 900 + 160 * along - 0.631 * across,
  y: 250 + 130 * along + 0.776 * across,
});

const DRAG: readonly ViewportPoint[] = [
  { x: 0, y: 0 },
  { x: 60, y: -20 },
  { x: 20, y: -70 },
  { x: -50, y: -30 },
];

interface GlideRow {
  kind: string;
  geometry: readonly Segment[];
  tool: RegExp;
  picks: readonly (ViewportPoint | typeof ORIGIN)[];
  /** Creation glide waypoints; the last one places the label. */
  creation: readonly ViewportPoint[];
  /**
   * The dragged chip stays under the pointer. An angle label keeps to its
   * bisector at the pointer's radius, so it only must never outrun it.
   */
  dragFollowsPointer?: false;
  /**
   * A known defect's bead: the row is expected to fail (Playwright
   * `test.fail`) and stops after the creation glide; drop it when the bead
   * lands.
   */
  expectedFailure?: string;
}

const ROWS: readonly GlideRow[] = [
  {
    kind: "line length",
    geometry: [A],
    tool: DISTANCE,
    picks: [{ x: 630, y: 380 }],
    creation: [
      { x: 560, y: 330 },
      { x: 700, y: 300 },
      { x: 660, y: 340 },
    ],
  },
  {
    kind: "point pair, aligned",
    geometry: [D],
    tool: DISTANCE,
    picks: [D[1], D[2]],
    creation: [besideD(0.3, 18), besideD(0.5, 24), besideD(0.7, 20)],
  },
  {
    kind: "Horizontal tool, point pair",
    geometry: [D],
    tool: HORIZONTAL,
    picks: [D[1], D[2]],
    creation: [
      { x: 960, y: 170 },
      { x: 1000, y: 150 },
      { x: 1020, y: 180 },
    ],
  },
  {
    kind: "Vertical tool, point pair",
    geometry: [D],
    tool: VERTICAL,
    picks: [D[1], D[2]],
    creation: [
      { x: 1150, y: 300 },
      { x: 1160, y: 330 },
      { x: 1140, y: 345 },
    ],
  },
  // cadara-y3p6: a fixed-axis tool's preview reads the zone-chosen point-pair
  // offset on its own axis. The Horizontal glide from (980, 170) to (1150,
  // 300) enters the vertical zone near (1080, 225), where the label jumps
  // 149.2 px for a 7.9 px step; the Vertical glide from (1150, 300) to (980,
  // 170) enters the horizontal zone near (1055, 237): 148.4 px for 7.8 px.
  {
    kind: "Horizontal tool, point pair, pointer crossing into the vertical zone,",
    geometry: [D],
    tool: HORIZONTAL,
    picks: [D[1], D[2]],
    creation: [
      { x: 980, y: 170 },
      { x: 1010, y: 150 },
      { x: 1150, y: 300 },
    ],
    expectedFailure: "cadara-y3p6",
  },
  {
    kind: "Vertical tool, point pair, pointer crossing into the horizontal zone,",
    geometry: [D],
    tool: VERTICAL,
    picks: [D[1], D[2]],
    creation: [
      { x: 1150, y: 300 },
      { x: 1160, y: 330 },
      { x: 980, y: 170 },
    ],
    expectedFailure: "cadara-y3p6",
  },
  {
    kind: "point to line",
    geometry: [A, D],
    tool: DISTANCE,
    picks: [{ x: 630, y: 380 }, D[1]],
    creation: [
      { x: 820, y: 320 },
      { x: 760, y: 300 },
      { x: 700, y: 330 },
    ],
  },
  {
    kind: "point to axis",
    geometry: [A],
    tool: DISTANCE,
    picks: [A[1], { x: 360, y: 480 }],
    creation: [
      { x: 420, y: 430 },
      { x: 380, y: 420 },
      { x: 330, y: 440 },
    ],
  },
  {
    kind: "line to line, parallel",
    geometry: [A, C],
    tool: DISTANCE,
    picks: [
      { x: 630, y: 380 },
      { x: 630, y: 560 },
    ],
    creation: [
      { x: 450, y: 440 },
      { x: 560, y: 430 },
      { x: 820, y: 520 },
    ],
  },
  {
    kind: "angle",
    geometry: [A, R],
    tool: DISTANCE,
    picks: [
      { x: 700, y: 380 },
      { x: 640, y: 220 },
    ],
    creation: [
      polar({ x: 400, y: 380 }, 150, 10),
      polar({ x: 400, y: 380 }, 260, 20),
      polar({ x: 400, y: 380 }, 200, 24),
    ],
    dragFollowsPointer: false,
  },
  {
    kind: "diameter",
    geometry: [CIRCLE_640],
    tool: DISTANCE,
    picks: [{ x: 1060, y: 640 }],
    creation: [
      polar({ x: 1000, y: 640 }, 110, 30),
      polar({ x: 1000, y: 640 }, 110, 0),
      polar({ x: 1000, y: 640 }, 110, -60),
    ],
  },
  {
    kind: "radius",
    geometry: [CIRCLE_640],
    tool: RADIUS,
    picks: [{ x: 1060, y: 640 }],
    creation: [
      polar({ x: 1000, y: 640 }, 110, 30),
      polar({ x: 1000, y: 640 }, 110, 0),
      polar({ x: 1000, y: 640 }, 110, -60),
    ],
  },
  {
    kind: "point to origin",
    geometry: [A],
    tool: DISTANCE,
    picks: [A[2], ORIGIN],
    creation: [
      { x: 900, y: 400 },
      { x: 920, y: 450 },
      { x: 880, y: 440 },
    ],
  },
];

async function openTopSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

/** Glides onto `point` (canvas-relative) and clicks there. */
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

const dimensionIds = (page: Page) =>
  page.evaluate(() =>
    (
      window.__cadaraDebug?.getSketchSnapshot()?.definition?.dimensions ?? []
    ).map((dimension) => dimension.dimensionId as string),
  );

for (const row of ROWS) {
  test(`cadara-3wp6: a ${row.kind} dimension label follows a gliding pointer step by step, in the creation preview and when its chip is dragged`, async ({
    page,
  }) => {
    test.fail(
      Boolean(row.expectedFailure),
      `${row.expectedFailure}: expected to fail until it lands`,
    );
    const workbench = new SketchWorkbenchHarness(page);
    await openTopSketch(workbench);
    const box = (await workbench.viewport().boundingBox())!;
    const canvas = { x: box.x, y: box.y };
    const absolute = (point: ViewportPoint) => ({
      x: canvas.x + point.x,
      y: canvas.y + point.y,
    });
    const settle = () => workbench.waitForAnimationFrames(2);

    for (const [index, [tool, from, to]] of row.geometry.entries()) {
      await workbench.activateTool(tool);
      await glideClick(workbench, canvas, from);
      await glideClick(workbench, canvas, to);
      await expect
        .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
        .toContain(`${index + 1} entities staged`);
      await leaveTool(workbench);
    }

    await workbench.openToolMenu(DIMENSION_MENU);
    await page.getByRole("menuitem", { name: row.tool }).click();
    await settle();
    for (const pick of row.picks) {
      await glideClick(
        workbench,
        canvas,
        pick === ORIGIN ? { x: box.width / 2, y: box.height / 2 } : pick,
      );
    }
    const start = absolute(row.creation[0]!);
    await page.mouse.move(start.x, start.y, { steps: 8 });
    await settle();
    const preview = page.locator(PREVIEW_LABEL);
    await expect(
      preview.first(),
      "premise: the preview label shows",
    ).toBeVisible();

    const creation = await glideSamplingElement(
      page,
      PREVIEW_LABEL,
      glidePath(row.creation.map(absolute)),
      settle,
    );
    expectGlideFollowed(creation, {
      what: `${row.kind} creation preview label`,
    });
    if (row.expectedFailure) return;

    const before = await dimensionIds(page);
    await page.mouse.down();
    await page.mouse.up();
    const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
    await expect(floatingInput).toBeVisible({ timeout: 5_000 });
    await floatingInput
      .getByRole("button", { name: /^(Commit|Add reference)$/ })
      .first()
      .click();
    await expect(floatingInput).toBeHidden({ timeout: 5_000 });
    await leaveTool(workbench);
    const id = (await dimensionIds(page)).find(
      (candidate) => !before.includes(candidate),
    );
    expect(id, "premise: the dimension is committed").toBeDefined();

    const chip = page.locator(`[data-sketch-annotation-id="${id}"]`);
    await expect(chip.first(), "premise: its chip shows").toBeVisible();
    const chipBox = (await chip.first().boundingBox())!;
    const grab = {
      x: chipBox.x + chipBox.width / 2,
      y: chipBox.y + chipBox.height / 2,
    };
    await page.mouse.move(grab.x + 40, grab.y + 30);
    await page.mouse.move(grab.x, grab.y, { steps: 8 });
    await settle();
    const drag = await glideSamplingElement(
      page,
      `[data-sketch-annotation-id="${id}"]`,
      glidePath(
        DRAG.map((delta) => ({ x: grab.x + delta.x, y: grab.y + delta.y })),
      ),
      settle,
      { press: true },
    );
    await page.mouse.up();
    // Grabbed at its centre: the chip's centre stays on the pointer.
    expectGlideFollowed(drag, {
      what: `${row.kind} dragged chip`,
      followsPointer: row.dragFollowsPointer ?? true,
      expectedOffset: { x: 0, y: 0 },
    });
  });
}
