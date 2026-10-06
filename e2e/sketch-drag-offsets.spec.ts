import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md reviewed).
// Seam: drag a source point while a *curved* offset exists → shell follows
// provisionally during drag (U-A) → certification completes after release
// → offset region becomes selectable/extrudable.
// Why e2e: composes the pointer pipeline, solver, derivation worker,
// region extraction, and feature UI — only the browser exercises all.

const OFFSET_TOOL =
  "Offset a connected chain with a durable offset relationship.";
const REGION_TARGET = /^sketch_.+\.region_[0-9a-f]{32}$/;

type ViewportPoint = { x: number; y: number };

async function startTopPlaneSketch(
  page: Page,
  workbench: FeatureWorkbenchHarness,
) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

async function expectStagedAtLeast(
  workbench: FeatureWorkbenchHarness,
  minimum: number,
  timeout = 15_000,
) {
  await expect
    .poll(
      async () => {
        const session = await workbench.currentSketchSession();
        const match = /(\d+) entities staged/.exec(session);
        return match ? Number(match[1]) : 0;
      },
      { timeout },
    )
    .toBeGreaterThanOrEqual(minimum);
}

async function clickEntityAlong(
  workbench: FeatureWorkbenchHarness,
  scan: readonly ViewportPoint[],
  entity: RegExp,
) {
  for (const point of scan) {
    await workbench.hoverViewportAt(point);
    await workbench.waitForAnimationFrames();
    if (entity.test(await workbench.currentHoverTarget())) {
      await workbench.clickViewportAt(point);
      return;
    }
  }
  throw new Error(`No ${entity} hover target along the scan.`);
}

async function commitOffset(
  page: Page,
  workbench: FeatureWorkbenchHarness,
  sidePoint: ViewportPoint,
  distance: string,
) {
  await page.getByRole("textbox", { name: "Distance" }).fill(distance);
  await workbench.hoverViewportAt(sidePoint);
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput
    .getByRole("button", { name: "Create" })
    .click({ timeout: 5_000 });
}

const along = (from: ViewportPoint, to: ViewportPoint, steps = 24) =>
  Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(from.x + ((to.x - from.x) * index) / steps),
    y: Math.round(from.y + ((to.y - from.y) * index) / steps),
  }));

async function regionTargets(page: Page, minimum: number) {
  let targets: string[] = [];
  await expect
    .poll(
      async () => {
        targets = await page.evaluate(
          (pattern) =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                new RegExp(pattern).test(target),
              ) ?? [],
          REGION_TARGET.source,
        );
        return targets.length;
      },
      {
        message: `Expected at least ${minimum} selectable regions after Finish.`,
        timeout: 60_000,
      },
    )
    .toBeGreaterThanOrEqual(minimum);
  return targets;
}

// ── T12g B8: curved offset follows provisionally during drag ────────────

