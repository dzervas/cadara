import { expect, type Page } from "@playwright/test";

import {
  currentRevision,
  glideDoubleClick,
  glideDrag,
  readHistoryStrip,
  selectRegionInViewport,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
  type CanvasPoint,
} from "./acceptance";
import { openDocumentCopy, saveDocumentCopy } from "./document-files";
import type { FeatureWorkbenchHarness } from "./feature-workbench";
import {
  expectStaged,
  glideClick,
  glidePress,
  openTopSketch,
  sketchSnapshot,
  type MirrorSketchSnapshot,
} from "./mirror-workbench";

// The specification §1 "Mechanical part to usable solid" flow (T17 E2E-1),
// shared by the fast lane (`e2e/acceptance-mechanical-part.spec.ts`, dev
// server) and the offline sub-lane (`e2e/offline/`, production preview,
// network off). Real pointer and keyboard only: every pointer path glides
// (several `mouse.move` steps); waits are on committed history entries,
// machine state and revisions, never a frame count. Debug reads (sketch
// snapshot, hover target, selectable targets) are assertions only.

const LINE_TOOL = "Create line geometry.";
const CIRCLE_TOOL = "Create circular geometry.";
const RECTANGLE_TOOL = "Create rectangle geometry.";
export const DIMENSION_TOOL = "Create point-to-point distance dimensions.";
const HORIZONTAL_TOOL =
  "Constrain a line parallel to the sketch horizontal axis.";
const MEASURE_TOOL = "Inspect geometric measurements.";

// Viewport 1440×960, top plane: sketch origin at canvas (720, 480), Y up.
// No two points share a row or column within the alignment snap radius,
// and none lines up with the origin, so placement infers no requirement.
/** A sloped quadrilateral, drawn as a Line chain. */
const OUTLINE: CanvasPoint[] = [
  { x: 500, y: 300 },
  { x: 940, y: 340 },
  { x: 980, y: 650 },
  { x: 460, y: 620 },
];
const CIRCLE = { centre: { x: 690, y: 470 }, rim: { x: 750, y: 470 } };
/** Where the diameter's label is placed. */
const DIAMETER_LABEL = { x: 800, y: 400 };
/** The free outline vertex dragged (OUTLINE[2]) and where it is dropped. */
const DRAG_TO = { x: 1010, y: 690 };
const FIRST_DIAMETER = 3;
const SECOND_DIAMETER = 4;

/**
 * The coarsest tessellation tier's angular deflection (0.5 rad, `startup` in
 * `occ/tessellation.ts`) bounds the angle a circle's mesh segment spans: the
 * mesh of a hole of radius r is an inscribed polygon whose area is short of
 * π r² by at most π r² (1 − sin φ/φ). The readout is rounded to 0.01.
 */
const MESH_SEGMENT_ANGLE = 0.5;
const holeMeshShortfall = (radius: number) =>
  Math.PI *
  radius *
  radius *
  (1 - Math.sin(MESH_SEGMENT_ANGLE) / MESH_SEGMENT_ANGLE);
export const READOUT_ROUNDING = 0.005;

/** Select is active and `tool` is no longer shown pressed. */
export async function expectSelect(
  page: Page,
  workbench: FeatureWorkbenchHarness,
  tool: string,
) {
  await expect
    .poll(() => command(page), { message: "Select", timeout: 10_000 })
    .toBe("sketch");
  await expect(workbench.toolbarButton(tool)).toHaveAttribute(
    "aria-pressed",
    "false",
    { timeout: 10_000 },
  );
}

const command = (page: Page) =>
  page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? "");

export const constraintRows = (page: Page, kind: string) =>
  page.locator("[data-sketch-constraint-row]").filter({
    has: page.getByRole("button", { name: new RegExp(`^${kind}`) }),
  });

export const floatingInput = (page: Page) =>
  page.locator("[data-sketch-viewport-floating-input]");

const diameterChip = (page: Page) =>
  page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label^="Diameter"]',
  );

const regionTargets = (page: Page) =>
  page.evaluate(
    () =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
        ) ?? [],
  );

const pointOf = (snap: MirrorSketchSnapshot, id: string) => {
  const point = snap.points.find((candidate) => candidate.id === id);
  if (!point) throw new Error(`No point ${id}.`);
  return point.position;
};

