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
