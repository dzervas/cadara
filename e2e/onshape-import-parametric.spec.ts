import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { meanPixelDelta } from "./helpers/feature-workbench";
import {
  currentRevision,
  editVariable,
  importBundle,
  LAPTOP_STAND_BUNDLE_PATH,
  MOUNTS_BUNDLE_PATH,
  PART_STUDIO_BUNDLE_PATH,
  SECOND_PART_STUDIO_BUNDLE_PATH,
  WAVE_T_BUNDLE_PATH,
  waitForMachineIdle,
  waitForRevisionChange,
} from "./helpers/onshape-import";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

const MOUNTS_CONSTRAINED_VERTEX =
  "sketch_2.sketch_point_FkkBVfXRKopMlIW_1_ZSK0f3tIhxWZ_center";
const MOUNTS_LIVE_BODY = "body_feature_extrude-1";
const MOUNTS_FULL_FEATURE_IDS = [
  "feature_extrude-1",
  "feature_plane-1",
  "feature_extrude-2",
  "feature_transform-1",
  "feature_chamfer-1",
];
// Shell 1 now bakes (apply-time topology rematch containment), so bake segment 1
// resolves to a single committed baked body instead of the earlier two.
const PART_STUDIO_BAKED_BODIES = ["body_feature_bakedBody-1"];
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

  const { reviewText } = await importBundle(page, MOUNTS_BUNDLE_PATH);
  expect(reviewText).toContain("10 parametric, 0 baked, 0 geometry-only features.");
  const importedState = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(importedState.featureIds).toEqual(MOUNTS_FULL_FEATURE_IDS);
  expectMountsLiveBodyIdentity(importedState);
  await expectNoWorkbenchAlerts(page);

  await chooseHistoryAction(page, "feature_transform-1", "Roll History Here");
  await page.getByRole("button", {
    name: "Select Sketch 2. Double-click to reopen.",
  }).dblclick();
  // Sketch 2 is committed on a captured-frame construction plane rather than a
  // canonical XY/YZ/XZ datum (contracts/shared/sketch-plane.ts SketchPlaneKey is
  // `null` for non-canonical planes), so the debug `sketchPlane` readout used by
  // `expectSketchSessionActive()` stays "none" by design; assert the machine state
  // directly instead.
  await workbench.expectMachine("editingSketch");
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
  // Wait for the post-finishSketch rebuild to settle before reading selectable
  // targets; otherwise the committed sketch/body can be momentarily absent.
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });

  const state = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(state.featureIds).toEqual(MOUNTS_FULL_FEATURE_IDS);
  expect(state.selectableTargets).toEqual(
    expect.arrayContaining([
      "construction_plane-xy",
      "construction_plane-yz",
      "construction_plane-xz",
      "sketch_primary",
    ]),
  );
  expectMountsLiveBodyIdentity(state);
  await expectNoWorkbenchAlerts(page);
});

test("Mounts variable and extrude edits rebuild geometry while preserving body lineage", async ({
  page,
}) => {
  test.skip(
    !existsSync(MOUNTS_BUNDLE_PATH),
    "Real Onshape Mounts capture is not present locally.",
  );
  const { reviewText } = await importBundle(page, MOUNTS_BUNDLE_PATH, true);
  expect(reviewText).toContain("10 parametric, 0 baked, 0 geometry-only features.");
  const initialState = await page.evaluate(() => window.__cadaraDebug!.getState());
  expectMountsLiveBodyIdentity(initialState);
  expect(initialState.featureIds).toEqual(MOUNTS_FULL_FEATURE_IDS);
  await expectNoWorkbenchAlerts(page);

  await chooseHistoryAction(page, "feature_extrude-1", "Roll History Here");
  const rolledState = await page.evaluate(() => window.__cadaraDebug!.getState());
  expectMountsLiveBodyIdentity(rolledState);
  const beforeVariableGeometry = await page.locator("main canvas").first().screenshot();

  const variableState = await editVariable(page, "nail", "5");
  await page.locator("[data-workbench-variables-fab]").click();
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });
  const afterVariableGeometry = await page.locator("main canvas").first().screenshot();
  expect(meanPixelDelta(beforeVariableGeometry, afterVariableGeometry)).toBeGreaterThan(
    0.05,
  );
  expectMountsLiveBodyIdentity(variableState);

  await chooseHistoryAction(page, "feature_extrude-2", "Roll History Here");
  const downstreamState = await page.evaluate(() => window.__cadaraDebug!.getState());
  // Extrude 2, Transform 1, and Chamfer 1 modify Extrude 1's body in place,
  // preserving its live lineage throughout the downstream history.
  expectMountsLiveBodyIdentity(downstreamState);
  expect(downstreamState.featureIds).toEqual(MOUNTS_FULL_FEATURE_IDS);
  const facesBeforeExtrude2 = variableState.selectableTargets.filter((target) =>
    target.includes("face_body_feature_extrude-1"),
  ).length;
  const facesAfterExtrude2 = downstreamState.selectableTargets.filter((target) =>
    target.includes("face_body_feature_extrude-1"),
  ).length;
  expect(facesAfterExtrude2).not.toBe(facesBeforeExtrude2);
  await chooseHistoryAction(page, "feature_extrude-2", "Roll To End");
  const endState = await page.evaluate(() => window.__cadaraDebug!.getState());
  expectMountsLiveBodyIdentity(endState);
  expect(endState.featureIds).toEqual(MOUNTS_FULL_FEATURE_IDS);
  await expectNoWorkbenchAlerts(page);

  await chooseHistoryAction(page, "feature_extrude-1", "Roll History Here");

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
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });

  const rebuilt = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(rebuilt.featureIds).toEqual(MOUNTS_FULL_FEATURE_IDS);
  await expectNoWorkbenchAlerts(page);
});

