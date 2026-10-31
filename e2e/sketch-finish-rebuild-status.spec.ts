import { expect, test } from "@playwright/test";

import { glideDoubleClick } from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

type FinishSample = { inSketch: boolean; bodies: number; rebuilding: boolean };

declare global {
  interface Window {
    __e2eFinishSamples?: FinishSample[];
  }
}

const BODY_ROWS = '[role="treeitem"][data-parts-tree-target^="body:"]';
const EXIT_SKETCH = [
  'button[aria-label="Exit the active sketch."]',
  'button[data-tool-tooltip="Exit the active sketch."]',
  'button[data-toolbar-group-tools*="|Exit the active sketch.|"]',
].join(", ");

// Reopening a sketch that features consume rolls the history back to it, so
// the editing snapshot has no bodies. After Finish the editor rolls forward
// again; until then the workbench must show a rebuild, never an empty part.
test("Finish of a reopened mid-history sketch shows a rebuild, never an empty Parts tree", async ({
  page,
}) => {
  const harness = new FeatureWorkbenchHarness(page);
  await harness.openWithBaseExtrudeFixture();
  const bodies = page.locator(BODY_ROWS);
  await expect(bodies).not.toHaveCount(0);

  await glideDoubleClick(
    page,
    page.locator('button[data-history-sketch-id="sketch_primary"]'),
  );
  await expect
    .poll(() => page.evaluate(() => window.__cadaraDebug?.getState()?.machineState))
    .toBe("editingSketch");
  // The hazard this guards: the rolled-back model lists no bodies.
  await expect(bodies).toHaveCount(0);
  await expect(page.locator(EXIT_SKETCH).first()).toBeAttached();

  // Every DOM change after Finish is sampled, so a single committed frame
  // with an empty, unexplained Parts tree fails. All three values come from
  // the same committed DOM: leaving the sketch is read from its toolbar, not
  // from the editor store, which can run ahead of React's render.
  await page.evaluate(
    ({ bodyRows, exitSketch }) => {
      const samples: FinishSample[] = (window.__e2eFinishSamples = []);
      const sample = () =>
        samples.push({
          inSketch: document.querySelector(exitSketch) !== null,
          bodies: document.querySelectorAll(bodyRows).length,
          rebuilding:
            document.querySelector('[role="status"][aria-label="Model rebuild pending"]') !== null,
        });
      new MutationObserver(sample).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    },
    { bodyRows: BODY_ROWS, exitSketch: EXIT_SKETCH },
  );
  await harness.activateTool("Exit the active sketch.");

  await expect(bodies).not.toHaveCount(0);
  await expect(page.locator(EXIT_SKETCH)).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Model rebuild pending" }),
  ).toHaveCount(0);
  const samples = await page.evaluate(() => window.__e2eFinishSamples!);
  const afterSketch = samples.filter((s) => !s.inSketch);
  expect(afterSketch.length, "Finish left the sketch").toBeGreaterThan(0);
  expect(
    afterSketch.filter((s) => s.bodies === 0 && !s.rebuilding),
    "after Finish the Parts tree is never empty without the rebuild status",
  ).toEqual([]);
  expect(
    afterSketch.some((s) => s.rebuilding),
    "the rolled-back moment shows the rebuild status",
  ).toBe(true);
});
