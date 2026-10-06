import { expect, test } from "@playwright/test";
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
  await workbench.clickViewportAt(p1);
  await workbench.clickViewportAt(p2);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await workbench.page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");
}

async function viewportDrag(
  workbench: SketchWorkbenchHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) {
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");
  await workbench.page.mouse.move(box.x + from.x, box.y + from.y);
  await workbench.page.mouse.down();
  await workbench.page.mouse.move(box.x + to.x, box.y + to.y, { steps });
  // Let the RAF-coalesced move fire before releasing.
  await workbench.waitForAnimationFrames(2);
  await workbench.page.mouse.up();
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
  await page.mouse.move(box.x + 400, box.y + 300);
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

  await viewportDrag(workbench, { x: 360, y: 260 }, { x: 500, y: 260 });
  await workbench.waitForAnimationFrames(4);

  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await page.keyboard.press("Control+Shift+z");
  await workbench.waitForAnimationFrames(4);
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

  await viewportDrag(workbench, { x: 450, y: 300 }, { x: 450, y: 650 });
  await workbench.waitForAnimationFrames(3);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const y0 = committed!.points[0]!.position[1];
  const y1 = committed!.points[1]!.position[1];
  expect(Math.abs(y0 - y1), "Rigid body translation.").toBeLessThan(0.5);
  expect(y0, "Point 0 Y below origin.").toBeLessThan(-1);
  expect(y1, "Point 1 Y below origin.").toBeLessThan(-1);
});

// ── Circle rim drag: dimensioned circle (blocked) ───────────────────────

