import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: the workbench composition wires live
// sketch-region derivation (and with it offset publication, [TECH] G1/G2′)
// to the dedicated derivation worker, never the OCC kernel worker's queue.
// Only a real browser has module workers; without this wiring the solver
// silently derives on the kernel path again (T08b-g4 review A1).
test("live region derivation of a closed sketch runs in the dedicated sketch-derivation worker", async ({
  page,
}) => {
  const workerUrls: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  const workbench = new SketchWorkbenchHarness(page);

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  expect(
    workerUrls.filter((url) => url.includes("sketch-derivation")),
    "No derivation worker exists before a sketch needs regions.",
  ).toEqual([]);

  const canvas = page.locator("main canvas").first();
  await workbench.activateTool("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await canvas.click({ position: { x: 700, y: 500 }, force: true });
  await canvas.click({ position: { x: 900, y: 650 }, force: true });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");

  await expect
    .poll(() => workerUrls.filter((url) => url.includes("sketch-derivation")), {
      timeout: 15_000,
      message:
        "The closed rectangle's live regions are derived in a dedicated sketch-derivation worker.",
    })
    .not.toEqual([]);
});
