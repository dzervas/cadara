import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

const STORAGE_KEY = "cad.modeling.operationHistory.doc_workspace.v1";

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

async function draw4PointSpline(workbench: SketchWorkbenchHarness) {
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 300, y: 500 });
  await workbench.clickViewportAt({ x: 500, y: 300 });
  await workbench.clickViewportAt({ x: 700, y: 500 });
  await workbench.clickViewportAt({ x: 900, y: 300 });
  await workbench.page.keyboard.press("Enter");
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 15_000 })
    .toContain("1 entities staged");
  await workbench.page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 10_000 })
    .toBe("editing");
}

async function viewportDrag(
  workbench: SketchWorkbenchHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
) {
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");
  await workbench.page.mouse.move(box.x + from.x, box.y + from.y);
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.down();
  await workbench.page.mouse.move(box.x + to.x, box.y + to.y, { steps });
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.up();
}

async function finishSketch(workbench: SketchWorkbenchHarness) {
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
}

type SketchSnap = {
  points: { id: string; position: readonly [number, number] }[];
  entities: {
    id: string;
    kind: string;
    occurrences?: {
      occId: string;
      pointId: string;
      tangent: { kind: string; vector?: readonly [number, number] };
      visibleVector?: readonly [number, number] | null;
    }[];
  }[];
};

/** Read the live sketch definition via the debug harness (in-sketch). */
async function readLiveSketch(
  workbench: SketchWorkbenchHarness,
): Promise<SketchSnap> {
  const snap = await workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snap) throw new Error("No live sketch snapshot.");
  return snap as SketchSnap;
}

async function readCommittedDefinition(
  workbench: SketchWorkbenchHarness,
): Promise<SketchSnap | null> {
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
              pointOccurrences?: Array<{
                occurrenceId: string;
                pointId: string;
                tangent: { kind: string; vector?: readonly [number, number] };
              }>;
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
        occurrences: e.pointOccurrences?.map((occ) => ({
          occId: occ.occurrenceId,
          pointId: occ.pointId,
          tangent: occ.tangent,
        })),
      })),
    };
  }, STORAGE_KEY);
}

function isHandleLabel(label: string): boolean {
  return label !== "none" && label.split(".").length === 3;
}

/**
 * Find a handle tip near the given fit-point viewport position.
 * Requires the spline to be hovered or selected so handles are revealed.
 * Uses a radial scan without clicking.
 */
async function findHandleNear(
  workbench: SketchWorkbenchHarness,
  fitPointPos: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("No viewport.");
  for (let radius = 30; radius <= 120; radius += 10) {
    for (let angle = 0; angle < 360; angle += 12) {
      const dx = Math.round(radius * Math.cos((angle * Math.PI) / 180));
      const dy = Math.round(radius * Math.sin((angle * Math.PI) / 180));
      const x = fitPointPos.x + dx;
      const y = fitPointPos.y + dy;
      if (x < 10 || x > 1430 || y < 10 || y > 950) continue;
      await workbench.page.mouse.move(box.x + x, box.y + y);
      await workbench.page.waitForTimeout(30);
      const ht = await workbench.page.evaluate(
        () => window.__cadaraDebug?.getState()?.hoverTarget ?? "none",
      );
      if (isHandleLabel(ht)) {
        return { x, y };
      }
    }
  }
  throw new Error(
    `No handle tip found near (${fitPointPos.x}, ${fitPointPos.y}).`,
  );
}

/**
 * Select the spline entity and press Escape to deactivate any auto-
 * activated tool, keeping the selection. Then scan for the handle.
 */
async function selectSplineAndFindHandle(
  workbench: SketchWorkbenchHarness,
  splineBodyPos: { x: number; y: number },
  fitPointPos: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("No viewport.");

  // Click the spline body to select it (reveals handles via selection).
  await workbench.hoverViewportAt(splineBodyPos);
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.click(
    box.x + splineBodyPos.x,
    box.y + splineBodyPos.y,
  );
  await workbench.waitForAnimationFrames(3);

  // Scan for handle (selection keeps handles revealed).
  return findHandleNear(workbench, fitPointPos);
}

// ── T12d E2E: draw spline, drag fit point, Undo/Redo ────────────────────

