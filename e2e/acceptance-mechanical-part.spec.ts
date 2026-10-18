import { expect, test } from "@playwright/test";

import {
  currentRevision,
  glideDrag,
  readHistoryStrip,
  waitForCommittedAction,
} from "./helpers/acceptance";
import {
  emulateSaveFilePicker,
  openDocumentCopy,
  readEmulatedSavedFile,
  saveDocumentCopy,
  saveDocumentLinked,
} from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  DIMENSION_TOOL,
  READOUT_ROUNDING,
  RECTANGLE,
  constraintRows,
  drawRectangle,
  leaveArmedDimension,
  extent,
  finishAndExtrudeOneRegion,
  floatingInput,
  measuredVolume,
  runMechanicalPartFlow,
} from "./helpers/mechanical-part";
import {
  glideClick,
  glidePress,
  openTopSketch,
  sketchSnapshot,
} from "./helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: specification §1 "Mechanical part to
// usable solid" (T17 E2E-1) through the real workbench only: the persistent
// drawing tools and their two-stage Escape, the Dimension tool and its
// value popup, a geometric requirement, a gliding drag with Undo/Redo,
// Finish, the Extrude feature with its profile picked in the viewport, the
// Measure tool's Volume readout (R-6), the File menu's Save As / Open (real
// download and file chooser), re-entry and an edit through the dimension
// chip, and the downstream rebuild. Every pointer path glides (several
// `mouse.move` steps); waits are on committed history entries, machine
// state and revisions, never a frame count. Debug reads (sketch snapshot,
// hover target, selectable targets) are assertions only. Step → row map and
// discrimination (mutants): T17h.md. The flow and its helpers live in
// `helpers/mechanical-part.ts`, shared with the offline sub-lane (T17h2).

test("§1 E2E-1: Line outline and Circle (persistent tools, two-stage Escape), no unsolicited dimension, diameter and Horizontal added, a free-vertex drag is one action with exact Undo/Redo; Finish, Extrude picked in the viewport, Measure volume; Save As → Open (fresh history), re-enter, diameter changed through its chip, Finish → the extrude rebuilds by the analytic volume change without reselection", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await runMechanicalPartFlow(workbench);
});

const WIDTH = 8;

test("§1 E2E-1 second fixture: Rectangle stays armed and adds no size; its width only is dimensioned; a corner drag changes the height and keeps the width (one action); Finish, Extrude picked in the viewport, Measure volume = width × height × depth", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);

  const drawn = await drawRectangle(workbench);
  expect(drawn.dimensions, "no width or height dimension").toEqual([]);
  // Its approved primitive relationships: two Horizontal, two Vertical.
  await expect(page.locator("[data-sketch-constraint-row]")).toHaveCount(4, {
    timeout: 10_000,
  });
  await expect(constraintRows(page, "Rectangle 1 .* horizontal")).toHaveCount(
    2,
  );
  await expect(constraintRows(page, "Rectangle 1 .* vertical")).toHaveCount(2, {
    timeout: 10_000,
  });
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
  ).toHaveCount(0, { timeout: 10_000 });

  // The width only: the Distance tool on the bottom side.
  const bottom = {
    x: (RECTANGLE[0].x + RECTANGLE[1].x) / 2,
    y: RECTANGLE[1].y,
  };
  await workbench.activateTool(DIMENSION_TOOL);
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  await glideClick(workbench, bottom);
  await glideClick(workbench, { x: bottom.x, y: bottom.y + 50 });
  const value = floatingInput(page).locator("input").first();
  await expect(value).toBeVisible({ timeout: 15_000 });
  expect(
    Number(await value.inputValue()),
    "the input opens with the measured width",
  ).toBeCloseTo(extent(drawn, 0), 4);
  await value.fill(String(WIDTH));
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    page.keyboard.press("Enter"),
  );
  await leaveArmedDimension(page, workbench);
  const sized = await sketchSnapshot(page);
  expect(sized.dimensions, "one dimension: the width").toHaveLength(1);
  expect(extent(sized, 0)).toBeCloseTo(WIDTH, 5);

  // A corner drag: the height changes, the width holds; one action.
  const sizedHeight = extent(sized, 1);
  // The width solve may have moved either side: the top right corner is
  // found in the snapshot and put on the canvas (top plane, canvas Y down).
  const scale = (RECTANGLE[1].x - RECTANGLE[0].x) / extent(drawn, 0); // px per unit
  const corner = sized.points.reduce((best, point) =>
    point.position[0] + point.position[1] > best.position[0] + best.position[1]
      ? point
      : best,
  );
  const cornerOnCanvas = {
    x: 720 + corner.position[0] * scale,
    y: 480 - corner.position[1] * scale,
  };
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, cornerOnCanvas, {
      x: cornerOnCanvas.x + 40,
      y: cornerOnCanvas.y - 60,
    }),
  );
  const dragged = await sketchSnapshot(page);
  expect(extent(dragged, 0), "the width holds").toBeCloseTo(WIDTH, 5);
  expect(
    extent(dragged, 1) - sizedHeight,
    "the height grew by the drag (60 px)",
  ).toBeCloseTo(60 / scale, 1);
  expect(dragged.dimensions).toHaveLength(1);

  // Finish, extrude through a viewport pick; Measure.
  const depth = await finishAndExtrudeOneRegion(workbench);
  const volume = await measuredVolume(page, workbench);
  // Planar faces mesh exactly: only the readout's rounding (0.005) and the
  // mesh's Float32 transport to the main thread (relative ≈ 1e-7 per
  // coordinate, bounded here by 1e-6 of the volume) separate the readout
  // from width × height × depth (review A-3).
  const expected = depth * WIDTH * extent(dragged, 1);
  expect(
    Math.abs(volume - expected),
    `${volume} vs ${expected}`,
  ).toBeLessThanOrEqual(READOUT_ROUNDING + expected * 1e-6);
});

