import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the Offset tool in the real workbench →
// U-G3 certified commit (dedicated derivation worker) → Finish (kernel
// publish + regions) → the extrude feature's region selection and OCC
// profile build. Only the browser composes the derivation worker, the OCC
// kernel and the feature UI (T08b-g5b).

const OFFSET_TOOL =
  "Offset a connected chain with a durable offset relationship.";
const REGION_TARGET = /^sketch_.+\.region_[0-9a-f]{32}$/;

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

async function expectStaged(
  workbench: FeatureWorkbenchHarness,
  count: number,
  timeout = 15_000,
) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout })
    .toContain(`${count} entities staged`);
}

type ViewportPoint = { x: number; y: number };

/**
 * Clicks the first point of `scan` whose hover target is a sketch entity
 * matching `entity` (a curve body, not one of its fit points).
 */
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

/** With the chain selected, puts the side at `sidePoint`, types the distance and commits. */
async function commitOffset(
  page: Page,
  workbench: FeatureWorkbenchHarness,
  sidePoint: ViewportPoint,
  distance: string,
) {
  // The tool panel's numeric Distance control (it patches a number).
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

async function regionTargets(page: Page, count: number) {
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
        message: `The offset sketch publishes ${count} selectable regions after Finish.`,
        timeout: 30_000,
      },
    )
    .toBe(count);
  return targets;
}

test("an inward offset of a line rectangle commits certified trimmed line outputs; after Finish both regions are selectable and each extrudes", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await startTopPlaneSketch(page, workbench);

  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 640, y: 420 });
  await workbench.clickViewportAt({ x: 860, y: 580 });
  await expectStaged(workbench, 4);

  await workbench.activateTool(OFFSET_TOOL);
  for (const point of [
    { x: 750, y: 420 },
    { x: 860, y: 500 },
    { x: 750, y: 580 },
    { x: 640, y: 500 },
  ])
    await workbench.clickViewportAt(point);
  await commitOffset(page, workbench, { x: 750, y: 470 }, "0.5");
  // Four offset lines trimmed at the concave corners (one shared driven
  // point each, G6), committed only once the preview certified (U-G3).
  await expectStaged(workbench, 8, 60_000);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  await workbench.activateFeature("extrude");
  const targets = await regionTargets(page, 2);
  // The frame between the rectangle and its offset, and the inner
  // rectangle: both are bounded by the offset's certified lines. Each one
  // extrudes on its own into a new body.
  await workbench.selectReference(targets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyCountAtLeast(1);

  // A new extrude reopens with the previous profile; clear it so this one
  // extrudes the other region alone.
  await workbench.activateFeature("extrude");
  await page.getByRole("button", { name: "Clear Profile targets" }).click();
  await expect(
    page.getByRole("button", { name: `Remove ${targets[0]!}` }),
  ).toHaveCount(0);
  // Picked into the profile list directly: after the first commit the
  // editor selection summary no longer echoes the picked region, so the
  // harness's selection poll does not apply; the profile chip is the check.
  expect(
    await page.evaluate(
      (id) => window.__cadaraDebug?.selectTarget(id) ?? false,
      targets[1]!,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: `Remove ${targets[1]!}` }),
  ).toHaveCount(1, { timeout: 10_000 });
  // Extrude preselects join with the first body, which the inner rectangle
  // touches; keep it a new body so each region yields its own body.
  await workbench.setOperation("newBody");
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-2");
  await workbench.expectBodyCountAtLeast(2);
});

test("an outward offset of a spline closed by a line commits a certified shell; after Finish its regions are selectable; the source region and the annulus each extrude into a body", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await startTopPlaneSketch(page, workbench);

  // A 3-point native spline arch closed by a line snapped to both its ends.
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 600, y: 560 });
  await workbench.clickViewportAt({ x: 720, y: 440 });
  await workbench.clickViewportAt({ x: 840, y: 560 });
  await expectStaged(workbench, 1);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 840, y: 560 });
  await workbench.clickViewportAt({ x: 600, y: 560 });
  await expectStaged(workbench, 2);

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
  // The derived shell, the line output and the two convex joint arcs.
  await expectStaged(workbench, 6, 90_000);

  // Finish re-solves and publishes the shell in the kernel (U-G3/C8).
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 90_000);

  await workbench.activateFeature("extrude");
  const targets = await regionTargets(page, 2);
  const diagnosticsBefore = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.snapshotDiagnosticsCount ?? -1,
  );
  // T10c: spline-bounded profiles build exact Bézier edges in the browser
  // OCC build. The source region (the spline arch and its line) and the
  // offset annulus (the shell, the line output and the joint arcs, with the
  // source loop as its hole) each extrude on their own into a new body.
  await workbench.selectReference(targets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyCountAtLeast(1);

  // A new extrude reopens with the previous profile; clear it so this one
  // extrudes the other region alone, as a new body.
  await workbench.activateFeature("extrude");
  await page.getByRole("button", { name: "Clear Profile targets" }).click();
  await expect(
    page.getByRole("button", { name: `Remove ${targets[0]!}` }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => window.__cadaraDebug?.selectTarget(id) ?? false,
      targets[1]!,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: `Remove ${targets[1]!}` }),
  ).toHaveCount(1, { timeout: 10_000 });
  await workbench.setOperation("newBody");
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-2");
  await workbench.expectBodyCountAtLeast(2);
  // Review A-3: neither region raised a document diagnostic (a profile face
  // that failed in the part-mode render would add a `profile-…` warning).
  expect(
    await page.evaluate(
      () => window.__cadaraDebug?.getState()?.snapshotDiagnosticsCount ?? -1,
    ),
    "no new document diagnostic",
  ).toBe(diagnosticsBefore);
});
