import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1280, height: 900 } });

test("solid STL export downloads through the browser worker path", async ({
  page,
}) => {
  // Lane: e2e. Observe the real worker request so the displayed setting is
  // checked against what export actually submits, not only another label.
  await page.addInitScript(() => {
    const nativePostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (
        message?.kind === "invoke" &&
        message.operation?.kind === "tessellateExportMesh"
      ) {
        (
          window as Window & { __exportMeshOptions?: unknown }
        ).__exportMeshOptions = message.operation.options;
      }
      return nativePostMessage.call(
        this,
        message,
        Array.isArray(transfer) ? { transfer } : transfer,
      );
    };
  });
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.openWithBaseExtrudeFixture();

  const bodyRow = page
    .locator("[data-parts-tree-row]")
    .filter({ hasText: "Extrude 1" })
    .first();
  await expect(bodyRow).toBeVisible({ timeout: 30_000 });
  await bodyRow.click({ button: "right", force: true });

  await page.getByRole("menuitem", { name: "Export" }).click();
  await expect(
    page.getByRole("dialog", { name: "Export Extrude 1" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("radio", { name: "STL" })).toBeChecked();

  const tolerance = page.getByRole("textbox", { name: "Chord tolerance" });
  await tolerance.fill("0.125");
  await tolerance.press("Enter");
  await expect(tolerance).toHaveValue("0.125");
  await expect(
    page.getByRole("dialog", { name: "Export Extrude 1" }),
  ).toBeVisible();
  await tolerance.fill("");
  await tolerance.press("Tab");
  await expect
    .soft(
      tolerance,
      "Rejected empty option restores its accepted numeric value",
    )
    .toHaveValue("0.125");
  await page.screenshot({
    path: ".scratch/cadara-tx5f/compare/export-option.png",
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("extrude-1.stl");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __exportMeshOptions?: unknown })
          .__exportMeshOptions,
    ),
  ).toMatchObject({ chordTolerance: 0.125 });

  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Could not read exported STL file.");
  }

  const bytes = await readFile(downloadPath);
  expect(bytes.byteLength).toBeGreaterThan(84);
  expect(bytes.subarray(0, 24).toString("utf8")).toContain(
    "cadara binary stl export",
  );
});
