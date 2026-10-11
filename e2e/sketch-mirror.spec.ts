import { expect, test, type Page } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T15 reciprocal mirrors in the real
// workbench: the Sketch Mirror tool (line, circle, arc and 3-point spline
// about a construction line, or about the X datum axis picked in the
// viewport), gliding-pointer drags on either side through the pick stack and
// the coupled solve, explicit axis drags, Escape mid-drag, one authored
// action per drag (Undo/Redo), Finish → re-entry, and the Trim refusal on a
// mirrored copy. Only the browser composes pointer → pick stack → session →
// history → publication. The underlying rules are pinned by the T15a–d logic
// rows; these rows pin their browser wiring (discrimination per row: see
// T15e.md).

// Viewport 1440×960, top plane: sketch origin at (720, 480), Y up. Every
// placement uses Shift (no inferred constraint); the 3-point arc authors its
// own construction constraints.
const LINE = [
  { x: 260, y: 300 },
  { x: 380, y: 220 },
] as const;
const CIRCLE = { centre: { x: 520, y: 280 }, rim: { x: 580, y: 280 } };
// 3-point arc clicks: start, through, end.
const ARC = [
  { x: 640, y: 330 },
  { x: 700, y: 250 },
  { x: 760, y: 330 },
] as const;
const SPLINE = [
  { x: 840, y: 330 },
  { x: 940, y: 220 },
  { x: 1040, y: 330 },
] as const;
// The construction axis (screen y 420; everything stays left of the
// constraint list panel).
const AXIS = [
  { x: 200, y: 420 },
  { x: 1100, y: 420 },
] as const;
const mirrorOnScreen = (at: { x: number; y: number }) => ({
  x: at.x,
  y: 2 * AXIS[0].y - at.y,
});

type Vec = readonly [number, number];
type Snapshot = {
  points: { id: string; position: Vec }[];
  entities: {
    id: string;
    kind: string;
    pointIds?: string[];
    radius?: number;
    occurrences?: {
      occId: string;
      pointId: string;
      tangent: { kind: string; vector?: Vec };
      visibleVector?: Vec | null;
    }[];
  }[];
  derivedRelationships: {
    id: string;
    kind: string;
    mirrorReference?: { kind: string; entityId?: string; datum?: string };
    outputs: {
      seedEntityId: string;
      outputEntityId: string;
      seedPointIds: string[];
      outputPointIds: string[];
    }[];
  }[];
};

async function snapshot(page: Page): Promise<Snapshot> {
  const snap = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snap) throw new Error("No live sketch snapshot.");
  return snap as unknown as Snapshot;
}

const positionOf = (snap: Snapshot, id: string) => {
  const point = snap.points.find((candidate) => candidate.id === id);
  if (!point) throw new Error(`No point ${id}.`);
  return point.position;
};
const entityOf = (snap: Snapshot, id: string) => {
  const entity = snap.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`No entity ${id}.`);
  return entity;
};
const mirrorOf = (snap: Snapshot) => {
  const mirrors = snap.derivedRelationships.filter(
    (relationship) => relationship.kind === "mirror",
  );
  expect(mirrors, "exactly one mirror relationship").toHaveLength(1);
  return mirrors[0]!;
};

/** The mirror line in sketch units: a line axis's solved ends, or a datum. */
function axisLine(snap: Snapshot): readonly [Vec, Vec] {
  const reference = mirrorOf(snap).mirrorReference!;
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

function reflect(point: Vec, [a, b]: readonly [Vec, Vec]): Vec {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  const along = (point[0] - a[0]) * u[0] + (point[1] - a[1]) * u[1];
  return [
    2 * (a[0] + along * u[0]) - point[0],
    2 * (a[1] + along * u[1]) - point[1],
  ];
}
function reflectVector(vector: Vec, [a, b]: readonly [Vec, Vec]): Vec {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  const along = vector[0] * u[0] + vector[1] * u[1];
  return [2 * along * u[0] - vector[0], 2 * along * u[1] - vector[1]];
}

/**
 * Complete-shape check: every copy point is the reflection of its seed
 * point about the current axis, circle radii are equal and every spline
 * copy occurrence has the seed's tangent kind with the reflected vector.
 */
function expectMirrorImage(snap: Snapshot, context: string) {
  const axis = axisLine(snap);
  for (const output of mirrorOf(snap).outputs) {
    output.seedPointIds.forEach((seedPointId, index) => {
      const image = reflect(positionOf(snap, seedPointId), axis);
      const copy = positionOf(snap, output.outputPointIds[index]!);
      expect(
        Math.hypot(copy[0] - image[0], copy[1] - image[1]),
        `${context}: copy point ${index} of ${output.outputEntityId} is the seed's mirror image`,
      ).toBeLessThan(1e-6);
    });
    const seed = entityOf(snap, output.seedEntityId);
    const copy = entityOf(snap, output.outputEntityId);
    expect(copy.kind, `${context}: the copy keeps the seed's kind`).toBe(
      seed.kind,
    );
    if (seed.kind === "circle")
      expect(
        Math.abs(copy.radius! - seed.radius!),
        `${context}: the copy circle's radius is the seed's`,
      ).toBeLessThan(1e-9);
    seed.occurrences?.forEach((occurrence, index) => {
      const copied = copy.occurrences![index]!;
      expect(
        copied.tangent.kind,
        `${context}: copy occurrence ${index} keeps the seed's tangent kind`,
      ).toBe(occurrence.tangent.kind);
      if (occurrence.tangent.vector) {
        const image = reflectVector(occurrence.tangent.vector, axis);
        expect(
          Math.hypot(
            copied.tangent.vector![0] - image[0],
            copied.tangent.vector![1] - image[1],
          ),
          `${context}: copy occurrence ${index}'s vector is the reflected seed vector`,
        ).toBeLessThan(1e-6);
      }
    });
  }
}

/** Positions, radii and tangents of the whole sketch, for exact comparison. */
const geometryOf = (snap: Snapshot) => ({
  points: Object.fromEntries(
    snap.points.map((point) => [point.id, point.position]),
  ),
  entities: snap.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    radius: entity.radius,
    tangents: entity.occurrences?.map((occurrence) => occurrence.tangent),
  })),
  derivedRelationships: snap.derivedRelationships,
});

