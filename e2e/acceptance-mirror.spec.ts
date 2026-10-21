import { sketchDiagnosticMessage } from "./helpers/sketch-workbench";
import { expect, test, type Page } from "@playwright/test";

import {
  glideDoubleClick,
  glideDrag,
  readHistoryStrip,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
  type CanvasPoint,
} from "./helpers/acceptance";
import { openDocumentCopy, saveDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  DIMENSION_TOOL,
  constraintRows,
  floatingInput,
} from "./helpers/mechanical-part";
import {
  entityOf,
  entityTarget,
  expectStaged,
  glideClick,
  glidePress,
  hoverUntil,
  mirrorPanel,
  mirrorsOf,
  openSearchTool,
  openTopSketch,
  placeFreely,
  positionOf,
  reflectAbout,
  sketchSnapshot,
  type MirrorSketchSnapshot,
  type Vec,
} from "./helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: specification §4 "Reciprocal mirror and
// dependency repair" (T17 E2E-4) through the real workbench only: the
// drawing tools, the Sketch Mirror tool (viewport picks of seeds, a line
// axis and the datum axes, the confirm popup), the Dimension and Fix tools
// and their popups, gliding drags of seed geometry and of the mirror line,
// a dimension chip edit, the Mirror panel's Remove / Replace mirror line…,
// the authored history (Undo/Redo), Finish, the File menu's Save As / Open
// (real download and file chooser) and re-entry. Every pointer path glides
// (several `mouse.move` steps); waits are on committed history entries and
// session state, never a frame count. Debug reads (sketch snapshot, hover
// target, editor selection) are assertions only. The rules are pinned by
// the T15/T16 logic rows; step → row map and discrimination: T17j2.md.

// Viewport 1440×960, top plane: sketch origin at canvas (720, 480), Y up.
// Every placement uses Shift (no inferred requirement).
/** Mirror A's seed circle (about the sketch Y axis). */
const CIRCLE = { centre: { x: 520, y: 700 }, rim: { x: 570, y: 700 } };
/** 3-point arc clicks: start, through, end. */
const ARC = [
  { x: 330, y: 420 },
  { x: 380, y: 350 },
  { x: 430, y: 420 },
] as const;
const SPLINE = [
  { x: 520, y: 200 },
  { x: 580, y: 150 },
  { x: 640, y: 210 },
] as const;
/** Mirror B's line: sloped, solid, sized by a length dimension. */
const MIRROR_LINE = [
  { x: 330, y: 780 },
  { x: 900, y: 210 },
] as const;
const CONSTRUCTION = [
  { x: 600, y: 330 },
  { x: 680, y: 280 },
] as const;
/** The unrelated point (Fixed) the copy circle is dimensioned to. */
const POINT = { x: 1060, y: 760 };
const MIRROR_LINE_LENGTH = 19;
const COPY_TO_POINT = 4.5;
/**
 * The short line's length once fixed: long enough to be valid, short
 * enough that the regrown line crosses no circle (a crossing line would
 * split a circle region in two).
 */
const REPAIRED_LENGTH = 5;
/** Below τ (the document's modeling tolerance, 0.001). */
const DEGENERATE_LENGTH = 0.0005;
/** The value input refuses ≤ 0, so a degenerate line is a positive length < τ. */
const TAU = 0.001;
/** A requirement holds after a coupled solve within its residual (E2E-2's bound). */
const SOLVE_RESIDUAL = 1e-6;

type SavedDocument = {
  sketches: {
    label: string;
    definition: {
      points: { pointId: string; position: Vec }[];
      dimensions: {
        kind: string;
        pointIds?: string[];
        value?: { value: number };
      }[];
      derivedRelationships: {
        derivationId: string;
        mirrorReference?: unknown;
      }[];
    };
  }[];
};

const CONSTRUCTION_TOOL =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";
const FIX_TOOL = "Fix selected geometry at its current placement.";

/** Canvas px per sketch unit at the default top view (measured, T17j2.md). */
async function canvasMap(page: Page, pointId: string, at: CanvasPoint) {
  const snap = await sketchSnapshot(page);
  const [x, y] = positionOf(snap, pointId);
  const scale = (at.x - 720) / x;
  expect(
    Math.abs((480 - at.y) / y - scale),
    "premise: one uniform scale about the origin",
  ).toBeLessThan(0.05);
  return {
    toCanvas: ([px, py]: Vec): CanvasPoint => ({
      x: 720 + px * scale,
      y: 480 - py * scale,
    }),
    scale,
  };
}

