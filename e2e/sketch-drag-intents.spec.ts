import { expect, test } from "@playwright/test";
import {
  glideDrag,
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import { glideClick, glidePress } from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";

// ── Helpers ──────────────────────────────────────────────────────────────

async function enterSketchMode(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

async function drawLine(
  workbench: SketchWorkbenchHarness,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
) {
  await workbench.activateTool("Create line geometry.");
  await glideClick(workbench, p1);
  await glideClick(workbench, p2);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await workbench.page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");
}

const MOVE = "Move Sketch Geometry";

/**
 * A gliding drag (T17b: the shared `glideDrag`) that completes one
 * committed "Move Sketch Geometry" action.
 */
async function committedDrag(
  workbench: SketchWorkbenchHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await waitForCommittedAction(workbench.page, MOVE, () =>
    glideDrag(workbench, from, to, { steps: 8 }),
  );
}

type LivePoint = { id: string; position: readonly [number, number] };

async function readLivePoints(
  workbench: SketchWorkbenchHarness,
): Promise<LivePoint[]> {
  const snap = await workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snap) throw new Error("No live sketch snapshot.");
  return (snap as { points: LivePoint[] }).points;
}

async function readCommittedDefinition(workbench: SketchWorkbenchHarness) {
  return workbench.page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (!serialized) return null;
    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            points?: Array<{
              pointId: string;
              position: readonly [number, number];
            }>;
            entities?: Array<{
              entityId: string;
              kind: string;
              radius?: number;
              centerPointId?: string;
            }>;
          };
        };
      }>;
    };
    const def = payload.entries
      ?.filter((entry) => entry.kind === "commitSketch")
      .at(-1)?.payload?.definition;
    if (!def) return null;
    return {
      points: (def.points ?? []).map((p) => ({
        id: p.pointId,
        position: [...p.position],
      })),
      entities: (def.entities ?? []).map((e) => ({
        id: e.entityId,
        kind: e.kind,
        radius: e.radius,
        centerPointId: e.centerPointId,
      })),
    };
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);
}

async function finishSketch(workbench: SketchWorkbenchHarness) {
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
}

/**
 * Polls the hover target at a viewport point until it does (`true`) or does
 * not (`false`) name the circle entity: a live read of where the rim is,
 * since the debug snapshot carries no radius.
 */
async function expectRimHover(
  workbench: SketchWorkbenchHarness,
  point: { x: number; y: number },
  circleId: string,
  onRim: boolean,
) {
  const hover = expect.poll(
    async () => {
      await workbench.hoverViewportAt(point);
      await workbench.waitForAnimationFrames(2);
      return workbench.currentHoverTarget();
    },
    {
      message: `circle rim ${onRim ? "at" : "not at"} (${point.x},${point.y})`,
      timeout: 10_000,
    },
  );
  await (onRim ? hover.toContain(circleId) : hover.not.toContain(circleId));
}

async function liveCircleId(workbench: SketchWorkbenchHarness) {
  const snap = await workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  const circle = (
    snap as { entities: Array<{ id: string; kind: string }> } | null
  )?.entities.find((entity) => entity.kind === "circle");
  if (!circle) throw new Error("No live circle.");
  return circle.id;
}

/** Draws a Circle-tool circle (centre, rim click) and leaves the tool. */
async function drawCircle(
  workbench: SketchWorkbenchHarness,
  centre: { x: number; y: number },
  rim: { x: number; y: number },
) {
  await workbench.activateTool("Create circular geometry.");
  await glideClick(workbench, centre);
  await glideClick(workbench, rim);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await workbench.page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");
}

/** Sketch units of the only circle's radius, from its centre and the pixel radius (top plane, origin at the viewport centre). */
async function sketchRadiusOf(
  workbench: SketchWorkbenchHarness,
  centre: { x: number; y: number },
  pixelRadius: number,
) {
  const [point] = await readLivePoints(workbench);
  return (pixelRadius * point!.position[0]) / (centre.x - 720);
}

