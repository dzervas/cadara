import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { meanPixelDelta } from "./helpers/feature-workbench";
import {
  currentRevision,
  editVariable,
  importBundle,
  MOUNTS_BUNDLE_PATH,
  PART_STUDIO_BUNDLE_PATH,
  waitForMachineIdle,
  waitForRevisionChange,
} from "./helpers/onshape-import";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

const MOUNTS_CONSTRAINED_VERTEX =
  "sketch_primary.sketch_point_FOoap8tw3jKAJf5_0_wyM2UeVwCAKl_end";
const MOUNTS_BAKED_BODY = "body_feature_bakedBody-1";
const PART_STUDIO_BAKED_BODIES = [
  "body_feature_bakedBody-1_1",
  "body_feature_bakedBody-1_2",
];
const INVALID_REFERENCE_ALERT =
  /does not resolve|invalid reference|missing reference|solver|workbench action failed/i;

test("Mounts constrained sketch drag commits without breaking constraints", async ({
  page,
}) => {
  test.skip(
    !existsSync(MOUNTS_BUNDLE_PATH),
    "Real Onshape Mounts capture is not present locally.",
  );
  const workbench = new SketchWorkbenchHarness(page);

  await importBundle(page, MOUNTS_BUNDLE_PATH);
  await workbench.expectSketchSessionActive();
  const beforeRevision = await currentRevision(page);
  const beforePoint = await projectTarget(page, MOUNTS_CONSTRAINED_VERTEX);

  const viewport = await workbench.viewportSurface().boundingBox();
  if (!viewport) throw new Error("Viewport surface is not visible.");
  await page.mouse.move(viewport.x + beforePoint.x, viewport.y + beforePoint.y);
  await page.mouse.down();
  await page.mouse.move(
    viewport.x + beforePoint.x + 90,
    viewport.y + beforePoint.y + 45,
    { steps: 10 },
  );
  await page.mouse.up();

  const constrainedPoint = await projectTarget(page, MOUNTS_CONSTRAINED_VERTEX);
  expect.soft(constrainedPoint.x).toBeCloseTo(beforePoint.x, 1);
  expect.soft(constrainedPoint.y).toBeCloseTo(beforePoint.y, 1);

  await page.locator('button[data-tool-id="finishSketch"]').click();
  await waitForRevisionChange(page, beforeRevision);
  await waitForMachineIdle(page);

  const state = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(state.snapshotDiagnosticsCount).toBe(0);
  expect(state.featureIds).toEqual([
    "feature_extrude-1",
    "feature_bakedBody-1",
  ]);
  expect(state.selectableTargets).toEqual(
    expect.arrayContaining([
      "construction_plane-xy",
      "construction_plane-yz",
      "construction_plane-xz",
      "sketch_primary",
      MOUNTS_BAKED_BODY,
    ]),
  );
  await expectNoReferenceAlerts(page);
});