/**
 * Largest numeric difference between two geometries of the same structure
 * (ids, kinds, tangent kinds and relationships must match exactly; any
 * structural difference is `Infinity`).
 */
function geometryDistance(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number")
    return Math.abs(left - right);
  if (Array.isArray(left) && Array.isArray(right))
    return left.length !== right.length
      ? Infinity
      : Math.max(0, ...left.map((item, i) => geometryDistance(item, right[i])));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = Object.keys(left);
    if (keys.join() !== Object.keys(right).join()) return Infinity;
    return Math.max(
      0,
      ...keys.map((key) =>
        geometryDistance(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
      ),
    );
  }
  return left === right ? 0 : Infinity;
}

async function openTopSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

async function expectStaged(workbench: SketchWorkbenchHarness, count: number) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 15_000 })
    .toContain(`${count} entities staged`);
}

/** Shift-placed clicks (no inferred constraint), then back to Select. */
async function placeFreely(
  workbench: SketchWorkbenchHarness,
  points: readonly { x: number; y: number }[],
  finishWithEnter = false,
) {
  const page = workbench.page;
  await page.keyboard.down("Shift");
  for (const point of points) await workbench.clickViewportAt(point);
  await page.keyboard.up("Shift");
  if (finishWithEnter) await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

async function drawConstructionAxis(
  workbench: SketchWorkbenchHarness,
  staged: number,
) {
  await workbench.activateTool(
    "Toggle sketch geometry construction-only or mark new sketch geometry as construction.",
  );
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, AXIS);
  await expectStaged(workbench, staged);
}

/** Hovers along a short vertical scan until `pattern` is the hover target. */
async function hoverUntil(
  workbench: SketchWorkbenchHarness,
  around: { x: number; y: number },
  pattern: RegExp,
  span = 12,
) {
  for (let dy = 0; dy <= span; dy += 1)
    for (const y of dy === 0 ? [around.y] : [around.y - dy, around.y + dy]) {
      await workbench.hoverViewportAt({ x: around.x, y });
      await workbench.waitForAnimationFrames(2);
      if (pattern.test(await workbench.currentHoverTarget()))
        return { x: around.x, y };
    }
  throw new Error(
    `Nothing matching ${pattern} is hoverable near ${JSON.stringify(around)}.`,
  );
}

const entityTarget = (id: string) => new RegExp(`\\.${id}$`);

async function openSearchTool(page: Page, name: string) {
  const search = page.getByPlaceholder("Search tools");
  await search.fill(name);
  await search.press("Enter");
}

/** T16d: the Mirror tool's confirm popup (it shows once the picks form a mirror). */
const mirrorPopup = (page: Page) =>
  page.locator('[data-sketch-viewport-floating-input="sketch-mirror-confirm"]');
/** The undo entries of confirmed mirrors (one per "Mirror" action). */
const mirrorActions = (page: Page) =>
  page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: /^Mirror$/ });

