import { expect, test } from "@playwright/test";
import { openDocumentCopy, saveDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createRectangleProfileOperationHistory } from "./helpers/modeling-fixtures";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

type CadaraDocument = {
  sketches: Array<{
    definition: {
      pointIds: string[];
      constraintIds: string[];
      constraints: Array<Record<string, unknown>>;
    };
  }>;
};

// Lane: e2e. Seam: actual workbench Finish + browser file Save As/Open +
// re-entry, which cannot be established by kernel or debug-only tests.
test("nonconverged authored sketch finishes, saves, reopens, and re-enters with diagnostics intact", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    createRectangleProfileOperationHistory(),
  );
  await workbench.openWithRepository();
  const valid = await saveDocumentCopy<CadaraDocument>(page);
  const sketch = valid.sketches[0];
  if (!sketch) throw new Error("Rectangle fixture did not save a sketch.");
  const pointId = sketch.definition.pointIds[0];
  if (!pointId)
    throw new Error("Rectangle fixture did not save a sketch point.");
  sketch.definition.constraintIds.push(
    "constraint_conflicting_e2e_a",
    "constraint_conflicting_e2e_b",
  );
  sketch.definition.constraints.push(
    {
      constraintId: "constraint_conflicting_e2e_a",
      kind: "fixPoint",
      label: "Conflicting point requirement A",
      pointId,
      position: [0, 0],
    },
    {
      constraintId: "constraint_conflicting_e2e_b",
      kind: "fixPoint",
      label: "Conflicting point requirement B",
      pointId,
      position: [100, 0],
    },
  );

  await openDocumentCopy(page, valid, "invalid-current.cadara");
  const sketchButton = page
    .getByRole("button", { name: /Select .*Double-click to reopen\./ })
    .first();
  await sketchButton.dblclick();
  // T13c (review R-2): the reopened sketch's status explains the conflict.
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Conflicting point requirement A, Conflicting point requirement B conflict. The sketch is invalid; profiles from it are blocked.",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .locator(
      'button[aria-label="Finish Sketch"], button[data-tool-tooltip="Finish Sketch"]',
    )
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__cadaraDebug?.getState()?.machineState),
    )
    .toBe("idle");

  const savedInvalid = await saveDocumentCopy<CadaraDocument>(page);
  expect(
    savedInvalid.sketches[0]?.definition.constraints.some(
      (constraint) =>
        constraint.constraintId === "constraint_conflicting_e2e_b",
    ),
  ).toBe(true);

  await openDocumentCopy(page, savedInvalid, "invalid-reopened.cadara");
  await page
    .getByRole("button", { name: /Select .*Double-click to reopen\./ })
    .first()
    .dblclick();
  // T13c (review R-2): the reopened sketch's status explains the conflict.
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Conflicting point requirement A, Conflicting point requirement B conflict. The sketch is invalid; profiles from it are blocked.",
    }),
  ).toBeVisible({ timeout: 15_000 });
});