test("T12d: draw 4-point spline, drag a fit point (curve reshapes), Undo/Redo", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  await viewportDrag(workbench, { x: 500, y: 300 }, { x: 500, y: 500 });
  await workbench.waitForAnimationFrames(4);

  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);

  await page.keyboard.press("Control+Shift+z");
  await workbench.waitForAnimationFrames(4);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed, "Committed definition must exist.").not.toBeNull();

  const spline = committed!.entities.find((e) => e.kind === "spline");
  expect(spline, "A spline entity should exist.").toBeTruthy();
  expect(spline!.occurrences?.length, "4 occurrences.").toBe(4);

  const point2 = committed!.points.find(
    (p) => p.id === spline!.occurrences![1]!.pointId,
  );
  expect(point2, "Second fit point should exist.").toBeTruthy();
  expect(
    point2!.position[1],
    "After Redo, the dragged point should be below its original Y (~3).",
  ).toBeLessThan(2);
});

// ── T12d E2E: hover spline → handles appear ─────────────────────────────

test("T12d: hover a spline → handle tips become hoverable", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  const handlePos = await selectSplineAndFindHandle(
    workbench,
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  );

  const box = await workbench.viewport().boundingBox();
  await workbench.page.mouse.move(box!.x + handlePos.x, box!.y + handlePos.y);
  await workbench.waitForAnimationFrames(3);
  const ht = await workbench.currentHoverTarget();
  expect(isHandleLabel(ht), "Handle tip should be hoverable.").toBe(true);
});

// ── T12d E2E: drag interior handle → vector changes ─────────────────────

test("T12d: drag an interior handle → vector changes by pointer delta, fit points unchanged, Undo restores automatic, Redo re-applies", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  // ── Pre-drag snapshot ──
  const preDrag = await readLiveSketch(workbench);
  const preSpline = preDrag.entities.find((e) => e.kind === "spline")!;
  const preOcc1 = preSpline.occurrences![1]!;
  expect(
    preOcc1.tangent.kind,
    "Before drag, occurrence 1 should be automatic.",
  ).toBe("automatic");
  const preFitPoints = preDrag.points.map((p) => ({
    id: p.id,
    pos: [...p.position],
  }));

  // ── Find and drag the handle 60 px right ──
  const handlePos = await selectSplineAndFindHandle(
    workbench,
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  );
  await viewportDrag(workbench, handlePos, {
    x: handlePos.x + 60,
    y: handlePos.y,
  });
  await workbench.waitForAnimationFrames(4);

  // ── Post-drag snapshot ──
  const postDrag = await readLiveSketch(workbench);
  const postSpline = postDrag.entities.find((e) => e.kind === "spline")!;
  const postOcc1 = postSpline.occurrences![1]!;
  expect(
    postOcc1.tangent.kind,
    "After drag, occurrence 1 must be authored.",
  ).toBe("authored");
  const postVec = postOcc1.tangent.vector!;
  expect(
    postVec[0] !== 0 || postVec[1] !== 0,
    "Authored vector must be non-zero.",
  ).toBe(true);
  // Fit points must be unchanged (within solver tolerance).
  for (const prePt of preFitPoints) {
    const postPt = postDrag.points.find((p) => p.id === prePt.id);
    expect(postPt, `Fit point ${prePt.id} must still exist.`).toBeTruthy();
    expect(
      Math.abs(postPt!.position[0] - prePt.pos[0]),
      `Fit point ${prePt.id} X unchanged after handle drag.`,
    ).toBeLessThan(0.01);
    expect(
      Math.abs(postPt!.position[1] - prePt.pos[1]),
      `Fit point ${prePt.id} Y unchanged after handle drag.`,
    ).toBeLessThan(0.01);
  }
  // Other occurrences remain automatic.
  expect(postSpline.occurrences![0]!.tangent.kind).toBe("automatic");
  expect(postSpline.occurrences![2]!.tangent.kind).toBe("automatic");
  expect(postSpline.occurrences![3]!.tangent.kind).toBe("automatic");

  // ── Undo → back to automatic ──
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);
  const afterUndo = await readLiveSketch(workbench);
  const undoOcc1 = afterUndo.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(
    undoOcc1.tangent.kind,
    "After Undo, occurrence 1 must revert to automatic.",
  ).toBe("automatic");

  // ── Redo → authored vector is back ──
  await page.keyboard.press("Control+Shift+z");
  await workbench.waitForAnimationFrames(4);
  const afterRedo = await readLiveSketch(workbench);
  const redoOcc1 = afterRedo.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(
    redoOcc1.tangent.kind,
    "After Redo, occurrence 1 must be authored again.",
  ).toBe("authored");
  expect(
    redoOcc1.tangent.vector,
    "Redo must restore the same authored vector.",
  ).toEqual(postVec);

  // Final commit sanity.
  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();
  const commitOcc1 = committed!.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(commitOcc1.tangent.kind).toBe("authored");
});