/** Shoelace area of the closed outline through `pointIds`. */
function polygonArea(
  snap: MirrorSketchSnapshot,
  pointIds: readonly string[],
) {
  let twice = 0;
  pointIds.forEach((id, index) => {
    const [x0, y0] = pointOf(snap, id);
    const [x1, y1] = pointOf(snap, pointIds[(index + 1) % pointIds.length]!);
    twice += x0 * y1 - x1 * y0;
  });
  return Math.abs(twice) / 2;
}

/** Selects the body in Parts & Objects with the Measure tool; its Volume. */
export async function measuredVolume(
  page: Page,
  workbench: FeatureWorkbenchHarness,
) {
  if ((await command(page)) !== "measure")
    await workbench.activateTool(MEASURE_TOOL);
  const row = page
    .locator("[data-parts-tree-row]")
    .filter({ hasText: /extrude/i });
  await expect(row, "one body in Parts & Objects").toHaveCount(1, {
    timeout: 30_000,
  });
  await glidePress(page, row.getByRole("button").first());
  const panel = page.getByText("Measure", { exact: true }).locator("xpath=..");
  const volume = panel
    .locator("div")
    .filter({ hasText: /^Volume/ })
    .locator("span")
    .last();
  await expect(volume).toHaveText(/^[\d.]+ mm³$/, { timeout: 15_000 });
  return Number((await volume.textContent())!.replace(" mm³", ""));
}

/** One Escape leaves the armed tool (no draft) for Select. */
async function leaveTool(page: Page) {
  await page.keyboard.press("Escape");
  await expect.poll(() => command(page), { timeout: 10_000 }).toBe("sketch");
}

/**
 * The whole E2E-1 flow on a fresh document (no sketch, no body yet): enter
 * a sketch on the Top plane, Line outline and Circle (persistent tools,
 * two-stage Escape), no unsolicited dimension, the diameter and a
 * Horizontal added, a free-vertex drag as one action with exact Undo/Redo;
 * Finish, Extrude picked in the viewport, Measure volume; Save As → Open
 * (fresh history), re-enter, the diameter changed through its chip, Finish
 * → the extrude rebuilds by the analytic volume change without reselection.
 * Step → row map and discrimination: T17h.md, T17h2.md.
 */
