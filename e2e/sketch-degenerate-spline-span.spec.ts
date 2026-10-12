import { expect, test, type Page } from "@playwright/test";

import {
  glideDoubleClick,
  glideDrag,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  glideClick,
  glidePress,
  hoverUntil,
  openSearchTool,
  openTopSketch,
  sketchSnapshot,
} from "./helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T17c3 (T17-21; issue 08 :107; T17b0
// P-9) in the real workbench: a degenerate spline span reached by a gliding
// drag of a fit point onto its neighbour, or by the Coincident tool on two
// consecutive fit points → the reducer → the authored history → the live
// solve, the status column and the viewport; then Finish and Extrude. Only
// the browser composes them. The rule, the text and the tint are pinned by
// the logic and UI rows (`sketch-degenerate-spline-span.spec.ts`,
// `sketch-action-labels.spec.ts`, `sketch-degenerate-spline-style.spec.ts`).
// Every pointer path glides; waits are on committed history entries and
// session state.

// Viewport 1440×960, top plane. Four Shift-placed fit points A → B → C → D,
// closed by a line D → A snapped onto the spline's ends: one region.
const A = { x: 480, y: 520 };
const B = { x: 600, y: 420 };
const C = { x: 720, y: 420 };
const D = { x: 840, y: 520 };

const TEXT =
  "Spline 1 has two consecutive fit points at the same place (Spline 1 point 2 and Spline 1 point 3); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).";

const status = (page: Page) =>
  page.getByRole("status").filter({ hasText: TEXT });
const liveRegions = async (page: Page) =>
  (await sketchSnapshot(page)).liveRegions;
/**
 * The viewport's projected centre of the spline's scene objects (a debug
 * read of what is drawn; null: not drawn). The new sketch is the draft.
 */
const projectedSpline = (page: Page, splineId: string) =>
  page.evaluate(
    (id) => window.__cadProjectToScreen?.(`sketch_draft.${id}`) ?? null,
    splineId,
  );

async function drawLoop(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await workbench.activateTool("Create spline geometry.");
  await page.keyboard.down("Shift");
  for (const point of [A, B, C, D]) await glideClick(workbench, point);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Enter");
  await workbench.activateTool("Create line geometry.");
  await glideClick(workbench, D);
  await glideClick(workbench, A);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => liveRegions(page), {
      message: "premise: the spline and its line bound one region",
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 1 });
  const drawn = await sketchSnapshot(page);
  expect(drawn.entities.map((entity) => entity.kind)).toEqual([
    "spline",
    "lineSegment",
  ]);
  const spline = drawn.entities[0]!;
  const occurrences = (
    spline as unknown as { occurrences: { pointId: string }[] }
  ).occurrences.map((occurrence) => occurrence.pointId);
  expect(occurrences, "premise: four fit points").toHaveLength(4);
  await expect
    .poll(() => projectedSpline(page, spline.id), {
      message: "premise: the spline is drawn",
      timeout: 15_000,
    })
    .not.toBeNull();
  await expect(status(page)).toHaveCount(0);
  return { spline, occurrences };
}

/** The degenerate state: authored span kept, spline drawn, text, blocked. */
async function expectDegenerate(
  page: Page,
  splineId: string,
  occurrences: readonly string[],
) {
  await expect(status(page), "the label-based status").toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toMatchObject({ status: "unavailable" });
  const snap = await sketchSnapshot(page);
  const at = (id: string) =>
    snap.points.find((point) => point.id === id)!.position;
  expect(at(occurrences[2]!), "fit points 2 and 3 at one place").toEqual(
    at(occurrences[1]!),
  );
  expect(
    (
      snap.entities[0] as unknown as { occurrences: { pointId: string }[] }
    ).occurrences.map((occurrence) => occurrence.pointId),
    "the span stays authored",
  ).toEqual(occurrences);
  expect(
    await projectedSpline(page, splineId),
    "the spline stays drawn",
  ).not.toBeNull();
}