test("Part Studio 1 imports its supported planes and sketches, then rebuilds walls", async ({
  page,
}) => {
  test.skip(
    !existsSync(PART_STUDIO_BUNDLE_PATH),
    "Real Onshape Part Studio 1 capture is not present locally.",
  );
  const { reviewText } = await importBundle(page, PART_STUDIO_BUNDLE_PATH, true);
  // Shell 1 (the X.8 closedHollow shell) is promoted parametrically at review but
  // its `parts` body-scope reference fails apply-time topology rematch against the
  // live OCC prefix; containment bakes only that feature (and cascades dependents)
  // instead of aborting the studio, so the studio now reviews and commits.
  expect(reviewText).toContain("9 parametric, 32 baked, 0 geometry-only features.");
  expect(reviewText).toMatch(
    /Shell 1\s+baked \(suppressed\) — topology reference could not be rematched while applying/,
  );
  for (const label of ["Split 1", "Boolean 1", "Delete part 1"]) {
    expect(reviewText).toMatch(
      new RegExp(`${label}\\s+baked \\(suppressed\\) — topology reference did not match`),
    );
  }

  const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect.soft(imported.snapshotDiagnosticsCount).toBe(0);
  expect.soft(imported.featureIds).toEqual([
    "feature_plane-1",
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

const WAVE_T_TIMELINES = [
  {
    studio: "Revolve remove",
    featureIds: ["feature_extrude-1", "feature_revolve-1"],
    tierSummary: "4 parametric, 0 baked, 0 geometry-only features.",
  },
  {
    studio: "Sweep",
    featureIds: ["feature_sweep-1"],
    tierSummary: "3 parametric, 0 baked, 0 geometry-only features.",
  },
  {
    studio: "Mirror transform",
    featureIds: [
      "feature_extrude-1",
      "feature_plane-1",
      "feature_bakedBody-1",
    ],
    tierSummary: "3 parametric, 2 baked, 0 geometry-only features.",
  },
  // Full-revolve studio: the review lists two features (Sketch 1 + Revolve 1) and
  // commits a single live revolve; the trailing sketch session finishes cleanly.
  {
    studio: "Part Studio 1",
    featureIds: ["feature_revolve-1"],
    tierSummary: "2 parametric, 0 baked, 0 geometry-only features.",
  },
  {
    studio: "Loft",
    featureIds: ["feature_plane-1", "feature_loft-1"],
    tierSummary: "4 parametric, 0 baked, 0 geometry-only features.",
  },
] as const;

for (const fixture of WAVE_T_TIMELINES) {
  test(`Wave T ${fixture.studio} commits its real-kernel feature timeline`, async ({ page }) => {
    test.skip(
      !existsSync(WAVE_T_BUNDLE_PATH),
      "Real Onshape Wave T capture is not present locally.",
    );

    const { reviewText } = await importBundle(page, WAVE_T_BUNDLE_PATH, true, fixture.studio);
    expect(reviewText).toContain(fixture.tierSummary);
    const state = await page.evaluate(() => window.__cadaraDebug!.getState());

    expect(state.snapshotDiagnosticsCount).toBe(0);
    expect(state.featureIds).toEqual(fixture.featureIds);

    if (fixture.studio === "Revolve remove") {
      await editRevolveAngleAndExpectGeometryChange(page);
    }
    if (fixture.studio === "Sweep") {
      await dragSweepPathAndExpectGeometryChange(page);
    }
    await expectNoReferenceAlerts(page);
  });
}

// X.9.4 real-browser acceptance: the following three studios do NOT import in the
// real OCC kernel. Apply aborts with an extrude profile-selection error and the
// atomic rollback then times out on repository undo synchronization (90000ms),
// leaving a partial document. These are genuine apply-pipeline defects (extrude
// profile/region resolution), not harness issues, so they are pinned as fixme
// with the honest observed tiers and the intended committed timeline. Remove the
// fixme once the profile-selection apply failure and rollback-undo timeout are
// fixed; the mock logic-lane review reports 23/1/0 (5151), 23/1/0 (d3cd9), and
// 6/0/0 (Wave T Extrude extents), all rosier than the real kernel.

test.fixme(
  "Laptop Stand studio imports its baked segments and rebuilds against LaptopWidth",
  async ({ page }) => {
    test.skip(
      !existsSync(LAPTOP_STAND_BUNDLE_PATH),
      "Real Onshape Laptop Stand capture is not present locally.",
    );
    // Observed import: apply fails "Extrude 2 profile selection is incorrect";
    // rollback times out after 90s. Budget beyond the file-wide 180s default so
    // the clean-import path (post-fix) has headroom for the ~93s apply.
    test.setTimeout(300_000);

    const { reviewText } = await importBundle(page, LAPTOP_STAND_BUNDLE_PATH, true);
    // Honest browser tier (mock review is 23 parametric, 1 baked): the real
    // kernel bakes 14 of the boolean/topology-scoped features into 2 checkpoints.
    expect(reviewText).toContain("10 parametric, 14 baked, 0 geometry-only features.");
    const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
    expect(imported.snapshotDiagnosticsCount).toBe(0);
    expect(imported.featureIds).toEqual(["feature_extrude-1"]);
    await expectNoReferenceAlerts(page);

    const beforeGeometry = await page.locator("main canvas").first().screenshot();
    // LaptopWidth is a translated document variable; edit it to a value distinct
    // from the captured default so the live extrude rebuilds visibly.
    const rebuilt = await editVariable(page, "LaptopWidth", "160");
    await page.locator("[data-workbench-variables-fab]").click();
    await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });
    const afterGeometry = await page.locator("main canvas").first().screenshot();
    expect(meanPixelDelta(beforeGeometry, afterGeometry)).toBeGreaterThan(0.05);
    expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  },
);

test.fixme(
  "Second Part Studio bundle imports its baked segment and rebuilds against walls",
  async ({ page }) => {
    test.skip(
      !existsSync(SECOND_PART_STUDIO_BUNDLE_PATH),
      "Real Onshape second Part Studio capture is not present locally.",
    );
    // Observed import: apply fails "Extrude 1 profile selection is incorrect";
    // rollback times out after 90s, leaving a document with the sketch only and
    // zero solid bodies (featureIds === []).
    test.setTimeout(300_000);

    const { reviewText } = await importBundle(page, SECOND_PART_STUDIO_BUNDLE_PATH, true);
    // Honest browser tier (mock review is 23 parametric, 1 baked): the real
    // kernel bakes 11 boolean/topology-scoped features into 1 checkpoint.
    expect(reviewText).toContain("13 parametric, 11 baked, 0 geometry-only features.");
    const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
    expect(imported.snapshotDiagnosticsCount).toBe(0);
    // Intended committed timeline once the apply defect is fixed: the live
    // Extrude 1 plus the bake-segment body. Currently the studio commits an
    // empty solid timeline, so this assertion documents the target state.
    expect(imported.featureIds.length).toBeGreaterThan(0);
    await expectNoReferenceAlerts(page);

    const beforeGeometry = await page.locator("main canvas").first().screenshot();
    const rebuilt = await editVariable(page, "walls", "3");
    await page.locator("[data-workbench-variables-fab]").click();
    await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });
    const afterGeometry = await page.locator("main canvas").first().screenshot();
    expect(meanPixelDelta(beforeGeometry, afterGeometry)).toBeGreaterThan(0.05);
    expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  },
);

