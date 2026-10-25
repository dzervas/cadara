import { expect, test } from "@playwright/test";

import {
  countHeldDocumentWrites,
  holdDocumentWrites,
  installDocumentWriteHold,
  releaseDocumentWrites,
} from "./helpers/document-write-hold";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

const SAVING_MESSAGE =
  "Your latest change is still being saved. It's safe to leave once this message disappears.";

// cadara-8p7o: a reload while an accepted edit is still being saved asks
// first (the browser's own dialog); after staying, a notification explains
// and disappears when the save has finished. Without a pending save a reload
// asks nothing (no beforeunload listener is registered while idle).
test("a reload while a change is saving asks first, then explains until the save finishes", async ({
  page,
}) => {
  await installDocumentWriteHold(page);
  await new FeatureWorkbenchHarness(page).openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  const row = page.locator(
    `[data-parts-tree-target="body:${FEATURE_FIXTURE.body}"]`,
  );
  const labelButton = row.locator("button").first();
  const original = await labelButton.innerText();
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });

  await holdDocumentWrites(page);
  await labelButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = row.getByRole("textbox", { name: `Rename ${original}` });
  await expect(input).toBeFocused();
  await page.keyboard.type("Mount plate");
  await input.press("Enter");
  await expect(labelButton).toHaveText("Mount plate", { timeout: 10_000 });
  await expect
    .poll(() => countHeldDocumentWrites(page), {
      message: "premise: the rename's repository write is held",
    })
    .toBeGreaterThan(0);

  const notification = page.getByRole("status").filter({ hasText: SAVING_MESSAGE });
  await expect(notification).toHaveCount(0);
  // Dismissing the dialog cancels the reload, so it never completes.
  void page.reload().catch(() => undefined);
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  await expect(notification).toBeVisible();

  await releaseDocumentWrites(page);
  await expect(notification).toHaveCount(0, { timeout: 15_000 });

  await page.reload();
  await expect(
    labelButton,
    "the saved rename survives the reload",
  ).toHaveText("Mount plate", { timeout: 30_000 });
  expect(dialogs, "an idle page reloads without asking").toEqual([
    "beforeunload",
  ]);
});
