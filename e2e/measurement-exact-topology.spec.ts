import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// Lane: e2e (docs/testing.md). Seam: the Measure readout asks the OCC worker
// for exact measures of the selected body topology and shows them in place
// of its mesh values (cadara-h026.5); only the browser runs the worker
// transport. Kind names and values are proven against real kernel bodies in
// the logic lane (measurement-occ-topology.spec.ts, the wheel heavy spec).

test.setTimeout(120_000);

const readout = (page: Page) => page.locator("[data-measurement-panel]");

/** Arms Measure with nothing selected, then selects one target. */
async function measure(
  page: Page,
  workbench: FeatureWorkbenchHarness,
  pattern: RegExp,
) {
  const state = () =>
    page.evaluate(() => ({
      command: window.__cadaraDebug?.getState()?.command,
      selected: window.__cadaraDebug?.getState()?.selectionCount,
    }));
  // Escape leaves Measure, then clears the kept selection.
  for (let presses = 0; presses < 3; presses += 1) {
    const { command, selected } = await state();
    if (command !== "measure" && selected === 0) break;
    await page.keyboard.press("Escape");
  }
  await expect.poll(state).toEqual({ command: expect.anything(), selected: 0 });
  await workbench.activateTool("Inspect geometric measurements.");
  const targets: readonly string[] = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.selectableTargets ?? [],
  );
  const target = targets.find((entry) => pattern.test(entry));
  if (!target) throw new Error(`No selectable target matches ${pattern}.`);
  expect(
    await page.evaluate((id) => window.__cadaraDebug?.selectTarget(id), target),
  ).toBe(true);
}

test("cadara-h026.5: a measured face, edge and body read out the kernel's exact values by kind, not approximate mesh values", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithBaseExtrudeFixture();

  await measure(page, workbench, /\.face_/);
  await expect(readout(page)).toContainText("Planar face · Extrude 1", {
    timeout: 15_000,
  });
  await expect(readout(page)).toContainText(/Normal\s*-?[01](, -?[01]){2}/);
  await expect(readout(page)).not.toContainText("≈");

  // A new revision (here: adding a document variable) makes the measure
  // stale; the readout asks again and settles on exact values.
  const revision = () =>
    page.evaluate(() => window.__cadaraDebug?.getState()?.revision);
  const before = await revision();
  await page.locator("[data-workbench-variables-fab]").click();
  await page.getByRole("button", { name: "Add variable", exact: true }).click();
  await expect.poll(revision, { timeout: 30_000 }).not.toBe(before);
  await expect(readout(page)).toContainText("Planar face · Extrude 1", {
    timeout: 15_000,
  });
  await expect(readout(page)).not.toContainText("≈");
  await page.locator("[data-workbench-variables-fab]").click();

  await measure(page, workbench, /\.edge_/);
  await expect(readout(page)).toContainText("Linear edge · Extrude 1", {
    timeout: 15_000,
  });
  await expect(readout(page)).toContainText(/Length\s*[\d.]+ mm/);
  await expect(readout(page)).not.toContainText("≈");

  await measure(page, workbench, /^body_/);
  await expect(readout(page)).toContainText(/Volume\s*[\d.]+ mm³/, {
    timeout: 15_000,
  });
  await expect(readout(page)).not.toContainText("≈");
});