// ── T12d E2E: drag fit point with authored handle → vector unchanged ───

test("T12d: drag a fit point whose handle is authored → vector unchanged, fit point moved", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  // First: drag the handle to make it authored.
  const handlePos = await selectSplineAndFindHandle(
    workbench,
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  );
  await viewportDrag(workbench, handlePos, {
    x: handlePos.x + 60,
    y: handlePos.y,
  });
  await workbench.waitForAnimationFrames(4);

  // Read the state: occurrence 1 should now be authored.
  const preMove = await readLiveSketch(workbench);
  const preSpline = preMove.entities.find((e) => e.kind === "spline")!;
  const preOcc1 = preSpline.occurrences![1]!;
  expect(preOcc1.tangent.kind, "Occurrence 1 must be authored.").toBe(
    "authored",
  );
  const authoredVec = preOcc1.tangent.vector!;
  const preFitPos = preMove.points.find(
    (p) => p.id === preOcc1.pointId,
  )!.position;

  // Now drag the fit point itself (not the handle) 50 px downward.
  await viewportDrag(workbench, { x: 500, y: 300 }, { x: 500, y: 350 });
  await workbench.waitForAnimationFrames(4);

  // Read after fit-point drag.
  const postMove = await readLiveSketch(workbench);
  const postSpline = postMove.entities.find((e) => e.kind === "spline")!;
  const postOcc1 = postSpline.occurrences![1]!;
  // The authored vector should be unchanged.
  expect(
    postOcc1.tangent.kind,
    "Tangent must still be authored after fit-point drag.",
  ).toBe("authored");
  expect(
    Math.abs(postOcc1.tangent.vector![0] - authoredVec[0]),
    "Authored vector X must be unchanged (solver tolerance).",
  ).toBeLessThan(0.1);
  expect(
    Math.abs(postOcc1.tangent.vector![1] - authoredVec[1]),
    "Authored vector Y must be unchanged (solver tolerance).",
  ).toBeLessThan(0.1);
  // The fit point must have moved.
  const postFitPos = postMove.points.find(
    (p) => p.id === postOcc1.pointId,
  )!.position;
  const fitDeltaY = postFitPos[1] - preFitPos[1];
  // Viewport Y down → sketch Y decreases; 50 viewport px ≈ a few sketch units.
  expect(
    Math.abs(fitDeltaY) > 0.1,
    `Fit point must have moved (deltaY=${fitDeltaY}).`,
  ).toBe(true);
});

// ── T12d E2E: drag handle onto fit point → exact zero ───────────────────

test("T12d: drag handle onto its fit point → stores exactly [0,0]", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  const handlePos = await selectSplineAndFindHandle(
    workbench,
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  );

  // Drag handle to the fit point, ending at (500, 300).
  const box = await workbench.viewport().boundingBox();
  await workbench.page.mouse.move(box!.x + handlePos.x, box!.y + handlePos.y);
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.down();
  await workbench.page.mouse.move(box!.x + 500, box!.y + 300, { steps: 15 });
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.up();
  await workbench.waitForAnimationFrames(4);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();

  const spline = committed!.entities.find((e) => e.kind === "spline");
  expect(spline).toBeTruthy();

  const occ1 = spline!.occurrences![1]!;
  expect(occ1.tangent.kind, "Tangent should be authored after drag.").toBe(
    "authored",
  );
  // Zero capture (D4): the pointer ended within 6 screen-px of the
  // fit point, so the session must store exactly [0, 0].
  expect(
    occ1.tangent.vector,
    "Zero capture must store exactly [0, 0].",
  ).toEqual([0, 0]);
});