/** A gliding press: the pointer moves in steps to the button's centre, then clicks. */
async function glidePress(page: Page, button: ReturnType<Page["locator"]>) {
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * The four seeds and the construction axis, mirrored with the Sketch Mirror
 * tool (each seed's body picked, the axis last). Returns the snapshot.
 */
async function mirrorFourSeeds(workbench: SketchWorkbenchHarness) {
  const page = workbench.page;
  await openTopSketch(workbench);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, LINE);
  await expectStaged(workbench, 1);
  await workbench.activateTool("Create circular geometry.");
  await placeFreely(workbench, [CIRCLE.centre, CIRCLE.rim]);
  await expectStaged(workbench, 2);
  await workbench.activateTool(
    "Create an arc from center, start, and end points.",
  );
  await page.getByRole("menuitem", { name: /3-Point Arc/ }).click();
  await placeFreely(workbench, ARC);
  await expectStaged(workbench, 3);
  await workbench.activateTool("Create spline geometry.");
  await placeFreely(workbench, SPLINE, true);
  await expectStaged(workbench, 4);
  await drawConstructionAxis(workbench, 5);

  const drawn = await snapshot(page);
  const [line, circle, arc, spline, axis] = drawn.entities;
  await openSearchTool(page, "Sketch Mirror");
  // Each seed's body (not one of its points), then the axis as the last pick.
  for (const [entity, around] of [
    [line!, { x: 320, y: 262 }],
    [circle!, { x: 520, y: 222 }],
    // The arc: centre ≈ (700, 312), radius ≈ 62 px; its upper-left body.
    [arc!, { x: 656, y: 270 }],
    [spline!, { x: 890, y: 270 }],
    [axis!, { x: 800, y: 420 }],
  ] as const) {
    const at = await hoverUntil(workbench, around, entityTarget(entity.id));
    await workbench.clickViewportAt(at);
  }
  // T16d: the picks stage the mirror; the popup's Mirror confirms it.
  await expect(
    mirrorPopup(page).locator("[data-floating-input-readout]"),
  ).toHaveText(/^4 shapes about ‘.+’$/, { timeout: 15_000 });
  await expectStaged(workbench, 5);
  await glidePress(
    page,
    mirrorPopup(page).getByRole("button", { name: "Mirror", exact: true }),
  );
  await expectStaged(workbench, 9);
  await expect(mirrorActions(page)).toHaveCount(1, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
  const mirrored = await snapshot(page);
  expect(
    mirrorOf(mirrored).outputs.map((output) => output.seedEntityId),
    "premise: one mirror of the line, circle, arc and spline",
  ).toEqual([line!.id, circle!.id, arc!.id, spline!.id]);
  expect(mirrorOf(mirrored).mirrorReference).toEqual({
    kind: "lineEntity",
    entityId: axis!.id,
  });
  expectMirrorImage(mirrored, "premise");
  return mirrored;
}

/** A gliding drag: hover, press, 4 segments × 4 pointer moves, release. */
async function glide(
  workbench: SketchWorkbenchHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { release?: boolean } = {},
) {
  const page = workbench.page;
  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  for (const fraction of [0.25, 0.5, 0.75, 1])
    await page.mouse.move(
      box.x + from.x + (to.x - from.x) * fraction,
      box.y + from.y + (to.y - from.y) * fraction,
      { steps: 4 },
    );
  await workbench.waitForAnimationFrames(2);
  if (options.release ?? true) await page.mouse.up();
}

/**
 * Ctrl+Z restores `before` and Ctrl+Shift+Z restores `after`: one step.
 * Restoring re-solves the recorded definition, so solved positions may move
 * inside the solve tolerance (≤ 1e-6; a missed or extra step moves them by
 * the pointer delta, ≫ 0.5).
 */
async function expectOneUndoStep(
  workbench: SketchWorkbenchHarness,
  before: Snapshot,
  after: Snapshot,
) {
  const page = workbench.page;
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        geometryDistance(geometryOf(await snapshot(page)), geometryOf(before)),
      { message: "one Ctrl+Z restores the pre-drag sketch" },
    )
    .toBeLessThan(1e-6);
  await expectStaged(workbench, 9);
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(
      async () =>
        geometryDistance(geometryOf(await snapshot(page)), geometryOf(after)),
      { message: "one Ctrl+Shift+Z restores the dragged sketch" },
    )
    .toBeLessThan(1e-6);
  expectMirrorImage(await snapshot(page), "after Redo");
}

function expectAxisUnchanged(before: Snapshot, after: Snapshot) {
  expect(axisLine(after), "the mirror axis stays where it was").toEqual(
    axisLine(before),
  );
}

async function settledAfterDrag(
  workbench: SketchWorkbenchHarness,
  before: Snapshot,
  movedPointId: string | null,
) {
  await expect
    .poll(async () => {
      const now = await snapshot(workbench.page);
      return (
        JSON.stringify(geometryOf(now)) !== JSON.stringify(geometryOf(before))
      );
    })
    .toBe(true);
  await workbench.waitForAnimationFrames(4);
  const after = await snapshot(workbench.page);
  if (movedPointId) {
    const [x0, y0] = positionOf(before, movedPointId);
    const [x1, y1] = positionOf(after, movedPointId);
    expect(
      Math.hypot(x1 - x0, y1 - y0),
      "the dragged point moved",
    ).toBeGreaterThan(0.5);
  }
  return after;
}

test("T15e: dragging a mirrored line's copy end moves the seed as its mirror image, keeps the axis, one Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const before = await mirrorFourSeeds(workbench);
  const line = mirrorOf(before).outputs[0]!;
  const copyStart = line.outputPointIds[0]!;
  const seedStart = line.seedPointIds[0]!;

  await glide(workbench, mirrorOnScreen(LINE[0]), { x: 220, y: 590 });
  const after = await settledAfterDrag(workbench, before, copyStart);
  expect(
    Math.hypot(
      positionOf(after, seedStart)[0] - positionOf(before, seedStart)[0],
      positionOf(after, seedStart)[1] - positionOf(before, seedStart)[1],
    ),
    "the seed end followed",
  ).toBeGreaterThan(0.5);
  expectMirrorImage(after, "after the copy-end drag");
  expectAxisUnchanged(before, after);
  await expectOneUndoStep(workbench, before, after);
});

