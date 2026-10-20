import { sketchDiagnosticMessage } from "./helpers/sketch-workbench";
import { expect, test, type Page } from "@playwright/test";

import type { SketchDefinition } from "../src/contracts/sketch/schema";
import {
  glideDoubleClick,
  glideDrag,
  readHistoryStrip,
  selectRegionInViewport,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
  type CanvasPoint,
} from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { DIMENSION_TOOL, floatingInput } from "./helpers/mechanical-part";
import {
  entityTarget,
  glideClick,
  glidePress,
  hoverUntil,
  openTopSketch,
} from "./helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: specification §5 "State, history, and
// persistence" (T17 E2E-5) through the real workbench only: every kind of
// authored sketch action (create, drag, dimension, construction, style,
// label move, delete) committed by pointer and keyboard, each undone and
// redone by the keyboard against the session's authored definition; a
// cancelled draft; Finish, re-entry and the retained private history; the
// document-level Undo/Redo of the publication; and (rows 2–3) what only the
// workbench shows of an invalid sketch: the status line, problem count,
// feature-tree repair entry, Offset panel and no internal id on the page.
// Their model semantics (retained requirements, validity, the waiting
// extrude, re-entry and Save As / Open) are proven in the semantic session:
// src/application/semantic/sketch-invalid-{merge,deletion}.spec.ts. Every
// pointer path glides (several `mouse.move` steps); waits are on committed
// history entries (sequence-based, T17-17), machine state and revisions,
// never a frame count. Debug reads (the session's authored definition, the
// selectable regions) are assertions only. Step → row map and discrimination (mutants): T17k.md.

const LINE_TOOL = "Create line geometry.";
const CIRCLE_TOOL = "Create circular geometry.";
const CONSTRUCTION_TOOL =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";
const SVG_RENDERING_TOOL =
  "Toggle authored SVG fill and stroke rendering for the active sketch.";
const STROKE_TOOL = "Set active sketch stroke styling.";
const FINISH_TOOL = "Exit the active sketch.";

/**
 * The live session's authored definition as the owner holds it (record
 * arrays and `*Ids` in their order), JSON-cloned: an absent key and an
 * `undefined` one are the same authored data (T17f, `withoutUndefined`).
 */
async function definition(page: Page): Promise<SketchDefinition> {
  const read = await page.evaluate(() => {
    const value = window.__cadaraDebug?.getSketchSnapshot()?.definition;
    return value === undefined ? null : JSON.stringify(value);
  });
  if (read === null) throw new Error("No live sketch definition.");
  return JSON.parse(read) as SketchDefinition;
}

const command = (page: Page) =>
  page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? "");

/** Shift-placed (no inferred requirement) gliding clicks. */
async function shiftClick(workbench: FeatureWorkbenchHarness, at: CanvasPoint) {
  await workbench.page.keyboard.down("Shift");
  await glideClick(workbench, at);
  await workbench.page.keyboard.up("Shift");
}

/** Escape until Select (no tool armed, no draft). */
async function toSelect(page: Page) {
  for (let press = 0; press < 3 && (await command(page)) !== "sketch"; press++)
    await page.keyboard.press("Escape");
  await expect.poll(() => command(page), { timeout: 10_000 }).toBe("sketch");
}

/**
 * One completed authored action: `act` commits exactly one `label`; Ctrl+Z
 * restores the pre-action definition exactly (every record array and its
 * order: the B6 check, within the private draft); Ctrl+Shift+Z re-applies
 * it exactly. Returns the definition after the action.
 */
