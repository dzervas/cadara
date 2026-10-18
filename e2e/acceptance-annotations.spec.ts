import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  glideDrag,
  readHistoryStrip,
  settledProjections,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
  panToViewportCentre,
  type CanvasPoint,
} from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { DIMENSION_TOOL, leaveArmedDimension } from "./helpers/mechanical-part";
import {
  entityTarget,
  expectStaged,
  glideClick,
  glidePress,
  hoverUntil,
  openTopSketch,
  placeFreely,
} from "./helpers/mirror-workbench";
import {
  findHandleNear,
  mixedSnapshot,
  positionOf,
  projectedSketchMap,
  type MixedSketchSnapshot,
  type Vec,
} from "./helpers/mixed-topology";

test.use({ viewport: { width: 1440, height: 960 } });
// Overlays and the history strip follow the pointer and the solve a few
// frames late, more so under the full lane's load: web-first assertions
// wait up to 10 s (the lane default is 1 s).
const expect = baseExpect.configure({ timeout: 10_000 });

// Lane: e2e (docs/testing.md). Seam: specification §3 "Selection, drawing,
// dragging, and annotations" (T17 E2E-3) through the real workbench only:
// dense constraints at a rectangle corner, the hover preview and the pinned
// controls of a selection, the `+N` wheel, a sibling, the two-stage clear,
// two dimension chips on one anchor (D8), a dimension label drag that keeps
// its sketch-space place through pan and zoom, Escape mid-drag, Undo/Redo,
// Trim right after a label move (D3), Shift during Line placement with
// focus loss and navigation (E12); and, in a sibling row, the drag matrix
// (point, body and tangent targets at 1× and ≈ 2×, blocked fixed and partly
// constrained targets, Escape mid-drag). Every pointer path glides (several
// `mouse.move` steps); waits are on committed history entries and session
// state. Debug reads (sketch snapshot, hover target, editor selection,
// `__cadProjectToScreen`) are assertions only. Step → row map and
// discrimination (mutants): T17j.md. T17j3: every row runs with the
// production document repository on (`openWithRepository`).

const RECTANGLE_TOOL = "Create rectangle geometry.";
const LINE_TOOL = "Create line geometry.";
const SPLINE_TOOL = "Create spline geometry.";
const POINT_TOOL = "Create a sketch point.";
const CIRCLE_TOOL = "Create circular geometry.";
const PERPENDICULAR_TOOL = "Constrain two lines to remain perpendicular.";
const EQUAL_TOOL = "Constrain two lines to equal length.";
const TRIM_TOOL = "Trim sketch segments.";
const FREE = "Free placement (inference off)";
const MOVE = "Move Sketch Geometry";
const MOVE_LABEL = "Move Dimension Label";
/** The live solve's residual bound used by E2E-2 (`acceptance-mixed-topology`). */
const SOLVE_RESIDUAL = 1e-6;

/**
 * A distance chip is drawn this far (screen px) from its anchor, the
 * midpoint of the dimension line (`createDimensionAnnotationAnchor` in
 * `annotations.ts`): the label's sketch-space point is under the chip
 * centre minus this offset.
 */
const CHIP_OFFSET = { x: 0, y: -18 };

const chips = (page: Page) =>
  page.locator('[data-sketch-annotation-kind="dimension"]');
const constraintGlyphs = (page: Page) =>
  page.locator('[data-sketch-annotation-kind="constraint"]');
const overflowChip = (page: Page) =>
  page.locator(
    "[data-sketch-annotation-layer] [data-sketch-annotation-overflow]",
  );
const wheel = (page: Page) => page.locator("[data-sketch-annotation-wheel]");
const spokes = (page: Page) =>
  page.locator('[data-sketch-annotation-wheel-slot="spoke"]');
const inLayer = (page: Page, name: string) =>
  page.locator(`[data-sketch-annotation-layer] [aria-label="${name}"]`);
const floatingInput = (page: Page) =>
  page.locator("[data-sketch-viewport-floating-input]");
const dragCue = (page: Page) =>
  page.locator('[data-testid="sketch-drag-feedback-cue"]');

async function canvasBox(page: Page) {
  return (await page.locator("main canvas").first().boundingBox())!;
}

/** A DOM element's centre in canvas coordinates. */
async function centreOf(page: Page, locator: Locator): Promise<CanvasPoint> {
  const canvas = await canvasBox(page);
  const box = (await locator.boundingBox())!;
  return {
    x: box.x + box.width / 2 - canvas.x,
    y: box.y + box.height / 2 - canvas.y,
  };
}

/** Leaves the armed tool: a chain's first Escape ends it, the second exits. */
async function leaveTool(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

type SketchMap = {
  toCanvas: (point: Vec) => CanvasPoint;
  toSketch: (point: CanvasPoint) => Vec;
  /** Canvas px per sketch unit. */
  scale: number;
};

/**
 * Sketch ↔ canvas under the current camera: the affine map through three
 * known points projected by `__cadProjectToScreen` (a debug read).
 */
async function currentMap(
  workbench: FeatureWorkbenchHarness,
  pointIds: readonly string[],
): Promise<SketchMap> {
  const snap = await mixedSnapshot(workbench.page);
  const toCanvas = await projectedSketchMap(
    workbench,
    "sketch_draft",
    pointIds.map((pointId) => ({
      pointId,
      position: positionOf(snap, pointId),
    })),
  );
  const o = toCanvas([0, 0]);
  const ex = toCanvas([1, 0]);
  const ey = toCanvas([0, 1]);
  const det = (ex.x - o.x) * (ey.y - o.y) - (ey.x - o.x) * (ex.y - o.y);
  return {
    toCanvas,
    toSketch: ({ x, y }) => [
      ((ey.y - o.y) * (x - o.x) - (ey.x - o.x) * (y - o.y)) / det,
      (-(ex.y - o.y) * (x - o.x) + (ex.x - o.x) * (y - o.y)) / det,
    ],
    scale: Math.hypot(ex.x - o.x, ex.y - o.y),
  };
}

const ends = (snap: MixedSketchSnapshot, entityId: string) => {
  const entity = snap.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`No entity ${entityId}.`);
  return entity.pointIds!.map((id) => positionOf(snap, id));
};

/** A canvas point at `t` along the line `entityId`. */
const alongLine = (
  map: SketchMap,
  snap: MixedSketchSnapshot,
  entityId: string,
  t = 0.5,
) => {
  const [a, b] = ends(snap, entityId).map(map.toCanvas);
  return { x: a!.x + (b!.x - a!.x) * t, y: a!.y + (b!.y - a!.y) * t };
};

