import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { P, along, buildDenseFan, setShowAll } from "./helpers/annotation-fan";
import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  expectGlideFollowed,
  glidePath,
  glideSamplingElement,
  type ViewportPoint,
} from "./helpers/pointer-glide";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// cadara-0atd, lane: e2e (docs/testing.md). Seam: a dimension chip's pointer
// drag over other annotations and its release, through the real annotation
// layout (pointer capture on the DOM chip, the placement round trip, the
// T14d layout re-placing labels once the drag's pin ends), which only the
// browser has. While dragged, a chip is pinned and the labels it passes are
// displaced (T14d A-7); every probe path across glyphs, a glyph cluster,
// other chips and a chip sharing its anchor followed the pointer. The
// teleport came at the release: no longer pinned, the dropped chip was laid
// out by id, so dropped on a chip with a lower id it lost its anchor to that
// chip and jumped a ring away (74 px in the fan, 38 px in the enclosure)
// while the chip under it snapped back. Each row glides a chip over other
// annotations onto a lower-id chip and asserts the glide, then that neither
// chip moves after the release.
test.use({ viewport: { width: 1440, height: 960 } });
test.setTimeout(180_000);

const chip = (id: string) => `[data-sketch-annotation-id="${id}"]`;

async function centreOf(page: Page, id: string) {
  const box = (await page.locator(chip(id)).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

type AfterReleaseRecorder = {
  frames: { id: string; x: number; y: number }[];
  stop: () => void;
};

/**
 * Glides the chip `droppedId`, grabbed at its centre, through `waypoints`
 * (screen deltas from the grab) and releases it, then watches both chips at
 * every drawn frame and DOM change after the release: the dropped one stays
 * where it was dropped and `coveredId`, which the drag displaced, stays
 * displaced.
 */
async function dragOnto(
  page: Page,
  droppedId: string,
  coveredId: string,
  waypoints: readonly ViewportPoint[],
  settle: () => Promise<void>,
  options: { followTolerancePx?: number } = {},
) {
  expect(
    droppedId > coveredId,
    "premise: the dropped chip has the higher id (the layout's tie-break)",
  ).toBe(true);
  const grab = await centreOf(page, droppedId);
  await page.mouse.move(grab.x + 40, grab.y + 30);
  await page.mouse.move(grab.x, grab.y, { steps: 8 });
  await settle();
  const drag = await glideSamplingElement(
    page,
    chip(droppedId),
    glidePath(waypoints.map((d) => ({ x: grab.x + d.x, y: grab.y + d.y }))),
    settle,
    { press: true },
  );
  expectGlideFollowed(drag, {
    what: "the dragged chip",
    followsPointer: true,
    expectedOffset: { x: 0, y: 0 },
    followTolerancePx: options.followTolerancePx,
  });
  const dropped = await centreOf(page, droppedId);
  const covered = await centreOf(page, coveredId);
  // Every frame and DOM change, so a chip drawn away for one frame fails.
  await page.evaluate(
    (ids) => {
      const recorder: AfterReleaseRecorder = { frames: [], stop: () => {} };
      const record = () => {
        for (const id of ids) {
          const box = document
            .querySelector(`[data-sketch-annotation-id="${id}"]`)
            ?.getBoundingClientRect();
          if (box) {
            recorder.frames.push({
              id,
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            });
          }
        }
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      let frame = 0;
      const tick = () => {
        record();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      recorder.stop = () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
      (
        window as unknown as { __cadaraAfterRelease: AfterReleaseRecorder }
      ).__cadaraAfterRelease = recorder;
    },
    [droppedId, coveredId],
  );
  await page.mouse.up();
  for (let round = 0; round < 12; round += 1) {
    await page.waitForTimeout(round === 11 ? 500 : 0);
    await settle();
  }
  const frames = await page.evaluate(() => {
    const recorder = (
      window as unknown as { __cadaraAfterRelease: AfterReleaseRecorder }
    ).__cadaraAfterRelease;
    recorder.stop();
    return recorder.frames;
  });
  const moves = frames.flatMap(({ id, x, y }, index) => {
    const [what, before] =
      id === droppedId
        ? ["the dropped chip", dropped]
        : ["the chip it was dropped on", covered];
    const moved = Math.hypot(x - before.x, y - before.y);
    return moved > 3
      ? [
          `frame ${index}: ${what} drawn ${moved.toFixed(1)} px away after the release (${Math.round(before.x)}, ${Math.round(before.y)}) -> (${Math.round(x)}, ${Math.round(y)})`,
        ]
      : [];
  });
  expect(
    frames.length,
    "frames were recorded after the release",
  ).toBeGreaterThan(0);
  expect(
    moves.slice(0, 4),
    "after the release both chips stay where the drag left them",
  ).toEqual([]);
}

async function commitDimension(page: Page) {
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput
    .getByRole("button", { name: /^(Commit|Add reference)$/ })
    .first()
    .click();
  await expect(floatingInput).toBeHidden();
}

async function leaveTool(workbench: SketchWorkbenchHarness) {
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
}

/**
 * Distance dimensions on the geometry under `picks` (one line: its length;
 * two lines: their angle), labels placed at `place`.
 */
async function dimensionLines(
  workbench: SketchWorkbenchHarness,
  rows: readonly (readonly [
    picks: readonly ViewportPoint[],
    place: ViewportPoint,
  ])[],
) {
  const page = workbench.page;
  for (const [picks, place] of rows) {
    await workbench.openToolMenu("Create point-to-point distance dimensions.");
    await page
      .getByRole("menuitem", {
        name: /Distance Create aligned distance dimensions/,
      })
      .click();
    for (const pick of picks) await workbench.clickViewportAt(pick);
    await workbench.clickViewportAt(place);
    await commitDimension(page);
    await leaveTool(workbench);
  }
  return page.evaluate(() =>
    (
      window.__cadaraDebug?.getSketchSnapshot()?.definition?.dimensions ?? []
    ).map((dimension) => dimension.dimensionId as string),
  );
}

test("cadara-0atd: two chips sharing one anchor: the displaced chip dragged away and dropped back onto the other stays there, and the other stays displaced", async ({
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
  for (const [index, y] of [380, 460].entries()) {
    await workbench.activateTool("Create line geometry.");
    await workbench.clickViewportAt({ x: 500, y });
    await workbench.clickViewportAt({ x: 760, y });
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${index + 1} entities staged`);
    await leaveTool(workbench);
  }
  // The T14d fixture: both labels placed on the middle line, one anchor.
  const [first, second] = await dimensionLines(workbench, [
    [[{ x: 600, y: 380 }], { x: 630, y: 420 }],
    [[{ x: 600, y: 460 }], { x: 630, y: 420 }],
  ]);
  await workbench.waitForAnimationFrames(3);
  const [lower, higher] = [first!, second!].sort() as [string, string];
  const lowerAt = await centreOf(page, lower);
  const higherAt = await centreOf(page, higher);
  expect(
    Math.hypot(higherAt.x - lowerAt.x, higherAt.y - lowerAt.y),
    "premise: the higher-id chip is displaced off the shared anchor",
  ).toBeGreaterThan(20);
  // Away (60 px down), then back over the other chip onto its centre.
  await dragOnto(
    page,
    higher,
    lower,
    [
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: lowerAt.x - higherAt.x, y: lowerAt.y - higherAt.y },
    ],
    () => workbench.waitForAnimationFrames(2),
  );
});

test("cadara-0atd: a chip dragged across a dense glyph cluster and dropped onto another chip stays where it was dropped", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await buildDenseFan(workbench);
  // Line lengths on L2 (65°) and L8 (335°), labels beside P's cluster and
  // below right of it.
  const [l2, l8] = await dimensionLines(workbench, [
    [[along(P, 65, 150)], along(P, 65, 60)],
    [[along(P, 335, 150)], along(P, 335, 150)],
  ]);
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await setShowAll(workbench, true);
  const cluster = page.locator("[data-sketch-annotation-overflow]");
  await expect(cluster, "premise: P's glyphs form one cluster").toHaveCount(1);
  const clusterBox = (await cluster.boundingBox())!;
  const [lower, higher] = [l2!, l8!].sort() as [string, string];
  const from = await centreOf(page, higher);
  const onto = await centreOf(page, lower);
  // Through the cluster's `+N`, then onto the other chip.
  await dragOnto(
    page,
    higher,
    lower,
    [
      { x: 0, y: 0 },
      {
        x: clusterBox.x + clusterBox.width / 2 - from.x,
        y: clusterBox.y + clusterBox.height / 2 - from.y,
      },
      { x: onto.x - from.x, y: onto.y - from.y },
    ],
    () => workbench.waitForAnimationFrames(2),
  );
});

// An angle label's placement keeps it on its bisector, so a layout-displaced
// angle chip is dragged at its displacement (cadara-bmy0) and dropped there,
// not on its anchor. It must not take its anchor back at the release: as the
// last drop it would outrank the chip displacing it and jump onto it.
test("cadara-0atd: a layout-displaced angle chip dragged along its bisector and released stays where it was dropped", async ({
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
  // The cadara-bmy0 fixture: line A horizontal, line B rising at about 34°
  // and meeting A's extension at (400, 380); A's length chip at about
  // (630, 301), then the angle, whose chip lands there and is moved off it.
  for (const [index, [start, end]] of [
    [
      { x: 500, y: 380 },
      { x: 760, y: 380 },
    ],
    [
      { x: 520, y: 300 },
      { x: 760, y: 140 },
    ],
  ].entries()) {
    await workbench.activateTool("Create line geometry.");
    await workbench.clickViewportAt(start!);
    await workbench.clickViewportAt(end!);
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${index + 1} entities staged`);
    await leaveTool(workbench);
  }
  const [length, angle] = await dimensionLines(workbench, [
    [[{ x: 700, y: 380 }], { x: 630, y: 319 }],
    [
      [
        { x: 700, y: 380 },
        { x: 640, y: 220 },
      ],
      { x: 620, y: 313 },
    ],
  ]);
  await workbench.waitForAnimationFrames(3);
  const angleChip = page.locator(
    '[data-sketch-annotation-kind="dimension"][data-sketch-annotation-glyph="dimensionAngle"]',
  );
  await expect(angleChip).toHaveCount(1);
  await expect(angleChip, "premise: the angle chip").toHaveAttribute(
    "data-sketch-annotation-id",
    angle!,
  );
  await expect(
    page.locator(`[data-sketch-annotation-leader="${angle!}"]`),
    "premise: the layout moved the angle chip off its anchor",
  ).toBeAttached();
  // Outward along the bisector (about 17°), past the 6 px drag threshold.
  await dragOnto(
    page,
    angle!,
    length!,
    [
      { x: 0, y: 0 },
      { x: 12, y: -4 },
    ],
    () => workbench.waitForAnimationFrames(2),
    { followTolerancePx: 6 },
  );
});

// The enclosure example's 3.00 and vertical 10.00 chips (point-to-origin).
const HORIZONTAL_3 =
  "dimension_4_horizontal-distance_a74c28aa-d770-41b2-b13b-c2be2187bf1c";
const VERTICAL_10 =
  "dimension_6_vertical-distance_6623c97b-d0a2-40fc-8464-1e4def128f5b";

async function openFrontConnectorOpenings(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await workbench.waitForRenderIdle(60_000);
  await page
    .getByRole("button", {
      name: "Select Front connector openings. Double-click to reopen.",
    })
    .first()
    .dblclick({ timeout: 60_000 });
  await workbench.expectMachine("editingSketch", 60_000);
  await expect(page.locator(chip(VERTICAL_10))).toBeVisible({
    timeout: 30_000,
  });
}

test("cadara-0atd: in the enclosure sketch, the 10.00 chip dragged over the Horizontal glyph and dropped onto the 3.00 chip stays there", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const enclosure: unknown = JSON.parse(
    await readFile("landing/examples/enclosure/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, enclosure, "enclosure.cadara");
  await openFrontConnectorOpenings(workbench);
  await page
    .getByRole("switch", { name: "Show all constraints" })
    .click({ force: true });
  const glyph = page.locator(
    '[data-sketch-annotation-id^="constraint_1_bottom-horizontal"]',
  );
  await expect(glyph, "premise: the Horizontal glyph is pinned").toBeVisible();
  await workbench.waitForAnimationFrames(3);
  const glyphBox = (await glyph.boundingBox())!;
  const from = await centreOf(page, VERTICAL_10);
  const onto = await centreOf(page, HORIZONTAL_3);
  await dragOnto(
    page,
    VERTICAL_10,
    HORIZONTAL_3,
    [
      { x: 0, y: 0 },
      {
        x: glyphBox.x + glyphBox.width / 2 - from.x,
        y: glyphBox.y + glyphBox.height / 2 - from.y,
      },
      // The 3.00 chip's centre, a few px off so its label is not exactly
      // on the other's anchor.
      { x: onto.x - 9 - from.x, y: onto.y - 25 - from.y },
    ],
    () => workbench.waitForAnimationFrames(2),
  );
});