test("T15e: dragging a mirrored circle copy's rim grows the seed circle too, keeps the axis, one Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const before = await mirrorFourSeeds(workbench);
  const circle = mirrorOf(before).outputs[1]!;
  const rim = await hoverUntil(
    workbench,
    mirrorOnScreen(CIRCLE.rim),
    entityTarget(circle.outputEntityId),
    4,
  );

  await glide(workbench, rim, { x: rim.x + 40, y: rim.y });
  const after = await settledAfterDrag(workbench, before, null);
  const seedRadius = entityOf(before, circle.seedEntityId).radius!;
  expect(
    entityOf(after, circle.outputEntityId).radius! / seedRadius,
    "the copy's radius grew with the pointer (60 → ≈ 100 px)",
  ).toBeGreaterThan(1.4);
  expect(
    positionOf(after, circle.seedPointIds[0]!),
    "the seed centre stays (rim drag)",
  ).toEqual(positionOf(before, circle.seedPointIds[0]!));
  expectMirrorImage(after, "after the copy-rim drag");
  expectAxisUnchanged(before, after);
  await expectOneUndoStep(workbench, before, after);
});

test("T15e: dragging a mirrored spline copy's handle authors the seed's reflected tangent, keeps the axis, one Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const before = await mirrorFourSeeds(workbench);
  const spline = mirrorOf(before).outputs[3]!;
  const copy = entityOf(before, spline.outputEntityId);
  const seed = entityOf(before, spline.seedEntityId);
  // Select the copy (reveals its handles), then find its middle handle tip.
  const body = await hoverUntil(
    workbench,
    mirrorOnScreen({ x: 890, y: 270 }),
    entityTarget(copy.id),
  );
  await workbench.clickViewportAt(body);
  await workbench.waitForAnimationFrames(3);
  const middle = mirrorOnScreen(SPLINE[1]);
  const handleLabel = new RegExp(
    `\\.${copy.id}\\.${copy.occurrences![1]!.occId}$`,
  );
  let tip: { x: number; y: number } | null = null;
  for (let radius = 20; radius <= 80 && !tip; radius += 6)
    for (let angle = 0; angle < 360 && !tip; angle += 15) {
      const at = {
        x: Math.round(middle.x + radius * Math.cos((angle * Math.PI) / 180)),
        y: Math.round(middle.y + radius * Math.sin((angle * Math.PI) / 180)),
      };
      await workbench.hoverViewportAt(at);
      await workbench.waitForAnimationFrames(1);
      if (handleLabel.test(await workbench.currentHoverTarget())) tip = at;
    }
  expect(tip, "the copy's middle handle tip is hoverable").not.toBeNull();

  await glide(workbench, tip!, { x: tip!.x + 10, y: tip!.y + 40 });
  const after = await settledAfterDrag(workbench, before, null);
  const copied = entityOf(after, copy.id).occurrences![1]!;
  const seeded = entityOf(after, seed.id).occurrences![1]!;
  expect(copied.tangent.kind, "the copy's handle is authored").toBe("authored");
  expect(seeded.tangent.kind, "the seed's handle is authored").toBe("authored");
  expect(
    copied.tangent.vector![1],
    "the copy's handle turned with the pointer (screen down = sketch −y)",
  ).toBeLessThan(-0.5);
  for (const occurrence of [0, 1, 2])
    expect(
      positionOf(after, seed.occurrences![occurrence]!.pointId),
      "a handle drag moves no fit point",
    ).toEqual(positionOf(before, seed.occurrences![occurrence]!.pointId));
  expectMirrorImage(after, "after the copy-handle drag");
  expectAxisUnchanged(before, after);
  await expectOneUndoStep(workbench, before, after);
});

test("T15e: dragging the mirror axis's end moves the axis and every copy follows; the seeds stay; one Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const before = await mirrorFourSeeds(workbench);
  const axisStart = entityOf(
    before,
    mirrorOf(before).mirrorReference!.entityId!,
  ).pointIds![0]!;

  await glide(workbench, AXIS[0], { x: AXIS[0].x, y: AXIS[0].y + 60 });
  const after = await settledAfterDrag(workbench, before, axisStart);
  // The seeds keep their place (up to the solve tolerance: the arc's own
  // point-on-curve requirements are re-solved in the frame).
  for (const output of mirrorOf(before).outputs)
    for (const seedPointId of output.seedPointIds) {
      const [x0, y0] = positionOf(before, seedPointId);
      const [x1, y1] = positionOf(after, seedPointId);
      expect(
        Math.hypot(x1 - x0, y1 - y0),
        "an explicit axis drag moves no seed",
      ).toBeLessThan(1e-5);
    }
  expect(
    positionOf(after, mirrorOf(before).outputs[0]!.outputPointIds[0]!),
    "the copies moved with the axis",
  ).not.toEqual(
    positionOf(before, mirrorOf(before).outputs[0]!.outputPointIds[0]!),
  );
  expectMirrorImage(after, "after the axis drag");
  await expectOneUndoStep(workbench, before, after);
});