// T17-1′ (a): dev-server network emulation only. Chromium's `setOffline`
// does not cover dedicated-worker script fetches (T17h2 F-1), so this row
// proves nothing about workers: it covers Save As (download), Open a copy
// and the rebuilt body, which spawn none (asserted). Workers spawned offline
// are covered by the offline sub-lane (`e2e/offline/`, T17h2).
test("§1 E2E-1 offline (dev-server network emulation): after warm-up, Save As → Open a copy → the reopened body is rebuilt with the same volume", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await drawRectangle(workbench);
  await finishAndExtrudeOneRegion(workbench);
  const online = await measuredVolume(page, workbench);
  await page.keyboard.press("Escape");

  await context.setOffline(true);
  expect(
    await page.evaluate(() =>
      fetch(`/?offline-probe=${Date.now()}`, { cache: "no-store" }).then(
        () => "reached",
        () => "unreachable",
      ),
    ),
    "premise: the network is off",
  ).toBe("unreachable");
  const workersAfterCut: string[] = [];
  page.on("worker", (worker) => workersAfterCut.push(worker.url()));
  const saved = await saveDocumentCopy(page);
  await openDocumentCopy(page, saved, "offline-part.cadara");
  await expect
    .poll(() => currentRevision(page), { timeout: 30_000 })
    .not.toBe("loading");
  await expect
    .poll(() => readHistoryStrip(page), { timeout: 15_000 })
    .toEqual({ undo: [], redo: [] });
  expect(
    await measuredVolume(page, workbench),
    "the reopened body is rebuilt offline",
  ).toBe(online);
  expect(
    workersAfterCut,
    "no worker was spawned after the cut (the emulation would not cover it)",
  ).toEqual([]);
});

// Specification §5 "saving failures are surfaced" (review R-2), on the
// linked-save path: the browser's save picker is emulated (headless
// Chromium has none); a failing write is reported and nothing claims
// success; the same path succeeds once writes work (the control).
test("§5 saving failure: a linked save whose write fails says so and reports no success; once writes work, the same path saves", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await emulateSaveFilePicker(page, "part.cadara");
  await workbench.openWithRepository();
  await page.evaluate(() => {
    (
      window as unknown as { __cadaraEmulatedWriteFailure?: string }
    ).__cadaraEmulatedWriteFailure = "The disk is full.";
  });

  await saveDocumentLinked(page);
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "Workbench action failed" });
  await expect(failure).toContainText("Save linked document failed.", {
    timeout: 15_000,
  });
  await expect(page.getByText(/^Saved part\.cadara/)).toHaveCount(0, {
    timeout: 10_000,
  });
  expect(
    await readEmulatedSavedFile(page, "part.cadara"),
    "premise (guaranteed by the emulation, not product evidence): nothing was written",
  ).toBe("");

  // Control: the same path, writes working.
  await page.evaluate(() => {
    delete (window as unknown as { __cadaraEmulatedWriteFailure?: string })
      .__cadaraEmulatedWriteFailure;
  });
  await saveDocumentLinked(page);
  await expect(
    page.getByRole("status").filter({
      hasText: "Saved part.cadara. Future changes will save to that file.",
    }),
  ).toBeVisible({ timeout: 15_000 });
  expect(
    JSON.parse(await readEmulatedSavedFile(page, "part.cadara")),
    "the document was written",
  ).toMatchObject({ documentId: "doc_workspace" });
});