const lengthOf = (snap: MirrorSketchSnapshot, lineId: string) => {
  const [start, end] = entityOf(snap, lineId).pointIds!;
  const [a, b] = [positionOf(snap, start!), positionOf(snap, end!)];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};

/** The mirror line of a mirror in sketch units (a line's solved ends or a datum). */
function axisOf(
  snap: MirrorSketchSnapshot,
  mirror: ReturnType<typeof mirrorsOf>[number],
): readonly [Vec, Vec] {
  const reference = mirror.mirrorReference!;
  if (reference.kind === "sketchDatum")
    return reference.datum === "xAxis"
      ? [
          [0, 0],
          [1, 0],
        ]
      : [
          [0, 0],
          [0, 1],
        ];
  const [start, end] = entityOf(snap, reference.entityId!).pointIds!;
  return [positionOf(snap, start!), positionOf(snap, end!)];
}

/**
 * Complete reflected shape: every copy point of every mirror is its seed
 * point's image about that mirror's current line, and a copy circle has the
 * seed's radius.
 */
function expectMirrorImages(snap: MirrorSketchSnapshot, context: string) {
  for (const mirror of mirrorsOf(snap)) {
    const [a, b] = axisOf(snap, mirror);
    for (const output of mirror.outputs) {
      output.seedPointIds.forEach((seedPointId, index) => {
        const image = reflectAbout(positionOf(snap, seedPointId), a, b);
        const copy = positionOf(snap, output.outputPointIds[index]!);
        expect(
          Math.hypot(copy[0] - image[0], copy[1] - image[1]),
          `${context}: ${mirror.id} copy point ${index} of ${output.outputEntityId} is the seed's image`,
        ).toBeLessThan(1e-6);
      });
      const seed = entityOf(snap, output.seedEntityId);
      if (seed.kind === "circle")
        expect(
          Math.abs(
            entityOf(snap, output.outputEntityId).radius! - seed.radius!,
          ),
          `${context}: the copy circle keeps the seed's radius`,
        ).toBeLessThan(1e-9);
    }
  }
}

/** Largest point move between two snapshots of the same points. */
function largestMove(
  before: MirrorSketchSnapshot,
  after: MirrorSketchSnapshot,
  ids: readonly string[],
) {
  return Math.max(
    0,
    ...ids.map((id) => {
      const [x0, y0] = positionOf(before, id);
      const [x1, y1] = positionOf(after, id);
      return Math.hypot(x1 - x0, y1 - y0);
    }),
  );
}

/** Every point of `snap` matches `reference` within `within` (same ids). */
function expectSamePoints(
  snap: MirrorSketchSnapshot,
  reference: MirrorSketchSnapshot,
  within: number,
  context: string,
) {
  expect(
    snap.points.map((point) => point.id).sort(),
    `${context}: the same points`,
  ).toEqual(reference.points.map((point) => point.id).sort());
  expect(
    largestMove(
      reference,
      snap,
      reference.points.map((point) => point.id),
    ),
    `${context}: every point is where it was`,
  ).toBeLessThan(within);
}

/** Internal ids never reach the page's text (F-2, T17e). */
async function expectNoInternalIds(page: Page, context: string) {
  const text = await page.locator("body").innerText();
  expect(
    text.match(/(sketch|derivation|dimension|constraint)_[\w-]+/g),
    `${context}: no internal id in the page text`,
  ).toBeNull();
  const labels = await page
    .locator("[aria-label]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label") ?? ""),
    );
  expect(
    labels.filter((label) => /(sketch|derivation)_/.test(label)),
    `${context}: no internal id in an accessible label`,
  ).toEqual([]);
}

const brokenStatus = (page: Page) =>
  sketchDiagnosticMessage(page)
    .filter({ hasText: /^Mirror ‘mirror \d+’ is broken/ });

const lengthChip = (page: Page) =>
  page.locator(
    '[data-sketch-annotation-kind="dimension"][aria-label^="Line length"]',
  );