async function oneUndoableAction(
  page: Page,
  label: string,
  act: () => Promise<unknown>,
) {
  const before = await definition(page);
  await waitForCommittedAction(page, label, act);
  let after = before;
  await expect
    .poll(
      async () => {
        after = await definition(page);
        return JSON.stringify(after) !== JSON.stringify(before);
      },
      { message: `"${label}" changed the authored definition` },
    )
    .toBe(true);
  await waitForUndoneAction(page, label, () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(() => definition(page), {
      message: `Undo "${label}" restores the pre-action definition exactly`,
      timeout: 10_000,
    })
    .toEqual(before);
  await waitForRedoneAction(page, label, () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect
    .poll(() => definition(page), {
      message: `Redo "${label}" re-applies it exactly`,
      timeout: 10_000,
    })
    .toEqual(after);
  return { before, after };
}

/** The ids of a definition's ordered collections. */
const orders = (sketch: SketchDefinition) => ({
  pointIds: sketch.pointIds,
  entityIds: sketch.entityIds,
  constraintIds: sketch.constraintIds,
  dimensionIds: sketch.dimensionIds,
  styleIds: sketch.styleIds ?? [],
});

/**
 * A definition as a set of records: the draft's sketch id written as
 * `sketchId` and every record array (and `*Ids`) sorted by id. Entity order
 * is not durable through Finish with the repository (T17f A-6, recorded in
 * T17k.md), so comparisons across Finish are order-free.
 */
function asRecordSet(sketch: SketchDefinition, sketchId: string) {
  const byId = <T>(records: readonly T[], key: keyof T) =>
    [...records].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  const named = JSON.parse(
    JSON.stringify(sketch).replaceAll(`"${sketchId}"`, '"sketch_draft"'),
  ) as SketchDefinition;
  return {
    ...named,
    pointIds: [...named.pointIds].sort(),
    points: byId(named.points, "pointId"),
    entityIds: [...named.entityIds].sort(),
    entities: byId(named.entities, "entityId"),
    constraintIds: [...named.constraintIds].sort(),
    constraints: byId(named.constraints, "constraintId"),
    dimensionIds: [...named.dimensionIds].sort(),
    dimensions: byId(named.dimensions, "dimensionId"),
  };
}

// Viewport 1440×960, top plane: sketch origin at canvas (720, 480), Y up.
// Every placement is Shift-placed: no inferred requirement.
const LINE_1 = [
  { x: 500, y: 300 },
  { x: 640, y: 360 },
] as const;
const CIRCLE = { centre: { x: 820, y: 420 }, rim: { x: 870, y: 420 } };
const LINE_3 = [
  { x: 560, y: 620 },
  { x: 900, y: 660 },
] as const;
/** Line 1's end is dragged here. */
const DRAG_TO = { x: 680, y: 330 };
const DIAMETER_LABEL = { x: 930, y: 360 };
const DIAMETER = 2.5;
/** A circle draft that is cancelled. */
const DRAFT = { centre: { x: 1100, y: 250 }, pointer: { x: 1160, y: 280 } };

test("§5 E2E-5 history: create, drag, dimension, construction, style, label move and delete are each one action whose Undo restores the pre-action definition exactly (record order included) and whose Redo re-applies it; a cancelled circle draft adds nothing; Finish → re-entry keeps the private history and its Undo continues; outside the sketch Undo of Publish Sketch removes the sketch and Redo restores it", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  const empty = await definition(page);
  expect(orders(empty), "premise: an empty draft").toEqual({
    pointIds: [],
    entityIds: [],
    constraintIds: [],
    dimensionIds: [],
    styleIds: [],
  });

  // Step 1, create: a Line (two Shift-placed clicks) is one "Create Sketch
  // Geometry"; its Undo leaves the empty draft.
  await workbench.activateTool(LINE_TOOL);
  await shiftClick(workbench, LINE_1[0]);
  const created = await oneUndoableAction(page, "Create Sketch Geometry", () =>
    shiftClick(workbench, LINE_1[1]),
  );
  expect(created.before).toEqual(empty);
  expect(created.after.entities.map((entity) => entity.kind)).toEqual([
    "lineSegment",
  ]);
  await toSelect(page);
  const [line1] = created.after.entityIds;

  // More geometry (not checked step by step): a circle and a second line,
  // so the deleted circle later sits in the middle of every collection.
  await workbench.activateTool(CIRCLE_TOOL);
  await shiftClick(workbench, CIRCLE.centre);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    shiftClick(workbench, CIRCLE.rim),
  );
  await toSelect(page);
  await workbench.activateTool(LINE_TOOL);
  await shiftClick(workbench, LINE_3[0]);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    shiftClick(workbench, LINE_3[1]),
  );
  await toSelect(page);
  const drawn = await definition(page);
  expect(drawn.entities.map((entity) => entity.kind)).toEqual([
    "lineSegment",
    "circle",
    "lineSegment",
  ]);
  const [, circleId, line3] = drawn.entityIds;

  // Step 2, drag: Line 1's free end, glided, is one "Move Sketch Geometry".
  const dragged = await oneUndoableAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, LINE_1[1], DRAG_TO),
  );
  expect(
    dragged.after.points.filter(
      (point, index) =>
        JSON.stringify(point) !== JSON.stringify(dragged.before.points[index]),
    ),
    "only the dragged end moved",
  ).toHaveLength(1);

  // Step 3, dimension: the circle's diameter with the Dimension tool (rim,
  // label spot, type, Enter) is one "Commit Constraint Value".
  await workbench.activateTool(DIMENSION_TOOL);
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  await glideClick(workbench, CIRCLE.rim);
  const dimensioned = await oneUndoableAction(
    page,
    "Commit Constraint Value",
    async () => {
      await glideClick(workbench, DIAMETER_LABEL);
      await expect(floatingInput(page)).toContainText("Diameter", {
        timeout: 15_000,
      });
      await floatingInput(page).locator("input").first().fill(String(DIAMETER));
      await page.keyboard.press("Enter");
    },
  );
  expect(dimensioned.after.dimensions.map((entry) => entry.kind)).toEqual([
    "diameter",
  ]);
  await toSelect(page);

  // Step 4, construction: the Construction tool on Line 3 is one
  // "Construction".
  await workbench.activateTool(CONSTRUCTION_TOOL);
  const constructed = await oneUndoableAction(page, "Construction", () =>
    glideClick(workbench, {
      x: (LINE_3[0].x + LINE_3[1].x) / 2,
      y: (LINE_3[0].y + LINE_3[1].y) / 2,
    }),
  );
  expect(
    constructed.after.entities.find((entity) => entity.entityId === line3)
      ?.isConstruction,
  ).toBe(true);
  await toSelect(page);

  // Step 5, style: the sketch's SVG rendering switched on ("SVG
  // Rendering"), then Line 1's stroke enabled in the Stroke panel
  // ("Stroke"; T17k2: was the generated "Patch Sketch Style"): one action
  // each.
  await oneUndoableAction(page, "SVG Rendering", () =>
    workbench.activateTool(SVG_RENDERING_TOOL),
  );
  const line1Middle = {
    x: (LINE_1[0].x + DRAG_TO.x) / 2,
    y: (LINE_1[0].y + DRAG_TO.y) / 2,
  };
  await glideClick(workbench, line1Middle);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain(line1!);
  await workbench.activateTool(STROKE_TOOL);
  const styled = await oneUndoableAction(page, "Stroke", () =>
    glidePress(page, page.getByText("Stroke Enabled", { exact: true })),
  );
  expect(
    styled.after.entities.find((entity) => entity.entityId === line1)?.style,
  ).toEqual({ strokeEnabled: true });
  await toSelect(page);

  // Step 6, label move: the diameter chip dragged (gliding) is one "Move
  // Dimension Label".
  const chip = page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label^="Diameter"]',
  );
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  const chipBox = (await chip.boundingBox())!;
  const canvas = (await workbench.viewport().boundingBox())!;
  const grab = {
    x: chipBox.x + chipBox.width / 2 - canvas.x,
    y: chipBox.y + chipBox.height / 2 - canvas.y,
  };
  const moved = await oneUndoableAction(page, "Move Dimension Label", () =>
    glideDrag(workbench, grab, { x: grab.x + 40, y: grab.y + 70 }),
  );
  expect(moved.after.points, "a label move moves no geometry").toEqual(
    moved.before.points,
  );

  // Step 7, cancel: a circle draft (its preview following the pointer)
  // cancelled by Escape adds no action and changes nothing; Circle stays
  // armed.
  const history = await readHistoryStrip(page);
  const beforeDraft = await definition(page);
  const draftMeasure = page.locator(
    '[data-sketch-viewport-overlay="measurement"]',
  );
  await workbench.activateTool(CIRCLE_TOOL);
  await glideClick(workbench, DRAFT.centre);
  await page.mouse.move(
    canvas.x + DRAFT.pointer.x,
    canvas.y + DRAFT.pointer.y,
    { steps: 10 },
  );
  await expect(
    draftMeasure,
    "premise: the draft's preview follows the pointer",
  ).not.toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(draftMeasure, "the draft's preview is gone").toHaveCount(0, {
    timeout: 10_000,
  });
  expect(await command(page), "Circle stays armed").toBe("circle");
  await workbench.waitForAnimationFrames(10);
  expect(await definition(page), "nothing was added").toEqual(beforeDraft);
  expect(await readHistoryStrip(page), "no history entry").toEqual(history);
  await toSelect(page);

  // Step 8, delete: the circle (the middle entity; its centre is the
  // middle point; its diameter goes with it) is one "Delete Sketch Item";
  // Undo puts every record back in its place (B6).
  await glideClick(workbench, { x: CIRCLE.centre.x, y: CIRCLE.centre.y + 50 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain(circleId!);
  const deleted = await oneUndoableAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Delete"),
  );
  expect(orders(deleted.before).entityIds).toEqual([line1, circleId, line3]);
  expect(orders(deleted.after).entityIds).toEqual([line1, line3]);
  expect(deleted.after.dimensions).toEqual([]);
  const beforeFinish = await readHistoryStrip(page);

  // Step 9: Finish publishes one document action; re-entry shows the
  // retained private history and its Undo continues: the circle comes
  // back (the same records; order-free across Finish, A-6), Redo removes
  // it again.
  await workbench.activateTool(FINISH_TOOL);
  await workbench.expectMachine("idle", 60_000);
  await expect
    .poll(async () => (await readHistoryStrip(page)).undo[0]?.label, {
      timeout: 30_000,
    })
    .toBe("Publish Sketch");
  const published = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(published).toHaveCount(1, { timeout: 30_000 });
  const sketchId = (await published.getAttribute("data-history-sketch-id"))!;
  expect(sketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);
  await glideDoubleClick(page, published);
  await workbench.expectSketchSessionActive();
  await expect
    .poll(() => readHistoryStrip(page), {
      message: "re-entry shows the retained private history",
      timeout: 15_000,
    })
    .toEqual(beforeFinish);
  const reentered = await definition(page);
  expect(asRecordSet(reentered, sketchId)).toEqual(
    asRecordSet(deleted.after, "sketch_draft"),
  );
  test.info().annotations.push({
    type: "A-6 (recorded, not asserted)",
    description: `record order across Finish: before ${JSON.stringify(orders(deleted.after))}; re-entered ${JSON.stringify(orders(reentered))}`,
  });
  await waitForUndoneAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(async () => asRecordSet(await definition(page), sketchId), {
      message: "the retained Undo brings the circle and its diameter back",
      timeout: 10_000,
    })
    .toEqual(asRecordSet(deleted.before, "sketch_draft"));
  await waitForRedoneAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect
    .poll(async () => asRecordSet(await definition(page), sketchId), {
      timeout: 10_000,
    })
    .toEqual(asRecordSet(deleted.after, "sketch_draft"));
  await workbench.activateTool(FINISH_TOOL);
  await workbench.expectMachine("idle", 60_000);

  // Step 10: outside the sketch, Undo "Publish Sketch" removes the sketch;
  // Redo restores it with the same identity.
  await waitForUndoneAction(page, "Publish Sketch", () =>
    page.keyboard.press("Control+z"),
  );
  await expect(published, "the sketch is gone").toHaveCount(0, {
    timeout: 30_000,
  });
  await waitForRedoneAction(page, "Publish Sketch", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect(published, "the sketch is back").toHaveCount(1, {
    timeout: 30_000,
  });
  expect(await published.getAttribute("data-history-sketch-id")).toBe(sketchId);
});