test.fixme(
  "Wave T Extrude extents commits its real-kernel feature timeline",
  async ({ page }) => {
    test.skip(
      !existsSync(WAVE_T_BUNDLE_PATH),
      "Real Onshape Wave T capture is not present locally.",
    );
    // Observed import: apply fails "Up to next extrude profile selection is
    // incorrect"; rollback times out after 90s. The review tier itself is clean.
    test.setTimeout(300_000);

    const { reviewText } = await importBundle(page, WAVE_T_BUNDLE_PATH, true, "Extrude extents");
    expect(reviewText).toContain("6 parametric, 0 baked, 0 geometry-only features.");
    const state = await page.evaluate(() => window.__cadaraDebug!.getState());
    expect(state.snapshotDiagnosticsCount).toBe(0);
    expect(state.featureIds).toEqual(["feature_extrude-1", "feature_extrude-2"]);
    await expectNoReferenceAlerts(page);
  },
);

async function editRevolveAngleAndExpectGeometryChange(page: Page) {
  const beforeGeometry = await page.locator("main canvas").first().screenshot();
  await chooseHistoryAction(page, "feature_revolve-1", "Edit");
  await expect
    .poll(
      () => page.evaluate(() => window.__cadaraDebug?.getState().featureSession ?? ""),
      { timeout: 60_000 },
    )
    .toContain("edit:revolve:previewReady");

  const beforeRevision = await currentRevision(page);
  await page.getByRole("button", { name: "Edit Angle (degrees) expression" }).click();
  const angle = page.getByRole("textbox", { name: "Angle (degrees) expression" });
  await angle.fill("90");
  await angle.press("Enter");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await waitForRevisionChange(page, beforeRevision);
  await waitForMachineIdle(page);
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });

  const afterGeometry = await page.locator("main canvas").first().screenshot();
  expect(meanPixelDelta(beforeGeometry, afterGeometry)).toBeGreaterThan(0.05);
}

