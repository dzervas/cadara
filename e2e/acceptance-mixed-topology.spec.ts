import { expect, test, type Page } from "@playwright/test";

import {
  activateProfileSlot,
  glideDoubleClick,
  glideDrag,
  readHistoryStrip,
  selectRegionInViewport,
  showInViewport,
  toggleVisibility,
  waitForCommittedAction,
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
} from "./helpers/mirror-workbench";
import {
  bezierPoint,
  boxCentre,
  cycleUntilSelected,
  entityOfKind,
  findHandleNear,
  mixedSnapshot,
  positionOf,
  projectedSketchMap,
  DISPLAY_SAMPLES_PER_SPAN,
  sampleSpans,
  surfaceToCanvasShift,
  topPlaneMap,
  type MixedSketchSnapshot,
  type Poles,
  type Vec,
} from "./helpers/mixed-topology";
import {
  FIGURE_EIGHT,
  bodyTopology,
  closedSplineSketch,
  expectExactPrism,
  historyOf,
  pointTouchingSquaresSketch,
  sketchRegionTargets,
  snapshotDiagnosticsCount,
  type SketchId,
} from "./helpers/seeded-sketches";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: specification §2 "Mixed curves and
// trustworthy topology" (T17 E2E-2) through the real workbench only.
// Every pointer path glides (several `mouse.move` steps); waits are on
// committed history entries, machine state and revisions, never a frame
// count. Debug reads (sketch snapshot incl. the live solve's spline spans,
// hover target, selectable targets, topology counts) are assertions only.
// Step → row map and discrimination: T17i.md.

const LINE_TOOL = "Create line geometry.";
const SPLINE_TOOL = "Create spline geometry.";
const ARC_TOOL = "Create an arc from center, start, and end points.";
const CONSTRUCTION_TOOL =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";

// Viewport 1440×960, top plane: sketch origin at canvas (720, 480), Y up.
// No two points share a row or column within the alignment snap radius.
// The closed mixed outline: Line A → B, 3-Point Arc B → C (through M),
// Spline C → F1 → F2 → A (its ends snap onto the arc end and the line
// start: inferred coincidences).
const A = { x: 300, y: 700 };
const B = { x: 640, y: 660 };
const M = { x: 680, y: 500 };
const C = { x: 560, y: 380 };
const F1 = { x: 420, y: 340 };
const F2 = { x: 270, y: 515 };
/** An empty spot of the canvas (a press there clears the selection). */
const BLANK = { x: 950, y: 760 };
/** Where F1 is dragged (uneven spacing). */
const F1_MOVED = { x: 470, y: 310 };

const regionTargets = (page: Page) =>
  page.evaluate(
    () =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
        ) ?? [],
  );

const liveRegions = async (page: Page) =>
  (await mixedSnapshot(page)).liveRegions;

async function expectLiveRegions(
  page: Page,
  expected: { status: string; count: number },
  message: string,
) {
  await expect
    .poll(() => liveRegions(page), { message, timeout: 30_000 })
    .toEqual(expected);
}

/** One Escape ends a chain or draft, a second leaves the tool. */
async function toSelect(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect
    .poll(
      () => page.evaluate(() => window.__cadaraDebug?.getState()?.command),
      { timeout: 10_000 },
    )
    .toBe("sketch");
}

/**
 * The sketch has inferred coincidences (a constrained solve), so an edit
 * re-solves every point: an untouched point may move by the solver's
 * convergence residual (measured ≈ 1e-7), far below a pixel (≈ 0.024).
 */
