import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
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

async function downloadCadara(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "File" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Save As" }).click();
  await page.getByRole("button", { name: "Download a copy" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Could not read the saved cadara document.");
  return JSON.parse(await readFile(path, "utf8")) as CadaraDocument;
}

async function openCadara(
  page: import("@playwright/test").Page,
  document: CadaraDocument,
  name: string,
) {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Open..." }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a copy" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: "application/vnd.cadara+json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(
    page.getByRole("status").filter({ hasText: `Opened ${name}.` }),
  ).toBeVisible({ timeout: 15_000 });
}

// Lane: e2e. Seam: actual workbench Finish + browser file Save As/Open +
// re-entry, which cannot be established by kernel or debug-only tests.
test("nonconverged authored sketch finishes, saves, reopens, and re-enters with diagnostics intact", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(createRectangleProfileOperationHistory());
  await workbench.openWithRepository();
  const valid = await downloadCadara(page);
  const sketch = valid.sketches[0];
  if (!sketch) throw new Error("Rectangle fixture did not save a sketch.");
  const pointId = sketch.definition.pointIds[0];
  if (!pointId) throw new Error("Rectangle fixture did not save a sketch point.");
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

  await openCadara(page, valid, "invalid-current.cadara");
  const sketchButton = page
    .getByRole("button", { name: /Select .*Double-click to reopen\./ })
    .first();
  await sketchButton.dblclick();
  await expect(
    page.getByRole("status").filter({ hasText: /residual|invalid/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .locator('button[aria-label="Finish Sketch"], button[data-tool-tooltip="Finish Sketch"]')
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__cadaraDebug?.getState().machineState))
    .toBe("idle");

  const savedInvalid = await downloadCadara(page);
  expect(
    savedInvalid.sketches[0]?.definition.constraints.some(
      (constraint) => constraint.constraintId === "constraint_conflicting_e2e_b",
    ),
  ).toBe(true);

  await openCadara(page, savedInvalid, "invalid-reopened.cadara");
  await page
    .getByRole("button", { name: /Select .*Double-click to reopen\./ })
    .first()
    .dblclick();
  await expect(
    page.getByRole("status").filter({ hasText: /residual|invalid/i }),
  ).toBeVisible({ timeout: 15_000 });
});
