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
// The first bake segment commits its two checkpoint bodies for the baked run
// that follows the promoted parametric prefix.
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
  // The start-extent contract makes Extrude 1 and its cascade live, so this
  // 237 MB studio now builds real solids through every review probe pass.
  test.setTimeout(1_800_000);
  const { reviewText } = await importBundle(
    page,
    PART_STUDIO_BUNDLE_PATH,
    true,
    undefined,
    1_500_000,
  );
  // `Extrude 1` is fully parametric: its `UP_TO_VERTEX` END extent resolves at
  // an exact `Screen Outline` sketch point (X.9.1), and its Onshape START offset
  // (`startOffset=true`, `startOffsetBound=ENTITY`) resolves through the extrude
  // contract's `sketchPointOffset` start extent. With the correct 120 mm body
  // live, `Chamfer 1`'s captured edge finally matches its live edge exactly.
  //
  // `Chamfer 2` is now parametric too. It selects `Chamfer 1`'s own boundary
  // edges, which no builder history names: `BRepFilletAPI::Generated` answers
  // with the chamfer SURFACE only. Those edges are now identified by the faces
  // they bound (exact combinatorial identity), so the rebuild keeps them live
  // instead of refusing them with `occ-topology-unsupported-history`.
  //
  // `Shell 1` and `Extrude 2` are parametric now. A pre-consumer prefix probe
  // suppresses bake checkpoints for sub-topology consumers, so a baked run in
  // that prefix contributes no bodies at all; `Shell 1`'s body rematch used to
  // run against that empty prefix and force-bake itself for the whole studio.
  // Such a failure is now contained at the prefix-probe boundary, so `Shell 1`
  // is decided by the whole-plan probes that build the sequence apply runs.
  expect(reviewText).toContain("13 parametric, 28 baked, 0 geometry-only features.");
  expect(reviewText).toMatch(/Extrude 1\s+parametric/);
  expect(reviewText).toMatch(/Chamfer 1\s+parametric/);
  expect(reviewText).toMatch(/Chamfer 2\s+parametric/);
  expect(reviewText).toMatch(/Shell 1\s+parametric/);
  expect(reviewText).toMatch(/Extrude 2\s+parametric/);
  // `Split 1` is excluded scope and cascades behind an earlier failure. Assert
  // only that it stays baked and suppressed; the quoted diagnostic names
  // whichever upstream feature the kernel refused first.
  expect(reviewText).toMatch(/Split 1\s+baked \(suppressed\) —/);

  const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect.soft(imported.snapshotDiagnosticsCount).toBe(0);
  expect.soft(imported.featureIds).toEqual([
    "feature_plane-1",
    // Every promoted feature reaches the committed timeline: the extrude built
    // between its authored start plane and its sketch-point terminator, the
    // chamfer that consumes the resulting 120 mm edge, and the chamfer that
    // consumes the first chamfer's own generated boundary edges.
    "feature_extrude-1",
    "feature_chamfer-1",
    "feature_chamfer-2",
    "feature_shell-1",
    "feature_extrude-2",
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
  // Upstream-edit proof for the newly promoted generated-topology class: the
  // `walls` edit rebuilds the whole timeline, so `Chamfer 2`'s reference to
  // `Chamfer 1`'s generated boundary edges must resolve again from the adjacency
  // claims alone. Losing it would drop the feature instead of raising an alert.
  expect.soft(rebuilt.featureIds).toContain("feature_chamfer-2");
  // Same proof for this iteration's promotions: `Shell 1`'s deferred body
  // selector and `Extrude 2` behind it must rematch through the rebuild.
  expect.soft(rebuilt.featureIds).toContain("feature_shell-1");
  expect.soft(rebuilt.featureIds).toContain("feature_extrude-2");
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
      "feature_mirror-1",
      "feature_transform-1",
    ],
    tierSummary: "5 parametric, 0 baked, 0 geometry-only features.",
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

// Laptop Stand now imports AND COMMITS. Two kernel-level fixes got it here:
//
// 1. One extrude is one operation. Its per-profile / per-end prisms are fused
//    (see `fuseExtrudedShapes` in occ/features/extrude.ts) instead of being
//    stapled into a compound, so Extrude 1's two touching regions build the
//    single body Onshape reports rather than two solids that later read as a
//    severed body and invalidated Fillet 1's captured edges.
// 2. Review now ends with a build-containment probe over the exact ordered
//    action sequence apply will run. A feature the live kernel refuses to build
//    is demoted to baked with `feature-kernel-build-failed`, attributed from the
//    ordered position the emitter recorded for it, so one unbuildable feature
//    cannot abort the studio.
//
// The remaining bakes are honest and each names a specific reason; they are not
// tuned away. Extrude 4 (the real severing THROUGH_ALL cut) does not build
// against the live prefix and is contained as `feature-kernel-build-failed`; its
// preserved probe diagnostic (X.9.3) names the exact kernel cause, and the
// downstream extent/evidence bakes all quote that same first failure rather than
// a generic no-match. Sketch 5 is now parametric: its Onshape circle OFFSET was
// being translated with an inverted sign (collapsing the circle at solve time)
// and its radial-gap DISTANCE dimensions were being forged into line dimensions
// the solver rejects; both now translate honestly.

const LAPTOP_STAND_FEATURE_IDS = [
  "feature_extrude-1",
  "feature_extrude-2",
  "feature_fillet-1",
  "feature_bakedBody-1",
  "feature_extrude-3",
  "feature_bakedBody-2",
];

test("Laptop Stand commits its honest real-kernel tier split", async ({
  page,
}) => {
  test.skip(
    !existsSync(LAPTOP_STAND_BUNDLE_PATH),
    "Real Onshape Laptop Stand capture is not present locally.",
  );
  test.setTimeout(700_000);
  const { reviewText } = await importBundle(page, LAPTOP_STAND_BUNDLE_PATH, true);
  expect(reviewText).toContain("11 parametric, 13 baked, 0 geometry-only features.");
  for (const [label, reason] of [
    ["Fillet 2", "topology reference did not match"],
    ["Chamfer 1", "topology reference could not be rematched while applying"],
    ["Extrude 4", "the modeling kernel could not build this feature against the live prefix"],
    ["Chamfer 2", "topology reference could not be rematched while applying"],
    // Extrude 6 / 7 author an Onshape `startOffset` start plane (bound ENTITY),
    // which Cadara's profile-plane-only `startExtent` cannot express yet.
    ["Extrude 6", "extrude starts at an offset start plane, which is not supported yet"],
    ["Linear pattern 1", "depends on previously baked geometry"],
    ["Extrude 7", "extrude starts at an offset start plane, which is not supported yet"],
    ["Linear pattern 2", "depends on previously baked geometry"],
    ["Mirror 1", "depends on previously baked geometry"],
    ["Boolean 1", "captured history topology evidence is missing"],
    ["Chamfer 3", "topology reference did not match"],
    ["Extrude 8", "extrude up-to or boolean-scope topology could not be resolved as a durable reference"],
    ["Extrude 3", "extrude up-to or boolean-scope topology could not be resolved as a durable reference"],
  ] as const) {
    expect(reviewText, `${label} must state its honest bake reason.`).toMatch(
      new RegExp(`${label}\\s+baked \\(suppressed\\) — [^\\n]*${escapeRegExp(reason)}`),
    );
  }

  // X.9.3: the first specific kernel probe failure must survive next to the
  // generic reason code, so each iteration names the next real root cause
  // instead of collapsing every downstream bake into "evidence missing".
  expect(
    reviewText,
    "Extrude 4 must expose the kernel's own first build diagnostic.",
  ).toMatch(/Extrude 4 boolean target is incorrect\./);

  const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(imported.snapshotDiagnosticsCount).toBe(0);
  expect(imported.featureIds).toEqual(LAPTOP_STAND_FEATURE_IDS);
  await expectNoWorkbenchAlerts(page);

  // `Wall` drives Extrude 1's blind distance directly. The edit does rebuild and
  // the committed timeline survives it, but it surfaces exactly one diagnostic:
  // `occ-missing-reference` on Extrude 5's profile selection, because Sketch 4's
  // region durable ids are re-minted on any re-solve. That is the same
  // pre-existing region-identity defect already documented for d3cd9's `walls`
  // lever and is unrelated to this import gate; all four of this bundle's
  // variables (Wall/Margin/LaptopWidth/LaptopThickness) hit it identically, so
  // there is no clean lever to substitute. Pinned at 1 rather than 0 so the
  // count cannot silently grow, and flip to 0 when region identity is stable.
  const rebuilt = await editVariable(page, "Wall", "4");
  expect(
    rebuilt.snapshotDiagnosticsCount,
    "Only the pre-existing Sketch 4 region-identity diagnostic may survive a variable edit.",
  ).toBe(1);
  expect(rebuilt.featureIds).toEqual(LAPTOP_STAND_FEATURE_IDS);
});

// d3cd9 commits in the real kernel. Its reviewed tiers equal what apply actually
// creates: every consumer whose profile sketch stayed baked is baked
// (`downstream-of-baked`) instead of being silently dropped at prepare.
//
// Extrude 2, Extrude 3, and Mirror 1 became parametric once one extrude stopped
// emitting one solid per profile lobe (`fuseExtrudedShapes`): their boolean
// scopes now resolve against the single body Onshape reports instead of against
// a spuriously severed one.
test("Second Part Studio commits its honest real-kernel tier split", async ({
  page,
}) => {
  test.skip(
    !existsSync(SECOND_PART_STUDIO_BUNDLE_PATH),
    "Real Onshape second Part Studio capture is not present locally.",
  );
  test.setTimeout(700_000);
  const { reviewText } = await importBundle(page, SECOND_PART_STUDIO_BUNDLE_PATH, true);
  expect(reviewText).toContain("16 parametric, 8 baked, 0 geometry-only features.");
  for (const [label, reason] of [
    ["Extrude 4", "only solid extrudes can import as parametric solid features"],
    // Excluded scope; the probe now names the kernel's real refusal.
    ["Split 1", "not a closed two-manifold shell"],
    ["Sketch 7", "requires captured history topology evidence"],
    ["Extrude 5", "depends on previously baked geometry"],
    ["Extrude 6", "depends on previously baked geometry"],
    ["Sketch 8", "requires captured history topology evidence"],
    ["Extrude 7", "depends on previously baked geometry"],
    // d3cd9's Extrude 8 also authors a `startOffset` start plane, so it now
    // names that intrinsic reason ahead of its split-dependent cascade.
    ["Extrude 8", "extrude starts at an offset start plane, which is not supported yet"],
  ] as const) {
    expect(reviewText, `${label} must state its honest bake reason.`).toMatch(
      new RegExp(`${label}\\s+baked \\(suppressed\\) — [^\\n]*${escapeRegExp(reason)}`),
    );
  }

  const imported = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(imported.snapshotDiagnosticsCount).toBe(0);
  expect(imported.featureIds).toEqual([
    "feature_extrude-1",
    "feature_plane-1",
    "feature_plane-2",
    "feature_plane-3",
    "feature_plane-4",
    "feature_extrude-2",
    "feature_extrude-3",
    "feature_mirror-1",
    "feature_bakedBody-1",
    "feature_extrude-4",
  ]);
  await expectNoWorkbenchAlerts(page);

  // The bundle carries real document variables; a `screwHole` edit proves the
  // committed parametric prefix still rebuilds against the baked checkpoint.
  // (`walls` is a separate lever: it reshapes Sketch 1, whose region durable ids
  // then no longer resolve for Extrude 1 — a pre-existing region-identity defect
  // unrelated to this import gate.)
  const rebuilt = await editVariable(page, "screwHole", "6");
  expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  expect(rebuilt.featureIds).toEqual(imported.featureIds);
  await expectNoReferenceAlerts(page);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Wave T "Extrude extents" now imports cleanly in the real kernel (the parallel
// up-to-next profile fix landed), committing its three-extrude timeline.
test("Wave T Extrude extents commits its real-kernel feature timeline", async ({
  page,
}) => {
  test.skip(
    !existsSync(WAVE_T_BUNDLE_PATH),
    "Real Onshape Wave T capture is not present locally.",
  );
  test.setTimeout(170_000);
  const { reviewText } = await importBundle(page, WAVE_T_BUNDLE_PATH, true, "Extrude extents");
  expect(reviewText).toContain("6 parametric, 0 baked, 0 geometry-only features.");
  const state = await page.evaluate(() => window.__cadaraDebug!.getState());
  expect(state.snapshotDiagnosticsCount).toBe(0);
  expect(state.featureIds).toEqual([
    "feature_extrude-1",
    "feature_extrude-2",
    "feature_extrude-3",
  ]);
  const bodyTargets = state.selectableTargets.filter(
    (target) => target.startsWith("body_feature_") && !target.includes("."),
  );
  expect(bodyTargets).toEqual(["body_feature_extrude-1", "body_feature_extrude-2"]);
  expect(bodyTargets).not.toEqual(
    expect.arrayContaining(["body_feature_extrude-2_1", "body_feature_extrude-2_2"]),
  );
  await expectNoReferenceAlerts(page);
});

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
