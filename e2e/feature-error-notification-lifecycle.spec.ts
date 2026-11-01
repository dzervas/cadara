import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

// That untied notifications stay is proven at the hook in
// workbench-notifications.isolated.spec.ts; these rows prove the feature ids
// flow from a real delete to a real Undo snapshot.

function toolbarUndo(page: Page) {
  return page.getByRole("button", { name: "Undo", exact: true });
}

async function openWithFilletOnExtrude(page: Page) {
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
}

async function deleteExtrude1(page: Page) {
  await page
    .getByRole("button", { name: /^Select Extrude 1\./ })
    .click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
}

const filletItemInError = (page: Page) =>
  page.locator('button[data-feature-error="true"]', { hasText: "Fillet 1" });

// An accepted delete is a success; the feature it left failing
// is announced as a warning by label, which goes once Undo repairs it.
test("an accepted delete that breaks Fillet 1 says so in a warning that clears on Undo", async ({
  page,
}) => {
  await openWithFilletOnExtrude(page);

  // Deleting the extrude leaves Fillet 1 without its edge.
  await deleteExtrude1(page);

  const deletedWarning = page.getByRole("status").filter({
    hasText:
      "Deleted Extrude 1. Fillet 1 no longer rebuilds: repair it or undo.",
  });
  await expect(deletedWarning).toBeVisible({ timeout: 30_000 });
  await expect(filletItemInError(page)).toBeVisible();
  await expect(page.getByText("Workbench action failed")).toHaveCount(0);

  await expect(toolbarUndo(page)).toBeEnabled({ timeout: 10_000 });
  await toolbarUndo(page).click();

  await expect(
    page.getByRole("button", { name: /^Select Fillet 1\./ }),
    "Undo restores a healthy Fillet 1",
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('button[data-feature-error="true"]')).toHaveCount(0);
  await expect(deletedWarning, "the warning goes with the error").toHaveCount(0);
});

// A feature that was already failing is not re-announced; an
// accepted edit in that document reports its plain success.
test("renaming an already broken Fillet 1 reports the rename, with no warning or failure", async ({
  page,
}) => {
  await openWithFilletOnExtrude(page);
  await deleteExtrude1(page);
  await expect(filletItemInError(page)).toBeVisible({ timeout: 30_000 });

  await filletItemInError(page).click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Rename Fillet 1" });
  await expect(input).toBeFocused();
  await input.fill("Edge round");
  await input.press("Enter");

  await expect(
    page.getByRole("status").filter({
      hasText: "Renamed Fillet 1 to Edge round.",
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('button[data-feature-error="true"]', {
      hasText: "Edge round",
    }),
    "premise: the renamed feature still fails",
  ).toBeVisible();
  await expect(page.getByText(/no longer rebuild/)).toHaveCount(0);
  await expect(page.getByText("Workbench action failed")).toHaveCount(0);
});
