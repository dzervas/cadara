import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  editVariable,
  importBundle,
  MOUNTS_BUNDLE_PATH,
  PART_STUDIO_BUNDLE_PATH,
} from "./helpers/onshape-import";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(120_000);

test("Mounts import, history-at-end nail edit, and reload keep Chamfer live", async ({
  page,
}) => {
  test.skip(
    !existsSync(MOUNTS_BUNDLE_PATH),
    "Real Onshape capture is not present locally.",
  );
  const harness = new SketchWorkbenchHarness(page);
  await importBundle(page, MOUNTS_BUNDLE_PATH, true);

  const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(imported.featureIds.at(-1)).toBe("feature_chamfer-1");
  expect(imported.snapshotDiagnosticsCount).toBe(0);

  const rebuilt = await editVariable(page, "nail", "4.1");
  expect(rebuilt.featureIds.at(-1)).toBe("feature_chamfer-1");
  expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  // Region durable id derives from the exact-region arrangement (source keys,
  // split ordinals, traversal), which the exact-Onshape-region resolution work
  // deterministically re-derived; the region still rebuilds cleanly here.
  expect(rebuilt.selectableTargets).toContain(
    "sketch_primary.region_primary-sketch_entity_FOoap8tw3jKAJf5_0_ATLNdmpEpWg5-2nko3yikmohbt",
  );

  await harness.reloadPreservingRepositoryStorage();
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 60_000 });
  const restored = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(restored.featureIds.at(-1)).toBe("feature_chamfer-1");
  expect(restored.snapshotDiagnosticsCount).toBe(0);
  await expect(page.getByText(/Workbench action failed/i)).toHaveCount(0);
});


test("Mounts Transform reference and Chamfer edit preview stay valid", async ({
  page,
}) => {
  test.skip(
    !existsSync(MOUNTS_BUNDLE_PATH),
    "Real Onshape capture is not present locally.",
  );
  await importBundle(page, MOUNTS_BUNDLE_PATH);

  await page
    .getByRole("button", {
      name: "Select Transform 1. Double-click to reopen.",
    })
    .dblclick({ force: true });
  const transformInspector = page.locator("aside").filter({ hasText: "Transform 1" });
  await expect(transformInspector.getByText("Rotation axis", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    transformInspector.getByRole("button", { name: "Clear Rotation axis" }),
  ).toBeEnabled();
  await transformInspector.getByRole("button", { name: "Cancel" }).click();
  await page.waitForFunction(
    () =>
      window.__cadaraDebug?.getState().machineState === "idle" &&
      window.__cadaraDebug?.getState().featureSession === "none",
    undefined,
    { timeout: 30_000 },
  );

  await page
    .getByRole("button", {
      name: "Select Chamfer 1. Double-click to reopen.",
    })
    .dblclick({ force: true });
  const chamferInspector = page.locator("aside").filter({ hasText: "Chamfer 1" });
  const distance = chamferInspector.getByRole("spinbutton", { name: "Distance" });
  await expect(distance).toHaveValue("2.5", { timeout: 30_000 });
  await distance.fill("2.4");
  await expect(distance).toHaveValue("2.4");
  await page.waitForFunction(
    () => window.__cadaraDebug?.getState().featureSession.includes("previewReady"),
    undefined,
    { timeout: 60_000 },
  );
  const preview = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(preview.previewDiagnostics).toBe("");
  await expect(chamferInspector.getByText("ERROR", { exact: true })).toHaveCount(0);
});

test("second real Onshape bundle updates walls against the latest revision", async ({
  page,
}) => {
  // The 9841 bundle (~237 MB with full bake-boundary snapshots) rebuilds every
  // distinct probe prefix in the kernel during review, and now promotes two more
  // features (`Shell 1`, `Extrude 2`), so each rebuild carries more geometry
  // (~7 min end to end). Budget beyond the file-wide 120 s default.
  test.setTimeout(2_400_000);
  test.skip(
    !existsSync(PART_STUDIO_BUNDLE_PATH),
    "Second real Onshape capture is not present locally.",
  );
  await importBundle(page, PART_STUDIO_BUNDLE_PATH);
  await editVariable(page, "walls", "3");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /request revision .* does not match current revision/i }),
  ).toHaveCount(0);
  await expect(page.getByText(/Workbench action failed/i)).toHaveCount(0);
});