/**
 * T13a: adds a driving diameter deliberately through the visible Dimension
 * tool (Distance variant on the circle rim, then placement, then a typed
 * value) and leaves the tool.
 */
async function addDiameterWithDimensionTool(
  workbench: SketchWorkbenchHarness,
  rim: { x: number; y: number },
  placement: { x: number; y: number },
  diameter: number,
) {
  const page = workbench.page;
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await glideClick(workbench, rim);
  await glideClick(workbench, placement);
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill(diameter.toFixed(4));
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    glidePress(page, floatingInput.getByRole("button", { name: "Commit" })),
  );
  await expect(floatingInput).toBeHidden();
  await expect(
    page.locator('[data-sketch-annotation-kind="dimension"]'),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
}

// Viewport 1440×960, centre (720,480). Top-plane sketch: origin at
// viewport centre, sketch Y up / viewport Y down.

// ── Escape mid-drag ─────────────────────────────────────────────────────

test("T12c: Escape mid-drag restores geometry and does not create an Undo entry", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawLine(workbench, { x: 400, y: 300 }, { x: 600, y: 300 });

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");
  await page.mouse.move(box.x + 400, box.y + 300, {
    steps: 8,
  });
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 650, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();

  // Ctrl+Z inside the sketch undoes the line draw, proving no drag undo entry.
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("0 entities staged");

  // Redo, finish, verify geometry was NOT moved below viewport centre.
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  for (const pt of committed!.points) {
    expect(
      pt.position[1],
      `After Escape-cancel, point ${pt.id} Y should be positive (drag restored).`,
    ).toBeGreaterThan(0);
  }
});

// ── Undo / Redo ─────────────────────────────────────────────────────────

test("T12c: completed vertex drag inside sketch; Ctrl+Z restores, Ctrl+Shift+Z re-applies", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawLine(workbench, { x: 360, y: 260 }, { x: 420, y: 320 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await committedDrag(workbench, { x: 360, y: 260 }, { x: 500, y: 260 });

  await waitForUndoneAction(page, MOVE, () => page.keyboard.press("Control+z"));
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await waitForRedoneAction(page, MOVE, () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  // After Redo, point 0 X > point 1 X (reversed from draw order 360 < 420).
  expect(
    committed!.points[0]!.position[0],
    "After Redo, dragged point 0 should be right of point 1.",
  ).toBeGreaterThan(committed!.points[1]!.position[0]);
});

// ── Line body drag ──────────────────────────────────────────────────────

test("T12c: dragging a line body translates both endpoints by the pointer delta", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawLine(workbench, { x: 350, y: 300 }, { x: 550, y: 300 });

  await committedDrag(workbench, { x: 450, y: 300 }, { x: 450, y: 650 });

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const y0 = committed!.points[0]!.position[1];
  const y1 = committed!.points[1]!.position[1];
  expect(Math.abs(y0 - y1), "Rigid body translation.").toBeLessThan(0.5);
  expect(y0, "Point 0 Y below origin.").toBeLessThan(-1);
  expect(y1, "Point 1 Y below origin.").toBeLessThan(-1);
});

// ── Circle rim drag: freshly drawn circle (free size, T13a) ─────────────

test("T13a: rim drag on a freshly drawn circle grows the radius, centre fixed, exactly one Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawCircle(workbench, { x: 400, y: 400 }, { x: 500, y: 400 });
  const [centreBefore] = await readLivePoints(workbench);
  const circleId = await liveCircleId(workbench);

  // Drag the rim 200 px outward (500 → 700): radius 100 px → 300 px.
  await committedDrag(workbench, { x: 500, y: 400 }, { x: 700, y: 400 });
  await expectRimHover(workbench, { x: 700, y: 400 }, circleId, true);

  // Exactly one Undo step: the first Ctrl+Z undoes the drag (the circle
  // stays, its rim back at the drawn 100 px: review A-2, no stale read),
  // the second undoes the circle draw.
  await waitForUndoneAction(page, MOVE, () => page.keyboard.press("Control+z"));
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await expectRimHover(workbench, { x: 500, y: 400 }, circleId, true);
  await expectRimHover(workbench, { x: 700, y: 400 }, circleId, false);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("0 entities staged");
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await waitForRedoneAction(page, MOVE, () =>
    page.keyboard.press("Control+Shift+z"),
  );

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  const centre = committed!.points.find((p) => p.id === circle!.centerPointId)!;
  // The drawn radius is 100 px; the dragged one 300 px. Measured in units of
  // the drawn radius (from the centre's own pixel → sketch scale).
  const drawnRadius = (100 * centreBefore!.position[0]) / (400 - 720);
  expect(
    circle!.radius! / drawnRadius,
    "Radius grows to ~3× the drawn radius (rim drag after Redo).",
  ).toBeGreaterThan(2.9);
  expect(circle!.radius! / drawnRadius).toBeLessThan(3.1);
  expect(centre.position[0], "Centre X fixed.").toBeCloseTo(
    centreBefore!.position[0],
    6,
  );
  expect(centre.position[1], "Centre Y fixed.").toBeCloseTo(
    centreBefore!.position[1],
    6,
  );
});

