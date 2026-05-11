import { expect, test } from "@playwright/test";

import { meanPixelDelta } from "./helpers/feature-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

const REFERENCE_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSuoAAAAASUVORK5CYII=",
  "base64",
);

test("importing a sketch reference image through the file chooser should add sketch history and change the viewport", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);

  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
  });

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  const sketchHistory = page.locator('[data-history-kind="sketch"]');
  await expect(sketchHistory).toContainText("Empty sketch history");

  await workbench.waitForAnimationFrames(4);
  const baselineFrame = await workbench.viewport().screenshot();
  await workbench.waitForAnimationFrames(2);
  const settledBaselineFrame = await workbench.viewport().screenshot();
  const idleDelta = meanPixelDelta(baselineFrame, settledBaselineFrame);

  const fileChooserPromise = page.waitForEvent("filechooser");
  await workbench.activateTool(
    "Import one or more reference images into the active sketch.",
  );
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: REFERENCE_IMAGE_BYTES,
  });

  await workbench.expectMachine("editingSketch", 30_000);
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 30_000 })
    .toBe("editing");

  await workbench.waitForAnimationFrames(6);

  const importedFrame = await workbench.viewport().screenshot();
  const viewportDelta = meanPixelDelta(settledBaselineFrame, importedFrame);
  const historyItemCount = await sketchHistory
    .getByRole("button", { name: /reference\.png/i })
    .count();
  const emptyHistoryVisible = await sketchHistory
    .getByText("Empty sketch history")
    .count();

  const failures: string[] = [];

  if (historyItemCount < 1 || emptyHistoryVisible > 0) {
    failures.push(
      `expected the imported image to add a sketch history row, but historyItemCount=${historyItemCount} and emptyHistoryVisible=${emptyHistoryVisible}`,
    );
  }

  if (viewportDelta <= idleDelta + 5) {
    failures.push(
      `expected the imported image to visibly change the viewport, but idleDelta=${idleDelta.toFixed(2)} and viewportDelta=${viewportDelta.toFixed(2)}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
});