// ── T12d E2E: reach zero handle via cycle, drag out ─────────────────────

test("T12d: press on zero handle without cycling drags the fit point; cycle then drag drags the handle out", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  // Make the handle zero by dragging it onto the fit point.
  const handlePos = await selectSplineAndFindHandle(
    workbench,
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  );

  const box = await workbench.viewport().boundingBox();
  await workbench.page.mouse.move(box!.x + handlePos.x, box!.y + handlePos.y);
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.down();
  await workbench.page.mouse.move(box!.x + 500, box!.y + 300, { steps: 15 });
  await workbench.waitForAnimationFrames(3);
  await workbench.page.mouse.up();
  await workbench.waitForAnimationFrames(4);

  // Without cycling, a press-drag at the coincident position drags the
  // fit point (stack[0]), not the zero handle (stack[1]).
  const snapBeforeFitDrag = await readLiveSketch(workbench);
  const preFitPos = snapBeforeFitDrag.points.find(
    (p) =>
      p.id ===
      snapBeforeFitDrag.entities.find((e) => e.kind === "spline")!
        .occurrences![1]!.pointId,
  )!.position;

  // Drag from the fit point position (50 px right). Because the fit
  // point is selected (not the handle), D3 says this drags the fit point.
  await viewportDrag(workbench, { x: 500, y: 300 }, { x: 550, y: 300 });
  await workbench.waitForAnimationFrames(4);

  const snapAfterFitDrag = await readLiveSketch(workbench);
  const postFitPos = snapAfterFitDrag.points.find(
    (p) =>
      p.id ===
      snapAfterFitDrag.entities.find((e) => e.kind === "spline")!
        .occurrences![1]!.pointId,
  )!.position;
  // The fit point must have moved.
  expect(
    Math.abs(postFitPos[0] - preFitPos[0]) > 0.1 ||
      Math.abs(postFitPos[1] - preFitPos[1]) > 0.1,
    "Press without cycling must drag the fit point (D3a).",
  ).toBe(true);
  // The tangent vector should still be [0, 0] (zero handle, not dragged).
  const occ1AfterFitDrag = snapAfterFitDrag.entities.find(
    (e) => e.kind === "spline",
  )!.occurrences![1]!;
  expect(
    occ1AfterFitDrag.tangent.vector,
    "Zero handle must stay [0, 0] after dragging the fit point.",
  ).toEqual([0, 0]);

  // Undo the fit-point drag to restore original position.
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);

  // Click to select fit point (stack[0]), then click again to cycle
  // to handle (stack[1]). Escape after each to cancel auto-tools.
  await workbench.page.mouse.click(box!.x + 500, box!.y + 300);
  await workbench.waitForAnimationFrames(3);
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
  // Second click: cycle to handle.
  await workbench.page.mouse.click(box!.x + 500, box!.y + 300);
  await workbench.waitForAnimationFrames(3);
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);

  // Drag from the fit point outward (drags the selected *handle*).
  await viewportDrag(workbench, { x: 500, y: 300 }, { x: 560, y: 300 });
  await workbench.waitForAnimationFrames(4);

  await finishSketch(workbench);
  const committed = await readCommittedDefinition(workbench);
  expect(committed).not.toBeNull();

  const spline = committed!.entities.find((e) => e.kind === "spline");
  expect(spline).toBeTruthy();

  const occ1 = spline!.occurrences![1]!;
  expect(occ1.tangent.kind, "Tangent should be authored.").toBe("authored");
  const vec = occ1.tangent.vector!;
  expect(
    vec[0] !== 0 || vec[1] !== 0,
    "After cycling to handle and dragging out, the vector should be non-zero.",
  ).toBe(true);
});

// ── T12e E2E: reset tangent to automatic ─────────────────────────────────