test("T15e: Escape mid-drag of a mirror copy restores the sketch and records no action", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const before = await mirrorFourSeeds(workbench);

  await glide(
    workbench,
    mirrorOnScreen(LINE[0]),
    { x: 220, y: 590 },
    { release: false },
  );
  // Mid-drag the seed already follows the copy (the live frame).
  const seedStart = mirrorOf(before).outputs[0]!.seedPointIds[0]!;
  await expect
    .poll(async () =>
      JSON.stringify(positionOf(await snapshot(page), seedStart)),
    )
    .not.toBe(JSON.stringify(positionOf(before, seedStart)));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(async () => geometryOf(await snapshot(page)), {
      message: "Escape restores the pre-drag sketch",
    })
    .toEqual(geometryOf(before));
  // No drag action: the next Ctrl+Z undoes the mirror itself.
  await page.keyboard.press("Control+z");
  await expectStaged(workbench, 5);
});

test("T15e: Finish → re-enter keeps the mirrored sketch identical", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await mirrorFourSeeds(workbench);
  // One copy drag first, so the state is not just the creation result.
  const created = await snapshot(page);
  await glide(workbench, mirrorOnScreen(LINE[0]), { x: 220, y: 590 });
  const dragged = await settledAfterDrag(workbench, created, null);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await page
    .getByRole("button", { name: /Select .*Double-click to reopen\./ })
    .first()
    .dblclick();
  await workbench.expectSketchSessionActive();
  await expectStaged(workbench, 9);
  const reentered = await snapshot(page);
  expect(geometryOf(reentered), "re-entry shows the finished sketch").toEqual(
    geometryOf(dragged),
  );
  expectMirrorImage(reentered, "after re-entry");
});