// ── Circle rim drag in a sketch with other requirements (review B-1) ────

test("T13a B-1: with a rectangle drawn first, a circle's rim drag keeps the grown radius through a later unrelated edit and Finish", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  // A rectangle first: its horizontal/vertical requirements put every later
  // drag on the solver path.
  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await glideClick(workbench, { x: 900, y: 250 });
  await glideClick(workbench, { x: 1050, y: 350 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  await workbench.activateTool("Create circular geometry.");
  await glideClick(workbench, { x: 400, y: 400 });
  await glideClick(workbench, { x: 500, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("5 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");
  // The circle's centre is its only point, the last one added.
  const centreBefore = (await readLivePoints(workbench)).at(-1)!;
  const circleId = await liveCircleId(workbench);

  await committedDrag(workbench, { x: 500, y: 400 }, { x: 700, y: 400 });
  await expectRimHover(workbench, { x: 700, y: 400 }, circleId, true);

  // A later unrelated edit re-solves the sketch from its definition.
  await workbench.activateTool("Create line geometry.");
  await glideClick(workbench, { x: 900, y: 700 });
  await glideClick(workbench, { x: 1050, y: 700 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("6 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");
  await expectRimHover(workbench, { x: 700, y: 400 }, circleId, true);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  const centre = committed!.points.find((p) => p.id === circle!.centerPointId)!;
  const drawnRadius = (100 * centre.position[0]) / (400 - 720);
  expect(
    circle!.radius! / drawnRadius,
    "The committed radius is the dragged ~3× radius, not the drawn one.",
  ).toBeGreaterThan(2.9);
  expect(circle!.radius! / drawnRadius).toBeLessThan(3.1);
  expect(centre.position[0]).toBeCloseTo(centreBefore.position[0], 6);
  expect(centre.position[1]).toBeCloseTo(centreBefore.position[1], 6);
});

// ── Circle rim drag: after deleting the deliberately added diameter ─────

test("T12c: after deleting the deliberately added diameter, rim drag grows the radius while centre stays fixed", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawCircle(workbench, { x: 400, y: 400 }, { x: 500, y: 400 });

  // T13a: the diameter is added deliberately (the Circle tool authors none),
  // at the drawn size so the rim stays at 500 px.
  const radius = await sketchRadiusOf(workbench, { x: 400, y: 400 }, 100);
  await addDiameterWithDimensionTool(
    workbench,
    { x: 500, y: 400 },
    { x: 560, y: 320 },
    2 * radius,
  );

  // Select the diameter annotation and delete it.
  const diameterGlyph = page.locator(
    '[data-sketch-annotation-kind="dimension"]',
  );
  await diameterGlyph.first().click();
  await workbench.waitForAnimationFrames(2);
  await waitForCommittedAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Delete"),
  );
  await expect(diameterGlyph).toHaveCount(0);

  // Drag rim 200 px outward (500 → 700). Now unconstrained, the radius
  // should change. Initial ~2.4 sketch units → post-drag ~7.1 units.
  await committedDrag(workbench, { x: 500, y: 400 }, { x: 700, y: 400 });

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  const centre = committed!.points.find((p) => p.id === circle!.centerPointId)!;

  // Radius should have grown past the initial. Threshold 4.0 discriminates:
  // initial 100 px ≈ 2.4 units (fails), dragged 300 px ≈ 7.1 units (passes).
  expect(
    circle!.radius!,
    "Radius should have grown after rim drag (dimension deleted).",
  ).toBeGreaterThan(4.0);
  // Centre unchanged (still in drawn quadrant).
  expect(centre.position[0], "Centre X unchanged.").toBeLessThan(0);
  expect(centre.position[1], "Centre Y unchanged.").toBeGreaterThan(0);
});

// ── Circle centre drag ──────────────────────────────────────────────────

test("T12c: dragging a circle centre translates the circle", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  await workbench.activateTool("Create circular geometry.");
  await glideClick(workbench, { x: 500, y: 400 });
  await glideClick(workbench, { x: 600, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  await committedDrag(workbench, { x: 500, y: 400 }, { x: 500, y: 600 });

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  const centre = committed!.points.find((p) => p.id === circle!.centerPointId)!;

  expect(centre.position[1], "Centre Y below origin.").toBeLessThan(0);
  expect(circle!.radius!, "Radius positive.").toBeGreaterThan(1);
  expect(circle!.radius!, "Radius not grown.").toBeLessThan(5);
});

// ── Spline body drag ────────────────────────────────────────────────────

/** F3 bound on the spline body drag's deviation from a translation (T17b.md). */
const SPLINE_BODY_RIGIDITY = 1e-6;

test("T12c: dragging a spline body translates all fit points", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  await workbench.activateTool("Create spline geometry.");
  for (const at of [
    { x: 300, y: 400 },
    { x: 450, y: 300 },
    { x: 600, y: 400 },
  ])
    await glideClick(workbench, at);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  const before = await readLivePoints(workbench);
  // (375,350) is on the spline curve per hover diagnostic. One gliding
  // drag, one committed action (T17b: no frame-count wait).
  await committedDrag(workbench, { x: 375, y: 350 }, { x: 375, y: 650 });

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  expect(committed!.points.length).toBeGreaterThanOrEqual(3);

  // T17b (F3): rigid = every fit point moved by the same vector. The
  // largest deviation from the common displacement measured 8.9e-16 (a
  // translation up to rounding, T17b.md); the bound keeps a wide margin and
  // is far below any reshaping drag (sketch units; one pixel ≈ 0.024).
  const moves = committed!.points.map((point) => {
    const start = before.find((entry) => entry.id === point.id)!.position;
    return [point.position[0] - start[0], point.position[1] - start[1]];
  });
  const mean = [0, 1].map(
    (axis) => moves.reduce((sum, move) => sum + move[axis]!, 0) / moves.length,
  );
  const deviation = Math.max(
    ...moves.map((move) =>
      Math.hypot(move[0]! - mean[0]!, move[1]! - mean[1]!),
    ),
  );
  console.log(
    `F3 spline body drag: deviation ${deviation}, mean move ${JSON.stringify(mean)}`,
  );
  expect(
    deviation,
    "every fit point moved by the same vector (rigid)",
  ).toBeLessThan(SPLINE_BODY_RIGIDITY);
  expect(mean[1]!, "the spline moved down with the pointer").toBeLessThan(-5);
  const ys = committed!.points.map((p) => p.position[1]);
  const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
  expect(meanY, "All fit points below origin.").toBeLessThan(-1);
});

// ── T12f: drag feedback cue ─────────────────────────────────────────────

test("T12f: dragging a fixed circle centre shows a feedback cue that disappears after release", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  // Draw a circle at (500,400). The T12c centre-drag test proves the
  // centre point at (500,400) is reliably pickable.
  await workbench.activateTool("Create circular geometry.");
  await glideClick(workbench, { x: 500, y: 400 });
  await glideClick(workbench, { x: 600, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  // Fix the centre point: activate Fix Geometry, then click the centre.
  await page.getByRole("button", { name: "Fix Geometry" }).click();
  await workbench.waitForAnimationFrames(2);
  // (A gliding press, committed as one "Fix Geometry" action.)
  await waitForCommittedAction(page, "Fix Geometry", () =>
    glideClick(workbench, { x: 500, y: 400 }),
  );
  // Escape out of the constraint tool.
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");

  // Now drag the centre point (which is now fixed + has radius dimension =
  // fully constrained), with a plain press-move-release.
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 600, { steps: 10 });
  await workbench.waitForAnimationFrames(8);

  // The feedback cue MUST appear (the centre is fixed, so it can't move).
  const cueDuringDrag = await page
    .locator('[data-testid="sketch-drag-feedback-cue"]')
    .count();
  expect(
    cueDuringDrag,
    "T12f: feedback cue must appear during drag of a fixed centre.",
  ).toBeGreaterThan(0);

  // Release.
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);

  const cueAfterRelease = await page
    .locator('[data-testid="sketch-drag-feedback-cue"]')
    .count();
  expect(
    cueAfterRelease,
    "T12f: feedback cue must disappear after release.",
  ).toBe(0);

  await finishSketch(workbench);
});

test("T12f: dragging the rim of a circle with a deliberately added diameter shows a feedback cue, the diameter blocks it, no Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  // Draw a circle at (500,400) with rim at (600,400), then dimension its
  // diameter deliberately with the Dimension tool (T13a: the Circle tool
  // authors no size) at the drawn size, so the rim stays at 600 px.
  await drawCircle(workbench, { x: 500, y: 400 }, { x: 600, y: 400 });
  const radius = await sketchRadiusOf(workbench, { x: 500, y: 400 }, 100);
  const diameter = Number((2 * radius).toFixed(4));
  await addDiameterWithDimensionTool(
    workbench,
    { x: 600, y: 400 },
    { x: 660, y: 320 },
    diameter,
  );
  const diameterGlyph = page.locator(
    '[data-sketch-annotation-kind="dimension"]',
  );

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");

  // Drag the rim outward. Entity-curve picks depend on tessellation
  // alignment (T12c report); hover first to warm the pick target.
  await page.mouse.move(box.x + 600, box.y + 400, {
    steps: 8,
  });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.move(box.x + 750, box.y + 400, { steps: 8 });
  await workbench.waitForAnimationFrames(6);

  // Check for the feedback cue during the drag.
  const cueDuringDrag = await page
    .locator('[data-testid="sketch-drag-feedback-cue"]')
    .count();

  // Release.
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);

  const cueAfterRelease = await page
    .locator('[data-testid="sketch-drag-feedback-cue"]')
    .count();

  expect(
    cueDuringDrag,
    "T12f: feedback cue must appear during rim drag of a dimensioned circle.",
  ).toBeGreaterThan(0);
  expect(
    cueAfterRelease,
    "T12f: feedback cue must disappear after release.",
  ).toBe(0);

  // No Undo step for the blocked drag: Ctrl+Z undoes the diameter addition
  // (its annotation goes, the circle stays).
  await page.keyboard.press("Control+z");
  await expect(diameterGlyph).toHaveCount(0);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  // Redo, finish, verify the diameter and the radius unchanged.
  await page.keyboard.press("Control+Shift+z");
  await expect(diameterGlyph).toHaveCount(1);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  expect(
    circle!.radius!,
    "Radius must NOT have grown (the deliberate diameter blocks the drag).",
  ).toBeCloseTo(diameter / 2, 3);
  const diameters = await page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            dimensions?: Array<{
              kind: string;
              value?: { value?: number };
            }>;
          };
        };
      }>;
    };
    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.dimensions?.map((dimension) => [
          dimension.kind,
          dimension.value?.value ?? null,
        ]) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);
  expect(diameters, "The deliberate diameter keeps its value.").toEqual([
    ["diameter", diameter],
  ]);
});

