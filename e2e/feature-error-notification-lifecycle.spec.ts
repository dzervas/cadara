import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

// That untied errors stay is proven at the hook in
// workbench-notifications.isolated.spec.ts; this row proves the feature id
// flows from a real delete to a real Undo snapshot.

function toolbarUndo(page: Page) {
  return page.getByRole("button", { name: "Undo", exact: true });
}

test("a feature's error popup clears when Undo restores what it was built on", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  await workbench.activateFeature("fillet");
  await workbench.selectFirstReferenceMatching(
    /^Select .* body_feature_extrude-1\.edge_/,
  );
  await workbench.setNumericField("Radius", 0.5);
  await workbench.expectFeaturePreviewReady("fillet");
  await workbench.commitFeature("feature_fillet-1");

  // Deleting the extrude leaves Fillet 1 without its edge.
  await page
    .getByRole("button", { name: /^Select Extrude 1\./ })
    .click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

  const filletError = page
    .getByRole("alert")
    .filter({ hasText: "Fillet 1 edge selection is incorrect." });
  await expect(filletError).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('button[data-feature-error="true"]', { hasText: "Fillet 1" }),
  ).toBeVisible();

  await expect(toolbarUndo(page)).toBeEnabled({ timeout: 10_000 });
  await toolbarUndo(page).click();

  await expect(
    page.getByRole("button", { name: /^Select Fillet 1\./ }),
    "Undo restores a healthy Fillet 1",
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('button[data-feature-error="true"]')).toHaveCount(0);
  await expect(filletError, "the popup goes with the error").toHaveCount(0);
});