test("T15e: Trim on a mirrored copy is refused with the named message and changes nothing", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  const before = await mirrorFourSeeds(workbench);
  const copyLine = mirrorOf(before).outputs[0]!.outputEntityId;

  await workbench.activateTool("Trim sketch segments.");
  const at = await hoverUntil(
    workbench,
    mirrorOnScreen({ x: 320, y: 262 }),
    entityTarget(copyLine),
  );
  await workbench.clickViewportAt(at);
  await expect(
    page.getByRole("status").filter({
      hasText:
        /^This shape is part of mirror ‘mirror \d+’\. To trim it, press Esc, select it, then Mirror → Remove mirror\.$/,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await workbench.waitForAnimationFrames(4);
  expect(geometryOf(await snapshot(page)), "nothing changed").toEqual(
    geometryOf(before),
  );
  await expectStaged(workbench, 9);
  await expect(
    page
      .locator('[data-history-action-direction="undo"]')
      .filter({ hasText: "Trim" }),
    "no Trim action",
  ).toHaveCount(0);

  // T16a review R-2: the message's steps work as written: Esc leaves Trim,
  // selecting the copy shows its mirror in the Mirror panel.
  await page.keyboard.press("Escape");
  await workbench.clickViewportAt(
    await hoverUntil(
      workbench,
      mirrorOnScreen({ x: 320, y: 262 }),
      entityTarget(copyLine),
    ),
  );
  await expect(
    page
      .getByRole("region", { name: "Mirror" })
      .getByRole("button", { name: "Remove mirror" }),
  ).toBeVisible({ timeout: 15_000 });
});

// T16a ([TECH] T16-1, T16-2): Remove mirror from the Mirror panel. Lane:
// e2e; seam: selection → panel → reducer → authored history in the
// workbench (every pointer path glides; the button press is a real glide
// over the panel, never a forced click).
test("T16a: select a mirrored line's copy, Mirror panel → Remove mirror: the copy goes, original and axis stay; one Ctrl+Z restores it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, LINE);
  await expectStaged(workbench, 1);
  await drawConstructionAxis(workbench, 2);
  const [seed, axis] = (await snapshot(page)).entities;
  await openSearchTool(page, "Sketch Mirror");
  for (const [entity, around] of [
    [seed!, { x: 320, y: 262 }],
    [axis!, { x: 800, y: 420 }],
  ] as const)
    await workbench.clickViewportAt(
      await hoverUntil(workbench, around, entityTarget(entity.id)),
    );
  // T16d: the picks stage the mirror; Enter confirms it.
  await expect(mirrorPopup(page)).toBeVisible({ timeout: 15_000 });
  await expectStaged(workbench, 2);
  await page.keyboard.press("Enter");
  await expectStaged(workbench, 3);
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
  const created = await snapshot(page);
  const copy = mirrorOf(created).outputs[0]!.outputEntityId;

  await workbench.clickViewportAt(
    await hoverUntil(
      workbench,
      mirrorOnScreen({ x: 320, y: 262 }),
      entityTarget(copy),
    ),
  );
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(copy);
  const panel = page.getByRole("region", { name: "Mirror" });
  await expect(panel).toContainText("Healthy", { timeout: 15_000 });
  await expect(panel).toContainText("Removes 1 copy.");
  const remove = panel.getByRole("button", { name: "Remove mirror" });
  const box = (await remove.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.down();
  await page.mouse.up();

  await expectStaged(workbench, 2);
  const removed = await snapshot(page);
  expect(
    removed.derivedRelationships.filter((entry) => entry.kind === "mirror"),
    "the mirror is gone",
  ).toEqual([]);
  expect(removed.entities.map((entity) => entity.id)).toEqual([
    seed!.id,
    axis!.id,
  ]);
  for (const point of removed.points)
    expect(point.position, `${point.id} did not move`).toEqual(
      positionOf(created, point.id),
    );
  await expect(panel, "no mirror left to list").toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(
    page
      .locator('[data-history-action-direction="undo"]')
      .filter({ hasText: "Remove Mirror" }),
    "one Remove Mirror action",
  ).toHaveCount(1, { timeout: 15_000 });

  await page.keyboard.press("Control+z");
  await expectStaged(workbench, 3);
  await expect
    .poll(
      async () =>
        geometryDistance(geometryOf(await snapshot(page)), geometryOf(created)),
      { timeout: 15_000 },
    )
    .toBeLessThan(1e-6);
  expectMirrorImage(await snapshot(page), "after Undo");

  // Review R-1: break the mirror (delete its axis). The sketch's validation
  // message and the Mirror panel (listing the broken mirror with nothing
  // selected) are both visible and never overlap.
  await workbench.clickViewportAt(
    await hoverUntil(workbench, { x: 800, y: 420 }, entityTarget(axis!.id)),
  );
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(axis!.id);
  await page.keyboard.press("Delete");
  await expect(panel).toContainText("Broken: mirror line missing", {
    timeout: 15_000,
  });
  const status = page.getByRole("status").filter({ hasText: /mirror/i });
  await expect(status).toBeVisible();
  const statusBox = (await status.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(
    statusBox.y + statusBox.height <= panelBox.y ||
      panelBox.y + panelBox.height <= statusBox.y ||
      statusBox.x + statusBox.width <= panelBox.x ||
      panelBox.x + panelBox.width <= statusBox.x,
    `the message ${JSON.stringify(statusBox)} and the Mirror panel ${JSON.stringify(panelBox)} do not overlap`,
  ).toBe(true);
});

test("T15e: mirror about the X datum axis picked in the viewport; dragging either side keeps the datum as the mirror line", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, LINE);
  await expectStaged(workbench, 1);
  const seedLine = (await snapshot(page)).entities[0]!;

  await openSearchTool(page, "Sketch Mirror");
  const seedBody = await hoverUntil(
    workbench,
    { x: 320, y: 262 },
    entityTarget(seedLine.id),
  );
  await workbench.clickViewportAt(seedBody);
  // The X datum axis (screen y 480), away from the origin.
  const datum = await hoverUntil(workbench, { x: 1000, y: 480 }, /\.xAxis$/, 4);
  await workbench.clickViewportAt(datum);
  // T16d: the picks stage the mirror; Enter confirms it.
  await expect(mirrorPopup(page)).toBeVisible({ timeout: 15_000 });
  await expectStaged(workbench, 1);
  await page.keyboard.press("Enter");
  await expectStaged(workbench, 2);
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
  const created = await snapshot(page);
  expect(mirrorOf(created).mirrorReference).toEqual({
    kind: "sketchDatum",
    datum: "xAxis",
  });
  expectMirrorImage(created, "datum mirror created");
  const output = mirrorOf(created).outputs[0]!;

  // The copy of the seed's start is below the X axis (screen y 660).
  await glide(
    workbench,
    { x: LINE[0].x, y: 960 - LINE[0].y },
    { x: 230, y: 700 },
  );
  const copyDragged = await settledAfterDrag(
    workbench,
    created,
    output.outputPointIds[0]!,
  );
  expectMirrorImage(copyDragged, "after the copy drag (about y = 0)");
  expect(
    positionOf(copyDragged, output.seedPointIds[0]!),
    "the seed followed",
  ).not.toEqual(positionOf(created, output.seedPointIds[0]!));

  // T16a: the dragged copy is selected, so the Mirror panel occupies the
  // left panel slot over the seed's end; Escape clears the selection first.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Mirror" })).toHaveCount(0, {
    timeout: 15_000,
  });
  await glide(workbench, LINE[1], { x: 420, y: 200 });
  const seedDragged = await settledAfterDrag(
    workbench,
    copyDragged,
    output.seedPointIds[1]!,
  );
  expectMirrorImage(seedDragged, "after the seed drag (about y = 0)");
  expect(mirrorOf(seedDragged).mirrorReference).toEqual({
    kind: "sketchDatum",
    datum: "xAxis",
  });
  // The datum is still where it was: hoverable at screen y 480.
  await hoverUntil(workbench, { x: 1000, y: 480 }, /\.xAxis$/, 0);
});