test("Mounts variable and extrude edits rebuild geometry while preserving its baked body", async ({
  page,
}) => {
  test.skip(
    !existsSync(MOUNTS_BUNDLE_PATH),
    "Real Onshape Mounts capture is not present locally.",
  );
  await importBundle(page, MOUNTS_BUNDLE_PATH, true);
  const initialState = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(initialState.selectableTargets).toContain(MOUNTS_BAKED_BODY);

  await chooseHistoryAction(page, "feature_extrude-1", "Roll History Here");
  const rolledState = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(rolledState.selectableTargets).toContain("body_feature_extrude-1");
  const beforeVariableGeometry = await page.locator("main canvas").first().screenshot();

  const variableState = await editVariable(page, "nail", "5");
  await page.locator("[data-workbench-variables-fab]").click();
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });
  const afterVariableGeometry = await page.locator("main canvas").first().screenshot();
  expect(meanPixelDelta(beforeVariableGeometry, afterVariableGeometry)).toBeGreaterThan(
    0.05,
  );
  expect(variableState.snapshotDiagnosticsCount).toBe(0);
  expect(variableState.selectableTargets).toContain("body_feature_extrude-1");

  await chooseHistoryAction(page, "feature_extrude-1", "Edit");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getState().featureSession ?? "",
        ),
      { timeout: 60_000 },
    )
    .toContain("edit:extrude:previewReady");
  const beforeFeatureRevision = await currentRevision(page);
  await page.getByRole("button", { name: "Edit Depth expression" }).click();
  await page.getByRole("textbox", { name: "Depth expression" }).fill("15");
  await page.getByRole("textbox", { name: "Depth expression" }).press("Enter");
  const previewDiagnostics = await page.evaluate(
    () => window.__cadaraDebug?.getState().previewDiagnostics ?? "",
  );
  expect.soft(previewDiagnostics).not.toMatch(/error/i);
  const commit = page.getByRole("button", { name: "Commit", exact: true });
  const canCommit = await commit.isEnabled();
  expect.soft(canCommit).toBe(true);
  if (!canCommit) return;
  await commit.click();
  await waitForRevisionChange(page, beforeFeatureRevision);
  await waitForMachineIdle(page);

  const rebuilt = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  expect(rebuilt.selectableTargets).toContain(MOUNTS_BAKED_BODY);
  expect(rebuilt.featureIds).toEqual([
    "feature_extrude-1",
    "feature_bakedBody-1",
  ]);
  await expectNoReferenceAlerts(page);
});

test("Part Studio 1 imports its plane, sketches, and extrude parametrically and rebuilds walls", async ({
  page,
}) => {
  test.skip(
    !existsSync(PART_STUDIO_BUNDLE_PATH),
    "Real Onshape Part Studio 1 capture is not present locally.",
  );
  await importBundle(page, PART_STUDIO_BUNDLE_PATH, true);

  const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect.soft(imported.snapshotDiagnosticsCount).toBe(0);
  expect.soft(imported.featureIds).toEqual([
    "feature_plane-1",
    "feature_extrude-1",
    "feature_bakedBody-1",
  ]);
  expect.soft(imported.selectableTargets).toEqual(
    expect.arrayContaining([
      "construction_feature_plane-1",
      "sketch_primary",
      "sketch_2",
      "sketch_3",
      "sketch_4",
      ...PART_STUDIO_BAKED_BODIES,
    ]),
  );
  const beforeGeometry = await page.locator("main canvas").first().screenshot();

  const rebuilt = await editVariable(page, "walls", "3");
  await page.locator("[data-workbench-variables-fab]").click();
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });
  const afterGeometry = await page.locator("main canvas").first().screenshot();

  expect.soft(meanPixelDelta(beforeGeometry, afterGeometry)).toBeGreaterThan(0.05);
  expect.soft(rebuilt.snapshotDiagnosticsCount).toBe(0);
  expect.soft(rebuilt.selectableTargets).toEqual(
    expect.arrayContaining(PART_STUDIO_BAKED_BODIES),
  );
  await expectNoReferenceAlerts(page);
});

async function chooseHistoryAction(
  page: Page,
  featureId: string,
  action: "Edit" | "Roll History Here" | "Roll To End",
) {
  const beforeRevision = await currentRevision(page);
  await page
    .locator(`[data-history-feature-id="${featureId}"]`)
    .click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: action, exact: true }).click({
    force: true,
  });
  await waitForRevisionChange(page, beforeRevision);
  if (action !== "Edit") await waitForMachineIdle(page);
}

async function projectTarget(page: Page, targetId: string) {
  const point = await page.evaluate(
    (id) => window.__cadProjectToScreen?.(id) ?? null,
    targetId,
  );
  if (!point) throw new Error(`Target ${targetId} is not projected in the viewport.`);
  return point;
}

async function expectNoReferenceAlerts(page: Page) {
  await expect(page.getByRole("alert").filter({ hasText: INVALID_REFERENCE_ALERT })).toHaveCount(
    0,
  );
}