test("T12c: rim drag on a freshly drawn (radius-dimensioned) circle is blocked — radius and centre unchanged, no Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 400, y: 400 });
  await workbench.clickViewportAt({ x: 500, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  // Attempt a rim drag outward.
  await viewportDrag(workbench, { x: 500, y: 400 }, { x: 700, y: 400 });
  await workbench.waitForAnimationFrames(3);

  // Ctrl+Z should undo the circle draw (0 entities), not a drag.
  // If the blocked drag had created an Undo step, we'd still see 1 entity.
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("0 entities staged");

  // Redo to restore circle, finish, verify radius and centre unchanged.
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  const centre = committed!.points.find((p) => p.id === circle!.centerPointId)!;

  // Radius should be the initial authored value (~2.4 units, < 4).
  expect(
    circle!.radius!,
    "Radius should NOT have grown (dimension blocks the drag).",
  ).toBeLessThan(4);
  // Centre should be in the drawn quadrant (negative X, positive Y).
  expect(centre.position[0]).toBeLessThan(0);
  expect(centre.position[1]).toBeGreaterThan(0);
});

// ── Circle rim drag: after deleting the radius dimension ────────────────

test("T12c: after deleting the radius dimension, rim drag grows the radius while centre stays fixed", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 400, y: 400 });
  await workbench.clickViewportAt({ x: 500, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  // Select the radius dimension annotation and delete it.
  // The annotation's aria-label matches "Circle 1 radius: NN.NN mm radius".
  await page.locator('[aria-label*="radius"]').first().click();
  await workbench.waitForAnimationFrames(2);
  await page.keyboard.press("Delete");
  await workbench.waitForAnimationFrames(4);

  // Drag rim 200 px outward (500 → 700). Now unconstrained, the radius
  // should change. Initial ~2.4 sketch units → post-drag ~7.1 units.
  await viewportDrag(workbench, { x: 500, y: 400 }, { x: 700, y: 400 });
  await workbench.waitForAnimationFrames(3);

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
  await workbench.clickViewportAt({ x: 500, y: 400 });
  await workbench.clickViewportAt({ x: 600, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  await viewportDrag(workbench, { x: 500, y: 400 }, { x: 500, y: 600 });
  await workbench.waitForAnimationFrames(3);

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

test("T12c: dragging a spline body translates all fit points", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 300, y: 400 });
  await workbench.clickViewportAt({ x: 450, y: 300 });
  await workbench.clickViewportAt({ x: 600, y: 400 });
  await page.keyboard.press("Enter");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  // (375,350) is on the spline curve per hover diagnostic.
  await viewportDrag(workbench, { x: 375, y: 350 }, { x: 375, y: 650 });
  await workbench.waitForAnimationFrames(3);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  expect(committed!.points.length).toBeGreaterThanOrEqual(3);

  const ys = committed!.points.map((p) => p.position[1]);
  const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
  for (let i = 0; i < ys.length; i++) {
    expect(
      Math.abs(ys[i]! - meanY),
      `Fit point ${i} Y near group mean (rigid).`,
    ).toBeLessThan(2.0);
  }
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
  await workbench.clickViewportAt({ x: 500, y: 400 });
  await workbench.clickViewportAt({ x: 600, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  // Fix the centre point: activate Fix Geometry, then click the centre.
  await page.getByRole("button", { name: "Fix Geometry" }).click();
  await workbench.waitForAnimationFrames(2);
  await page.mouse.click(
    (await workbench.viewport().boundingBox())!.x + 500,
    (await workbench.viewport().boundingBox())!.y + 400,
  );
  await workbench.waitForAnimationFrames(4);
  // Escape out of the constraint tool.
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");

  // Now drag the centre point (which is now fixed + has radius dimension =
  // fully constrained). Use viewportDrag which is proven reliable.
  await page.mouse.move(box.x + 500, box.y + 400);
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

test("T12f: dragging the rim of a freshly drawn (radius-dimensioned) circle shows a feedback cue, radius stays unchanged, no Undo step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);

  // Draw a circle at (500,400) with rim at (600,400). The circle tool
  // auto-creates a radius dimension, so the rim is constrained.
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 500, y: 400 });
  await workbench.clickViewportAt({ x: 600, y: 400 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");

  // Drag the rim outward. Entity-curve picks depend on tessellation
  // alignment (T12c report); hover first to warm the pick target.
  await page.mouse.move(box.x + 600, box.y + 400);
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

  // The rim drag on a dimensioned circle should produce a feedback cue.
  // The cue depends on the rim pick succeeding (tessellation-dependent);
  // when it does, it must appear and then clear.
  expect(
    cueDuringDrag,
    "T12f: feedback cue must appear during rim drag of a dimensioned circle.",
  ).toBeGreaterThan(0);
  expect(
    cueAfterRelease,
    "T12f: feedback cue must disappear after release.",
  ).toBe(0);

  // Ctrl+Z should undo the circle draw (0 entities), not a drag — no Undo
  // step was recorded for the blocked drag.
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("0 entities staged");

  // Redo, finish, verify radius unchanged.
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const circle = committed!.entities.find((e) => e.kind === "circle");
  expect(circle).toBeDefined();
  // Radius should be the initial authored value (~2.4 units, < 4).
  expect(
    circle!.radius!,
    "Radius must NOT have grown (dimension blocks the drag).",
  ).toBeLessThan(4);
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
  await workbench.clickViewportAt({ x: 600, y: 500 });
  await workbench.clickViewportAt({ x: 800, y: 500 });
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
  await viewportDrag(workbench, { x: 400, y: 300 }, { x: 400, y: 380 });
  await workbench.waitForAnimationFrames(4);
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
  await viewportDrag(workbench, { x: 700, y: 500 }, { x: 700, y: 420 });
  await workbench.waitForAnimationFrames(4);
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
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);
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
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);
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
  await page.keyboard.press("Control+Shift+z");
  await workbench.waitForAnimationFrames(4);
  await page.keyboard.press("Control+Shift+z");
  await workbench.waitForAnimationFrames(4);
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

test("T12g: the same world-space displacement applied at 1× and ~2× zoom gives the same committed geometry within 1-px quantization tolerance", async ({
  page,
}) => {
  // Viewport 1440×960; sketch origin at viewport centre (720,480).
  // Zoom centred on the origin keeps it at (720,480) on screen.
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await drawLine(workbench, { x: 720, y: 480 }, { x: 920, y: 480 });

  // ── Measure world-units-per-pixel at 1× zoom empirically. ──
  // Drag point 0 exactly 100px right, observe world delta.
  const init1x = await readLivePoints(workbench);
  await viewportDrag(workbench, { x: 720, y: 480 }, { x: 820, y: 480 });
  await workbench.waitForAnimationFrames(4);
  const after1x = await readLivePoints(workbench);
  const delta1x = after1x[0]!.position[0] - init1x[0]!.position[0];
  const wupp1x = delta1x / 100; // world-units-per-pixel at 1×
  expect(
    delta1x,
    "1× drag must produce a positive displacement.",
  ).toBeGreaterThan(0.5);
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);

  // ── Zoom in at the origin. ──
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("No viewport.");
  await page.mouse.move(box.x + 720, box.y + 480);
  for (let i = 0; i < 7; i++) {
    await page.mouse.wheel(0, -120);
  }
  await workbench.waitForAnimationFrames(6);

  // ── Measure world-units-per-pixel at the zoomed level. ──
  // Probe: drag point 0 by 60px right, observe world delta, undo.
  const initProbe = await readLivePoints(workbench);
  await viewportDrag(workbench, { x: 720, y: 480 }, { x: 780, y: 480 });
  await workbench.waitForAnimationFrames(4);
  const afterProbe = await readLivePoints(workbench);
  const deltaProbe = afterProbe[0]!.position[0] - initProbe[0]!.position[0];
  const wupp2x = deltaProbe / 60; // world-units-per-pixel at zoomed level
  expect(
    wupp2x,
    "Zoomed wupp must be smaller than 1× (zoom happened).",
  ).toBeLessThan(wupp1x * 0.9);
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);

  // ── Apply the same world-space displacement (delta1x) at zoomed level. ──
  const pixelsNeeded = Math.round(delta1x / wupp2x);
  const init2x = await readLivePoints(workbench);
  await viewportDrag(
    workbench,
    { x: 720, y: 480 },
    { x: 720 + pixelsNeeded, y: 480 },
  );
  await workbench.waitForAnimationFrames(4);
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
  // Place point 0 at the viewport centre (720,480) = sketch origin.
  // Zoom at (720,480) keeps the origin at the same screen pixel.
  await drawLine(workbench, { x: 720, y: 480 }, { x: 920, y: 480 });

  // Read initial.
  const initPts = await readLivePoints(workbench);

  // ── Test at 1× zoom: press 8px from point 0, release immediately. ──
  // The grab radius is 12px (entry), so 8px is within grab but offset.
  // A no-movement release (press and up at the same spot) should not move
  // the point.
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("No viewport.");
  await page.mouse.move(box.x + 728, box.y + 480);
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

  // ── Zoom in at the origin (720,480) and repeat. ──
  await page.mouse.move(box.x + 720, box.y + 480);
  for (let i = 0; i < 7; i++) {
    await page.mouse.wheel(0, -120);
  }
  await workbench.waitForAnimationFrames(6);

  // After zoom centred on the origin, the origin is still at (720,480).
  // Press 8px to the right of (720,480).
  await page.mouse.move(box.x + 728, box.y + 480);
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