// ── T12g: repeated gestures → two Undo steps ────────────────────────────

test("T12g: two consecutive drags of different targets in one sketch produce two Undo steps; each Undo restores the prior state, two Redos restore the final state", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  // Draw two separate lines:
  //   Line 1: (300,300) to (500,300) — body midpoint (400,300)
  //   Line 2: (600,500) to (800,500) — body midpoint (700,500)
  await drawLine(workbench, { x: 300, y: 300 }, { x: 500, y: 300 });
  // Second line: inline to avoid drawLine's "1 entities staged" assertion.
  await workbench.activateTool("Create line geometry.");
  await glideClick(workbench, { x: 600, y: 500 });
  await glideClick(workbench, { x: 800, y: 500 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("2 entities staged");
  await workbench.page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 5_000 })
    .toMatch(/collecting|editing/);

  // Read initial geometry (4 points: 2 per line).
  const snap0 = await readLivePoints(workbench);
  expect(snap0.length).toBeGreaterThanOrEqual(4);

  // ── Drag 1: body of line 1 down 80px (400,300 → 400,380). ──
  await committedDrag(workbench, { x: 400, y: 300 }, { x: 400, y: 380 });
  const snap1 = await readLivePoints(workbench);
  // Line 1's points (indices 0,1) should have moved down.
  expect(
    snap1[0]!.position[1],
    "After drag 1, line 1 point 0 Y should be below initial.",
  ).toBeLessThan(snap0[0]!.position[1] - 0.5);
  expect(
    snap1[1]!.position[1],
    "After drag 1, line 1 point 1 Y should be below initial.",
  ).toBeLessThan(snap0[1]!.position[1] - 0.5);
  // Line 2's points (indices 2,3) should be unchanged.
  expect(
    Math.abs(snap1[2]!.position[1] - snap0[2]!.position[1]),
    "After drag 1, line 2 point 0 Y should be unchanged.",
  ).toBeLessThan(0.1);

  // ── Drag 2: body of line 2 up 80px (700,500 → 700,420). ──
  await committedDrag(workbench, { x: 700, y: 500 }, { x: 700, y: 420 });
  const snap2 = await readLivePoints(workbench);
  // Line 2's points should have moved up.
  expect(
    snap2[2]!.position[1],
    "After drag 2, line 2 point 0 Y should be above its drag 1 position.",
  ).toBeGreaterThan(snap1[2]!.position[1] + 0.5);
  // Line 1's points should be unchanged from drag 1.
  expect(
    Math.abs(snap2[0]!.position[1] - snap1[0]!.position[1]),
    "After drag 2, line 1 point 0 Y should be unchanged.",
  ).toBeLessThan(0.3);

  // ── Undo 1: should restore state after drag 1 (before drag 2). ──
  await waitForUndoneAction(page, MOVE, () => page.keyboard.press("Control+z"));
  const afterUndo1 = await readLivePoints(workbench);
  for (const pt of afterUndo1) {
    const s1Pt = snap1.find((p) => p.id === pt.id)!;
    expect(
      Math.abs(pt.position[0] - s1Pt.position[0]),
      `Undo 1: point ${pt.id} X should match state after drag 1.`,
    ).toBeLessThan(0.3);
    expect(
      Math.abs(pt.position[1] - s1Pt.position[1]),
      `Undo 1: point ${pt.id} Y should match state after drag 1.`,
    ).toBeLessThan(0.3);
  }

  // ── Undo 2: should restore initial state (before any drag). ──
  await waitForUndoneAction(page, MOVE, () => page.keyboard.press("Control+z"));
  const afterUndo2 = await readLivePoints(workbench);
  for (const pt of afterUndo2) {
    const s0Pt = snap0.find((p) => p.id === pt.id)!;
    expect(
      Math.abs(pt.position[0] - s0Pt.position[0]),
      `Undo 2: point ${pt.id} X should match initial state.`,
    ).toBeLessThan(0.3);
    expect(
      Math.abs(pt.position[1] - s0Pt.position[1]),
      `Undo 2: point ${pt.id} Y should match initial state.`,
    ).toBeLessThan(0.3);
  }

  // ── Redo twice: should restore the final state. ──
  await waitForRedoneAction(page, MOVE, () =>
    page.keyboard.press("Control+Shift+z"),
  );
  await waitForRedoneAction(page, MOVE, () =>
    page.keyboard.press("Control+Shift+z"),
  );
  const afterRedos = await readLivePoints(workbench);
  for (const pt of afterRedos) {
    const s2Pt = snap2.find((p) => p.id === pt.id)!;
    expect(
      Math.abs(pt.position[0] - s2Pt.position[0]),
      `Redo 2: point ${pt.id} X should match final state.`,
    ).toBeLessThan(0.3);
    expect(
      Math.abs(pt.position[1] - s2Pt.position[1]),
      `Redo 2: point ${pt.id} Y should match final state.`,
    ).toBeLessThan(0.3);
  }

  await finishSketch(workbench);
});