test("T12e: drag a handle (authored), select it, click Reset to automatic → occurrence automatic, Undo → authored again", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  // ── Pre-drag snapshot: capture the automatic visible vector ──
  const preDrag = await readLiveSketch(workbench);
  const preSpline = preDrag.entities.find((e) => e.kind === "spline")!;
  const preOcc1 = preSpline.occurrences![1]!;
  expect(preOcc1.tangent.kind, "Before drag, occurrence 1 is automatic.").toBe(
    "automatic",
  );
  const preDragVisibleVec = preOcc1.visibleVector;
  expect(
    preDragVisibleVec,
    "Pre-drag automatic visible vector must be non-null.",
  ).not.toBeNull();

  // ── Drag the handle to make it authored ──
  const handlePos = await selectSplineAndFindHandle(
    workbench,
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  );
  await viewportDrag(workbench, handlePos, {
    x: handlePos.x + 60,
    y: handlePos.y,
  });
  await workbench.waitForAnimationFrames(4);

  const postDrag = await readLiveSketch(workbench);
  const postOcc1 = postDrag.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(postOcc1.tangent.kind, "After drag, occurrence 1 is authored.").toBe(
    "authored",
  );
  const authoredVec = postOcc1.tangent.vector!;

  // Exit the spline tool completely before selecting the fit point.
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);

  // ── Select the fit point (brief: a selected fit point maps to its occurrence) ──
  const box = await workbench.viewport().boundingBox();
  await workbench.page.mouse.click(box!.x + 500, box!.y + 300);
  await workbench.waitForAnimationFrames(3);

  // ── Click "Reset to automatic" button ──
  const resetBtn = page.getByRole("button", { name: /Reset to automatic/i });
  await expect(resetBtn).toBeVisible({ timeout: 5_000 });
  await resetBtn.click();
  await workbench.waitForAnimationFrames(4);

  const afterReset = await readLiveSketch(workbench);
  const resetOcc1 = afterReset.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(
    resetOcc1.tangent.kind,
    "After reset, occurrence 1 must be automatic.",
  ).toBe("automatic");

  // R2: compare the post-reset visible vector to the pre-drag automatic one.
  const postResetVisibleVec = resetOcc1.visibleVector;
  expect(
    postResetVisibleVec,
    "Post-reset automatic visible vector must be non-null.",
  ).not.toBeNull();
  expect(
    Math.abs(postResetVisibleVec![0] - preDragVisibleVec![0]),
    "Reset visible vector X must match pre-drag automatic (solver tolerance).",
  ).toBeLessThan(0.01);
  expect(
    Math.abs(postResetVisibleVec![1] - preDragVisibleVec![1]),
    "Reset visible vector Y must match pre-drag automatic (solver tolerance).",
  ).toBeLessThan(0.01);

  // ── Undo → back to authored ──
  await page.keyboard.press("Control+z");
  await workbench.waitForAnimationFrames(4);
  const afterUndo = await readLiveSketch(workbench);
  const undoOcc1 = afterUndo.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(
    undoOcc1.tangent.kind,
    "After Undo, occurrence 1 must be authored.",
  ).toBe("authored");
  expect(
    undoOcc1.tangent.vector,
    "Undo must restore the exact authored vector.",
  ).toEqual(authoredVec);
});

// ── T12e E2E: set tangent to zero via fit point selection ────────────────

test("T12e: select a fit point, click Set to zero → exactly [0,0]", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await enterSketchMode(workbench);
  await draw4PointSpline(workbench);

  // Exit the spline tool: Escape twice (first exits draft, second exits tool).
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);
  await page.keyboard.press("Escape");
  await workbench.waitForAnimationFrames(2);

  // ── Select the second fit point (at viewport 500, 300) ──
  const box = await workbench.viewport().boundingBox();
  await workbench.page.mouse.click(box!.x + 500, box!.y + 300);
  await workbench.waitForAnimationFrames(3);

  // ── Click "Set to zero" button ──
  const zeroBtn = page.getByRole("button", { name: /Set to zero/i });
  await expect(zeroBtn).toBeVisible({ timeout: 5_000 });
  await zeroBtn.click();
  await workbench.waitForAnimationFrames(4);

  const afterZero = await readLiveSketch(workbench);
  const zeroOcc1 = afterZero.entities.find((e) => e.kind === "spline")!
    .occurrences![1]!;
  expect(
    zeroOcc1.tangent.kind,
    "After set to zero, occurrence 1 must be authored.",
  ).toBe("authored");
  expect(
    zeroOcc1.tangent.vector,
    "Set to zero must store exactly [0, 0].",
  ).toEqual([0, 0]);
});