// T16d ([TECH] T16-8/T16-21, review R-1/A-11). Lane: e2e; seam: gliding
// pointer → pick stack → Mirror staging → confirm popup (Cancel, Enter) →
// authored history in the workbench. Red on base: the line, picked second as
// a seed, committed "circle about line" at once.
test("T16d: mirror a circle and a line picked second: preview, Cancel records nothing, re-pick, Enter is one Mirror action that one Ctrl+Z removes; the popup covers no pick target and a glide over it still picks", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, LINE);
  await expectStaged(workbench, 1);
  await workbench.activateTool("Create circular geometry.");
  await placeFreely(workbench, [CIRCLE.centre, CIRCLE.rim]);
  await expectStaged(workbench, 2);
  await drawConstructionAxis(workbench, 3);
  const [line, circle, axis] = (await snapshot(page)).entities;
  // Hoverable spots on each body, found before the tool is armed.
  const spots = {
    circle: await hoverUntil(
      workbench,
      { x: 520, y: 222 },
      entityTarget(circle!.id),
    ),
    line: await hoverUntil(
      workbench,
      { x: 320, y: 262 },
      entityTarget(line!.id),
    ),
    axis: await hoverUntil(
      workbench,
      { x: 800, y: 420 },
      entityTarget(axis!.id),
    ),
  };
  const canvas = (await workbench.viewport().boundingBox())!;
  /** A gliding pick (canvas coordinates), optionally by way of `via`. */
  const pick = async (
    to: { x: number; y: number },
    via?: { x: number; y: number },
  ) => {
    for (const point of via ? [via, to] : [to])
      await page.mouse.move(canvas.x + point.x, canvas.y + point.y, {
        steps: 10,
      });
    await workbench.waitForAnimationFrames(2);
    await page.mouse.down();
    await page.mouse.up();
  };
  const popup = mirrorPopup(page);
  const readout = popup.locator("[data-floating-input-readout]");
  const command = () =>
    page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? "");
  /** The popup's rect leaves every pick spot (± 6 px) uncovered. */
  const expectClearOfSpots = async (context: string) => {
    const box = (await popup.boundingBox())!;
    for (const [name, spot] of Object.entries(spots)) {
      const x = canvas.x + spot.x;
      const y = canvas.y + spot.y;
      expect(
        x + 6 < box.x ||
          box.x + box.width < x - 6 ||
          y + 6 < box.y ||
          box.y + box.height < y - 6,
        `${context}: the popup ${JSON.stringify(box)} leaves the ${name} pick at (${x}, ${y}) uncovered`,
      ).toBe(true);
    }
    return box;
  };

  await openSearchTool(page, "Sketch Mirror");
  await pick(spots.circle);
  await pick(spots.line);
  // The line is the axis candidate: one shape staged, nothing authored.
  await expect(readout).toHaveText(/^1 shape about ‘.+’$/, {
    timeout: 15_000,
  });
  await expectStaged(workbench, 3);
  await expect(mirrorActions(page)).toHaveCount(0);
  const box = await expectClearOfSpots("after the line pick");
  // The axis pick glides across the popup first: the popup does not keep it.
  await pick(spots.axis, {
    x: box.x - canvas.x + box.width / 2,
    y: box.y - canvas.y + box.height / 2,
  });
  await expect(readout).toHaveText(/^2 shapes about ‘.+’$/, {
    timeout: 15_000,
  });
  await expectClearOfSpots("after the axis pick");
  await expectStaged(workbench, 3);
  await expect(mirrorActions(page)).toHaveCount(0);

  // Cancel: nothing recorded, the tool stays armed.
  await glidePress(page, popup.getByRole("button", { name: "Cancel" }));
  await expect(popup).toBeHidden({ timeout: 15_000 });
  await workbench.waitForAnimationFrames(4);
  await expectStaged(workbench, 3);
  await expect(mirrorActions(page)).toHaveCount(0);
  expect(
    (await snapshot(page)).derivedRelationships,
    "Cancel authors no mirror",
  ).toEqual([]);
  expect(await command(), "the Mirror tool stays armed").toBe("sketchMirror");

  // Re-pick, then Enter: one Mirror action of both seeds.
  await pick(spots.circle);
  await pick(spots.line);
  await pick(spots.axis);
  await expect(readout).toHaveText(/^2 shapes about ‘.+’$/, {
    timeout: 15_000,
  });
  await page.keyboard.press("Enter");
  await expect(mirrorActions(page)).toHaveCount(1, { timeout: 15_000 });
  await expectStaged(workbench, 5);
  await expect(popup).toBeHidden();
  const mirrored = await snapshot(page);
  expect(
    mirrorOf(mirrored).outputs.map((output) => output.seedEntityId),
    "one mirror of the circle and the line",
  ).toEqual([circle!.id, line!.id]);
  expect(mirrorOf(mirrored).mirrorReference).toEqual({
    kind: "lineEntity",
    entityId: axis!.id,
  });
  expectMirrorImage(mirrored, "confirmed");

  // One Ctrl+Z removes the mirror.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expectStaged(workbench, 3);
  expect(
    (await snapshot(page)).derivedRelationships,
    "Undo removes the mirror",
  ).toEqual([]);
  await expect(mirrorActions(page)).toHaveCount(0);
});