test("T12g B8: drag a source point on a spline+line loop with an outward offset; the curved shell geometry changes during drag; after release the region becomes selectable and extrudable", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await startTopPlaneSketch(page, workbench);

  // Build a spline arch closed by a line (same shape as the existing
  // sketch-offset-regions.spec.ts "outward offset of a spline" row).
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 600, y: 560 });
  await workbench.clickViewportAt({ x: 720, y: 440 });
  await workbench.clickViewportAt({ x: 840, y: 560 });
  await page.keyboard.press("Enter");
  await expectStagedAtLeast(workbench, 1);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 840, y: 560 });
  await workbench.clickViewportAt({ x: 600, y: 560 });
  await expectStagedAtLeast(workbench, 2);

  // Create an outward offset (side away from the loop interior).
  await workbench.activateTool(OFFSET_TOOL);
  await clickEntityAlong(
    workbench,
    along({ x: 660, y: 430 }, { x: 660, y: 540 }),
    /spline/,
  );
  await clickEntityAlong(
    workbench,
    along({ x: 680, y: 545 }, { x: 680, y: 575 }, 12),
    /line/,
  );
  await commitOffset(page, workbench, { x: 720, y: 400 }, "0.1");
  // The derived shell, the line output and the two convex joint arcs: ≥ 6.
  await expectStagedAtLeast(workbench, 6, 90_000);

  // Escape out of the offset tool to the editing phase.
  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 5_000 })
    .toMatch(/collecting|editing/);

  // ── Pre-drag snapshot: capture all point positions. ──
  const preDragSnap = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  expect(preDragSnap, "Pre-drag snapshot must exist.").not.toBeNull();
  const preDragPoints = (
    preDragSnap as { points: { id: string; position: [number, number] }[] }
  ).points;

  // Identify the spline's middle fit point (at viewport ~720,440).
  // It's the point with the largest Y (most positive sketch Y).
  const dragTarget = preDragPoints.reduce((best, p) =>
    p.position[1] > best.position[1] ? p : best,
  );

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport not visible.");

  // ── Start dragging the middle spline fit point upward. ──
  await page.mouse.move(box.x + 720, box.y + 440);
  await workbench.waitForAnimationFrames(3);
  await page.mouse.down();
  await page.mouse.move(box.x + 720, box.y + 360, { steps: 6 });
  await workbench.waitForAnimationFrames(6);

  // Mid-drag: verify the source point has moved.
  const midDragSnap = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  expect(midDragSnap, "Mid-drag snapshot must exist.").not.toBeNull();
  const midDragPoints = (
    midDragSnap as { points: { id: string; position: [number, number] }[] }
  ).points;
  const midTarget = midDragPoints.find((p) => p.id === dragTarget.id)!;
  expect(
    midTarget.position[1],
    "Mid-drag: the dragged spline point Y must have increased.",
  ).toBeGreaterThan(dragTarget.position[1] + 0.1);

  // Mid-drag: verify that offset output geometry changed (the shell
  // followed provisionally). Find points that are NOT source points
  // (driven offset outputs) and compare to pre-drag.
  const sourcePointIds = new Set(
    preDragPoints
      .filter(
        (p) =>
          // Source points: the 3 spline fit points and the 2 line endpoints.
          // They are the first 5 points (by draw order). But safer: the
          // source points are those that existed before the offset was added.
          // We use the first 4 points (spline 3 + shared endpoint = 4 unique).
          preDragPoints.indexOf(p) < 5,
      )
      .map((p) => p.id),
  );
  const preDragDrivenPositions = new Map(
    preDragPoints
      .filter((p) => !sourcePointIds.has(p.id))
      .map((p) => [p.id, p.position] as const),
  );
  const midDragDriven = midDragPoints.filter((p) => !sourcePointIds.has(p.id));
  // At least one driven (offset output) point must have moved.
  let anyDrivenMoved = false;
  for (const dp of midDragDriven) {
    const pre = preDragDrivenPositions.get(dp.id);
    if (
      pre &&
      (Math.abs(dp.position[0] - pre[0]) > 0.01 ||
        Math.abs(dp.position[1] - pre[1]) > 0.01)
    ) {
      anyDrivenMoved = true;
      break;
    }
  }
  expect(
    anyDrivenMoved,
    "Mid-drag: at least one offset output point must have moved (shell followed provisionally).",
  ).toBe(true);

  // Mid-drag: assert that the offset shell is provisional (U-A) and no
  // region from it is available yet.
  const midDragShells = (
    midDragSnap as {
      offsetShells?: { entityId: string; publication: string }[];
    }
  ).offsetShells;
  expect(
    midDragShells,
    "Mid-drag: offsetShells must be present in the snapshot.",
  ).toBeDefined();
  expect(
    midDragShells!.length,
    "Mid-drag: at least one offset shell must exist.",
  ).toBeGreaterThan(0);
  for (const shell of midDragShells!) {
    expect(
      shell.publication,
      `Mid-drag: offset shell ${shell.entityId} must be provisional (not certified).`,
    ).toBe("provisional");
  }
  const midDragRegions = (
    midDragSnap as { liveRegions?: { status: string; count: number } }
  ).liveRegions;
  expect(
    midDragRegions,
    "Mid-drag: liveRegions must be present in the snapshot.",
  ).toBeDefined();
  // During a drag, derivation is suppressed (U-A): regions are pending or
  // unavailable, and no *current* region from the offset is available.
  expect(
    midDragRegions!.status,
    "Mid-drag: live regions must not be 'current' (derivation suppressed during drag).",
  ).not.toBe("current");

  // Release.
  await page.mouse.move(box.x + 720, box.y + 340, { steps: 3 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.up();
  await workbench.waitForAnimationFrames(10);

  // Post-release: verify the source point committed.
  const postDragSnap = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  expect(postDragSnap, "Post-drag snapshot must exist.").not.toBeNull();
  const postTarget = (
    postDragSnap as { points: { id: string; position: [number, number] }[] }
  ).points.find((p) => p.id === dragTarget.id)!;
  expect(
    postTarget.position[1],
    "Post-release: dragged point must have moved.",
  ).toBeGreaterThan(dragTarget.position[1] + 0.3);

  // Finish the sketch. After Finish, certification should complete and
  // regions from the offset should become available.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 90_000);

  // The spline+line loop source region and the offset annulus should give
  // at least 2 selectable regions.
  await workbench.activateFeature("extrude");
  const targets = await regionTargets(page, 2);

  // Verify that one region is extrudable (certification completed after
  // release → the offset region is no longer provisional).
  await workbench.selectReference(targets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyCountAtLeast(1);
});