test("T17c3: a fit point dragged onto its neighbour: one Move Sketch Geometry; the spline stays drawn, the label-based status shows, profiles are blocked; Undo restores the region, Redo the status; after Finish, Extrude offers no region", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  const { spline, occurrences } = await drawLoop(workbench);

  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, C, B),
  );
  await expectDegenerate(page, spline.id, occurrences);

  await waitForUndoneAction(page, "Move Sketch Geometry", () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(() => liveRegions(page), {
      message: "Undo: the region is back",
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 1 });
  await expect(status(page)).toHaveCount(0);
  await waitForRedoneAction(page, "Move Sketch Geometry", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expectDegenerate(page, spline.id, occurrences);

  // Finish: the sketch is published and shown in part mode (its own target
  // and its spline are offered), but Extrude offers no region of it.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  const finishedTargets = () =>
    page.evaluate(
      (id) =>
        window.__cadaraDebug
          ?.getState()
          ?.selectableTargets.filter(
            (target) =>
              /^sketch_[^.]+$/.test(target) ||
              target.endsWith(`.${id}`) ||
              /\.region_/.test(target),
          ) ?? [],
      spline.id,
    );
  await expect
    .poll(
      async () =>
        (await finishedTargets()).map((target) =>
          /\.region_/.test(target)
            ? "region"
            : target.endsWith(`.${spline.id}`)
              ? "spline"
              : "sketch",
        ),
      {
        message: "the finished sketch and its spline are offered, no region",
        timeout: 30_000,
      },
    )
    .toEqual(["sketch", "spline"]);
});

test("T17c3: Coincident on two consecutive fit points is one 'Coincident' action with the same diagnostic; after Finish → reopen, deleting the spline unblocks the sketch", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  const { spline, occurrences } = await drawLoop(workbench);

  await openSearchTool(page, "Coincident");
  await glideClick(workbench, B);
  await waitForCommittedAction(page, "Coincident", () =>
    glideClick(workbench, C),
  );
  await expectDegenerate(page, spline.id, occurrences);

  // Review F-1: the promised recovery after Finish → reopen (no Undo
  // history; the Coincident is a constraint, so a drag apart is refused):
  // delete the spline. The reopened sketch shows the same status first.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await glideDoubleClick(
    page,
    page
      .getByRole("button", { name: /Select .*Double-click to reopen\./ })
      .first(),
  );
  await workbench.expectSketchSessionActive();
  await expect(status(page), "the reopened sketch's status").toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toMatchObject({ status: "unavailable" });
  await glidePress(
    page,
    page.getByRole("button", { name: "Select Spline 1.", exact: true }),
  );
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(spline.id);
  await waitForCommittedAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Delete"),
  );
  expect(
    (await sketchSnapshot(page)).entities.map((entity) => entity.kind),
    "the spline is gone, the line stays",
  ).toEqual(["lineSegment"]);
  await expect(status(page), "no longer blocked").toHaveCount(0);
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toMatchObject({ status: "current" });
});

// T17c5 (issue 08 :107): in a constrained sketch (a Fix on fit point 1, so
// no drag takes the unconstrained fast path), after Finish → reopen from the
// tree (the drag and the Coincident path), gliding one of the two fit points
// apart is one "Move Sketch Geometry": the status goes and the region is
// offered again. A Coincident between them keeps them together until it is
// deleted from the Constraints panel.