/** Edits the mirror line's length through its chip (one action). */
async function editLength(page: Page, value: number) {
  await glideDoubleClick(page, lengthChip(page));
  await expect(floatingInput(page)).toBeVisible({ timeout: 15_000 });
  await floatingInput(page).locator("input").first().fill(String(value));
  await waitForCommittedAction(page, "Commit Annotation Value", () =>
    page.keyboard.press("Enter"),
  );
  await expect(floatingInput(page)).toBeHidden({ timeout: 10_000 });
  await page.keyboard.press("Escape");
}

async function liveRegions(page: Page) {
  return (await sketchSnapshot(page)).liveRegions;
}

test("§4 E2E-4: a circle mirrored about the Y datum, then an arc + spline + construction line + that copy (a short chain) about a length-dimensioned sloped line; seed and axis drags; the copy dimensioned to an unrelated Fixed point stays its own requirement and edits both sides; the line made degenerate through its length → label-based break; Undo/Redo; Finish → Save As → Open → re-enter: the same message, no internal id; Remove mirror → its copies go, the short line keeps its own problem, fixing it brings the regions back; Undo; Replace mirror line with the X axis → healed about the X axis", async ({
  page,
}) => {
  test.setTimeout(480_000);
  expect.configure({ timeout: 10_000 });
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openTopSketch(workbench);

  // Draw (Shift: no inferred requirement): the circle, the arc, the
  // spline, the mirror line, a construction line and the unrelated point.
  await workbench.activateTool("Create circular geometry.");
  await placeFreely(workbench, [CIRCLE.centre, CIRCLE.rim]);
  await expectStaged(workbench, 1);
  await workbench.openToolMenu(
    "Create an arc from center, start, and end points.",
  );
  await glidePress(page, page.getByRole("menuitem", { name: /3-Point Arc/ }));
  await placeFreely(workbench, ARC);
  await expectStaged(workbench, 2);
  await workbench.activateTool("Create spline geometry.");
  await placeFreely(workbench, SPLINE, true);
  await expectStaged(workbench, 3);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, MIRROR_LINE);
  await expectStaged(workbench, 4);
  await workbench.activateTool(CONSTRUCTION_TOOL);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, CONSTRUCTION);
  await expectStaged(workbench, 5);
  await workbench.activateTool(CONSTRUCTION_TOOL);
  await workbench.activateTool("Create a sketch point.");
  await placeFreely(workbench, [POINT]);
  await expectStaged(workbench, 6);
  const drawn = await sketchSnapshot(page);
  const [circle, arc, spline, line, construction] = drawn.entities;
  expect(drawn.entities.map((entity) => entity.kind)).toEqual([
    "circle",
    "arc",
    "spline",
    "lineSegment",
    "lineSegment",
    "point",
  ]);
  const { toCanvas } = await canvasMap(
    page,
    circle!.pointIds![0]!,
    CIRCLE.centre,
  );
  const pointId = drawn.points.find(
    (candidate) =>
      Math.hypot(
        toCanvas(candidate.position).x - POINT.x,
        toCanvas(candidate.position).y - POINT.y,
      ) < 1,
  )!.id;

  // The constrained line: its Length with the Dimension tool (one action).
  await workbench.openToolMenu(DIMENSION_TOOL);
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  await glideClick(
    workbench,
    await hoverUntil(workbench, { x: 700, y: 410 }, entityTarget(line!.id)),
  );
  await glideClick(workbench, { x: 760, y: 380 });
  await expect(floatingInput(page)).toContainText("Length", {
    timeout: 15_000,
  });
  await floatingInput(page)
    .locator("input")
    .first()
    .fill(String(MIRROR_LINE_LENGTH));
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    page.keyboard.press("Enter"),
  );
  await page.keyboard.press("Escape");
  const sized = await sketchSnapshot(page);
  expect(lengthOf(sized, line!.id)).toBeCloseTo(MIRROR_LINE_LENGTH, 9);
  // The unrelated point is Fixed (so the distance below moves the copy).
  await workbench.activateTool(FIX_TOOL);
  const pointSpot = await hoverUntil(
    workbench,
    POINT,
    entityTarget(pointId),
    4,
  );
  await waitForCommittedAction(page, "Fix Geometry", () =>
    glideClick(workbench, pointSpot),
  );
  await page.keyboard.press("Escape");

  // Mirror A: the circle about the sketch Y axis (a datum), picked in the
  // viewport; the popup confirms (one "Mirror").
  await openSearchTool(page, "Sketch Mirror");
  await glideClick(
    workbench,
    await hoverUntil(
      workbench,
      { x: CIRCLE.centre.x, y: CIRCLE.centre.y - 50 },
      entityTarget(circle!.id),
    ),
  );
  await glideClick(
    workbench,
    await hoverUntil(workbench, { x: 720, y: 600 }, /\.yAxis$/, 6),
  );
  const mirrorPopup = page.locator(
    '[data-sketch-viewport-floating-input="sketch-mirror-confirm"]',
  );
  await expect(mirrorPopup.locator("[data-floating-input-readout]")).toHaveText(
    "1 shape about the sketch Y axis",
    { timeout: 15_000 },
  );
  await waitForCommittedAction(page, "Mirror", () =>
    page.keyboard.press("Enter"),
  );
  await page.keyboard.press("Escape");
  const afterA = await sketchSnapshot(page);
  const [mirrorA] = mirrorsOf(afterA);
  expect(mirrorA!.mirrorReference).toEqual({
    kind: "sketchDatum",
    datum: "yAxis",
  });
  const copyCircle = mirrorA!.outputs[0]!.outputEntityId;
  const copyCentre = mirrorA!.outputs[0]!.outputPointIds[0]!;

  // Mirror B: the arc, the spline, the construction line and A's copy (a
  // mirror of a copy: the short chain) about the dimensioned sloped line.
  const copyAt = toCanvas(positionOf(afterA, copyCentre));
  const lineAt = (snap: MirrorSketchSnapshot) => {
    const [start, end] = entityOf(snap, line!.id).pointIds!;
    return [
      toCanvas(positionOf(snap, start!)),
      toCanvas(positionOf(snap, end!)),
    ] as const;
  };
  const [lineStart, lineEnd] = lineAt(afterA);
  await openSearchTool(page, "Sketch Mirror");
  for (const [id, around] of [
    [arc!.id, { x: 345, y: 368 }],
    [spline!.id, { x: 550, y: 170 }],
    [construction!.id, { x: 640, y: 305 }],
    [copyCircle, { x: copyAt.x, y: copyAt.y - 50 }],
    [
      line!.id,
      {
        x: lineStart.x + (lineEnd.x - lineStart.x) * 0.65,
        y: lineStart.y + (lineEnd.y - lineStart.y) * 0.65,
      },
    ],
  ] as const)
    await glideClick(
      workbench,
      await hoverUntil(workbench, around, entityTarget(id)),
    );
  await expect(mirrorPopup.locator("[data-floating-input-readout]")).toHaveText(
    "4 shapes about ‘Line 4’",
    { timeout: 15_000 },
  );
  await waitForCommittedAction(page, "Mirror", () =>
    glidePress(
      page,
      mirrorPopup.getByRole("button", { name: "Mirror", exact: true }),
    ),
  );
  await page.keyboard.press("Escape");
  const mirrored = await sketchSnapshot(page);
  const mirrorB = mirrorsOf(mirrored).find(
    (mirror) => mirror.id !== mirrorA!.id,
  )!;
  expect(mirrorB.mirrorReference).toEqual({
    kind: "lineEntity",
    entityId: line!.id,
  });
  expect(
    mirrorB.outputs.map((output) => output.seedEntityId),
    "B mirrors the arc, the spline, the construction line and A's copy",
  ).toEqual([arc!.id, spline!.id, construction!.id, copyCircle]);
  expectMirrorImages(mirrored, "created");
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "current", count: 3 });

  // Drag seed geometry: the construction line's start (one of B's seeds).
  // One action; its copy follows, both mirror lines stay.
  const constructionStart = entityOf(mirrored, construction!.id).pointIds![0]!;
  const constructionStartAt = toCanvas(positionOf(mirrored, constructionStart));
  await hoverUntil(
    workbench,
    constructionStartAt,
    entityTarget(constructionStart),
    3,
  );
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, constructionStartAt, {
      x: constructionStartAt.x - 30,
      y: constructionStartAt.y + 30,
    }),
  );
  await page.keyboard.press("Escape");
  const seedDragged = await sketchSnapshot(page);
  expect(
    largestMove(mirrored, seedDragged, [constructionStart]),
    "the dragged seed point moved",
  ).toBeGreaterThan(0.5);
  expect(
    largestMove(mirrored, seedDragged, entityOf(mirrored, line!.id).pointIds!),
    "a seed drag leaves the mirror line where it was",
  ).toBeLessThan(1e-9);
  expectMirrorImages(seedDragged, "after the seed drag");

  // Drag the constrained mirror line's end: one action; its length holds,
  // every copy of B follows the moved line, the seeds stay.
  const [, endPoint] = entityOf(seedDragged, line!.id).pointIds!;
  const endAt = toCanvas(positionOf(seedDragged, endPoint!));
  await hoverUntil(workbench, endAt, entityTarget(endPoint!), 3);
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, endAt, { x: endAt.x + 50, y: endAt.y + 40 }),
  );
  await page.keyboard.press("Escape");
  const axisDragged = await sketchSnapshot(page);
  expect(
    largestMove(seedDragged, axisDragged, [endPoint!]),
    "the line's end moved",
  ).toBeGreaterThan(0.5);
  expect(
    Math.abs(lengthOf(axisDragged, line!.id) - MIRROR_LINE_LENGTH),
    "the length requirement holds",
  ).toBeLessThan(SOLVE_RESIDUAL);
  const seedPointIds = mirrorsOf(axisDragged).flatMap((mirror) =>
    mirror.id === mirrorB.id
      ? mirror.outputs.flatMap((output) => output.seedPointIds)
      : [],
  );
  // Up to the solve tolerance of the T15e axis-drag row: the arc's own
  // point-on-curve requirement is re-solved in the frame (measured 7e-7).
  expect(
    largestMove(seedDragged, axisDragged, seedPointIds),
    "B's seeds stay",
  ).toBeLessThan(1e-5);
  const copyPointsOfB = (snap: MirrorSketchSnapshot) =>
    mirrorsOf(snap)
      .find((mirror) => mirror.id === mirrorB.id)!
      .outputs.flatMap((output) => output.outputPointIds);
  expect(
    largestMove(seedDragged, axisDragged, copyPointsOfB(axisDragged)),
    "B's copies followed the line",
  ).toBeGreaterThan(0.5);
  expectMirrorImages(axisDragged, "after the line drag");

  // The copy circle dimensioned to the unrelated Fixed point: the Distance
  // tool picks the copy's centre, then glides straight onto the point (D-1:
  // the preview no longer swallows that pick). Not routed: no shared
  // readout; its own requirement (one more dimension).
  const dimensionsBefore = axisDragged.dimensions!.length;
  await workbench.openToolMenu(DIMENSION_TOOL);
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  const copyCentreAt = toCanvas(positionOf(axisDragged, copyCentre));
  await glideClick(
    workbench,
    await hoverUntil(workbench, copyCentreAt, entityTarget(copyCentre), 3),
  );
  const pointAt = toCanvas(positionOf(axisDragged, pointId));
  await glideClick(workbench, pointAt);
  // The label just beside the segment's middle, inside the two points'
  // box (an aligned distance; outside it the tool infers a horizontal or
  // vertical one).
  const span = Math.hypot(
    pointAt.x - copyCentreAt.x,
    pointAt.y - copyCentreAt.y,
  );
  await glideClick(workbench, {
    x:
      (pointAt.x + copyCentreAt.x) / 2 +
      ((pointAt.y - copyCentreAt.y) / span) * 12,
    y:
      (pointAt.y + copyCentreAt.y) / 2 -
      ((pointAt.x - copyCentreAt.x) / span) * 12,
  });
  await expect(floatingInput(page)).toContainText("Distance", {
    timeout: 15_000,
  });
  await expect(
    floatingInput(page).getByText(/Shared with/),
    "not routed to a mirrored driver",
  ).toHaveCount(0);
  await floatingInput(page)
    .locator("input")
    .first()
    .fill(String(COPY_TO_POINT));
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    page.keyboard.press("Enter"),
  );
  await page.keyboard.press("Escape");
  const dimensioned = await sketchSnapshot(page);
  expect(
    dimensioned.dimensions!.length,
    "its own dimension: one more in the sketch",
  ).toBe(dimensionsBefore + 1);
  expect(dimensioned.dimensions!.at(-1)!.kind).toBe("distance");
  await expect(
    constraintRows(page, "Distance"),
    "listed as its own requirement",
  ).toHaveCount(1);
  const [cx, cy] = positionOf(dimensioned, copyCentre);
  const [px, py] = positionOf(dimensioned, pointId);
  expect(
    Math.abs(Math.hypot(px - cx, py - cy) - COPY_TO_POINT),
    "the copy is at the typed distance",
  ).toBeLessThan(SOLVE_RESIDUAL);
  expect(
    largestMove(axisDragged, dimensioned, [pointId]),
    "the Fixed point stays",
  ).toBeLessThan(SOLVE_RESIDUAL);
  expect(
    largestMove(axisDragged, dimensioned, circle!.pointIds!),
    "the original (A's seed) follows its copy",
  ).toBeGreaterThan(0.01);
  expectMirrorImages(dimensioned, "after the distance");

  // The mirror line made degenerate through its length (a positive value
  // below τ): one action; B is broken by label, its copies held where they
  // were last solved, every profile blocked; A is untouched.
  await editLength(page, DEGENERATE_LENGTH);
  const degenerate = await sketchSnapshot(page);
  expect(
    lengthOf(degenerate, line!.id),
    "the line solved shorter than τ",
  ).toBeLessThan(TAU);
  await expect(brokenStatus(page)).toHaveText(
    /^Mirror ‘mirror \d+’ is broken: its mirror line is shorter than the modeling tolerance\. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked\. Undo, replace the mirror line, or remove the mirror from the Mirror panel\.$/,
    { timeout: 15_000 },
  );
  const message = (await brokenStatus(page).textContent())!;
  await expect(mirrorPanel(page)).toContainText(
    "Broken: mirror line too short",
  );
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "unavailable", count: 0 });
  expect(
    largestMove(dimensioned, degenerate, copyPointsOfB(dimensioned)),
    "B's copies are held where they were last solved",
  ).toBeLessThan(1e-9);
  const healthyA = (snap: MirrorSketchSnapshot) => ({
    ...snap,
    derivedRelationships: mirrorsOf(snap).filter(
      (mirror) => mirror.id === mirrorA!.id,
    ),
  });
  expectMirrorImages(healthyA(degenerate), "A is untouched by B's break");

  // Undo heals in one step; Redo breaks it again with the same message.
  await waitForUndoneAction(page, "Commit Annotation Value", () =>
    page.keyboard.press("Control+z"),
  );
  await expect(brokenStatus(page)).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "current", count: 3 });
  expectSamePoints(
    await sketchSnapshot(page),
    dimensioned,
    SOLVE_RESIDUAL,
    "Undo",
  );
  await waitForRedoneAction(page, "Commit Annotation Value", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect(brokenStatus(page)).toHaveText(message, { timeout: 15_000 });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "unavailable", count: 0 });

  // Finish → Save As: the file keeps the broken mirror and the distance on
  // the copy (not rerouted to the original).
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  const saved = await saveDocumentCopy<SavedDocument>(page);
  expect(saved.sketches, "one sketch").toHaveLength(1);
  const definition = saved.sketches[0]!.definition;
  const savedB = definition.derivedRelationships.find(
    (relationship) => relationship.derivationId === mirrorB.id,
  );
  expect(savedB?.mirrorReference).toEqual({
    kind: "lineEntity",
    entityId: line!.id,
  });
  // The file keeps the authored intent (the sub-τ length); positions are
  // written back only from accepted solves, so the reopened sketch re-solves
  // to the same break.
  expect(
    definition.dimensions
      .filter((dimension) => dimension.kind === "lineLength")
      .map((dimension) => dimension.value?.value),
    "the saved length is the degenerate one",
  ).toEqual([DEGENERATE_LENGTH]);
  const distances = definition.dimensions.filter(
    (dimension) => dimension.kind === "distance",
  );
  expect(
    distances.map((dimension) => dimension.pointIds),
    "the distance names the copy's centre and the unrelated point",
  ).toEqual([[copyCentre, pointId]]);

  // Open the copy (a fresh history), re-enter: the same label-based
  // message, the panel's Broken row, no region, no internal id anywhere.
  await openDocumentCopy(page, saved, "mirror-repair.cadara");
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
  await expect(brokenStatus(page)).toHaveText(message, { timeout: 15_000 });
  await expect(mirrorPanel(page)).toContainText(
    "Broken: mirror line too short",
    { timeout: 15_000 },
  );
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "unavailable", count: 0 });
  const reopened = await sketchSnapshot(page);
  expectSamePoints(reopened, degenerate, 1e-9, "reopened");
  await expectNoInternalIds(page, "re-entered");

  // Remove mirror (Mirror panel): one action; B's four copies go, A, the
  // seeds and the line stay. The short line keeps its own label-based
  // problem, so profiles stay blocked until its length is fixed.
  await expect(mirrorPanel(page)).toContainText("Removes 4 copies.");
  await waitForCommittedAction(page, "Remove Mirror", () =>
    glidePress(
      page,
      mirrorPanel(page).getByRole("button", { name: "Remove mirror" }),
    ),
  );
  const removed = await sketchSnapshot(page);
  expect(mirrorsOf(removed).map((mirror) => mirror.id)).toEqual([mirrorA!.id]);
  const copiesOfB = mirrorB.outputs.map((output) => output.outputEntityId);
  expect(
    removed.entities.filter((entity) => copiesOfB.includes(entity.id)),
    "B's copies are gone",
  ).toEqual([]);
  expect(removed.entities.map((entity) => entity.id)).toEqual(
    reopened.entities
      .map((entity) => entity.id)
      .filter((id) => !copiesOfB.includes(id)),
  );
  expect(
    largestMove(
      reopened,
      removed,
      removed.points.map((candidate) => candidate.id),
    ),
    "nothing that stays moves",
  ).toBeLessThan(SOLVE_RESIDUAL);
  expectMirrorImages(removed, "A after the removal");
  await expect(brokenStatus(page)).toHaveCount(0, { timeout: 15_000 });
  const lineProblem = sketchDiagnosticMessage(page)
    .filter({ hasText: /^‘Line 4’ solved to length/ });
  await expect(lineProblem).toHaveText(
    /^‘Line 4’ solved to length [\d.e-]+, shorter than the minimum segment length tolerance\.$/,
    { timeout: 15_000 },
  );
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "unavailable", count: 0 });
  await editLength(page, REPAIRED_LENGTH);
  await expect(lineProblem).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "current", count: 2 });

  // Undo both: the broken mirror is back, the same message.
  await waitForUndoneAction(page, "Commit Annotation Value", () =>
    page.keyboard.press("Control+z"),
  );
  await waitForUndoneAction(page, "Remove Mirror", () =>
    page.keyboard.press("Control+z"),
  );
  await expect(brokenStatus(page)).toHaveText(message, { timeout: 15_000 });
  const restored = await sketchSnapshot(page);
  expect(restored.derivedRelationships).toEqual(reopened.derivedRelationships);
  expectSamePoints(restored, reopened, SOLVE_RESIDUAL, "Undo of the removal");

  // Replace mirror line… → the sketch X axis picked in the viewport →
  // Replace: one action; B heals about the X axis with every copy id kept.
  // The short line's own problem stays until its length is fixed.
  await glidePress(
    page,
    mirrorPanel(page).getByRole("button", { name: "Replace mirror line…" }),
  );
  await expect(mirrorPanel(page)).toHaveCount(0, { timeout: 15_000 });
  await glideClick(
    workbench,
    // (The reopened view is framed differently: the axis is picked right
    // of the geometry, clear of every curve.)
    await hoverUntil(workbench, { x: 1050, y: 480 }, /\.xAxis$/, 6),
  );
  const repair = page.locator(
    '[data-sketch-viewport-floating-input="sketch-mirror-repair-confirm"]',
  );
  await expect(repair.locator("[data-floating-input-readout]")).toHaveText(
    "Use the sketch X axis as the mirror line",
    { timeout: 15_000 },
  );
  await waitForCommittedAction(page, "Replace Mirror Line", () =>
    glidePress(page, repair.getByRole("button", { name: "Replace" })),
  );
  const replaced = await sketchSnapshot(page);
  const healedB = mirrorsOf(replaced).find(
    (mirror) => mirror.id === mirrorB.id,
  )!;
  expect(healedB.mirrorReference).toEqual({
    kind: "sketchDatum",
    datum: "xAxis",
  });
  expect(
    healedB.outputs.map((output) => output.outputEntityId),
    "every copy keeps its id",
  ).toEqual(copiesOfB);
  expectMirrorImages(replaced, "healed about the X axis");
  await expect(brokenStatus(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(lineProblem).toHaveCount(1, { timeout: 15_000 });
  await editLength(page, REPAIRED_LENGTH);
  await expect(lineProblem).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => liveRegions(page), { timeout: 30_000 })
    .toEqual({ status: "current", count: 3 });
  expectMirrorImages(await sketchSnapshot(page), "after the line is fixed");
  await expectNoInternalIds(page, "healed");
});