// ── T12g: same world-space displacement at two zoom levels ──────────────

// Wheel zoom keeps the viewport centre (the sketch origin) fixed. The line
// starts off the origin and the axes: a point placed on the origin snaps to it
// and is fixed there (T13-D19), so it could not be dragged.
const ZOOM_CENTRE = { x: 720, y: 480 };
const LINE_START = { x: 800, y: 400 };
const LINE_END = { x: 1000, y: 400 };

async function zoomInAtCentre(workbench: SketchWorkbenchHarness) {
  await workbench.hoverViewportAt(ZOOM_CENTRE);
  for (let i = 0; i < 7; i++) {
    await workbench.page.mouse.wheel(0, -120);
  }
  await workbench.waitForAnimationFrames(6);
}

/**
 * The screen position of the line's start after a zoom about the centre: it
 * moved outward along the ray from the centre, so hover along that ray (Line
 * is armed) until the endpoint snap shows, and read its indicator.
 */
async function locateLineStart(workbench: SketchWorkbenchHarness) {
  // A geometry drag disarms the drawing tool (`startDragWithIntent` sets
  // `activeTool: null`), so re-arm Line to get hover snaps again.
  await workbench.activateTool("Create line geometry.");
  const viewport = await workbench.viewport().boundingBox();
  if (!viewport) throw new Error("No viewport.");
  const dx = LINE_START.x - ZOOM_CENTRE.x;
  const dy = LINE_START.y - ZOOM_CENTRE.y;
  const length = Math.hypot(dx, dy);
  for (let radius = length; radius < 400; radius += 10) {
    await workbench.hoverViewportAt({
      x: ZOOM_CENTRE.x + (dx / length) * radius,
      y: ZOOM_CENTRE.y + (dy / length) * radius,
    });
    await workbench.waitForAnimationFrames(2);
    const indicator = workbench.page.locator(
      '[data-sketch-viewport-geometry="snapIndicator"][data-sketch-snap-kind="endpoint"]',
    );
    if ((await indicator.count()) > 0) {
      const box = await indicator.first().boundingBox();
      if (!box) throw new Error("Snap indicator not visible.");
      return {
        x: Math.round(box.x + box.width / 2 - viewport.x),
        y: Math.round(box.y + box.height / 2 - viewport.y),
      };
    }
  }
  throw new Error("The line start was not found after zooming.");
}