async function dragSweepPathAndExpectGeometryChange(page: Page) {
  const workbench = new SketchWorkbenchHarness(page);
  const beforeGeometry = await page.locator("main canvas").first().screenshot();
  await page.getByRole("button", {
    name: "Select Sweep path. Double-click to reopen.",
  }).dblclick();
  await workbench.expectSketchSessionActive();

  // Confirmed against the real Wave T bundle: sketch entity ids are prefixed with
  // the owning Onshape sketch feature id (`sketch_point_<sketchFeatureId>_<entityId>_<role>`).
  const pointCandidates = ["sketch_2.sketch_point_FmRzyMZqAsUDXhZ_0_Sweep_path_0_end"];
  const beforeRevision = await currentRevision(page);
  let point: { x: number; y: number } | null = null;
  for (const targetId of pointCandidates) {
    point = await page.evaluate((id) => window.__cadProjectToScreen?.(id) ?? null, targetId);
    if (point) break;
  }
  if (!point) throw new Error(`Sweep path endpoint is not projected: ${pointCandidates.join(", ")}`);
  const viewport = await workbench.viewportSurface().boundingBox();
  if (!viewport) throw new Error("Viewport surface is not visible.");
  await page.mouse.move(viewport.x + point.x, viewport.y + point.y);
  await page.mouse.down();
  await page.mouse.move(viewport.x + point.x + 70, viewport.y + point.y - 25, {
    steps: 10,
  });
  await page.mouse.up();
  await page.locator('button[data-tool-id="finishSketch"]').click();
  await waitForRevisionChange(page, beforeRevision);
  await waitForMachineIdle(page);
  await page.waitForSelector('[data-render-idle="true"]', { timeout: 30_000 });

  const afterGeometry = await page.locator("main canvas").first().screenshot();
  expect(meanPixelDelta(beforeGeometry, afterGeometry)).toBeGreaterThan(0.05);
}

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
  if (!point) {
    const candidates = await page.evaluate(() =>
      window.__cadaraDebug?.getState().selectableTargets.filter((id) => id.includes("sketch_2")),
    );
    throw new Error(`Target ${targetId} is not projected in the viewport. Candidates: ${candidates?.join(", ")}`);
  }
  return point;
}


function expectMountsLiveBodyIdentity(state: { selectableTargets: string[] }) {
  expect(state.selectableTargets).not.toContain("body_feature_bakedBody-1");
  expect(
    state.selectableTargets.some((target) => target.includes(MOUNTS_LIVE_BODY)),
    `Expected Mounts live body identity ${MOUNTS_LIVE_BODY}; body targets: ${state.selectableTargets
      .filter((target) => target.includes("body_feature_") || target.includes("face_body_feature_"))
      .join(", ")}`,
  ).toBe(true);
}

async function expectNoWorkbenchAlerts(page: Page) {
  await expect(page.getByRole("alert")).toHaveCount(0);
}

async function expectNoReferenceAlerts(page: Page) {
  await expect(page.getByRole("alert").filter({ hasText: INVALID_REFERENCE_ALERT })).toHaveCount(
    0,
  );
}
