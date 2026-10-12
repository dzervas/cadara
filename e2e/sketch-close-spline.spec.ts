import { expect, test, type Page } from "@playwright/test";

import {
  selectRegionInViewport,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import { openDocumentCopy, saveDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  entityTarget,
  glideClick,
  glidePress,
  hoverUntil,
  openTopSketch,
  placeFreely,
  sketchSnapshot,
} from "./helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T17c2 ([TECH] T17-16, review B-1)
// Close spline in the real workbench: the Spline tool, a gliding selection
// of the spline → the selection-context Spline panel → the reducer → the
// authored history (one "Close Spline" action, Undo/Redo) → the live region
// derivation worker; then Finish, the File menu's Save As / Open (download
// and file chooser) and a viewport region pick in Extrude. Only the browser
// composes them. The write set and the refusal set are pinned by the logic
// rows (`close-spline.spec.ts`, `sketch-authored-actions.spec.ts`). Every
// pointer path glides; waits are on committed history entries and session
// state.

// Viewport 1440×960, top plane: sketch origin at canvas (720, 480), Y up.
// Four fit points (Shift: no inferred constraint), open: A → B → C → D.
const FIT = [
  { x: 600, y: 560 },
  { x: 700, y: 400 },
  { x: 860, y: 420 },
  { x: 820, y: 600 },
] as const;
// On the open curve between B and C (the vertical hover scan finds it).
const ON_CURVE = { x: 780, y: 400 } as const;

type SavedSpline = {
  kind: string;
  entityId: string;
  closure?: string;
  pointOccurrences?: { occurrenceId: string; pointId: string }[];
};
type SavedDocument = {
  sketches: {
    sketchId: string;
    definition: { entities: SavedSpline[] };
  }[];
};
const savedSpline = (saved: SavedDocument, entityId: string) =>
  saved.sketches
    .flatMap((sketch) => sketch.definition.entities)
    .find((entity) => entity.entityId === entityId)!;

/** The spline's occurrences as authored (the displayed handle vectors aside). */
const occurrencesOf = (snap: Awaited<ReturnType<typeof sketchSnapshot>>) =>
  (
    snap.entities[0] as unknown as {
      occurrences: { occId: string; pointId: string; tangent: unknown }[];
    }
  ).occurrences.map(({ occId, pointId, tangent }) => ({
    occId,
    pointId,
    tangent,
  }));
const splinePanel = (page: Page) =>
  page.getByTestId("sketch-close-spline-action");
const regionTargets = (page: Page) =>
  page.evaluate(
    () =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
        ) ?? [],
  );

test("T17c2: draw a 4-fit-point open spline, select it → Close spline: one Close Spline action, one region; Undo re-opens, Redo closes; Finish → Save As → Open: still smooth, the region is picked in the viewport and extrudes", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await workbench.activateTool("Create spline geometry.");
  await placeFreely(workbench, FIT, true);
  const drawn = await sketchSnapshot(page);
  expect(drawn.entities.map((entity) => entity.kind)).toEqual(["spline"]);
  const spline = drawn.entities[0]!;
  expect(drawn.points, "premise: four fit points").toHaveLength(4);
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      message: "premise: the open spline bounds no region",
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 0 });

  // Select the spline in the viewport: the Spline panel offers Close spline.
  const selectSpline = async () => {
    await glideClick(
      workbench,
      await hoverUntil(workbench, ON_CURVE, entityTarget(spline.id), 40),
    );
    await expect
      .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
      .toContain(spline.id);
  };
  await selectSpline();
  const close = splinePanel(page).getByRole("button", {
    name: "Close spline",
  });
  await expect(close).toBeEnabled({ timeout: 15_000 });

  await waitForCommittedAction(page, "Close Spline", () =>
    glidePress(page, close),
  );
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      message: "the closed spline bounds one region",
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 1 });
  const closed = await sketchSnapshot(page);
  expect(closed.points, "no fit point added or removed; none moved").toEqual(
    drawn.points,
  );
  expect(
    occurrencesOf(closed),
    "the occurrences and their tangents are unchanged",
  ).toEqual(occurrencesOf(drawn));
  await expect(
    splinePanel(page),
    "a closed spline offers no Close spline",
  ).toHaveCount(0);

  // Undo re-opens it (no region; selected again, Close spline is offered;
  // Undo/Redo clear the selection, the existing restore rule); Redo closes.
  await waitForUndoneAction(page, "Close Spline", () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 0 });
  await selectSpline();
  await expect(close).toBeEnabled({ timeout: 15_000 });
  await waitForRedoneAction(page, "Close Spline", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 1 });

  // Finish, then the real file round trip.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  const saved = await saveDocumentCopy<SavedDocument>(page);
  const file = savedSpline(saved, spline.id);
  expect(file.closure, "the saved file has the smooth closure").toBe("smooth");
  expect(
    file.pointOccurrences?.map((occurrence) => occurrence.pointId),
    "four fit points, no duplicate",
  ).toEqual(drawn.points.map((point) => point.id));
  await openDocumentCopy(page, saved, "closed-spline.cadara");

  // The reopened sketch's region is offered by Extrude and picked in the
  // viewport.
  await workbench.activateFeature("extrude");
  let regions: string[] = [];
  await expect
    .poll(
      async () => {
        regions = await regionTargets(page);
        return regions.length;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await selectRegionInViewport(workbench, regions[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);

  // Saved again after the Open: the closure is still smooth.
  const resaved = await saveDocumentCopy<SavedDocument>(page);
  expect(savedSpline(resaved, spline.id)).toEqual(file);
});
