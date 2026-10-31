import { expect, test } from "@playwright/test";

import { glideDoubleClick } from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

type RenderIdleSample = {
  inSketch: boolean;
  bodies: number;
  rebuilding: boolean;
  renderIdle: boolean;
};

declare global {
  interface Window {
    __e2eRenderIdleSamples?: RenderIdleSample[];
  }
}

const BODY_ROWS = '[role="treeitem"][data-parts-tree-target^="body:"]';
const EXIT_SKETCH = [
  'button[aria-label="Exit the active sketch."]',
  'button[data-tool-tooltip="Exit the active sketch."]',
  'button[data-toolbar-group-tools*="|Exit the active sketch.|"]',
].join(", ");

// Finishing a reopened mid-history sketch leaves the editor idle on the
// rolled-back model (no bodies) while the history rolls forward again. Waits
// on render readiness must not end there: `[data-render-idle]` is only set
// once the rolled-forward model is shown.
test("render readiness after Finish of a reopened mid-history sketch waits for the roll-forward", async ({
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
    .poll(() =>
      page.evaluate(() => window.__cadaraDebug?.getState()?.machineState),
    )
    .toBe("editingSketch");
  await expect(bodies).toHaveCount(0);
  await expect(page.locator(EXIT_SKETCH).first()).toBeAttached();

  // Every DOM change after Finish is sampled from the same committed DOM,
  // including the render-idle attribute the viewport sets in a frame.
  await page.evaluate(
    ({ bodyRows, exitSketch }) => {
      const samples: RenderIdleSample[] = (window.__e2eRenderIdleSamples = []);
      const sample = () =>
        samples.push({
          inSketch: document.querySelector(exitSketch) !== null,
          bodies: document.querySelectorAll(bodyRows).length,
          rebuilding:
            document.querySelector(
              '[role="status"][aria-label="Model rebuild pending"]',
            ) !== null,
          renderIdle: document.querySelector("[data-render-idle]") !== null,
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

  await harness.waitForRenderIdle(30_000);
  await expect(page.locator(EXIT_SKETCH)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__cadaraDebug?.getState()?.editSessionCursorRestorePending,
    ),
    "the debug state reports the roll-forward as finished",
  ).toBe(false);
  await expect(bodies).not.toHaveCount(0);

  const samples = await page.evaluate(() => window.__e2eRenderIdleSamples!);
  const afterSketch = samples.filter((s) => !s.inSketch);
  expect(
    afterSketch.some((s) => s.rebuilding),
    "the roll-forward was observed",
  ).toBe(true);
  expect(
    afterSketch.filter((s) => s.renderIdle && (s.rebuilding || s.bodies === 0)),
    "render-idle is never set on the rolled-back model",
  ).toEqual([]);
});
