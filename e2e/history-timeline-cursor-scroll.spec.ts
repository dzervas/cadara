import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createRectangleSketchSeriesOperationHistory } from "./helpers/modeling-fixtures";
import {
  currentRevision,
  waitForMachineIdle,
  waitForRevisionChange,
} from "./helpers/onshape-import";

const SKETCH_COUNT = 16;
const FIRST_SKETCH_ID = "sketch_series-1";
const LAST_SKETCH_ID = `sketch_series-${SKETCH_COUNT}`;

test.setTimeout(90_000);
// Narrow enough that the document history overflows its horizontal scroller.
test.use({ viewport: { width: 640, height: 480 } });

test("document history keeps the current history item scrolled into view on open and on cursor moves", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(
    createRectangleSketchSeriesOperationHistory(SKETCH_COUNT),
  );
  await expect(historyItem(page, LAST_SKETCH_ID)).toBeAttached({
    timeout: 30_000,
  });
  await waitForMachineIdle(page);

  const opened = await readHistoryScroll(page, LAST_SKETCH_ID);
  expect(
    opened.scrollWidth,
    "The fixture history must overflow the scroller for this check to mean anything.",
  ).toBeGreaterThan(opened.clientWidth);
  expect(
    opened.itemVisible,
    `On open the cursor sits on the last sketch, so it must be scrolled into view: ${JSON.stringify(opened)}`,
  ).toBe(true);

  // Roll back to the first item: it is off-screen at the end of the history,
  // so first bring it into view the way a user would, by scrolling. Rolling
  // back to an item that is already visible must not scroll the history
  // away from it (e.g. back to the end).
  await page.evaluate((sketchId) => {
    document
      .querySelector(`[data-history-sketch-id="${sketchId}"]`)
      ?.closest<HTMLElement>("[data-history-scroller]")
      ?.scrollTo({ left: 0 });
  }, FIRST_SKETCH_ID);
  await chooseHistoryAction(page, FIRST_SKETCH_ID, "Roll History Here");
  await expect
    .poll(
      async () => (await readHistoryScroll(page, FIRST_SKETCH_ID)).itemVisible,
      { message: "Rolling back to a visible item keeps it in view" },
    )
    .toBe(true);
  await expect
    .poll(
      async () => (await readHistoryScroll(page, LAST_SKETCH_ID)).itemVisible,
      { message: "Rolling back must not scroll to the end of the history" },
    )
    .toBe(false);

  // Rolling to the end moves the cursor to an item outside the scrolled range.
  await chooseHistoryAction(page, FIRST_SKETCH_ID, "Roll To End");
  await expect
    .poll(
      async () => (await readHistoryScroll(page, LAST_SKETCH_ID)).itemVisible,
      { message: "Roll To End must scroll the new current item into view" },
    )
    .toBe(true);
});

function historyItem(page: Page, sketchId: string) {
  return page.locator(`[data-history-sketch-id="${sketchId}"]`);
}

async function chooseHistoryAction(
  page: Page,
  sketchId: string,
  action: "Roll History Here" | "Roll To End",
) {
  const beforeRevision = await currentRevision(page);
  await historyItem(page, sketchId).click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  await waitForRevisionChange(page, beforeRevision);
  await waitForMachineIdle(page);
}

/** Reads the scroller and item bounds in one frame so a scroll cannot fall between them. */
function readHistoryScroll(page: Page, sketchId: string) {
  return page.evaluate((id) => {
    const item = document.querySelector<HTMLElement>(
      `[data-history-sketch-id="${id}"]`,
    );
    const scroller = item?.closest<HTMLElement>("[data-history-scroller]");
    if (!item || !scroller) {
      throw new Error(`History item ${id} or its scroller is missing.`);
    }
    const itemRect = item.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      scrollLeft: scroller.scrollLeft,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      itemLeft: itemRect.left,
      itemRight: itemRect.right,
      scrollerLeft: scrollerRect.left,
      scrollerRight: scrollerRect.right,
      itemVisible:
        itemRect.left >= scrollerRect.left - 1 &&
        itemRect.right <= scrollerRect.right + 1,
    };
  }, sketchId);
}