test("T12g: the same world-space displacement applied at 1× and ~2× zoom gives the same committed geometry within 1-px quantization tolerance", async ({
  page,
}) => {
  // Viewport 1440×960; sketch origin at viewport centre (720,480).
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawLine(workbench, LINE_START, LINE_END);

  // ── Measure world-units-per-pixel at 1× zoom empirically. ──
  // Drag point 0 exactly 100px right, observe world delta.
  const init1x = await readLivePoints(workbench);
  await committedDrag(workbench, LINE_START, {
    x: LINE_START.x + 100,
    y: LINE_START.y,
  });
  const after1x = await readLivePoints(workbench);
  const delta1x = after1x[0]!.position[0] - init1x[0]!.position[0];
  const wupp1x = delta1x / 100; // world-units-per-pixel at 1×
  expect(
    delta1x,
    "1× drag must produce a positive displacement.",
  ).toBeGreaterThan(0.5);
  await waitForUndoneAction(page, MOVE, () => page.keyboard.press("Control+z"));

  // ── Zoom in at the centre; find point 0 on screen again. ──
  await zoomInAtCentre(workbench);
  const start2x = await locateLineStart(workbench);

  // ── Measure world-units-per-pixel at the zoomed level. ──
  // Probe: drag point 0 by 60px right, observe world delta, undo.
  const initProbe = await readLivePoints(workbench);
  await committedDrag(workbench, start2x, { x: start2x.x + 60, y: start2x.y });
  const afterProbe = await readLivePoints(workbench);
  const deltaProbe = afterProbe[0]!.position[0] - initProbe[0]!.position[0];
  const wupp2x = deltaProbe / 60; // world-units-per-pixel at zoomed level
  expect(
    wupp2x,
    "Zoomed wupp must be smaller than 1× (zoom happened).",
  ).toBeLessThan(wupp1x * 0.9);
  await waitForUndoneAction(page, MOVE, () => page.keyboard.press("Control+z"));

  // ── Apply the same world-space displacement (delta1x) at zoomed level. ──
  const pixelsNeeded = Math.round(delta1x / wupp2x);
  const init2x = await readLivePoints(workbench);
  await committedDrag(workbench, start2x, {
    x: start2x.x + pixelsNeeded,
    y: start2x.y,
  });
  const after2x = await readLivePoints(workbench);
  const delta2x = after2x[0]!.position[0] - init2x[0]!.position[0];

  // Tolerance: ±1 pixel at the coarser (1×) zoom = wupp1x world units.
  // At the default orthographic camera (frustum 32, viewport 960px):
  // wupp1x ≈ 32/1/960 ≈ 0.033 world units.
  const tolerance = wupp1x;
  expect(
    Math.abs(delta2x - delta1x),
    `World-space X displacement must match: 1×=${delta1x.toFixed(4)}, ` +
      `2×=${delta2x.toFixed(4)}, tol=${tolerance.toFixed(4)} (1px at 1×).`,
  ).toBeLessThan(tolerance);

  await finishSketch(workbench);
});