/** A Fix on fit point A (gliding press), then back to Select. */
async function fixA(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await glidePress(page, page.getByRole("button", { name: "Fix Geometry" }));
  await waitForCommittedAction(page, "Fix Geometry", () =>
    glideClick(workbench, A),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

/** Finish, then reopen the sketch from the tree (gliding double-click). */
async function finishAndReopen(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await glideDoubleClick(
    page,
    page
      .getByRole("button", { name: /Select .*Double-click to reopen\./ })
      .first(),
  );
  await workbench.expectSketchSessionActive();
  await expect(status(page), "the reopened sketch's status").toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toMatchObject({ status: "unavailable" });
}

/**
 * Hovers fit points 2 and 3 near `at` (one of them reports), then glides it
 * apart: fit point 2 to `second`, fit point 3 to `third` (so the spline
 * keeps its order and bounds the region). `committed`: wait for one "Move
 * Sketch Geometry".
 */
async function dragOneApart(
  workbench: FeatureWorkbenchHarness,
  at: { x: number; y: number },
  occurrences: readonly string[],
  destinations: {
    second: { x: number; y: number };
    third: { x: number; y: number };
  },
  committed: boolean,
) {
  const grabbed = await hoverUntil(
    workbench,
    at,
    new RegExp(`\\.(${occurrences[1]}|${occurrences[2]})$`),
  );
  const to = (await workbench.currentHoverTarget()).endsWith(occurrences[1]!)
    ? destinations.second
    : destinations.third;
  const drag = () => glideDrag(workbench, grabbed, to);
  if (committed)
    await waitForCommittedAction(workbench.page, "Move Sketch Geometry", drag);
  else await drag();
}

/** One "Move Sketch Geometry" took them apart: no status, the region back. */
async function expectRecovered(page: Page, occurrences: readonly string[]) {
  await expect(status(page), "the status is gone").toHaveCount(0, {
    timeout: 15_000,
  });
  await expect
    .poll(() => liveRegions(page), {
      message: "the region is back",
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 1 });
  const snap = await sketchSnapshot(page);
  const at = (id: string) =>
    snap.points.find((point) => point.id === id)!.position;
  expect(at(occurrences[2]!), "fit points 2 and 3 apart").not.toEqual(
    at(occurrences[1]!),
  );
  expect(
    (
      snap.entities[0] as unknown as { occurrences: { pointId: string }[] }
    ).occurrences.map((occurrence) => occurrence.pointId),
    "the spline's fit points are unchanged",
  ).toEqual(occurrences);
}

test("T17c5: a fit point dragged onto its neighbour in a constrained sketch; after Finish → reopen, gliding one of them apart is one Move Sketch Geometry: the status goes and Extrude offers the region again", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  const { spline, occurrences } = await drawLoop(workbench);
  await fixA(workbench);
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, C, B),
  );
  await expectDegenerate(page, spline.id, occurrences);

  await finishAndReopen(workbench);
  await dragOneApart(
    workbench,
    B,
    occurrences,
    { second: { x: B.x - 60, y: B.y + 20 }, third: C },
    true,
  );
  await expectRecovered(page, occurrences);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) => /\.region_/.test(target))
              .length ?? 0,
        ),
      { message: "Extrude offers the region again", timeout: 30_000 },
    )
    .toBe(1);
});

test("T17c5: Coincident on two consecutive fit points in a constrained sketch; after Finish → reopen, a drag keeps them together until the Coincident is deleted, then gliding one apart recovers the region", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  const { spline, occurrences } = await drawLoop(workbench);
  await fixA(workbench);
  await openSearchTool(page, "Coincident");
  await glideClick(workbench, B);
  await waitForCommittedAction(page, "Coincident", () =>
    glideClick(workbench, C),
  );
  await expectDegenerate(page, spline.id, occurrences);

  await finishAndReopen(workbench);
  // The Coincident moved both to the midpoint of B and C.
  const midpoint = { x: (B.x + C.x) / 2, y: B.y };
  const before = await sketchSnapshot(page);
  const apart = { second: B, third: C };
  await dragOneApart(workbench, midpoint, occurrences, apart, false);
  await workbench.waitForAnimationFrames(4);
  expect(
    (await sketchSnapshot(page)).points,
    "the Coincident keeps them together: nothing moved",
  ).toEqual(before.points);
  await expect(status(page), "still blocked").toBeVisible();

  const coincidentRow = page
    .locator("[data-sketch-constraint-row]")
    .filter({ has: page.getByRole("button", { name: /^Coincident/ }) });
  await waitForCommittedAction(page, "Delete Sketch Item", () =>
    glidePress(
      page,
      coincidentRow.getByRole("button", { name: /^Delete Coincident/ }),
    ),
  );
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toMatchObject({ status: "unavailable" });

  await dragOneApart(workbench, midpoint, occurrences, apart, true);
  await expectRecovered(page, occurrences);
});