/** The sketch point a distance chip labels (its dimension line midpoint). */
async function labelPoint(page: Page, chip: Locator, map: SketchMap) {
  const at = await centreOf(page, chip);
  return map.toSketch({ x: at.x - CHIP_OFFSET.x, y: at.y - CHIP_OFFSET.y });
}

/**
 * The chip labels the sketch point `label` under the current camera (the
 * map is re-read on every poll: the camera may still be settling), within
 * 1 px.
 */
async function expectChipLabels(
  workbench: FeatureWorkbenchHarness,
  mapPoints: readonly string[],
  chip: Locator,
  label: Vec,
  message: string,
) {
  await expect
    .poll(
      async () => {
        const map = await currentMap(workbench, mapPoints);
        const expected = map.toCanvas(label);
        const at = await centreOf(workbench.page, chip);
        return Math.hypot(
          at.x - CHIP_OFFSET.x - expected.x,
          at.y - CHIP_OFFSET.y - expected.y,
        );
      },
      { message, timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
  const map = await currentMap(workbench, mapPoints);
  const expected = map.toCanvas(label);
  const at = await centreOf(workbench.page, chip);
  record(
    `label-residual-px ${message}`,
    Math.hypot(
      at.x - CHIP_OFFSET.x - expected.x,
      at.y - CHIP_OFFSET.y - expected.y,
    ),
  );
}

/** A measured value, reported with the row (`--reporter=json`). */
const record = (type: string, value: unknown) =>
  test.info().annotations.push({ type, description: JSON.stringify(value) });

/** Gap between two boxes (negative: they overlap). */
function separation(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return Math.max(
    right.x - (left.x + left.width),
    left.x - (right.x + right.width),
    right.y - (left.y + left.height),
    left.y - (right.y + right.height),
  );
}

/**
 * An aligned Distance on the line under `pick`, its label placed at
 * `place`, committed with Enter (the measured value); returns its chip.
 */
async function addDistance(
  workbench: FeatureWorkbenchHarness,
  pick: CanvasPoint,
  place: CanvasPoint,
) {
  const page = workbench.page;
  const labels = () =>
    chips(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label")),
    );
  const before = await labels();
  await workbench.activateTool(DIMENSION_TOOL);
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  await glideClick(workbench, pick);
  await glideClick(workbench, place);
  await expect(floatingInput(page)).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    page.keyboard.press("Enter"),
  );
  await leaveArmedDimension(page, workbench);
  await expect(chips(page)).toHaveCount(before.length + 1);
  const added = (await labels()).find((label) => !before.includes(label));
  return chips(page).and(page.locator(`[aria-label="${added}"]`));
}

/** The live placement text at the pointer: the snap badge or the free label. */
function pointerText(page: Page) {
  return page.evaluate(() => {
    const snap = document.querySelector(
      '[data-sketch-viewport-overlay="snapIndicator"]',
    );
    if (snap) return snap.textContent;
    const free = [
      ...document.querySelectorAll(
        '[data-sketch-viewport-overlay="referenceLabel"]',
      ),
    ].find((element) => element.textContent?.startsWith("Free placement"));
    return free?.textContent ?? null;
  });
}

/**
 * Environment emulation of a hidden page: headless Chromium raises no
 * `blur` or `visibilitychange` when another tab comes to the front (probe
 * in T17j-evidence), so the page's own events are dispatched, as for the
 * T13h blur row.
 */
async function emulateVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((next) => {
    if (next === "hidden")
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
    else
      delete (document as unknown as { visibilityState?: string })
        .visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("§3 E2E-3: dense constraints at a rectangle corner; hover preview, pinned controls, `+N` wheel, spoke and sibling, two-stage clear; two chips on one anchor keep the 6 px gap; a label drag is one action and keeps its sketch-space place through pan and zoom; Escape mid-drag adds nothing; Undo/Redo; Trim right after a label move; Shift during Line placement survives navigation and is reset by blur and a hidden page", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.expectWorkspaceInRepository();
  await openTopSketch(workbench);
  const canvas = await canvasBox(page);

  // Step 1: a rectangle and three lines from its bottom-left corner C,
  // each starting on C (the point is shared).
  await workbench.activateTool(RECTANGLE_TOOL);
  await glidePress(
    page,
    page.locator('[role="menuitem"][data-tool-id="rectangle"]'),
  );
  await glideClick(workbench, { x: 620, y: 580 });
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 980, y: 330 }),
  );
  await page.keyboard.press("Escape");
  let snap = await mixedSnapshot(page);
  const corner = (name: string) =>
    snap.points.find((point) => point.id.includes(`rect-${name}`))!.id;
  const side = (name: string) =>
    snap.entities.find((entity) => entity.id.includes(`rect-${name}`))!.id;
  const corners = [
    corner("bottom-left"),
    corner("bottom-right"),
    corner("top-left"),
  ];
  const C = corners[0]!;
  const topRight = corner("top-right");
  const bottom = side("bottom");
  const left = side("left");
  let map = await currentMap(workbench, corners);
  for (const end of [
    { x: 560, y: 700 },
    { x: 500, y: 640 },
    { x: 530, y: 520 },
  ]) {
    await workbench.activateTool(LINE_TOOL);
    await glideClick(workbench, map.toCanvas(positionOf(snap, C)));
    await waitForCommittedAction(page, "Create Sketch Geometry", () =>
      glideClick(workbench, end),
    );
    await leaveTool(page);
  }
  await expectStaged(workbench, 7);
  snap = await mixedSnapshot(page);
  const [l1, l2, l3] = snap.entities.slice(4).map((entity) => entity.id) as [
    string,
    string,
    string,
  ];
  for (const id of [l1, l2, l3])
    expect(
      snap.entities.find((entity) => entity.id === id)!.pointIds![0],
      "each line starts on the corner",
    ).toBe(C);
  // Dense requirements at C: L1 ⟂ bottom, L1 ⟂ L2, L1 = L2, L1 = L3 and
  // bottom = left (the corner's sides), each one action by the tool's name.
  const constrain = async (
    tool: string,
    a: string,
    b: string,
    label: string,
  ) => {
    const current = await mixedSnapshot(page);
    await workbench.activateTool(tool);
    await glideClick(workbench, alongLine(map, current, a));
    await waitForCommittedAction(page, label, () =>
      glideClick(workbench, alongLine(map, current, b)),
    );
    await leaveTool(page);
  };
  await constrain(PERPENDICULAR_TOOL, l1, bottom, "Perpendicular");
  await constrain(PERPENDICULAR_TOOL, l1, l2, "Perpendicular");
  await constrain(EQUAL_TOOL, l1, l2, "Equal");
  await constrain(EQUAL_TOOL, l1, l3, "Equal");
  await constrain(EQUAL_TOOL, bottom, left, "Equal");
  await expect(
    page.locator("[data-sketch-constraint-row]"),
    "4 rectangle rows + the 5 added requirements",
  ).toHaveCount(9);
  await expect(
    page.locator(
      "[data-sketch-constraint-row][data-sketch-constraint-problem]",
    ),
    "none is a problem",
  ).toHaveCount(0);
  // A free line (Shift-placed) through the rectangle, for Trim (step 11).
  await workbench.activateTool(LINE_TOOL);
  await placeFreely(workbench, [
    { x: 560, y: 420 },
    { x: 1040, y: 450 },
  ]);
  await expectStaged(workbench, 8);
  const l4 = (await mixedSnapshot(page)).entities[7]!.id;

  // Step 2 (D8): two distances whose labels are placed on one anchor (the
  // bottom side's, below it at the height of L1's midpoint, and L1's, to
  // its right at the same point): the chips keep the 6 px layout gap.
  snap = await mixedSnapshot(page);
  map = await currentMap(workbench, corners);
  const bottomMid = alongLine(map, snap, bottom);
  const l1Mid = alongLine(map, snap, l1);
  const sharedAnchor = { x: bottomMid.x, y: l1Mid.y };
  const bottomChip = await addDistance(workbench, bottomMid, sharedAnchor);
  const l1Chip = await addDistance(workbench, l1Mid, sharedAnchor);
  const [first, second] = [
    (await bottomChip.boundingBox())!,
    (await l1Chip.boundingBox())!,
  ];
  // Premise: the two labels' anchors coincide (placed at one point), so
  // the layout had to move one chip off it; it took the first ring step to
  // the right or left (same row). If a geometry change ever leaves the
  // anchors apart the layout may pick another ring direction: that fails
  // here, not as a misleading gap.
  record("d8-layout", {
    bottom: first,
    l1: second,
    direction:
      first!.x < second!.x ? "l1 right of bottom" : "l1 left of bottom",
  });
  expect(
    Math.abs(first!.y - second!.y),
    "premise: the two anchors coincide and the layout moved one chip sideways (same row)",
  ).toBeLessThanOrEqual(1);
  record("d8-separation-px", separation(first!, second!));
  expect(
    separation(first!, second!),
    "the chips keep the 6 px layout gap (D8)",
  ).toBeGreaterThanOrEqual(6);

  // Step 3: hovering L1 (nothing selected) previews its requirements:
  // passive glyphs (no controls), the canvas owns the pointer under them.
  // Premise, waited on as state (no click): the Distance commit left no
  // selection, whichever element took its placement press (T17j3 F-1, fixed:
  // the preview's dimension-line handle used to leave L1 selected, its
  // glyphs pinned controls), and with the pointer on blank canvas no
  // constraint glyph is drawn, so every glyph read below is the hover's.
  await page.mouse.move(canvas.x + 1050, canvas.y + 720, { steps: 6 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toBe("Nothing selected");
  await expect(
    constraintGlyphs(page),
    "premise: no glyph is drawn with nothing selected or hovered",
  ).toHaveCount(0);
  snap = await mixedSnapshot(page);
  const l1At = alongLine(map, snap, l1, 0.6);
  await page.mouse.move(canvas.x + l1At.x, canvas.y + l1At.y, { steps: 8 });
  await expect
    .poll(() => workbench.currentHoverTarget(), { timeout: 10_000 })
    .toMatch(entityTarget(l1));
  await expect(constraintGlyphs(page).first()).toBeAttached({
    timeout: 10_000,
  });
  const previews = await constraintGlyphs(page).evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        visibility: element.getAttribute("data-sketch-annotation-visibility"),
        interactive: element.getAttribute("data-sketch-annotation-interactive"),
        tag: element.tagName,
        under: document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        )?.tagName,
      };
    }),
  );
  expect(previews.length, "L1's requirements are previewed").toBeGreaterThan(0);
  for (const preview of previews)
    expect(preview, "a passive preview glyph over the canvas").toEqual({
      visibility: "preview",
      interactive: "false",
      tag: "DIV",
      under: "CANVAS",
    });
  expect(await workbench.currentEditorSelection()).toBe("Nothing selected");

  // Step 4: selecting L1 pins its requirements as controls; the corner
  // cluster is dense at L1's size (2 + `+1`).
  await glideClick(workbench, l1At);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(entityTarget(l1));
  await expect(overflowChip(page)).toHaveAccessibleName("1 more constraint", {
    timeout: 10_000,
  });
  const pinned = await constraintGlyphs(page).evaluateAll((elements) =>
    elements.map((element) => [
      element.getAttribute("data-sketch-annotation-visibility"),
      element.getAttribute("data-sketch-annotation-interactive"),
      element.tagName,
    ]),
  );
  expect(pinned.length).toBeGreaterThan(0);
  for (const glyph of pinned)
    expect(glyph, "a pinned control").toEqual(["pinned", "true", "BUTTON"]);

  // Step 5: `+1` opens the wheel with the corner cluster's three members;
  // a spoke is selected (it moves to the centre), then a sibling.
  await glideClick(workbench, await centreOf(page, overflowChip(page)));
  await expect(wheel(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(spokes(page)).toHaveCount(3);
  await expect(overflowChip(page), "the `+N` gave way").toHaveCount(0);
  const spokeNames = await spokes(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label")!),
  );
  const [firstSpoke, siblingSpoke] = [
    inLayer(page, spokeNames[0]!),
    inLayer(page, spokeNames[1]!),
  ];
  await glideClick(workbench, await centreOf(page, firstSpoke));
  await expect(firstSpoke).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "centre",
    { timeout: 10_000 },
  );
  await expect(firstSpoke).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(/\.constraint_/);
  const firstSelection = await workbench.currentEditorSelection();
  await glideClick(workbench, await centreOf(page, siblingSpoke));
  await expect(siblingSpoke).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "centre",
    { timeout: 10_000 },
  );
  await expect(siblingSpoke).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
  await expect(
    firstSpoke,
    "the previous centre is back on the wheel",
  ).toHaveAttribute("data-sketch-annotation-wheel-slot", "spoke");
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toMatch(/\.constraint_/);
  expect(await workbench.currentEditorSelection()).not.toBe(firstSelection);

  // Step 6: the first blank clears the active spoke and the wheel and
  // keeps L1's context (pinned controls, the sibling marked last); the
  // second blank clears the context.
  const BLANK = { x: 1050, y: 720 };
  await glideClick(workbench, BLANK);
  await expect(wheel(page)).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toBe("Nothing selected");
  await expect(inLayer(page, spokeNames[1]!)).toHaveAttribute(
    "data-sketch-annotation-selection",
    "last",
  );
  await expect(overflowChip(page)).toHaveCount(1);
  const kept = await constraintGlyphs(page).evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-sketch-annotation-interactive"),
    ),
  );
  expect(kept.length, "the context's controls stay").toBeGreaterThan(0);
  expect(kept.every((interactive) => interactive === "true")).toBe(true);
  await glideClick(workbench, BLANK);
  await expect(
    constraintGlyphs(page),
    "the second blank clears the context",
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(overflowChip(page)).toHaveCount(0);

  // Step 7: a gliding drag of the bottom distance's chip, grabbed off its
  // centre, is one "Move Dimension Label". The chip moves by the pointer's
  // displacement and keeps the grab offset (issue 10's approved delta drag,
  // T17j F-1): no jump when the drag passes its 6 px threshold, mid-drag or
  // at release. Geometry never moves.
  map = await currentMap(workbench, corners);
  const label0 = await labelPoint(page, bottomChip, map);
  const geometry = await mixedSnapshot(page);
  const chip0 = await centreOf(page, bottomChip);
  const grab = { x: Math.round(chip0.x + 9), y: Math.round(chip0.y + 6) };
  const chipShift = async (pointer: CanvasPoint) => {
    const at = await centreOf(page, bottomChip);
    return Math.hypot(
      at.x - chip0.x - (pointer.x - grab.x),
      at.y - chip0.y - (pointer.y - grab.y),
    );
  };
  const box = await canvasBox(page);
  await waitForCommittedAction(page, MOVE_LABEL, async () => {
    await page.mouse.move(box.x + grab.x, box.y + grab.y, { steps: 8 });
    await page.mouse.down();
    for (const dy of [8, 40, 70]) {
      const pointer = { x: grab.x, y: grab.y + dy };
      await page.mouse.move(box.x + pointer.x, box.y + pointer.y, {
        steps: 6,
      });
      await expect
        .poll(() => chipShift(pointer), {
          message: `the chip follows the pointer ${dy} px into the drag (no jump)`,
        })
        .toBeLessThanOrEqual(1);
      record(`label-drag-offset-px ${dy}`, await chipShift(pointer));
    }
    await page.mouse.up();
  });
  const release = { x: grab.x, y: grab.y + 70 };
  await expect
    .poll(() => chipShift(release), {
      message: "after release the chip stays where the pointer left it",
    })
    .toBeLessThanOrEqual(1);
  const label1 = await labelPoint(page, bottomChip, map);
  const releasedAt = map.toSketch(release);
  const pressedAt = map.toSketch(grab);
  expect(
    Math.hypot(
      label1[0] - label0[0] - (releasedAt[0] - pressedAt[0]),
      label1[1] - label0[1] - (releasedAt[1] - pressedAt[1]),
    ) * map.scale,
    "the label moved by the pointer's sketch displacement",
  ).toBeLessThanOrEqual(1);
  expect(
    (await mixedSnapshot(page)).points,
    "a label drag never moves geometry",
  ).toEqual(geometry.points);

  // Step 8: a middle-button pan and a wheel zoom: the chip still labels
  // the same sketch point (within 1 px), the camera did change.
  await page.mouse.move(canvas.x + 1050, canvas.y + 420, { steps: 6 });
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(canvas.x + 910, canvas.y + 340, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  const settle = () =>
    settledProjections(
      workbench,
      corners.map((id) => `sketch_draft.${id}`),
    );
  await settle();
  await expectChipLabels(workbench, corners, bottomChip, label1, "after a pan");
  const panned = await currentMap(workbench, corners);
  expect(
    Math.hypot(
      panned.toCanvas(label1).x - map.toCanvas(label1).x,
      panned.toCanvas(label1).y - map.toCanvas(label1).y,
    ),
    "premise: the pan moved the sketch on screen",
  ).toBeGreaterThan(100);
  await page.mouse.move(canvas.x + 760, canvas.y + 420, { steps: 6 });
  for (let notch = 0; notch < 4; notch += 1) await page.mouse.wheel(0, -100);
  await settle();
  await expectChipLabels(
    workbench,
    corners,
    bottomChip,
    label1,
    "after a zoom",
  );
  map = await currentMap(workbench, corners);
  expect(
    map.scale / panned.scale,
    "premise: the wheel zoomed in",
  ).toBeGreaterThan(1.2);

  // Step 9: Undo puts the label back, Redo moves it again (one step each).
  await waitForUndoneAction(page, MOVE_LABEL, () =>
    page.keyboard.press("Control+z"),
  );
  await expectChipLabels(workbench, corners, bottomChip, label0, "Undo");
  await waitForRedoneAction(page, MOVE_LABEL, () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expectChipLabels(workbench, corners, bottomChip, label1, "Redo");

  // Step 10: Escape mid-drag puts the chip back and records nothing.
  const strip = await readHistoryStrip(page);
  const beforeCancel = await mixedSnapshot(page);
  const held = await centreOf(page, bottomChip);
  await glideDrag(
    workbench,
    held,
    { x: held.x, y: held.y + 50 },
    { steps: 10, release: false },
  );
  expect(
    (await centreOf(page, bottomChip)).y - held.y,
    "premise: the chip follows the drag",
  ).toBeGreaterThan(20);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectChipLabels(
    workbench,
    corners,
    bottomChip,
    label1,
    "Escape mid-drag puts the label back",
  );
  expect(await readHistoryStrip(page), "no history entry").toEqual(strip);
  expect(await mixedSnapshot(page)).toEqual(beforeCancel);

  // Step 11 (D3): move the label once more, then Trim the free line at
  // once: one "Trim" (the label move keeps the solve). Trim removes the
  // piece between the two cuts (the rectangle's sides).
  const grabAgain = await centreOf(page, bottomChip);
  await waitForCommittedAction(page, MOVE_LABEL, () =>
    glideDrag(workbench, grabAgain, {
      x: grabAgain.x,
      y: grabAgain.y - 30,
    }),
  );
  snap = await mixedSnapshot(page);
  map = await currentMap(workbench, corners);
  await workbench.activateTool(TRIM_TOOL);
  const inside = await hoverUntil(
    workbench,
    alongLine(map, snap, l4, 0.5),
    entityTarget(l4),
  );
  await waitForCommittedAction(page, "Trim", () =>
    glideClick(workbench, inside),
  );
  await expect(page.getByText(/needs a solved sketch/)).toHaveCount(0);
  const trimmed = await mixedSnapshot(page);
  expect(
    trimmed.entities,
    "the free line is cut into its two outer pieces",
  ).toHaveLength(9);
  const [, l4End] = ends(trimmed, l4);
  const [pieceStart] = ends(trimmed, trimmed.entities[8]!.id);
  // The cut ends are tied to the sides and solved (E2E-2's solve residual).
  expect(
    Math.abs(l4End![0] - ends(trimmed, left)[0]![0]),
    "its first piece ends on the left side",
  ).toBeLessThanOrEqual(SOLVE_RESIDUAL);
  expect(
    Math.abs(pieceStart![0] - ends(trimmed, side("right"))[0]![0]),
    "its second piece starts on the right side",
  ).toBeLessThanOrEqual(SOLVE_RESIDUAL);
  await leaveTool(page);

  // Step 12 (E12): Shift during Line placement, near the top-right corner
  // (an end snap). Shift frees the placement and its release restores it;
  // a window blur and a hidden page (environment emulation) reset it; a
  // middle-button pan with Shift held keeps it (the pan moves the corner
  // with the pointer), and a pan without Shift does not suppress.
  map = await currentMap(workbench, corners);
  const nearCorner = map.toCanvas(positionOf(trimmed, topRight));
  nearCorner.x += 4;
  nearCorner.y += 3;
  await workbench.activateTool(LINE_TOOL);
  await page.mouse.move(canvas.x + nearCorner.x, canvas.y + nearCorner.y, {
    steps: 8,
  });
  await expect
    .poll(() => pointerText(page), {
      message: "premise: the corner's end snap",
      timeout: 10_000,
    })
    .toMatch(/^Joins Rectangle 1 top right/);
  const snapped = await pointerText(page);
  const expectText = (text: string | null, message: string) =>
    expect.poll(() => pointerText(page), { message }).toBe(text);
  await page.keyboard.down("Shift");
  await expectText(FREE, "Shift frees the placement");
  await page.keyboard.up("Shift");
  await expectText(snapped, "release restores it");
  await page.keyboard.down("Shift");
  await expectText(FREE, "Shift again");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expectText(snapped, "a window blur resets the held Shift");
  await page.keyboard.up("Shift");
  await page.keyboard.down("Shift");
  await expectText(FREE, "Shift again");
  await emulateVisibility(page, "hidden");
  await expectText(snapped, "a hidden page resets the held Shift");
  await emulateVisibility(page, "visible");
  await expectText(snapped, "showing the page again does not re-hold it");
  await page.keyboard.up("Shift");
  const staged = await workbench.currentSketchSession();
  const phase = await workbench.currentPhase();
  const history = await readHistoryStrip(page);
  // A middle-button pan without Shift (grabbed at the pointer, so the
  // corner stays under it) does not free the placement.
  const beforePan = await currentMap(workbench, corners);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    canvas.x + nearCorner.x - 120,
    canvas.y + nearCorner.y + 80,
    { steps: 12 },
  );
  await page.mouse.up({ button: "middle" });
  await settle();
  const afterPan = await currentMap(workbench, corners);
  expect(
    afterPan.toCanvas([0, 0]).x - beforePan.toCanvas([0, 0]).x,
    "premise: the middle button panned",
  ).toBeLessThan(-100);
  await expectText(snapped, "a pan without Shift does not free the placement");
  // With Shift held, the middle button still navigates (OrbitControls'
  // Shift swap turns the pan into an orbit, T13h) and the placement stays
  // free during and after it; releasing Shift ends the suppression.
  await page.keyboard.down("Shift");
  await expectText(FREE, "Shift before the navigation");
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    canvas.x + nearCorner.x - 200,
    canvas.y + nearCorner.y + 140,
    { steps: 12 },
  );
  await expectText(FREE, "the navigation keeps the held Shift");
  await page.mouse.up({ button: "middle" });
  await expectText(FREE, "still free after the navigation");
  await settle();
  const afterOrbit = await currentMap(workbench, corners);
  const moved = (point: Vec) =>
    Math.hypot(
      afterOrbit.toCanvas(point).x - afterPan.toCanvas(point).x,
      afterOrbit.toCanvas(point).y - afterPan.toCanvas(point).y,
    );
  expect(
    Math.max(moved([0, 0]), moved([5, 0]), moved([0, 5])),
    "the Shift + middle-button drag moved the camera",
  ).toBeGreaterThan(20);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => pointerText(page), { message: "release ends the suppression" })
    .not.toBe(FREE);
  expect(await workbench.currentSketchSession(), "nothing placed").toBe(staged);
  expect(await workbench.currentPhase()).toBe(phase);
  expect(await readHistoryStrip(page)).toEqual(history);
  // Shift held while placing: the line starts free beside the corner.
  map = await currentMap(workbench, corners);
  const freeStart = map.toCanvas(positionOf(trimmed, topRight));
  freeStart.x += 4;
  freeStart.y += 3;
  await page.keyboard.down("Shift");
  await glideClick(workbench, freeStart);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: freeStart.x + 60, y: freeStart.y - 70 }),
  );
  await page.keyboard.up("Shift");
  const placed = await mixedSnapshot(page);
  const added = placed.entities.at(-1)!;
  expect(
    added.pointIds![0],
    "Shift placed a new point, not the corner",
  ).not.toBe(topRight);
  expect(
    positionOf(placed, added.pointIds![0]!),
    "and not on the corner",
  ).not.toEqual(positionOf(placed, topRight));
});