/** Canvas point of a live sketch point (re-entry frames the sketch anew). */
async function pointOnCanvas(
  workbench: FeatureWorkbenchHarness,
  pointId: string,
) {
  const page = workbench.page;
  const sketch = await definition(page);
  const sketchId = sketch.points[0]!.target.sketchId;
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const canvas = (await workbench.viewport().boundingBox())!;
  const at = await page.evaluate(
    (id) => window.__cadProjectToScreen?.(id) ?? null,
    `${sketchId}.${pointId}`,
  );
  if (!at) throw new Error(`${pointId} has no projected screen point.`);
  return { x: at.x + surface.x - canvas.x, y: at.y + surface.y - canvas.y };
}

const regionTargets = (page: Page) =>
  page.evaluate(
    () =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
        ) ?? [],
  );

/** No internal id in the page's text or accessible labels (T17e). */
async function expectNoInternalIds(page: Page, when: string) {
  const text = await page.evaluate(() => {
    const labels = Array.from(
      document.querySelectorAll("[aria-label]"),
      (element) => element.getAttribute("aria-label") ?? "",
    );
    return [document.body.innerText, ...labels].join("\n");
  });
  expect(text, `${when}: no internal id`).not.toMatch(
    /sketch_|derivation_|constraint_|dimension_/,
  );
}

