import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";

test.use({ viewport: { width: 1440, height: 960 } });
test.setTimeout(90_000);

// These subpixel points straddle the box's face/edge and edge/vertex pick
// boundaries: truncating their coordinates changes the picked primitive.
for (const { kind, point } of [
  { kind: "face", point: { x: 390.8, y: 251.8 } },
  { kind: "edge", point: { x: 257.8, y: 372.8 } },
]) {
  test(`a press selects the hovered ${kind} at a fractional pick boundary`, async ({
    page,
  }) => {
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithRepositoryAndOperationHistory(
      createBaseExtrudeOperationHistory(),
    );

    await workbench.hoverViewportAtReal(point);
    await expect
      .poll(() => workbench.currentHoverTarget())
      .toContain(`.${kind}_`);
    const hovered = await workbench.currentHoverTarget();

    // No intervening pointer motion: click's legacy MouseEvent coordinates
    // must not cause a second pick at a different (integer) position.
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => workbench.currentEditorSelection()).toBe(hovered);
  });
}