const SOLVE_RESIDUAL = 1e-6;
function expectSamePoint(actual: Vec, expected: Vec, message: string) {
  expect(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]),
    `${message}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
  ).toBeLessThanOrEqual(SOLVE_RESIDUAL);
}
function expectSamePoints(
  actual: MixedSketchSnapshot,
  expected: MixedSketchSnapshot,
  message: string,
) {
  expect(actual.points.map((point) => point.id)).toEqual(
    expected.points.map((point) => point.id),
  );
  expected.points.forEach((point) =>
    expectSamePoint(positionOf(actual, point.id), point.position, message),
  );
}

const splineOf = (snap: MixedSketchSnapshot) => entityOfKind(snap, "spline");
const occurrencesOf = (snap: MixedSketchSnapshot) =>
  splineOf(snap).occurrences!;

/** Draws the closed Line + 3-Point Arc + Spline outline; returns ids. */
async function drawMixedOutline(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await workbench.activateTool(LINE_TOOL);
  await glideClick(workbench, A);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, B),
  );
  await toSelect(page);
  // 3-Point Arc: start, through, end.
  await workbench.activateTool(ARC_TOOL);
  await glidePress(page, page.getByRole("menuitem", { name: /3-Point Arc/ }));
  await glideClick(workbench, B);
  await glideClick(workbench, M);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, C),
  );
  await toSelect(page);
  await workbench.activateTool(SPLINE_TOOL);
  for (const point of [C, F1, F2, A]) await glideClick(workbench, point);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    page.keyboard.press("Enter"),
  );
  await toSelect(page);
  await expectLiveRegions(
    page,
    { status: "current", count: 1 },
    "the closed mixed outline bounds one region",
  );
  const snap = await mixedSnapshot(page);
  expect(snap.entities.map((entity) => entity.kind)).toEqual([
    "lineSegment",
    "arc",
    "spline",
  ]);
  const [line, arc, spline] = snap.entities;
  const map = topPlaneMap(
    (B.x - A.x) /
      (positionOf(snap, line!.pointIds![1]!)[0] -
        positionOf(snap, line!.pointIds![0]!)[0]),
    { x: 720, y: 480 },
  );
  const fit = spline!.occurrences!.map((occurrence) => occurrence.pointId);
  expect(fit, "four fit points").toHaveLength(4);
  // The outline closes: the spline starts on the arc's end and ends on
  // the line's start; the arc starts on the line's end.
  const near = (left: string, right: string) =>
    Math.hypot(
      positionOf(snap, left)[0] - positionOf(snap, right)[0],
      positionOf(snap, left)[1] - positionOf(snap, right)[1],
    );
  expect(near(fit[0]!, arc!.pointIds![2]!)).toBeLessThan(1e-9);
  expect(near(fit[3]!, line!.pointIds![0]!)).toBeLessThan(1e-9);
  expect(near(arc!.pointIds![1]!, line!.pointIds![1]!)).toBeLessThan(1e-9);
  return { line: line!, arc: arc!, spline: spline!, fit, map };
}

/** The live solve's spline spans, read while editing (R-6 read). */
const editSpans = async (page: Page) =>
  splineOf(await mixedSnapshot(page)).spans!;

test("§2 E2E-2: a closed Line + 3-Point Arc + Spline outline; an uneven fit-point drag, an interior handle drag, the end handle to exactly zero (no region at the join, fails closed, the status line says why), recovered by the pick cycle and reset to automatic (each one action); construction removes the region and back; a fit point dropped exactly on its neighbour keeps the span authored and drawn, says so by label and blocks the profiles, dragged apart the region returns; Finish: part mode draws the spline the edit spans describe; Extrude picked in the viewport builds the exact prism", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  const { line, spline, fit, map } = await drawMixedOutline(workbench);

  // Step 2a: an uneven fit-point drag: F1 only moves; one action.
  const beforeFitDrag = await mixedSnapshot(page);
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, F1, F1_MOVED),
  );
  const afterFitDrag = await mixedSnapshot(page);
  const movedF1 = map.toCanvas(positionOf(afterFitDrag, fit[1]!));
  expect(
    Math.hypot(movedF1.x - F1_MOVED.x, movedF1.y - F1_MOVED.y),
    "F1 follows the pointer",
  ).toBeLessThan(2);
  for (const id of [fit[0]!, fit[2]!, fit[3]!])
    expectSamePoint(
      positionOf(afterFitDrag, id),
      positionOf(beforeFitDrag, id),
      "the other fit points stay",
    );
  const chords = [0, 1, 2].map((index) =>
    Math.hypot(
      positionOf(afterFitDrag, fit[index + 1]!)[0] -
        positionOf(afterFitDrag, fit[index]!)[0],
      positionOf(afterFitDrag, fit[index + 1]!)[1] -
        positionOf(afterFitDrag, fit[index]!)[1],
    ),
  );
  expect(
    Math.max(...chords) / Math.min(...chords),
    "premise: the fit points are unevenly spaced",
  ).toBeGreaterThan(1.3);
  await expectLiveRegions(
    page,
    { status: "current", count: 1 },
    "still one region",
  );

  // Step 2b: an interior handle (F2) dragged: authored, fit points stay.
  const selectSpline = async () => {
    const onCurve = map.toCanvas(bezierPoint((await editSpans(page))[2]!, 0.5));
    await glideClick(
      workbench,
      await hoverUntil(workbench, onCurve, entityTarget(spline.id), 30),
    );
    await expect
      .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
      .toContain(spline.id);
  };
  await selectSpline();
  const occurrences = occurrencesOf(afterFitDrag);
  const interior = await findHandleNear(
    workbench,
    map.toCanvas(positionOf(afterFitDrag, fit[2]!)),
    (label) => label.endsWith(occurrences[2]!.occId),
  );
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, interior.at, {
      x: interior.at.x + 50,
      y: interior.at.y - 20,
    }),
  );
  const afterHandle = await mixedSnapshot(page);
  expect(occurrencesOf(afterHandle)[2]!.tangent.kind).toBe("authored");
  expectSamePoints(afterHandle, afterFitDrag, "a handle drag moves no point");
  const interiorTangent = occurrencesOf(afterHandle)[2]!.tangent;

  // Step 2c: the end handle (at C) dragged onto its fit point: exactly
  // [0, 0]; one action.
  await page.keyboard.press("Escape");
  await selectSpline();
  const cOnCanvas = map.toCanvas(positionOf(afterHandle, fit[0]!));
  const endHandle = await findHandleNear(workbench, cOnCanvas, (label) =>
    label.endsWith(occurrences[0]!.occId),
  );
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, endHandle.at, cOnCanvas),
  );
  const zeroed = await mixedSnapshot(page);
  expect(occurrencesOf(zeroed)[0]!.tangent, "the end handle is zero").toEqual({
    kind: "authored",
    vector: [0, 0],
  });
  expectSamePoints(zeroed, afterFitDrag, "zeroing a handle moves no point");
  // A zero end tangent at the join with the arc: the arrangement cannot
  // certify the join, so the outline forms no region (fails closed) and
  // the status line says why, by label, with the recovery (T17c6 D-2).
  await expectLiveRegions(
    page,
    { status: "current", count: 0 },
    "a zero tangent at a join: no region is offered",
  );
  const withheld = page.getByRole("status").filter({
    hasText:
      "The declared-join query of ‘3-point arc 2’ and ‘Spline 3’ span 1 is uncertain (join-zero-end-tangent): A cubic has a zero tangent at a declared join location. Affects ‘3-point arc 2’. No region is formed there. Undo, or edit that geometry.",
  });
  await expect(
    withheld,
    "the status line explains the missing region",
  ).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");
  await glideClick(workbench, BLANK);
  await expect
    .poll(
      () => page.evaluate(() => window.__cadaraDebug?.getState()?.previewState),
      { timeout: 10_000 },
    )
    .toMatch(
      /^The declared-join query of ‘3-point arc 2’ and ‘Spline 3’ span 1 is uncertain \(join-zero-end-tangent\)/,
    );

  // Recover: the pick cycle at C reaches the zero handle; a drag out of
  // it authors a non-zero vector; one action.
  await page.keyboard.press("Escape");
  await cycleUntilSelected(workbench, cOnCanvas, endHandle.label);
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, cOnCanvas, {
      x: cOnCanvas.x - 40,
      y: cOnCanvas.y - 30,
    }),
  );
  const recovered = await mixedSnapshot(page);
  const recoveredTangent = occurrencesOf(recovered)[0]!.tangent;
  expect(recoveredTangent.kind).toBe("authored");
  expect(
    Math.hypot(...recoveredTangent.vector!),
    "recovered: a non-zero end tangent",
  ).toBeGreaterThan(0.1);
  expectSamePoints(recovered, afterFitDrag, "the fit point stays");
  await expectLiveRegions(
    page,
    { status: "current", count: 1 },
    "out of zero: the region is back",
  );

  // Reset to automatic (the handle still selected): one "Reset Tangent".
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toBe(endHandle.label);
  await waitForCommittedAction(page, "Reset Tangent", () =>
    glidePress(page, page.getByRole("button", { name: /Reset to automatic/i })),
  );
  const reset = await mixedSnapshot(page);
  expect(occurrencesOf(reset)[0]!.tangent).toEqual({ kind: "automatic" });
  expect(
    occurrencesOf(reset)[2]!.tangent,
    "the interior authored tangent is kept",
  ).toEqual(interiorTangent);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Step 8: the line toggled to construction: the outline bounds nothing
  // (construction forms no region); toggled back: the region returns.
  const lineMiddle = map.toCanvas([
    (positionOf(reset, line.pointIds![0]!)[0] +
      positionOf(reset, line.pointIds![1]!)[0]) /
      2,
    (positionOf(reset, line.pointIds![0]!)[1] +
      positionOf(reset, line.pointIds![1]!)[1]) /
      2,
  ]);
  for (const expected of [0, 1]) {
    await workbench.activateTool(CONSTRUCTION_TOOL);
    await waitForCommittedAction(page, "Construction", () =>
      glideClick(workbench, lineMiddle),
    );
    await expectLiveRegions(
      page,
      { status: "current", count: expected },
      expected === 0
        ? "a construction side forms no region"
        : "the side is real again: the region returns",
    );
    await toSelect(page);
  }

  // Degenerate span on this constrained outline (T17c3/T17c5; T17c6 D-3:
  // the release lands exactly on the cursor whenever it can): fit point 3
  // glided onto fit point 2: one action; exactly together; the span stays
  // authored and drawn, the label-based status shows and no profile is
  // offered; dragged apart, the region returns.
  const beforeDrop = await mixedSnapshot(page);
  const second = map.toCanvas(positionOf(beforeDrop, fit[1]!));
  const third = map.toCanvas(positionOf(beforeDrop, fit[2]!));
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, third, second),
  );
  const degenerateStatus = page.getByRole("status").filter({
    hasText:
      "Spline 3 has two consecutive fit points at the same place (Spline 3 point 2 and Spline 3 point 3); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).",
  });
  await expect(degenerateStatus, "the label-based status").toBeVisible({
    timeout: 15_000,
  });
  await expectLiveRegions(
    page,
    { status: "unavailable", count: 0 },
    "no profile is offered",
  );
  const degenerate = await mixedSnapshot(page);
  expect(
    positionOf(degenerate, fit[2]!),
    "dropped exactly on its neighbour",
  ).toEqual(positionOf(degenerate, fit[1]!));
  expect(
    occurrencesOf(degenerate).map((occurrence) => occurrence.pointId),
    "the span stays authored",
  ).toEqual(fit);
  expect(
    await page.evaluate(
      (id) => window.__cadProjectToScreen?.(`sketch_draft.${id}`) ?? null,
      spline.id,
    ),
    "the spline stays drawn",
  ).not.toBeNull();
  await page.keyboard.press("Escape");
  await glideClick(workbench, BLANK);
  const grabbed = await hoverUntil(
    workbench,
    second,
    new RegExp(`\\.(${fit[1]}|${fit[2]})$`),
  );
  const grabbedId = (await workbench.currentHoverTarget()).endsWith(fit[2]!)
    ? fit[2]!
    : fit[1]!;
  // Fit point 3 goes back where it was; fit point 2 back towards C (either
  // keeps the fit points in order).
  const back =
    grabbedId === fit[2]
      ? third
      : map.toCanvas([
          (positionOf(beforeDrop, fit[0]!)[0] +
            positionOf(beforeDrop, fit[1]!)[0]) /
            2,
          (positionOf(beforeDrop, fit[0]!)[1] +
            positionOf(beforeDrop, fit[1]!)[1]) /
            2,
        ]);
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, grabbed, back),
  );
  await expect(degenerateStatus, "the status is gone").toHaveCount(0, {
    timeout: 15_000,
  });
  await expectLiveRegions(
    page,
    { status: "current", count: 1 },
    "dragged apart: the region returns",
  );
  const apart = map.toCanvas(positionOf(await mixedSnapshot(page), grabbedId));
  expect(
    Math.hypot(apart.x - back.x, apart.y - back.y),
    "the hovered fit point is the one dragged apart",
  ).toBeLessThan(2);

  // Edit vs finished (R-6, review R-1). The edit read: the live solve's
  // spline spans (debug snapshot). The finished read, after Finish (the
  // document's solve, the kernel's re-solve): what part mode draws, the
  // projected centre of the drawn spline's bounding box
  // (`__cadProjectToScreen`, a debug read), against the same centre of the
  // edit spans sampled exactly as the display tessellates them (16 samples
  // per span, `tessellateCubicSpans`), put on the canvas by the part-mode
  // map read off three projected fit points. Both polylines then have the
  // same vertices up to the two solves' convergence (≈ 1e-6 units, far
  // below 0.001 px here), so only float and projection rounding remain:
  // tolerance 0.05 px. A part mode drawing another spline meaning (the
  // review's `rm-handles` mutant, inner poles pulled 25 %: 0.54 px) fails.
  // (The Measure tool's Length/Area readouts read the document's solved
  // spans, so they would not see a different drawing; T17i.md R-1.)
  const edit = await mixedSnapshot(page);
  const editSpline = splineOf(edit);
  expect(editSpline.spans, "three spans").toHaveLength(3);
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  await expect
    .poll(() => regionTargets(page), { timeout: 30_000 })
    .toHaveLength(1);
  const [region] = await regionTargets(page);
  const sketchId = region!.split(".")[0]!;
  const splineTarget = `${sketchId}.${spline.id}`;
  const partMap = await projectedSketchMap(
    workbench,
    sketchId,
    fit.slice(0, 3).map((pointId) => ({
      pointId,
      position: positionOf(edit, pointId),
    })),
  );
  const canvasShift = await surfaceToCanvasShift(workbench);
  const drawn = await page.evaluate(
    (id) => window.__cadProjectToScreen?.(id) ?? null,
    splineTarget,
  );
  expect(drawn, "the spline is drawn in part mode").not.toBeNull();
  const expectedCentre = partMap(
    boxCentre(sampleSpans(editSpline.spans!, DISPLAY_SAMPLES_PER_SPAN)),
  );
  expect(
    Math.hypot(
      drawn!.x + canvasShift.x - expectedCentre.x,
      drawn!.y + canvasShift.y - expectedCentre.y,
    ),
    "part mode draws the spline the edit spans describe",
  ).toBeLessThanOrEqual(0.05);

  // Extrude, the region picked in the viewport: the exact prism (one side
  // face per boundary curve: line, arc, three spline spans; two caps).
  const diagnostics = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.snapshotDiagnosticsCount ?? -1,
  );
  await selectRegionInViewport(workbench, region!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyEulerCharacteristic("body_feature_extrude-1", 2);
  expect(
    await page.evaluate(
      () =>
        window.__cadaraDebug
          ?.getState()
          ?.topologyDebug.bodies.find(
            (body) => body.bodyId === "body_feature_extrude-1",
          )?.faces ?? null,
    ),
    "5 side faces (line, arc, 3 spline spans) + 2 caps",
  ).toBe(7);
  expect(
    await page.evaluate(
      () => window.__cadaraDebug?.getState()?.snapshotDiagnosticsCount ?? -1,
    ),
    "no new document diagnostic",
  ).toBe(diagnostics);
});

// Fixture 2 (Shift-placed, so no inferred constraint: drags take the
// unconstrained path). An open 4-fit-point spline for Close spline, and a
// 5-fit-point spline whose last fit point is placed 6 px off its first,
// closed positionally by Merge Points (last → first).
const OPEN_FIT = [
  { x: 380, y: 360 },
  { x: 500, y: 300 },
  { x: 640, y: 360 },
  { x: 560, y: 480 },
] as const;
const MERGE_FIT = [
  { x: 820, y: 560 },
  { x: 960, y: 470 },
  { x: 1100, y: 560 },
  { x: 1000, y: 700 },
  { x: 826, y: 566 },
] as const;
const MERGE_TOOL =
  "Merge two sketch points: the first into the second (the destination).";

type SavedSpline = {
  kind: string;
  entityId: string;
  closure?: string;
  pointOccurrences?: {
    occurrenceId: string;
    pointId: string;
    tangent: { kind: string; vector?: Vec };
  }[];
};
type SavedDocument = {
  sketches: {
    sketchId: string;
    label: string;
    definition: { entities: SavedSpline[] };
  }[];
};
const savedSplines = (saved: SavedDocument) =>
  saved.sketches
    .flatMap((sketch) => sketch.definition.entities)
    .filter((entity) => entity.kind === "spline");
/** A live spline's closure and occurrences as authored (ids, tangents). */
const authoredSpline = (entity: MixedSketchSnapshot["entities"][number]) => ({
  entityId: entity.id,
  closure: entity.closure,
  pointOccurrences: entity.occurrences!.map((occurrence) => ({
    occurrenceId: occurrence.occId,
    pointId: occurrence.pointId,
    tangent: occurrence.tangent,
  })),
});

test("§2 E2E-2 closures: Close spline on an open spline (one action) and positional closure by Merge Points (the second pick, the first fit point, survives) each form a region; Finish → Save As → Open: each closure and the authored tangents are byte-equal, re-entered and saved again unchanged, and the positional region extrudes from a viewport pick", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await workbench.activateTool(SPLINE_TOOL);
  await placeFreely(workbench, OPEN_FIT, true);
  await workbench.activateTool(SPLINE_TOOL);
  await placeFreely(workbench, MERGE_FIT, true);
  await expectLiveRegions(
    page,
    { status: "current", count: 0 },
    "premise: two open splines bound nothing",
  );
  const drawn = await mixedSnapshot(page);
  expect(drawn.entities.map((entity) => entity.kind)).toEqual([
    "spline",
    "spline",
  ]);
  const [open, merged] = drawn.entities as [
    MixedSketchSnapshot["entities"][number],
    MixedSketchSnapshot["entities"][number],
  ];
  const openFit = open.occurrences!.map((occurrence) => occurrence.pointId);
  const mergeFit = merged.occurrences!.map((occurrence) => occurrence.pointId);
  expect(mergeFit, "five fit points").toHaveLength(5);
  const map = topPlaneMap(
    (OPEN_FIT[1].x - OPEN_FIT[0].x) /
      (positionOf(drawn, openFit[1]!)[0] - positionOf(drawn, openFit[0]!)[0]),
    { x: 720, y: 480 },
  );

  // Close spline: select the open spline, the Spline panel's button; one
  // "Close Spline"; smooth, no fit point added.
  const selectSpline = async (id: string, spans: readonly Poles[]) => {
    const onCurve = map.toCanvas(bezierPoint(spans[1]!, 0.5));
    await glideClick(
      workbench,
      await hoverUntil(workbench, onCurve, entityTarget(id), 30),
    );
    await expect
      .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
      .toContain(id);
  };
  await selectSpline(open.id, open.spans!);
  await waitForCommittedAction(page, "Close Spline", () =>
    glidePress(
      page,
      page
        .getByTestId("sketch-close-spline-action")
        .getByRole("button", { name: "Close spline" }),
    ),
  );
  await expectLiveRegions(
    page,
    { status: "current", count: 1 },
    "the closed spline bounds a region",
  );
  const closed = await mixedSnapshot(page);
  expect(closed.entities[0]!.closure).toBe("smooth");
  expect(closed.points, "no fit point added, removed or moved").toEqual(
    drawn.points,
  );

  // An authored tangent on it (interior handle at fit point 2), for the
  // file round trip.
  await page.keyboard.press("Escape");
  await selectSpline(open.id, closed.entities[0]!.spans!);
  const handle = await findHandleNear(
    workbench,
    map.toCanvas(positionOf(closed, openFit[1]!)),
    (label) => label.endsWith(open.occurrences![1]!.occId),
  );
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, handle.at, {
      x: handle.at.x + 37,
      y: handle.at.y + 11,
    }),
  );
  const authored = await mixedSnapshot(page);
  expect(authored.entities[0]!.occurrences![1]!.tangent.kind).toBe("authored");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Positional closure: Merge Points, the last fit point (the source) into
  // the first (the destination, the second pick); Enter merges.
  await workbench.activateTool(MERGE_TOOL);
  await glideClick(workbench, MERGE_FIT[4]);
  await glideClick(workbench, MERGE_FIT[0]);
  await expect(
    page
      .locator('[data-sketch-viewport-floating-input="merge-points-confirm"]')
      .getByRole("button", { name: "Merge" }),
  ).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(page, "Merge Points", () =>
    page.keyboard.press("Enter"),
  );
  await expectLiveRegions(
    page,
    { status: "current", count: 2 },
    "the merged spline bounds a region too",
  );
  const positional = await mixedSnapshot(page);
  const mergedNow = positional.entities[1]!;
  expect(mergedNow.closure).toBe("positional");
  expect(
    mergedNow.occurrences!.map((occurrence) => occurrence.pointId),
    "the destination (first fit point) survives and ends the spline; the source is gone",
  ).toEqual([...mergeFit.slice(0, 4), mergeFit[0]]);
  expect(positional.points.map((point) => point.id)).not.toContain(mergeFit[4]);
  expect(positionOf(positional, mergeFit[0]!)).toEqual(
    positionOf(drawn, mergeFit[0]!),
  );
  await toSelect(page);

  const beforeFinish = await mixedSnapshot(page);

  // Finish → Save As: the closures and the authored tangents as edited.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  const saved = await saveDocumentCopy<SavedDocument>(page);
  const editedSplines = beforeFinish.entities.map(authoredSpline);
  const fileSplines = savedSplines(saved);
  expect(
    fileSplines.map((spline) => ({
      entityId: spline.entityId,
      closure: spline.closure,
      pointOccurrences: spline.pointOccurrences,
    })),
    "the file has each closure and every tangent as edited",
  ).toEqual(editedSplines);
  expect(fileSplines[0]!.pointOccurrences![1]!.tangent).toEqual(
    beforeFinish.entities[0]!.occurrences![1]!.tangent,
  );

  // Open the copy (new history); re-enter: the same authored splines;
  // Finish and save again: byte-equal.
  await openDocumentCopy(page, saved, "closures.cadara");
  await expect
    .poll(() => readHistoryStrip(page), { timeout: 15_000 })
    .toEqual({ undo: [], redo: [] });
  await glideDoubleClick(
    page,
    page.getByRole("button", {
      name: `Select ${saved.sketches[0]!.label}. Double-click to reopen.`,
    }),
  );
  await workbench.expectSketchSessionActive();
  await expectLiveRegions(
    page,
    { status: "current", count: 2 },
    "the reopened sketch forms both regions",
  );
  expect(
    (await mixedSnapshot(page)).entities.map(authoredSpline),
    "re-entered: the same closures and tangents",
  ).toEqual(editedSplines);
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  const resaved = await saveDocumentCopy<SavedDocument>(page);
  expect(
    JSON.stringify(savedSplines(resaved)),
    "saved again: the spline records are byte-equal",
  ).toBe(JSON.stringify(fileSplines));

  // The positional region is a usable profile: picked in the viewport
  // (the one whose projected point is nearer the merged spline's fit
  // points), it extrudes.
  await workbench.activateFeature("extrude");
  await expect
    .poll(() => regionTargets(page), { timeout: 30_000 })
    .toHaveLength(2);
  const regions = await regionTargets(page);
  const sketchId = regions[0]!.split(".")[0]!;
  const mergedCentre = await page.evaluate(
    (id) => window.__cadProjectToScreen?.(id) ?? null,
    `${sketchId}.${merged.id}`,
  );
  const projected = await Promise.all(
    regions.map((id) =>
      page.evaluate((target) => window.__cadProjectToScreen?.(target), id),
    ),
  );
  const nearest = regions
    .map((id, index) => ({
      id,
      distance: Math.hypot(
        projected[index]!.x - mergedCentre!.x,
        projected[index]!.y - mergedCentre!.y,
      ),
    }))
    .sort((left, right) => left.distance - right.distance)[0]!.id;
  await selectRegionInViewport(workbench, nearest);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyEulerCharacteristic("body_feature_extrude-1", 2);
});

// Fixture 3: a triangle P → Q → R → (near P) whose last end is placed with
// Shift 6 px off P (a real near gap, T13j/T13k), each gap end Fixed where
// it is: merging them retains both Fix requirements, which now disagree.
const P = { x: 600, y: 540 };
const Q = { x: 840, y: 540 };
const R = { x: 720, y: 340 };
const GAP_END = { x: 594, y: 534 };
const FIX_TOOL = "Fix Geometry";

test("§2 E2E-2 near gap: a Shift-placed near gap is not healed; both ends Fixed, Merge Points (source, then the destination) keeps the destination's point id and retains both Fix requirements, which the Constraints list shows as a conflict; the profiles are blocked; Undo restores the gap", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await workbench.activateTool(LINE_TOOL);
  for (const at of [P, Q, R]) await glideClick(workbench, at);
  await page.keyboard.down("Shift");
  await glideClick(workbench, GAP_END);
  await page.keyboard.up("Shift");
  await toSelect(page);
  await expectLiveRegions(
    page,
    { status: "current", count: 0 },
    "premise: the near gap is not healed: no region",
  );
  const drawn = await mixedSnapshot(page);
  const sides = drawn.entities;
  expect(sides.map((side) => side.kind)).toEqual(Array(3).fill("lineSegment"));
  const destination = sides[0]!.pointIds![0]!;
  const source = sides[2]!.pointIds![1]!;
  expect(destination, "premise: two points at the gap").not.toBe(source);

  // Fix each gap end where it is (two "Fix Geometry" actions).
  for (const at of [P, GAP_END]) {
    await glidePress(
      page,
      page.getByRole("button", { name: FIX_TOOL, exact: true }),
    );
    await waitForCommittedAction(page, FIX_TOOL, () =>
      glideClick(workbench, at),
    );
    await toSelect(page);
  }
  const problems = page.locator(
    "[data-sketch-constraint-row][data-sketch-constraint-problem]",
  );
  await expect(problems, "premise: no conflict before the merge").toHaveCount(
    0,
  );

  // Merge Points: the source first, then the destination; Enter merges.
  await workbench.activateTool(MERGE_TOOL);
  await glideClick(workbench, GAP_END);
  await glideClick(workbench, P);
  await expect(
    page
      .locator('[data-sketch-viewport-floating-input="merge-points-confirm"]')
      .getByRole("button", { name: "Merge" }),
  ).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(page, "Merge Points", () =>
    page.keyboard.press("Enter"),
  );
  const merged = await mixedSnapshot(page);
  const ids = merged.points.map((point) => point.id);
  expect(ids, "the destination keeps its id").toContain(destination);
  expect(ids, "the source is merged away").not.toContain(source);
  expect(
    merged.entities[2]!.pointIds,
    "the last side now ends on the destination",
  ).toEqual([sides[2]!.pointIds![0], destination]);

  // The conflict is listed: both Fix requirements, now on one point, are
  // problem rows (none discarded), and the header counts them.
  const fixRows = page
    .locator("[data-sketch-constraint-row]")
    .filter({ has: page.getByRole("button", { name: /^Fix/ }) });
  await expect(fixRows, "both Fix requirements are retained").toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(
    problems.filter({ has: page.getByRole("button", { name: /^Fix/ }) }),
  ).toHaveCount(2, {
    timeout: 15_000,
  });
  // The reason is label-based (no internal id).
  const reasons = await problems
    .locator("[data-sketch-constraint-problem-text]")
    .allTextContents();
  expect(reasons).toHaveLength(2);
  for (const reason of reasons)
    expect(reason).not.toMatch(/sketch_|constraint_|_[0-9a-f]{8}-/);
  await expect(
    page.locator("[data-sketch-constraint-problem-count]"),
  ).toHaveAttribute("data-sketch-constraint-problem-count", "2");
  await expect
    .poll(() => liveRegions(page), {
      message: "the conflict blocks the profiles",
      timeout: 30_000,
    })
    .not.toEqual(expect.objectContaining({ status: "current" }));

  // Undo restores the gap and clears the conflict.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitForUndoneAction(page, "Merge Points", () =>
    page.keyboard.press("Control+z"),
  );
  await expect(problems).toHaveCount(0, { timeout: 15_000 });
  expect((await mixedSnapshot(page)).points.map((point) => point.id)).toContain(
    source,
  );
  await expectLiveRegions(
    page,
    { status: "current", count: 0 },
    "the gap is back, unhealed",
  );
});

// Separate small seeded fixtures (specification §2: "in separate small
// fixtures"): the figure-eight (one smooth closed spline crossing itself
// once) and two squares touching at one shared corner point, in two
// sketches. The annulus (nested regions) and the figure-eight's
// reselection after its crossing is removed are the converted rows of
// `sketch-spline-region-extrude.spec.ts` (T17i.md).
const FIGURE_EIGHT_SKETCH: SketchId = "sketch_figure_eight";
const SQUARES_SKETCH: SketchId = "sketch_touching_squares";

test("§2 E2E-2 seeded fixtures: each figure-eight lobe and each of two point-touching squares is picked in the viewport and extrudes into its own exact prism", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(
    historyOf([
      closedSplineSketch(FIGURE_EIGHT_SKETCH, "Figure Eight", [FIGURE_EIGHT]),
      pointTouchingSquaresSketch(
        SQUARES_SKETCH,
        "Touching Squares",
        [7, -3],
        3,
      ),
    ]),
  );
  await workbench.activateFeature("extrude");
  const lobes = await sketchRegionTargets(page, FIGURE_EIGHT_SKETCH, 2);
  const squares = await sketchRegionTargets(page, SQUARES_SKETCH, 2);
  const diagnostics = await snapshotDiagnosticsCount(page);
  expect(diagnostics, "every region renders its exact face").toBe(0);

  // A lobe is 5 boundary segments (3 spans and 2 pieces split at the
  // crossing): 7 faces; a square 4 sides: 6 faces.
  const picks = [
    ...lobes.map((region) => ({ region, sketch: "Figure Eight", faces: 7 })),
    ...squares.map((region) => ({
      region,
      sketch: "Touching Squares",
      faces: 6,
    })),
  ];
  for (const [index, pick] of picks.entries()) {
    const feature = `feature_extrude-${index + 1}`;
    if (index > 0) {
      // A new Extrude reopens with the previous profile: cleared; earlier
      // bodies hidden so they cannot take the hover; a consumed (auto-
      // hidden) sketch shown again; the profile slot re-armed.
      await workbench.activateFeature("extrude");
      await glidePress(
        page,
        page.getByRole("button", { name: "Clear Profile targets" }),
      );
      for (let body = 1; body <= index; body += 1)
        await toggleVisibility(page, "Hide", `Extrude ${body}`);
      if (
        (await page
          .getByRole("button", { name: `Show ${pick.sketch}` })
          .count()) > 0
      )
        await showInViewport(page, pick.sketch);
      await activateProfileSlot(page);
    }
    await selectRegionInViewport(workbench, pick.region);
    if (index > 0) await workbench.setOperation("newBody");
    await workbench.expectFeaturePreviewReady("extrude");
    await workbench.commitFeature(feature);
    await expectExactPrism(page, `body_${feature}`, [pick.faces], diagnostics);
    if (index > 0)
      for (let body = 1; body <= index; body += 1)
        await toggleVisibility(page, "Show", `Extrude ${body}`);
  }
  await workbench.expectBodyCountAtLeast(4);
  expect(
    await Promise.all(
      [1, 2, 3, 4].map((index) =>
        bodyTopology(page, `body_feature_extrude-${index}`),
      ),
    ),
    "two lobe prisms and two cube-like prisms (closed solids)",
  ).toEqual([
    { vertices: 10, edges: 15, faces: 7 },
    { vertices: 10, edges: 15, faces: 7 },
    { vertices: 8, edges: 12, faces: 6 },
    { vertices: 8, edges: 12, faces: 6 },
  ]);
});
