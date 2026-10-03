import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md) — arc edges are built by the shipped browser OCC
// build (`public/cadara-occ`), which lacks bindings the Node logic lane's stock
// package has (open problem 8). Only the browser worker proves the arc route.
// Seam: a 3-point arc closed by a line, finished, extruded through the
// workbench, commits a body.
test("a 3-point arc closed by a line extrudes into a body", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  const canvas = page.locator("main canvas").first();
  const start = { x: 640, y: 520 };
  const end = { x: 860, y: 520 };
  const through = { x: 750, y: 430 };

  // 3-Point Arc is a variant of the arc-family dropdown headed by Center Arc.
  await workbench.activateTool(
    "Create an arc from center, start, and end points.",
  );
  await page.getByRole("menuitem", { name: /3-Point Arc/ }).click();
  for (const position of [start, end, through])
    await canvas.click({ position, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await workbench.activateTool("Create line geometry.");
  await canvas.click({ position: end, force: true });
  await canvas.click({ position: start, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("2 entities staged");

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  await workbench.activateFeature("extrude");
  let regionTargets: string[] = [];
  await expect
    .poll(
      async () => {
        regionTargets = await page.evaluate(
          () =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
              ) ?? [],
        );
        return regionTargets.length;
      },
      {
        message: "The arc and its closing line publish exactly one region.",
        timeout: 15_000,
      },
    )
    .toBe(1);
  await workbench.selectReference(regionTargets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);
});