// T16e ([TECH] T16-9). Lane: e2e; seam: Mirror panel → repair sub-state of
// the Mirror tool → gliding viewport pick → staged candidate + confirm
// popup → authored history in the workbench (every pointer path glides).
test("T16e: delete the mirror line → panel Broken → Replace mirror line… → pick another line (popup, confirm) → the copy follows, panel Healthy; one Ctrl+Z restores the broken state", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, LINE);
  await expectStaged(workbench, 1);
  // The replacement line, horizontal at screen y 360 (review A-8: the copy
  // about it lands at screen y 420–500, inside the viewport and clear of
  // the toolbar).
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, [
    { x: 480, y: 360 },
    { x: 1000, y: 360 },
  ]);
  await expectStaged(workbench, 2);
  await drawConstructionAxis(workbench, 3);
  const [seed, replacement, axis] = (await snapshot(page)).entities;
  const canvas = (await workbench.viewport().boundingBox())!;
  /** A gliding pick (canvas coordinates). */
  const pick = async (to: { x: number; y: number }) => {
    await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps: 10 });
    await workbench.waitForAnimationFrames(2);
    await page.mouse.down();
    await page.mouse.up();
  };
  const spots = {
    seed: await hoverUntil(
      workbench,
      { x: 320, y: 262 },
      entityTarget(seed!.id),
    ),
    axis: await hoverUntil(
      workbench,
      { x: 800, y: 420 },
      entityTarget(axis!.id),
    ),
    replacement: await hoverUntil(
      workbench,
      { x: 740, y: 360 },
      entityTarget(replacement!.id),
    ),
  };
  await openSearchTool(page, "Sketch Mirror");
  await pick(spots.seed);
  await pick(spots.axis);
  await expect(mirrorPopup(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expectStaged(workbench, 4);
  await expect(mirrorActions(page)).toHaveCount(1, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);

  // Delete the mirror line: the panel lists the broken mirror.
  await pick(spots.axis);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(axis!.id);
  await page.keyboard.press("Delete");
  await expectStaged(workbench, 3);
  const panel = page.getByRole("region", { name: "Mirror" });
  await expect(panel).toContainText("Broken: mirror line missing", {
    timeout: 15_000,
  });
  const broken = await snapshot(page);

  // Replace mirror line…: the repair arms the Mirror tool (the panel goes).
  await glidePress(
    page,
    panel.getByRole("button", { name: "Replace mirror line…" }),
  );
  await expect(panel).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(
      () => page.evaluate(() => window.__cadaraDebug?.getState()?.command),
      { timeout: 15_000 },
    )
    .toBe("sketchMirror");

  // Pick the replacement line: the popup asks to confirm; nothing authored.
  const popup = page.locator(
    '[data-sketch-viewport-floating-input="sketch-mirror-repair-confirm"]',
  );
  await pick(spots.replacement);
  await expect(popup.locator("[data-floating-input-readout]")).toHaveText(
    /^Use ‘.+’ as the mirror line$/,
    { timeout: 15_000 },
  );
  expect(
    geometryDistance(geometryOf(await snapshot(page)), geometryOf(broken)),
    "the pick authors nothing",
  ).toBe(0);
  const replaceActions = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Replace Mirror Line" });
  await expect(replaceActions).toHaveCount(0);

  // Confirm: one action; the copy is the seed's image about the new line.
  await glidePress(page, popup.getByRole("button", { name: "Replace" }));
  await expect(replaceActions).toHaveCount(1, { timeout: 15_000 });
  await expect(popup).toBeHidden();
  const replaced = await snapshot(page);
  expect(mirrorOf(replaced).mirrorReference).toEqual({
    kind: "lineEntity",
    entityId: replacement!.id,
  });
  expect(
    mirrorOf(replaced).outputs.map((output) => output.outputEntityId),
    "the copy keeps its id",
  ).toEqual(mirrorOf(broken).outputs.map((output) => output.outputEntityId));
  expectMirrorImage(replaced, "after the replacement");
  await expect(panel).toContainText("Healthy", { timeout: 15_000 });

  // One Ctrl+Z restores the broken state.
  await page.keyboard.press("Control+z");
  await expect(replaceActions).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(
      async () =>
        geometryDistance(geometryOf(await snapshot(page)), geometryOf(broken)),
      { timeout: 15_000 },
    )
    .toBe(0);
  await expect(panel).toContainText("Broken: mirror line missing", {
    timeout: 15_000,
  });
});
