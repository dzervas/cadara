import { expect, test } from "@playwright/test";

import type { ModelingOperationHistoryPayload } from "../src/contracts/modeling/operation-history";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createRectangleProfileOperationHistory } from "./helpers/modeling-fixtures";

const LONG_SKETCH_LABEL =
  "Mounting bracket outline with chamfered corners and slotted holes";

test.setTimeout(90_000);

test("a parts tree row with a long name shows the full name on hover and keeps its show/hide toggle inside the tree", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(
    withSketchLabel(
      createRectangleProfileOperationHistory(),
      LONG_SKETCH_LABEL,
    ),
  );

  const tree = page.getByRole("complementary", { name: "Parts and objects" });
  const row = tree
    .locator("[data-parts-tree-row]")
    .filter({ hasText: LONG_SKETCH_LABEL });
  await expect(row).toBeAttached({ timeout: 30_000 });

  const labelButton = row.getByRole("button", {
    name: LONG_SKETCH_LABEL,
    exact: true,
  });
  await expect(
    labelButton,
    "The truncated label must expose its full name as a hover title.",
  ).toHaveAttribute("title", new RegExp(`^${LONG_SKETCH_LABEL}\\b`));

  // Hover with the raw mouse: a locator hover would scroll the tree's
  // viewport sideways to reach the toggle, hiding exactly the clipping
  // under test.
  const treeBox = await tree.boundingBox();
  const rowBox = await row.boundingBox();
  if (!treeBox || !rowBox) {
    throw new Error("The parts tree and its row must have layout boxes.");
  }
  await page.mouse.move(treeBox.x + 40, rowBox.y + rowBox.height / 2);
  const toggle = row.getByRole("button", {
    name: `Hide ${LONG_SKETCH_LABEL}`,
  });
  await expect(toggle).toHaveCSS("opacity", "1");

  // Read every bound in one frame; a hit test proves the toggle is not
  // clipped away by the tree's scroll viewport.
  const layout = await toggle.evaluate((element) => {
    const tree = element.closest("aside");
    const label = element
      .closest("[data-parts-tree-row]")
      ?.querySelector<HTMLElement>("button[title]");
    if (!tree || !label) {
      throw new Error("The toggle must sit in a parts tree row.");
    }
    const toggleRect = element.getBoundingClientRect();
    const treeRect = tree.getBoundingClientRect();
    const hit = document.elementFromPoint(
      toggleRect.left + toggleRect.width / 2,
      toggleRect.top + toggleRect.height / 2,
    );
    return {
      toggleCenterX: toggleRect.left + toggleRect.width / 2,
      toggleCenterY: toggleRect.top + toggleRect.height / 2,
      toggleLeft: toggleRect.left,
      toggleRight: toggleRect.right,
      treeLeft: treeRect.left,
      treeRight: treeRect.right,
      toggleHit: hit !== null && element.contains(hit),
      labelTruncated: label.scrollWidth > label.clientWidth,
    };
  });
  expect(
    layout.toggleRight,
    `The show/hide toggle must stay inside the tree: ${JSON.stringify(layout)}`,
  ).toBeLessThanOrEqual(layout.treeRight);
  expect(layout.toggleHit, JSON.stringify(layout)).toBe(true);
  expect(
    layout.labelTruncated,
    "A long label must truncate inside the tree rather than widen its row.",
  ).toBe(true);

  await page.mouse.click(layout.toggleCenterX, layout.toggleCenterY);
  await expect(
    row.getByRole("button", { name: `Show ${LONG_SKETCH_LABEL}` }),
  ).toBeVisible();
});

function withSketchLabel(
  history: ModelingOperationHistoryPayload,
  sketchLabel: string,
): ModelingOperationHistoryPayload {
  return {
    ...history,
    entries: history.entries.map((entry) =>
      entry.kind === "commitSketch"
        ? { ...entry, payload: { ...entry.payload, sketchLabel } }
        : entry,
    ),
  };
}