/** The pointer displacement `from` → `to` in sketch units under `map`. */
const sketchDelta = (map: SketchMap, from: CanvasPoint, to: CanvasPoint) => {
  const [x0, y0] = map.toSketch(from);
  const [x1, y1] = map.toSketch(to);
  return [x1 - x0, y1 - y0] as const;
};
const minus = (left: Vec, right: Vec) =>
  [left[0] - right[0], left[1] - right[1]] as const;
const rounded = (point: CanvasPoint) => ({
  x: Math.round(point.x),
  y: Math.round(point.y),
});

test("§3 E2E-3 drag matrix: point, body and tangent-handle drags keep the grab offset and give the same world displacement at 1× and ≈ 2×; a fixed point and a dimensioned rim show the constrained cue and stay byte-equal; Escape mid-drag adds nothing", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.expectWorkspaceInRepository();
  await openTopSketch(workbench);

  // A connected two-line chain (P0 → P1 → P2), a 3-point spline, a point
  // with Fix, a circle with a diameter. Positions infer nothing.
  await workbench.activateTool(LINE_TOOL);
  await glideClick(workbench, { x: 540, y: 360 });
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 640, y: 410 }),
  );
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 590, y: 500 }),
  );
  await leaveTool(page);
  await workbench.activateTool(SPLINE_TOOL);
  await glideClick(workbench, { x: 770, y: 330 });
  await glideClick(workbench, { x: 830, y: 395 });
  await glideClick(workbench, { x: 895, y: 345 });
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    page.keyboard.press("Enter"),
  );
  await leaveTool(page);
  await workbench.activateTool(POINT_TOOL);
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 560, y: 600 }),
  );
  await leaveTool(page);
  await workbench.activateTool(CIRCLE_TOOL);
  await glideClick(workbench, { x: 860, y: 585 });
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 915, y: 585 }),
  );
  await leaveTool(page);
  await expectStaged(workbench, 5);
  let snap = await mixedSnapshot(page);
  const [lineA, , spline, point, circle] = snap.entities as [
    MixedSketchSnapshot["entities"][number],
    MixedSketchSnapshot["entities"][number],
    MixedSketchSnapshot["entities"][number],
    MixedSketchSnapshot["entities"][number],
    MixedSketchSnapshot["entities"][number],
  ];
  const [P0, P1] = lineA.pointIds! as [string, string];
  expect(snap.entities[1]!.pointIds![0], "premise: P1 is shared").toBe(P1);
  const P2 = snap.entities[1]!.pointIds![1]!;
  const centre = circle.pointIds![0]!;
  const mapPoints = [P0, P1, P2];
  let map = await currentMap(workbench, mapPoints);
  // The Point tool's point: the sketch point placed at (560, 600).
  const placedAt = map.toSketch({ x: 560, y: 600 });
  const fixedPoint = snap.points.reduce((best, candidate) =>
    Math.hypot(...minus(candidate.position, placedAt)) <
    Math.hypot(...minus(best.position, placedAt))
      ? candidate
      : best,
  ).id;
  expect(point.kind, "premise: a point entity").toBe("point");
  await workbench.activateTool(
    "Fix selected geometry at its current placement.",
  );
  await waitForCommittedAction(page, "Fix Geometry", () =>
    glideClick(workbench, map.toCanvas(positionOf(snap, fixedPoint))),
  );
  await leaveTool(page);
  const rim = () =>
    ({
      x: map.toCanvas(positionOf(snap, centre)).x + circle.radius! * map.scale,
      y: map.toCanvas(positionOf(snap, centre)).y,
    }) satisfies CanvasPoint;
  await addDistance(workbench, rim(), { x: rim().x + 45, y: rim().y - 65 });
  snap = await mixedSnapshot(page);
  expect(snap.dimensions?.map((dimension) => dimension.kind)).toEqual([
    "diameter",
  ]);

  /** One committed drag `from` → `to`; Undo restores the snapshot exactly. */
  const committedDrag = async (from: CanvasPoint, to: CanvasPoint) => {
    const before = await mixedSnapshot(page);
    await waitForCommittedAction(page, MOVE, () =>
      glideDrag(workbench, from, to, { steps: 12 }),
    );
    const after = await mixedSnapshot(page);
    await waitForUndoneAction(page, MOVE, () =>
      page.keyboard.press("Control+z"),
    );
    await expect
      .poll(() => mixedSnapshot(page), { message: "Undo restores it exactly" })
      .toEqual(before);
    return { before, after };
  };

  /** A press on a blocked target: the cue shows; nothing changes. */
  const blockedDrag = async (from: CanvasPoint, label: string) => {
    const before = JSON.stringify(await mixedSnapshot(page));
    const strip = await readHistoryStrip(page);
    await glideDrag(
      workbench,
      from,
      { x: from.x - 60, y: from.y + 40 },
      { steps: 12, release: false },
    );
    await expect(
      dragCue(page),
      `${label}: the constrained cue`,
    ).not.toHaveCount(0, { timeout: 10_000 });
    await page.mouse.up();
    await expect(dragCue(page), `${label}: the cue ends`).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(
      JSON.stringify(await mixedSnapshot(page)),
      `${label}: byte-equal after release`,
    ).toBe(before);
    expect(await readHistoryStrip(page), `${label}: no history`).toEqual(strip);
    // Read both again a little later: no late commit follows the release.
    await workbench.waitForAnimationFrames(10);
    expect(
      JSON.stringify(await mixedSnapshot(page)),
      `${label}: still byte-equal`,
    ).toBe(before);
    expect(await readHistoryStrip(page), `${label}: still no history`).toEqual(
      strip,
    );
  };

  type Measured = { point: Vec; body: Vec; handle: Vec; handleScale: number };
  /**
   * The three free targets at the current zoom, each pressed off its point
   * (grab offset) and moved by `pixels` (1×) or by the pixels that give
   * `world` (the 1× displacements) here.
   */
  const measure = async (world?: Measured): Promise<Measured> => {
    snap = await mixedSnapshot(page);
    map = await currentMap(workbench, mapPoints);
    const toward = (from: CanvasPoint, fallback: CanvasPoint, w?: Vec) => {
      if (!w) return { x: from.x + fallback.x, y: from.y + fallback.y };
      const at = map.toSketch(from);
      return rounded(map.toCanvas([at[0] + w[0], at[1] + w[1]]));
    };
    // Point: the shared chain point P1, pressed 3 px right, 2 px up of it.
    const p1 = map.toCanvas(positionOf(snap, P1));
    const pointFrom = rounded({ x: p1.x + 3, y: p1.y - 2 });
    const pointTo = toward(pointFrom, { x: 37, y: 23 }, world?.point);
    const pointDrag = await committedDrag(pointFrom, pointTo);
    const pointMoved = minus(
      positionOf(pointDrag.after, P1),
      positionOf(pointDrag.before, P1),
    );
    const pointWanted = sketchDelta(map, pointFrom, pointTo);
    record(
      `point-error-px scale ${map.scale.toFixed(3)}`,
      Math.hypot(...minus(pointMoved, pointWanted)) * map.scale,
    );
    expect(
      Math.hypot(...minus(pointMoved, pointWanted)) * map.scale,
      "the point moves by the pointer's displacement (the grab offset is kept)",
    ).toBeLessThanOrEqual(0.01);
    expect(
      positionOf(pointDrag.after, P0),
      "the connected chain keeps its other ends",
    ).toEqual(positionOf(pointDrag.before, P0));
    // Body: line A at 40 % of its length.
    const bodyFrom = rounded(
      await hoverUntil(
        workbench,
        rounded(alongLine(map, snap, lineA.id, 0.4)),
        entityTarget(lineA.id),
      ),
    );
    const bodyTo = toward(bodyFrom, { x: -27, y: 19 }, world?.body);
    const bodyDrag = await committedDrag(bodyFrom, bodyTo);
    const bodyWanted = sketchDelta(map, bodyFrom, bodyTo);
    for (const id of [P0, P1])
      expect(
        Math.hypot(
          ...minus(
            minus(
              positionOf(bodyDrag.after, id),
              positionOf(bodyDrag.before, id),
            ),
            bodyWanted,
          ),
        ) * map.scale,
        "both ends follow the body by the pointer's displacement",
      ).toBeLessThanOrEqual(0.01);
    // Tangent handle at the spline's middle fit point.
    const fit = spline.occurrences!.map((occurrence) => occurrence.pointId);
    const occId = spline.occurrences![1]!.occId;
    await glideClick(
      workbench,
      await hoverUntil(
        workbench,
        map.toCanvas([
          (positionOf(snap, fit[0]!)[0] + positionOf(snap, fit[1]!)[0]) / 2,
          (positionOf(snap, fit[0]!)[1] + positionOf(snap, fit[1]!)[1]) / 2,
        ]),
        entityTarget(spline.id),
        30,
      ),
    );
    await expect
      .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
      .toMatch(/spline/);
    const handle = await findHandleNear(
      workbench,
      map.toCanvas(positionOf(snap, fit[1]!)),
      (label) => label.endsWith(occId),
    );
    const handleTo = toward(handle.at, { x: 25, y: 18 }, world?.handle);
    const handleDrag = await committedDrag(handle.at, handleTo);
    const occurrence = (s: MixedSketchSnapshot) =>
      s.entities
        .find((entity) => entity.id === spline.id)!
        .occurrences!.find((candidate) => candidate.occId === occId)!;
    const vectorMoved = minus(
      occurrence(handleDrag.after).tangent.vector!,
      occurrence(handleDrag.before).visibleVector!,
    );
    const handleWanted = sketchDelta(map, handle.at, handleTo);
    expect(
      Math.hypot(...minus(vectorMoved, handleWanted)) * map.scale,
      "the handle tip follows the pointer 1:1, in direction and size (the grab offset is kept)",
    ).toBeLessThanOrEqual(0.01);
    await page.keyboard.press("Escape");
    return {
      point: pointMoved,
      body: bodyWanted,
      handle: handleWanted,
      handleScale: Math.hypot(...vectorMoved) / Math.hypot(...handleWanted),
    };
  };

  // 1×.
  const splineEnd = spline.occurrences!.at(-1)!.pointId;
  const atOne = await measure();
  const [zoomA, zoomB] = await settledProjections(workbench, [
    `sketch_draft.${P0}`,
    `sketch_draft.${centre}`,
  ]);
  const zoomBase = Math.hypot(zoomA!.x - zoomB!.x, zoomA!.y - zoomB!.y);
  const oneScale = map.scale;
  await blockedDrag(
    map.toCanvas(positionOf(snap, fixedPoint)),
    "fixed point at 1×",
  );
  await blockedDrag(rim(), "dimensioned rim at 1×");

  // A partly constrained target that can move (issue 05): a Horizontal
  // line with a Fixed start. Its free end, dragged off the line, slides to
  // the nearest allowed position: the pointer's target projected onto the
  // horizontal through the start (minimum motion); the start stays.
  await workbench.activateTool(LINE_TOOL);
  await placeFreely(workbench, [
    { x: 650, y: 650 },
    { x: 780, y: 672 },
  ]);
  await expectStaged(workbench, 6);
  snap = await mixedSnapshot(page);
  const slider = snap.entities.at(-1)!;
  const [sliderStart, sliderEnd] = slider.pointIds! as [string, string];
  await workbench.activateTool(
    "Constrain a line parallel to the sketch horizontal axis.",
  );
  await waitForCommittedAction(page, "Horizontal", () =>
    glideClick(workbench, alongLine(map, snap, slider.id, 0.5)),
  );
  await leaveTool(page);
  snap = await mixedSnapshot(page);
  await workbench.activateTool(
    "Fix selected geometry at its current placement.",
  );
  await waitForCommittedAction(page, "Fix Geometry", () =>
    glideClick(workbench, map.toCanvas(positionOf(snap, sliderStart))),
  );
  await leaveTool(page);
  snap = await mixedSnapshot(page);
  const startBefore = positionOf(snap, sliderStart);
  const endBefore = positionOf(snap, sliderEnd);
  expect(endBefore[1], "premise: horizontal").toBeCloseTo(startBefore[1], 9);
  const slideFrom = rounded({
    x: map.toCanvas(endBefore).x + 3,
    y: map.toCanvas(endBefore).y - 2,
  });
  const slideTo = { x: slideFrom.x + 40, y: slideFrom.y - 50 };
  await waitForCommittedAction(page, MOVE, () =>
    glideDrag(workbench, slideFrom, slideTo, { steps: 12 }),
  );
  snap = await mixedSnapshot(page);
  const wanted = sketchDelta(map, slideFrom, slideTo);
  const slid = positionOf(snap, sliderEnd);
  record("slide", { startBefore, endBefore, slid, wanted });
  // The re-solve may move the Fixed start by its convergence residual.
  expect(
    Math.hypot(...minus(positionOf(snap, sliderStart), startBefore)),
    "the Fixed start does not move",
  ).toBeLessThanOrEqual(SOLVE_RESIDUAL);
  expect(
    Math.abs(slid[1] - startBefore[1]) * map.scale,
    "the end stays on the horizontal through the start",
  ).toBeLessThanOrEqual(0.01);
  expect(
    Math.abs(slid[0] - (endBefore[0] + wanted[0])) * map.scale,
    "the end slid to the nearest allowed position (the target's x)",
  ).toBeLessThanOrEqual(0.01);

  // ≈ 2×: zoomed in about the sketch, the same world displacements.
  // ≈ 2×: the sketch panned to the viewport centre, then one small wheel
  // notch at a time at the centre (the controls zoom about it) until 2×.
  const anchor = await panToViewportCentre(
    workbench,
    [P0, splineEnd, fixedPoint, centre].map((id) => `sketch_draft.${id}`),
  );
  const surface = (await workbench.viewportSurface().boundingBox())!;
  await page.mouse.move(surface.x + anchor.x, surface.y + anchor.y, {
    steps: 6,
  });
  for (let notch = 0; notch < 40; notch += 1) {
    const [a, b] = await settledProjections(workbench, [
      `sketch_draft.${P0}`,
      `sketch_draft.${centre}`,
    ]);
    if (Math.hypot(a!.x - b!.x, a!.y - b!.y) >= 2 * zoomBase) break;
    await page.mouse.wheel(0, -40);
  }
  const atTwo = await measure(atOne);
  record("matrix", { atOne, atTwo, oneScale, twoScale: map.scale });
  expect(map.scale / oneScale, "premise: ≈ 2× zoom").toBeGreaterThanOrEqual(2);
  expect(map.scale / oneScale, "premise: ≈ 2× zoom").toBeLessThan(2.3);
  // Integer pointer positions quantize the 2× displacement by ≤ ½ px.
  const quantum = 0.5 / map.scale;
  for (const key of ["point", "body", "handle"] as const)
    for (const axis of [0, 1] as const)
      expect(
        Math.abs(atTwo[key][axis] - atOne[key][axis]),
        `${key}: the same world displacement at both zooms`,
      ).toBeLessThanOrEqual(quantum * Math.SQRT2);
  for (const measured of [atOne, atTwo])
    expect(
      measured.handleScale,
      "the handle follows the pointer 1:1 at both zooms",
    ).toBeCloseTo(1, 6);
  await blockedDrag(
    map.toCanvas(positionOf(snap, fixedPoint)),
    "fixed point at 2×",
  );
  await blockedDrag(rim(), "dimensioned rim at 2×");

  // Escape mid-drag: the point goes back, nothing is recorded.
  const before = JSON.stringify(await mixedSnapshot(page));
  const strip = await readHistoryStrip(page);
  const p1 = rounded(map.toCanvas(positionOf(snap, P1)));
  await glideDrag(
    workbench,
    p1,
    { x: p1.x + 80, y: p1.y + 50 },
    { steps: 12, release: false },
  );
  expect(
    JSON.stringify(await mixedSnapshot(page)),
    "premise: the drag moves it",
  ).not.toBe(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(async () => JSON.stringify(await mixedSnapshot(page)), {
      message: "Escape mid-drag restores the accepted state",
    })
    .toBe(before);
  expect(await readHistoryStrip(page), "no history entry").toEqual(strip);
});

