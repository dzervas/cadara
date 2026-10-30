import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

const URL_STORE_KEY = "cad.documentRepository.automergeUrls.v1";
const SUPERSEDED_MESSAGE =
  "This document was reset or replaced in another tab, so this tab can no longer save to it. Reload the tab to open the stored version.";

function bodyLabel(page: Page) {
  return page
    .locator(`[data-parts-tree-target="body:${FEATURE_FIXTURE.body}"]`)
    .locator("button")
    .first();
}

function featureIds(page: Page) {
  return page.evaluate(
    () => window.__cadaraDebug?.getState()?.featureIds ?? null,
  );
}

// Two tabs of one browser profile share localStorage (including the
// operation-history journal) and IndexedDB but not their document-sync
// workers, and production has no cross-tab sync. When tab A replaces the
// stored document, tab B must not write the old one: its edit stays in memory
// with a save notice saying why. The refused edit stays in the shared journal
// and must not replay over the replacement on either tab's reload, even when
// the replacement's content equals the seed document.
for (const replacement of [
  { name: "a fresh seed document", addsVariable: false },
  { name: "a document with a variable", addsVariable: true },
]) {
  test(`a tab whose stored document another tab replaced with ${replacement.name} keeps its edit unsaved, says why, and reloads the stored version`, async ({
    context,
  }) => {
    const pageB = await context.newPage();
    const tabB = new FeatureWorkbenchHarness(pageB);
    await tabB.openWithRepositoryAndOperationHistory(
      createBaseExtrudeOperationHistory(),
    );
    const original = await bodyLabel(pageB).innerText();
    const extrudeFeatures = await featureIds(pageB);
    expect(extrudeFeatures?.length).toBeGreaterThan(0);

    // Tab A opens the same document, loses this browser's pointer to it (site
    // data cleared) and stores a fresh document in its place on reload.
    const pageA = await context.newPage();
    const tabA = new FeatureWorkbenchHarness(pageA);
    await tabA.openWithRepository();
    await expect(bodyLabel(pageA)).toHaveText(original, { timeout: 30_000 });
    await pageA.evaluate(
      (key) => window.localStorage.removeItem(key),
      URL_STORE_KEY,
    );
    await tabA.reloadPreservingRepositoryStorage();
    await tabA.expectWorkspaceInRepository();
    const replacementFeatures = await featureIds(pageA);
    expect(replacementFeatures).not.toEqual(extrudeFeatures);
    if (replacement.addsVariable) {
      await pageA.locator("[data-workbench-variables-fab]").click();
      await pageA
        .getByRole("button", { name: "Add variable", exact: true })
        .click();
      await expect(pageA.getByLabel("Variable name variable_1")).toHaveValue(
        "var1",
        { timeout: 30_000 },
      );
    }

    // Tab B still shows the old document and edits it.
    const dialogs: string[] = [];
    pageB.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });
    await bodyLabel(pageB).click({ button: "right" });
    await pageB.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const input = pageB.getByRole("textbox", { name: `Rename ${original}` });
    await expect(input).toBeFocused();
    await pageB.keyboard.type("Edited in tab B");
    await input.press("Enter");
    await expect(bodyLabel(pageB)).toHaveText("Edited in tab B");
    const notice = pageB
      .locator('[data-notification-type="error"]')
      .filter({ hasText: "Your latest change could not be saved" });
    await expect(notice).toContainText(SUPERSEDED_MESSAGE, { timeout: 15_000 });
    await expect(notice).toContainText("Download a copy");

    // Both tabs reload to tab A's document; tab B's edit is not in it.
    for (const [page, harness] of [
      [pageA, tabA],
      [pageB, tabB],
    ] as const) {
      await harness.reloadPreservingRepositoryStorage();
      expect(await featureIds(page)).toEqual(replacementFeatures);
      await expect(bodyLabel(page)).toHaveCount(0);
      if (replacement.addsVariable) {
        await page.locator("[data-workbench-variables-fab]").click();
        await expect(
          page.locator('[data-variable-row="variable_1"]'),
        ).toContainText("var1", { timeout: 30_000 });
      }
      await expect(
        page.getByText("Your latest change could not be saved"),
      ).toHaveCount(0);
      await expect(page.getByText("History restore failed")).toHaveCount(0);
    }
    expect(dialogs, "tab B's unsaved edit guarded its reload").toEqual([
      "beforeunload",
    ]);
  });
}