test("T12g: a press within the grab radius but off the point does not cause a position jump at either zoom level", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawLine(workbench, LINE_START, LINE_END);

  // Read initial.
  const initPts = await readLivePoints(workbench);

  // ── Test at 1× zoom: press 8px from point 0, release immediately. ──
  // The grab radius is 12px (entry), so 8px is within grab but offset.
  // A no-movement release (press and up at the same spot) should not move
  // the point.
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("No viewport.");
  await page.mouse.move(box.x + LINE_START.x + 8, box.y + LINE_START.y, {
    steps: 8,
  });
  await page.mouse.down();
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);

  const afterClick1x = await readLivePoints(workbench);
  expect(
    Math.abs(afterClick1x[0]!.position[0] - initPts[0]!.position[0]),
    "1× zoom: off-centre press-release must not jump point X.",
  ).toBeLessThan(0.05);
  expect(
    Math.abs(afterClick1x[0]!.position[1] - initPts[0]!.position[1]),
    "1× zoom: off-centre press-release must not jump point Y.",
  ).toBeLessThan(0.05);

  // ── Zoom in at the centre, find point 0 again and repeat. ──
  await zoomInAtCentre(workbench);
  const start2x = await locateLineStart(workbench);
  // Press 8px to the right of point 0.
  await page.mouse.move(box.x + start2x.x + 8, box.y + start2x.y, {
    steps: 8,
  });
  await page.mouse.down();
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);

  const afterClick2x = await readLivePoints(workbench);
  expect(
    Math.abs(afterClick2x[0]!.position[0] - initPts[0]!.position[0]),
    "2× zoom: off-centre press-release must not jump point X.",
  ).toBeLessThan(0.05);
  expect(
    Math.abs(afterClick2x[0]!.position[1] - initPts[0]!.position[1]),
    "2× zoom: off-centre press-release must not jump point Y.",
  ).toBeLessThan(0.05);

  await finishSketch(workbench);
});