export async function runMechanicalPartFlow(
  workbench: FeatureWorkbenchHarness,
) {
  const page = workbench.page;
  await openTopSketch(workbench);
  const lineButton = workbench.toolbarButton(LINE_TOOL);

  // Step 2: a connected outline. Line chains its sides; Escape ends the
  // chain and Line stays armed; the closing side is a new chain from the
  // last corner onto the first; a second Escape returns to Select.
  await workbench.activateTool(LINE_TOOL);
  for (const [index, point] of OUTLINE.entries()) {
    if (index === 0) {
      await glideClick(workbench, point);
      continue;
    }
    await waitForCommittedAction(page, "Create Sketch Geometry", () =>
      glideClick(workbench, point),
    );
  }
  await expectStaged(workbench, 3);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "Escape ends the chain",
      timeout: 10_000,
    })
    .toBe("collecting");
  expect(await command(page), "Line stays armed").toBe("line");
  await expect(lineButton).toHaveAttribute("aria-pressed", "true", {
    timeout: 10_000,
  });
  await glideClick(workbench, OUTLINE[3]!);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, OUTLINE[0]!),
  );
  await expectStaged(workbench, 4);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 10_000 })
    .toBe("collecting");
  expect(await command(page), "Line stays armed").toBe("line");
  await leaveTool(page);
  await expect(lineButton).toHaveAttribute("aria-pressed", "false", {
    timeout: 10_000,
  });
  const outlined = await sketchSnapshot(page);
  const sides = outlined.entities;
  expect(sides.map((side) => side.kind)).toEqual(Array(4).fill("lineSegment"));
  sides.forEach((side, index) =>
    expect(
      side.pointIds![1],
      `side ${index + 1} ends where the next side starts (shared point)`,
    ).toBe(sides[(index + 1) % 4]!.pointIds![0]),
  );
  expect(outlined.points).toHaveLength(4);
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 1 });

  // A circle inside: Circle stays armed after it; one Escape (no draft)
  // returns to Select.
  const circleButton = workbench.toolbarButton(CIRCLE_TOOL);
  await workbench.activateTool(CIRCLE_TOOL);
  await glideClick(workbench, CIRCLE.centre);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, CIRCLE.rim),
  );
  await expectStaged(workbench, 5);
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 10_000 })
    .toBe("collecting");
  expect(await command(page), "Circle stays armed").toBe("circle");
  await expect(circleButton).toHaveAttribute("aria-pressed", "true", {
    timeout: 10_000,
  });
  await leaveTool(page);
  await expect(circleButton).toHaveAttribute("aria-pressed", "false", {
    timeout: 10_000,
  });
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 2 });

  // No size driver exists before the user adds one (no dimension, drawn or
  // not; no requirement in the Constraints list).
  const drawn = await sketchSnapshot(page);
  expect(drawn.dimensions, "no unsolicited dimension").toEqual([]);
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("[data-sketch-constraint-row]")).toHaveCount(0, {
    timeout: 10_000,
  });
  const circle = drawn.entities[4]!;
  const drawnRadius = circle.radius!;

  // Step 3: the circle's diameter with the Dimension tool: glide to the
  // rim, place the label, type, Enter: one action.
  await workbench.activateTool(DIMENSION_TOOL);
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  await glideClick(workbench, CIRCLE.rim);
  await glideClick(workbench, DIAMETER_LABEL);
  await expect(floatingInput(page)).toContainText("Diameter", {
    timeout: 15_000,
  });
  const value = floatingInput(page).locator("input").first();
  expect(
    Number(await value.inputValue()),
    "the input opens with the measured diameter",
  ).toBeCloseTo(2 * drawnRadius, 4);
  await value.fill(String(FIRST_DIAMETER));
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    page.keyboard.press("Enter"),
  );
  await expect(floatingInput(page)).toBeHidden({ timeout: 10_000 });
  // T17h fix: the commit disarms the Dimension tool and the toolbar shows
  // it (Select), instead of keeping Distance pressed.
  await expectSelect(page, workbench, DIMENSION_TOOL);
  let dimensioned = await sketchSnapshot(page);
  expect(dimensioned.dimensions?.map((dimension) => dimension.kind)).toEqual([
    "diameter",
  ]);
  expect(dimensioned.entities[4]!.radius).toBeCloseTo(FIRST_DIAMETER / 2, 6);

  // Step 4: Horizontal on the sloped top side (placement inferred none,
  // so the Constraints list gains exactly one Horizontal row).
  await expect(constraintRows(page, "Horizontal")).toHaveCount(0, {
    timeout: 10_000,
  });
  await workbench.activateTool(HORIZONTAL_TOOL);
  await waitForCommittedAction(page, "Horizontal", () =>
    glideClick(workbench, {
      x: (OUTLINE[0]!.x + OUTLINE[1]!.x) / 2,
      y: (OUTLINE[0]!.y + OUTLINE[1]!.y) / 2,
    }),
  );
  await expect(constraintRows(page, "Horizontal")).toHaveCount(1, {
    timeout: 10_000,
  });
  await expectSelect(page, workbench, HORIZONTAL_TOOL);
  dimensioned = await sketchSnapshot(page);
  const [topStart, topEnd] = sides[0]!.pointIds!;
  expect(
    pointOf(dimensioned, topStart!)[1],
    "the top side is horizontal",
  ).toBeCloseTo(pointOf(dimensioned, topEnd!)[1], 9);

  // Step 5: a gliding drag of the free corner is one "Move Sketch
  // Geometry"; Ctrl+Z restores the sketch exactly; Ctrl+Shift+Z re-applies.
  const freeCorner = sides[2]!.pointIds![0]!;
  const beforeDrag = await sketchSnapshot(page);
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, OUTLINE[2]!, DRAG_TO),
  );
  const dragged = await sketchSnapshot(page);
  expect(pointOf(dragged, freeCorner), "the dragged corner moved").not.toEqual(
    pointOf(beforeDrag, freeCorner),
  );
  expect(pointOf(dragged, topStart!)[1], "the requirement holds").toBeCloseTo(
    pointOf(dragged, topEnd!)[1],
    9,
  );
  expect(dragged.entities[4]!.radius).toBeCloseTo(FIRST_DIAMETER / 2, 6);
  await waitForUndoneAction(page, "Move Sketch Geometry", () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(() => sketchSnapshot(page), {
      message: "Undo restores the sketch exactly",
      timeout: 10_000,
    })
    .toEqual(beforeDrag);
  await waitForRedoneAction(page, "Move Sketch Geometry", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect
    .poll(() => sketchSnapshot(page), {
      message: "Redo re-applies the drag exactly",
      timeout: 10_000,
    })
    .toEqual(dragged);
  const outlineArea = polygonArea(
    dragged,
    sides.map((side) => side.pointIds![0]!),
  );

  // Step 6: Finish.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);

  // Step 7: Extrude, the outline-minus-circle region picked in the
  // viewport. Its id is read from the hover inside the frame (between the
  // top and right sides' midpoints, clear of the circle).
  await workbench.activateFeature("extrude");
  await expect
    .poll(() => regionTargets(page), { timeout: 30_000 })
    .toHaveLength(2);
  const sketchId = (await regionTargets(page))[0]!.split(".")[0]!;
  const projected = (entityId: string) =>
    page.evaluate(
      (id) => window.__cadProjectToScreen?.(id) ?? null,
      `${sketchId}.${entityId}`,
    );
  const top = (await projected(sides[0]!.id))!;
  const right = (await projected(sides[1]!.id))!;
  const insideFrame = { x: (top.x + right.x) / 2, y: (top.y + right.y) / 2 };
  const surface = (await workbench.viewportSurface().boundingBox())!;
  await page.mouse.move(surface.x + insideFrame.x, surface.y + insideFrame.y, {
    steps: 8,
  });
  let frameRegion = "";
  await expect
    .poll(
      async () => {
        frameRegion = await workbench.currentHoverTarget();
        return frameRegion;
      },
      { message: "the frame region is under the pointer", timeout: 10_000 },
    )
    .toMatch(/^sketch_.+\.region_[0-9a-f]{32}$/);
  await selectRegionInViewport(workbench, frameRegion, { from: insideFrame });
  await workbench.expectFeaturePreviewReady("extrude");
  const depth = Number(
    await page.getByRole("spinbutton", { name: "Depth" }).inputValue(),
  );
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);

  // Step 8: the Measure tool's Volume: outline minus the circle, × depth.
  const firstVolume = await measuredVolume(page, workbench);
  const firstRadius = FIRST_DIAMETER / 2;
  const exactFirst = depth * (outlineArea - Math.PI * firstRadius ** 2);
  expect(firstVolume).toBeGreaterThanOrEqual(exactFirst - READOUT_ROUNDING);
  expect(firstVolume).toBeLessThanOrEqual(
    exactFirst + depth * holeMeshShortfall(firstRadius) + READOUT_ROUNDING,
  );
  await page.keyboard.press("Escape");

  // Step 9: Save As (download) → Open a copy: a new history context.
  const saved = await saveDocumentCopy<Record<string, unknown>>(page);
  await openDocumentCopy(page, saved, "mechanical-part.cadara");
  await expect
    .poll(() => currentRevision(page), { timeout: 30_000 })
    .not.toBe("loading");
  await expect
    .poll(() => readHistoryStrip(page), {
      message: "the opened copy starts a new history: the Undo strip is empty",
      timeout: 15_000,
    })
    .toEqual({ undo: [], redo: [] });
  const openedRevision = await currentRevision(page);
  await page.keyboard.press("Control+z");
  await workbench.expectBodyCountAtLeast(1);
  expect(
    await currentRevision(page),
    "Ctrl+Z has nothing to undo in the opened copy",
  ).toBe(openedRevision);
  expect(
    await measuredVolume(page, workbench),
    "the reopened body is rebuilt with the same volume",
  ).toBe(firstVolume);
  await page.keyboard.press("Escape");

  // Step 10: re-enter the sketch (gliding double-click on its timeline
  // entry) and change the diameter through its chip: glide, double-click,
  // type, Enter: one action.
  const savedSketch = (
    saved as { sketches: { label: string; definition: unknown }[] }
  ).sketches[0]!;
  const savedDiameter = (
    savedSketch.definition as {
      dimensions: { kind: string; value: { value: number } }[];
    }
  ).dimensions;
  expect(
    savedDiameter.map((dimension) => [dimension.kind, dimension.value.value]),
    "the saved file has the diameter the user typed",
  ).toEqual([["diameter", FIRST_DIAMETER]]);
  await glideDoubleClick(
    page,
    page.getByRole("button", {
      name: `Select ${savedSketch.label}. Double-click to reopen.`,
    }),
  );
  await workbench.expectSketchSessionActive();
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 2 });
  // The reopened authored intent: the requirement and the one diameter.
  await expect(constraintRows(page, "Horizontal")).toHaveCount(1, {
    timeout: 10_000,
  });
  expect(
    (await sketchSnapshot(page)).dimensions?.map((dimension) => dimension.kind),
  ).toEqual(["diameter"]);
  await glideDoubleClick(page, diameterChip(page));
  await expect(floatingInput(page)).toBeVisible({ timeout: 15_000 });
  const edit = floatingInput(page).locator("input").first();
  expect(Number(await edit.inputValue()), "the chip edits the diameter").toBe(
    FIRST_DIAMETER,
  );
  await edit.fill(String(SECOND_DIAMETER));
  await waitForCommittedAction(page, "Commit Annotation Value", () =>
    page.keyboard.press("Enter"),
  );
  await expect(floatingInput(page)).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(async () => (await sketchSnapshot(page)).entities[4]!.radius, {
      timeout: 15_000,
    })
    .toBeCloseTo(SECOND_DIAMETER / 2, 6);
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 2 });

  // Step 11: Finish; the extrude rebuilds on the same region (no
  // reselection asked) and its volume changes by the hole's area change.
  const beforeFinish = await currentRevision(page);
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await expect
    .poll(() => currentRevision(page), { timeout: 30_000 })
    .not.toBe(beforeFinish);
  await workbench.expectBodyCountAtLeast(1);
  const secondRadius = SECOND_DIAMETER / 2;
  const exactDelta = depth * Math.PI * (secondRadius ** 2 - firstRadius ** 2);
  let secondVolume = Number.NaN;
  await expect
    .poll(
      async () => {
        secondVolume = await measuredVolume(page, workbench);
        return secondVolume;
      },
      { message: "the rebuilt body's volume", timeout: 30_000 },
    )
    .not.toBe(firstVolume);
  // Rebuilt in place: no "Repair Extrude 1" asks for a new profile.
  await expect(
    page.getByRole("treeitem", { name: /^Repair Extrude 1/ }),
  ).toHaveCount(0);
  const exactSecond = depth * (outlineArea - Math.PI * secondRadius ** 2);
  expect(secondVolume).toBeGreaterThanOrEqual(exactSecond - READOUT_ROUNDING);
  expect(secondVolume).toBeLessThanOrEqual(
    exactSecond + depth * holeMeshShortfall(secondRadius) + READOUT_ROUNDING,
  );
  expect(
    Math.abs(firstVolume - secondVolume - exactDelta),
    "the volume changes by the hole's area change × depth",
  ).toBeLessThanOrEqual(
    depth *
      Math.max(
        holeMeshShortfall(firstRadius),
        holeMeshShortfall(secondRadius),
      ) +
      2 * READOUT_ROUNDING,
  );
}