test("§3 E2E-3 tool switch: switching tools during an unfinished Circle or Rectangle draft discards only its preview; no history entry; committed geometry intact", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.expectWorkspaceInRepository();
  await openTopSketch(workbench);
  // Committed geometry: one line.
  await workbench.activateTool(LINE_TOOL);
  await glideClick(workbench, { x: 520, y: 380 });
  await waitForCommittedAction(page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 640, y: 330 }),
  );
  await leaveTool(page);
  await expectStaged(workbench, 1);
  await expect
    .poll(async () => (await mixedSnapshot(page)).liveRegions?.status, {
      message: "premise: the live regions settled",
    })
    .toBe("current");
  const committed = JSON.stringify(await mixedSnapshot(page));
  const draftMeasure = page.locator(
    '[data-sketch-viewport-overlay="measurement"]',
  );
  const history = await readHistoryStrip(page);
  const command = () =>
    page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? "");
  const box = await canvasBox(page);
  /** Glides onto a toolbar control and presses it (a tool switch). */
  const switchTo = async (tool: string) =>
    glidePress(page, workbench.toolbarButton(tool));

  const drafts = [
    {
      name: "Circle",
      arm: () => workbench.activateTool(CIRCLE_TOOL),
      first: { x: 860, y: 560 },
      pointer: { x: 930, y: 600 },
      switchTo: LINE_TOOL,
      armed: "line",
    },
    {
      name: "Rectangle",
      arm: async () => {
        await workbench.activateTool(RECTANGLE_TOOL);
        await glidePress(
          page,
          page.locator('[role="menuitem"][data-tool-id="rectangle"]'),
        );
      },
      first: { x: 560, y: 560 },
      pointer: { x: 700, y: 650 },
      switchTo: CIRCLE_TOOL,
      armed: "circle",
    },
  ];
  for (const draft of drafts) {
    await draft.arm();
    await glideClick(workbench, draft.first);
    await page.mouse.move(box.x + draft.pointer.x, box.y + draft.pointer.y, {
      steps: 10,
    });
    // Premise: the draft is under way (its preview measures it at the
    // pointer) and nothing is committed yet.
    await expect(
      draftMeasure,
      `premise: ${draft.name}'s draft preview follows the pointer`,
    ).not.toHaveCount(0);
    record(`${draft.name} draft preview`, await draftMeasure.allTextContents());
    expect(JSON.stringify(await mixedSnapshot(page))).toBe(committed);
    expect(await readHistoryStrip(page)).toEqual(history);
    await switchTo(draft.switchTo);
    await expect
      .poll(command, { message: `${draft.name}: the new tool is armed` })
      .toBe(draft.armed);
    await expect(
      draftMeasure,
      `${draft.name}: its preview is gone`,
    ).toHaveCount(0);
    await expect
      .poll(async () => JSON.stringify(await mixedSnapshot(page)), {
        message: `${draft.name}: the committed geometry is intact, nothing added`,
      })
      .toBe(committed);
    await workbench.waitForAnimationFrames(10);
    expect(JSON.stringify(await mixedSnapshot(page))).toBe(committed);
    expect(
      await readHistoryStrip(page),
      `${draft.name}: no history entry`,
    ).toEqual(history);
    await leaveTool(page);
  }
});