async function reenter(workbench: FeatureWorkbenchHarness) {
  await glideDoubleClick(
    workbench.page,
    workbench.page.getByRole("button", {
      name: "Select Sketch Draft. Double-click to reopen.",
    }),
  );
  await workbench.expectSketchSessionActive();
}

async function finish(workbench: FeatureWorkbenchHarness) {
  await workbench.activateTool(FINISH_TOOL);
  await workbench.expectMachine("idle", 60_000);
}

const RECTANGLE_TOOL = "Create rectangle geometry.";
const MERGE_TOOL =
  "Merge two sketch points: the first into the second (the destination).";
const FIX_TOOL = "Fix Geometry";
const RECTANGLE = [
  { x: 420, y: 300 },
  { x: 700, y: 520 },
] as const;
/** Two Shift-placed lines whose ends are 6 px apart: a real near gap. */
const GAP_LINES = [
  [
    { x: 1100, y: 300 },
    { x: 900, y: 360 },
  ],
  [
    { x: 894, y: 354 },
    { x: 1050, y: 600 },
  ],
] as const;
const CONFLICT =
  "Fix 4, Fix 5 conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.";
const EXTRUDE_WAITING =
  "Repair Extrude 1. Correct Sketch Draft; the profile will resolve again.";

test("§5 E2E-5 invalid by merge, workbench surface: after an endpoint merge retains two disagreeing Fix requirements, the conflict explanation outlives the tool, the Constraints list counts 2 problems, Finish shows a repair entry for the waiting extrude, and no internal id reaches the page", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await workbench.activateTool(RECTANGLE_TOOL);
  await glidePress(
    page,
    page.locator('[role="menuitem"][data-tool-id="rectangle"]'),
  );
  await glideClick(workbench, RECTANGLE[0]);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, RECTANGLE[1]),
  );
  await toSelect(page);
  for (const [start, end] of GAP_LINES) {
    await workbench.activateTool(LINE_TOOL);
    await shiftClick(workbench, start);
    await waitForCommittedAction(page, "Create Sketch Geometry", () =>
      shiftClick(workbench, end),
    );
    await toSelect(page);
  }
  const [, , , , gapA, gapB] = (await definition(page)).entities;
  const destination = (gapA as { endPointId: string }).endPointId;
  const source = (gapB as { startPointId: string }).startPointId;
  // Each gap end Fixed where it is.
  for (const at of [GAP_LINES[0][1], GAP_LINES[1][0]]) {
    await glidePress(
      page,
      page.getByRole("button", { name: FIX_TOOL, exact: true }),
    );
    await waitForCommittedAction(page, FIX_TOOL, () =>
      glideClick(workbench, at),
    );
    await toSelect(page);
  }

  // The rectangle extruded, its region picked in the viewport.
  await finish(workbench);
  await workbench.activateFeature("extrude");
  await expect
    .poll(() => regionTargets(page), { timeout: 30_000 })
    .toHaveLength(1);
  await selectRegionInViewport(workbench, (await regionTargets(page))[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature();
  await expect(
    page.getByRole("button", {
      name: "Select Extrude 1. Double-click to reopen.",
    }),
  ).toHaveCount(1, { timeout: 30_000 });

  // Re-enter; Merge Points (the source, then the destination).
  await reenter(workbench);
  await workbench.activateTool(MERGE_TOOL);
  await glideClick(workbench, await pointOnCanvas(workbench, source));
  await glideClick(workbench, await pointOnCanvas(workbench, destination));
  await expect(
    page
      .locator('[data-sketch-viewport-floating-input="merge-points-confirm"]')
      .getByRole("button", { name: "Merge" }),
  ).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(page, "Merge Points", () =>
    page.keyboard.press("Enter"),
  );
  await toSelect(page);
  // T17k2 (T17k F-1): leaving the tool keeps the invalid sketch's
  // explanation on the status line (base: Escape cleared it).
  await expect(
    sketchDiagnosticMessage(page).filter({ hasText: CONFLICT }),
    "the explanation outlives the tool",
  ).toHaveText(CONFLICT, { timeout: 15_000 });
  await expect(
    page.locator("[data-sketch-constraint-problem-count]"),
    "the Constraints list counts both conflicting requirements",
  ).toHaveAttribute("data-sketch-constraint-problem-count", "2", {
    timeout: 30_000,
  });
  await expectNoInternalIds(page, "merged");

  // Finish: the feature tree says how to repair the waiting extrude.
  await finish(workbench);
  await expect(
    page.getByRole("button", { name: EXTRUDE_WAITING }),
    "the extrude waits for its invalid sketch",
  ).toHaveCount(1, { timeout: 30_000 });
  await expectNoInternalIds(page, "finished");
});