/** Rectangle corners (canvas). */
export const RECTANGLE = [
  { x: 800, y: 520 },
  { x: 1120, y: 760 },
] as const;

/**
 * Draws one rectangle with the Rectangle tool (it stays armed), then one
 * Escape to Select. Returns the drawn snapshot.
 */
export async function drawRectangle(workbench: FeatureWorkbenchHarness) {
  const page = workbench.page;
  await workbench.activateTool(RECTANGLE_TOOL);
  await glidePress(
    page,
    page.locator('[role="menuitem"][data-tool-id="rectangle"]'),
  );
  await glideClick(workbench, RECTANGLE[0]);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, RECTANGLE[1]),
  );
  await expectStaged(workbench, 4);
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 10_000 })
    .toBe("collecting");
  expect(await command(page), "Rectangle stays armed").toBe("rectangle");
  await leaveTool(page);
  return sketchSnapshot(page);
}

export const extent = (snap: MirrorSketchSnapshot, axis: 0 | 1) => {
  const values = snap.points.map((point) => point.position[axis]);
  return Math.max(...values) - Math.min(...values);
};

/** Finish, then Extrude its one region picked in the viewport; the depth. */
export async function finishAndExtrudeOneRegion(
  workbench: FeatureWorkbenchHarness,
) {
  const page = workbench.page;
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  await expect
    .poll(() => regionTargets(page), { timeout: 30_000 })
    .toHaveLength(1);
  await selectRegionInViewport(workbench, (await regionTargets(page))[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  const depth = Number(
    await page.getByRole("spinbutton", { name: "Depth" }).inputValue(),
  );
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);
  return depth;
}