const OFFSET_TOOL =
  "Offset a connected chain with a durable offset relationship.";
/** Two Shift-placed lines with a corner: the offset's seeds. */
const CHAIN = [
  { x: 560, y: 560 },
  { x: 840, y: 560 },
  { x: 840, y: 340 },
] as const;
const OFFSET_BROKEN =
  "Broken: an original was deleted or can't be offset. Undo, or remove the offset.";

test("§5 E2E-5 invalid by deletion, workbench surface: after an offset's seed is deleted, the Offset panel of an output says it is broken and how to recover, and no internal id reaches the page", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);
  await workbench.activateTool(LINE_TOOL);
  await shiftClick(workbench, CHAIN[0]);
  await shiftClick(workbench, CHAIN[1]);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    shiftClick(workbench, CHAIN[2]),
  );
  await toSelect(page);
  const [seed, corner] = (await definition(page)).entityIds;

  // The offset: both lines picked (gliding hover), distance 0.5 on the
  // outer side, Create: one "Commit Offset".
  await workbench.activateTool(OFFSET_TOOL);
  for (const [around, entityId] of [
    [{ x: 840, y: 450 }, corner],
    [{ x: 650, y: 560 }, seed],
  ] as const)
    await glideClick(
      workbench,
      await hoverUntil(workbench, around, entityTarget(entityId!)),
    );
  await page.getByRole("textbox", { name: "Distance" }).fill("0.5");
  const canvas = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(canvas.x + 880, canvas.y + 600, { steps: 8 });
  await expect(floatingInput(page)).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(
    page,
    "Commit Offset",
    () =>
      glidePress(
        page,
        floatingInput(page).getByRole("button", { name: "Create" }),
      ),
    { timeout: 60_000 },
  );
  await toSelect(page);

  // Delete the offset's horizontal seed: one "Delete Sketch Item".
  await glideClick(
    workbench,
    await hoverUntil(workbench, { x: 650, y: 560 }, entityTarget(seed!)),
  );
  await waitForCommittedAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Delete"),
  );

  await glidePress(
    page,
    page.getByRole("button", { name: "Select Line 1 offset." }),
  );
  await expect(
    page.getByRole("region", { name: "Offset" }),
    "the Offset panel says the offset is broken and how to recover",
  ).toContainText(OFFSET_BROKEN, { timeout: 15_000 });
  await expectNoInternalIds(page, "broken");
});
