import { expect, test, type Page } from "@playwright/test";

import {
  glideDoubleClick,
  readHistoryStrip,
  selectRegionInViewport,
  waitForCommittedAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import { openDocumentCopy, saveDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  cropPixels,
  dangerColor,
  entityOf,
  entityTarget,
  expectStaged,
  glideClick,
  glidePress,
  hoverUntil,
  maxColorDistance,
  mirrorPanel,
  mirrorsOf,
  openSearchTool,
  openTopSketch,
  pixelsNear,
  placeFreely,
  positionOf,
  reflectAbout,
  sketchSnapshot,
  undoEntries,
  type CanvasPoint,
  type Rgb,
} from "./helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T16 mirror requirements and repair in
// the real workbench, where only the browser composes the gliding pointer,
// the pick stack, the Mirror and Dimension tools, the routed popup, the
// Mirror panel, the authored history, Finish, the File menu's Save As /
// Open (download and file chooser), re-entry and the Extrude feature. The
// rules are pinned by the T16a–f logic rows; these rows pin their browser
// wiring. Every pointer path glides (several `mouse.move` steps); waits are
// on committed history entries and session state, never a frame count.
// Discrimination per row: T16g.md.

// Viewport 1440×960, top plane: sketch origin at canvas (720, 480), Y up.
const SEED = { centre: { x: 640, y: 260 }, rim: { x: 700, y: 260 } };
/** A spare line (the replacement mirror line), clear of both circles. */
const SPARE = [
  { x: 450, y: 360 },
  { x: 1000, y: 360 },
] as const;
/** The construction mirror line (canvas y 420); the copy is centred at y 580. */
const AXIS = [
  { x: 400, y: 420 },
  { x: 1050, y: 420 },
] as const;
const COPY_CENTRE = { x: 640, y: 580 };
/** The other sketch's circle, away from everything in the mirrored sketch. */
const OTHER = { centre: { x: 980, y: 700 }, rim: { x: 1080, y: 700 } };
/** Rim points (lower left, away from labels and panels) for pixel checks. */
const SEED_RIM_SAMPLE = { x: 598, y: 302 };
const COPY_RIM_SAMPLE = { x: 598, y: 622 };
/** F-4 control: an unhighlighted rim's largest colour change (measured: T17b.md). */
const CONTROL_MAX_RIM_CHANGE = 30;

const floatingInput = (page: Page) =>
  page.locator("[data-sketch-viewport-floating-input]");

async function drawCircle(
  workbench: FeatureWorkbenchHarness,
  circle: { centre: CanvasPoint; rim: CanvasPoint },
  staged: number,
) {
  await workbench.activateTool("Create circular geometry.");
  await placeFreely(workbench, [circle.centre, circle.rim]);
  await expectStaged(workbench, staged);
}

/**
 * The seed circle (and optionally the spare line) and the construction
 * mirror line, mirrored with the Mirror tool (seed picked, then the line,
 * then confirmed with Enter: one "Mirror" action). Returns the ids.
 */
async function mirroredCircle(
  workbench: FeatureWorkbenchHarness,
  withSpare: boolean,
) {
  const page = workbench.page;
  await drawCircle(workbench, SEED, 1);
  if (withSpare) {
    await workbench.activateTool("Create line geometry.");
    await placeFreely(workbench, SPARE);
    await expectStaged(workbench, 2);
  }
  await workbench.activateTool(
    "Toggle sketch geometry construction-only or mark new sketch geometry as construction.",
  );
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, AXIS);
  await expectStaged(workbench, withSpare ? 3 : 2);
  const drawn = await sketchSnapshot(page);
  const seed = drawn.entities[0]!.id;
  const spare = withSpare ? drawn.entities[1]!.id : null;
  const axis = drawn.entities.at(-1)!.id;
  const spots = {
    seed: await hoverUntil(
      workbench,
      { x: SEED.centre.x, y: SEED.centre.y - 60 },
      entityTarget(seed),
    ),
    axis: await hoverUntil(workbench, { x: 900, y: 420 }, entityTarget(axis)),
    spare: spare
      ? await hoverUntil(workbench, { x: 900, y: 360 }, entityTarget(spare))
      : null,
  };
  await openSearchTool(page, "Sketch Mirror");
  await glideClick(workbench, spots.seed);
  await glideClick(workbench, spots.axis);
  await expect(
    page.locator(
      '[data-sketch-viewport-floating-input="sketch-mirror-confirm"]',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(undoEntries(page, "Mirror")).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");
  const mirrored = await sketchSnapshot(page);
  const [mirror] = mirrorsOf(mirrored);
  expect(mirror?.mirrorReference, "premise: mirrored about the line").toEqual({
    kind: "lineEntity",
    entityId: axis,
  });
  const copy = mirror!.outputs[0]!.outputEntityId;
  return { seed, spare, axis, copy, spots, mirrorId: mirror!.id };
}

const radiusOf = (
  snap: Awaited<ReturnType<typeof sketchSnapshot>>,
  id: string,
) => entityOf(snap, id).radius!;

// Plan row 2 ([TECH] T16-12/T16-14, T16f). Red on 46054e20 (pre-T16): the
// Dimension tool on the copy opens its own Reference-mode input, with no
// shared readout and the original not highlighted. T17b (F-4): the same
// pick before the original has a driving radius is the control (its value
// input open, neither circle is highlighted), so both highlights below are
// the linked highlight of the shared driver edit;
// dimensions are counted in the sketch snapshot (off-screen labels have no
// chip).
test("T16g row 2: the Dimension tool on a mirrored copy opens the original's driving radius (shared readout, both circles highlighted; without a driver the same pick highlights neither); Save is one action that edits both, one Ctrl+Z restores", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await openTopSketch(workbench);
  const { seed, copy } = await mirroredCircle(workbench, false);
  const dimensionCount = async () =>
    (await sketchSnapshot(page)).dimensions!.length;
  const popup = floatingInput(page);
  const pickCopyWithRadiusTool = async () => {
    await workbench.activateTool("Create point-to-point distance dimensions.");
    await glidePress(
      page,
      page.getByRole("menuitem", {
        name: /Radius Create circle radius dimensions/,
      }),
    );
    await glideClick(
      workbench,
      await hoverUntil(
        workbench,
        { x: COPY_CENTRE.x + 60, y: COPY_CENTRE.y },
        entityTarget(copy),
        4,
      ),
    );
    await glideClick(workbench, { x: 820, y: 660 });
    await expect(popup).toBeVisible({ timeout: 15_000 });
  };
  /** Each rim's largest colour change against its unhighlighted crop. */
  const rimChange = async (plain: { seed: Rgb[][]; copy: Rgb[][] }) => ({
    seed: maxColorDistance(
      await cropPixels(workbench, SEED_RIM_SAMPLE, 12),
      plain.seed,
    ),
    copy: maxColorDistance(
      await cropPixels(workbench, COPY_RIM_SAMPLE, 12),
      plain.copy,
    ),
  });
  /** Unhighlighted rims (nothing hovered or selected). */
  const plainRims = async () => {
    await workbench.clearHoverByLeavingViewport();
    await expect.poll(() => workbench.currentHoverTarget()).toBe("none");
    await expect
      .poll(() => workbench.currentEditorSelection())
      .toBe("Nothing selected");
    return {
      seed: await cropPixels(workbench, SEED_RIM_SAMPLE, 12),
      copy: await cropPixels(workbench, COPY_RIM_SAMPLE, 12),
    };
  };

  // Control (no driver yet): the same pick, with its value input open,
  // highlights neither circle; Escape records nothing.
  expect(await dimensionCount(), "premise: no dimension").toBe(0);
  const unpicked = await plainRims();
  const historyBefore = await readHistoryStrip(page);
  await pickCopyWithRadiusTool();
  await expect(
    popup.getByText(/^Shared with/),
    "control: no shared driver to open",
  ).toHaveCount(0);
  const control = await rimChange(unpicked);
  console.log(`F-4 control rim change ${JSON.stringify(control)}`);
  expect(control.seed, "control: the original").toBeLessThan(
    CONTROL_MAX_RIM_CHANGE,
  );
  expect(control.copy, "control: the copy").toBeLessThan(
    CONTROL_MAX_RIM_CHANGE,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden({ timeout: 15_000 });
  expect(await readHistoryStrip(page), "control: nothing recorded").toEqual(
    historyBefore,
  );
  expect(await dimensionCount(), "control: no dimension").toBe(0);

  // The original's driving radius (Radius tool, measured value committed).
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Radius Create circle radius dimensions/,
    }),
  );
  await glideClick(
    workbench,
    await hoverUntil(workbench, SEED.rim, entityTarget(seed), 4),
  );
  await glideClick(workbench, { x: 780, y: 170 });
  await expect(popup).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    glidePress(page, popup.getByRole("button", { name: "Commit" })),
  );
  await expect(popup).toBeHidden({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect(await dimensionCount(), "one driving radius").toBe(1);
  const before = await sketchSnapshot(page);
  const radius = radiusOf(before, seed);
  expect(radiusOf(before, copy), "premise: the copy's radius").toBeCloseTo(
    radius,
    9,
  );
  const plain = await plainRims();
  const historyWithDriver = await readHistoryStrip(page);

  // The Radius tool on the copy: its value input opens the original's
  // driver (routed before the redundancy probe).
  await pickCopyWithRadiusTool();
  await expect(popup.locator("[data-floating-input-readout]")).toHaveText(
    /^Shared with Radius \d+ through mirror ‘mirror \d+’$/,
    { timeout: 15_000 },
  );
  const input = popup.locator("input:not([role='switch'])").first();
  expect(Number(await input.inputValue()), "the driver's value").toBeCloseTo(
    radius,
    2,
  );
  await expect(popup.getByRole("switch")).not.toBeChecked();
  // Both sides are highlighted while the shared driver is edited.
  for (const side of ["seed", "copy"] as const)
    await expect
      .poll(async () => (await rimChange(plain))[side], {
        message: `the ${side === "seed" ? "original" : "copy"} is highlighted`,
        timeout: 10_000,
      })
      .toBeGreaterThan(60);
  console.log(
    `F-4 shared rim change ${JSON.stringify(await rimChange(plain))}`,
  );
  expect(
    await readHistoryStrip(page),
    "opening the edit records nothing",
  ).toEqual(historyWithDriver);

  const edited = Math.round(radius * 1.25 * 100) / 100;
  await input.fill(String(edited));
  await waitForCommittedAction(page, "Commit Annotation Value", () =>
    glidePress(page, popup.getByRole("button", { name: "Save" })),
  );
  await expect
    .poll(async () => {
      const snap = await sketchSnapshot(page);
      return [radiusOf(snap, seed), radiusOf(snap, copy)].map(
        (value) => Math.abs(value - edited) < 1e-6,
      );
    })
    .toEqual([true, true]);
  expect(
    await dimensionCount(),
    "no second driver or reference was added",
  ).toBe(1);

  // One Ctrl+Z restores both circles.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitForUndoneAction(page, "Commit Annotation Value", () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(async () => {
      const snap = await sketchSnapshot(page);
      return [radiusOf(snap, seed), radiusOf(snap, copy)].map(
        (value) => Math.abs(value - radius) < 1e-6,
      );
    })
    .toEqual([true, true]);
  expect(await dimensionCount()).toBe(1);
});

type SavedDocument = {
  historyOrder: { kind: string; sketchId?: string }[];
  sketches: {
    sketchId: string;
    label: string;
    definition: {
      entityIds: string[];
      derivedRelationships?: {
        kind: string;
        mirrorReference: { kind: string; entityId?: string };
      }[];
    };
  }[];
};

const regionTargets = (page: Page) =>
  page.evaluate(
    () =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) =>
          /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
        ) ?? [],
  );

/** Glides onto a timeline entry (the `index`-th of `label`) and double-clicks it. */
async function reenter(page: Page, label: string, index: number) {
  await glideDoubleClick(
    page,
    page
      .getByRole("button", { name: `Select ${label}. Double-click to reopen.` })
      .nth(index),
  );
}

// Plan rows 3 and 4 ([TECH] T16-4/T16-5/T16-6, T16b; recovery T16e). A
// mirror broken by deleting its mirror line: the copy is drawn invalid, the
// sketch offers no region; one Ctrl+Z / Ctrl+Shift+Z steps it; Finish, File
// Save As, File Open of the saved file; an unrelated sketch of the same
// document still extrudes while the broken one offers nothing; re-entry
// shows the same message, the panel's Broken row and the invalid copy;
// replacing the mirror line by a viewport pick (staged preview, confirm)
// repairs it and its regions come back.
test("T16g rows 3–4: delete the mirror line → copy invalid, no region; Undo/Redo one step; Finish → Save As → Open: same message, Broken, no region from this sketch while the unrelated sketch extrudes; replace the line by a pick (preview, confirm) → regions return", async ({
  page,
}) => {
  test.setTimeout(360_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const danger = await dangerColor(page);

  // The unrelated sketch: one circle.
  await openTopSketch(workbench);
  await drawCircle(workbench, OTHER, 1);
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);

  // The mirrored sketch, healthy: two regions (the circle and its copy).
  await openTopSketch(workbench);
  const ids = await mirroredCircle(workbench, true);
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 2 });

  // Delete the mirror line.
  await glideClick(workbench, ids.spots.axis);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(ids.axis);
  await page.keyboard.press("Delete");
  await expect(undoEntries(page, "Delete Sketch Item")).toHaveCount(1, {
    timeout: 15_000,
  });
  const brokenStatus = page
    .getByRole("status")
    .filter({ hasText: /^Mirror ‘mirror \d+’ is broken/ });
  await expect(brokenStatus).toHaveText(
    /^Mirror ‘mirror \d+’ is broken: its mirror line was deleted\. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked\. Undo, replace the mirror line, or remove the mirror from the Mirror panel\.$/,
    { timeout: 15_000 },
  );
  const message = await brokenStatus.textContent();
  await expect(mirrorPanel(page)).toContainText("Broken: mirror line missing");
  // (The debug count keeps the last regions while they are unavailable.)
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions?.status)
    .toBe("unavailable");
  /** The held copy is drawn in the danger red; the original is not. */
  const expectCopyInvalid = async (context: string) => {
    await workbench.clearHoverByLeavingViewport();
    await expect
      .poll(
        async () =>
          pixelsNear(await cropPixels(workbench, COPY_RIM_SAMPLE, 12), danger),
        { message: `${context}: the held copy is drawn invalid` },
      )
      .toBeGreaterThan(3);
    expect(
      pixelsNear(await cropPixels(workbench, SEED_RIM_SAMPLE, 12), danger),
      `${context}: the original is not`,
    ).toBe(0);
  };
  await expectCopyInvalid("after the delete");

  // T16b (A5): the held copy stays drawn invalid while other geometry is
  // dragged (before T16b it drew as current geometry during any drag).
  // Escape cancels the drag (no action).
  const beforeDrag = await sketchSnapshot(page);
  const canvas = (await workbench.viewport().boundingBox())!;
  const grab = ids.spots.spare!;
  await page.mouse.move(canvas.x + grab.x, canvas.y + grab.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  for (const dy of [6, 12, 18, 24])
    await page.mouse.move(canvas.x + grab.x, canvas.y + grab.y - dy, {
      steps: 3,
    });
  const spareStart = entityOf(beforeDrag, ids.spare!).pointIds![0]!;
  await expect
    .poll(async () => positionOf(await sketchSnapshot(page), spareStart).join())
    .not.toBe(positionOf(beforeDrag, spareStart).join());
  await expect
    .poll(
      async () =>
        pixelsNear(await cropPixels(workbench, COPY_RIM_SAMPLE, 12), danger),
      { message: "mid-drag: the held copy is drawn invalid" },
    )
    .toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(async () => positionOf(await sketchSnapshot(page), spareStart).join())
    .toBe(positionOf(beforeDrag, spareStart).join());

  // Plan row 4: one Ctrl+Z restores the healthy mirror, one Ctrl+Shift+Z
  // breaks it again.
  await page.keyboard.press("Control+z");
  await expect(undoEntries(page, "Delete Sketch Item")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 2 });
  await expect(brokenStatus).toHaveCount(0);
  expect(
    mirrorsOf(await sketchSnapshot(page))[0]!.mirrorReference,
    "Undo restores the mirror line",
  ).toEqual({ kind: "lineEntity", entityId: ids.axis });
  expect(
    pixelsNear(await cropPixels(workbench, COPY_RIM_SAMPLE, 12), danger),
    "the healthy copy is not drawn invalid",
  ).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(undoEntries(page, "Delete Sketch Item")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(brokenStatus).toHaveText(message!, { timeout: 15_000 });

  // Finish, then the real file round trip.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  const saved = await saveDocumentCopy<SavedDocument>(page);
  const mirrored = saved.sketches.find((sketch) =>
    (sketch.definition.derivedRelationships ?? []).some(
      (relationship) => relationship.kind === "mirror",
    ),
  )!;
  const other = saved.sketches.find(
    (sketch) => sketch.sketchId !== mirrored.sketchId,
  )!;
  expect(
    mirrored.definition.derivedRelationships![0]!.mirrorReference,
    "the saved file keeps the broken mirror (its line is gone)",
  ).toEqual({ kind: "lineEntity", entityId: ids.axis });
  expect(mirrored.definition.entityIds).not.toContain(ids.axis);
  expect(mirrored.definition.entityIds).toContain(ids.copy);
  await openDocumentCopy(page, saved, "broken-mirror.cadara");

  // Extrude: no region of the broken sketch is offered; the unrelated
  // sketch's region is, and it extrudes (picked in the viewport).
  await workbench.activateFeature("extrude");
  let regions: string[] = [];
  await expect
    .poll(
      async () => {
        regions = await regionTargets(page);
        return regions.map((target) => target.split(".")[0]);
      },
      { timeout: 30_000 },
    )
    .toEqual([other.sketchId]);
  await selectRegionInViewport(workbench, regions[0]!);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(regions[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);

  // Re-enter the broken sketch: the same message, the panel's Broken row
  // (no participant selected), no region, the copy still drawn invalid.
  const sketchOrder = saved.historyOrder
    .filter((item) => item.kind === "sketch")
    .map((item) => item.sketchId);
  await reenter(
    page,
    mirrored.label,
    sketchOrder
      .filter(
        (sketchId) =>
          saved.sketches.find((sketch) => sketch.sketchId === sketchId)!
            .label === mirrored.label,
      )
      .indexOf(mirrored.sketchId),
  );
  await workbench.expectSketchSessionActive();
  await expect(brokenStatus).toHaveText(message!, { timeout: 15_000 });
  await expect(mirrorPanel(page)).toContainText("Broken: mirror line missing", {
    timeout: 15_000,
  });
  expect(
    await workbench.currentEditorSelection(),
    "no mirror participant is selected (the re-entered sketch is)",
  ).toBe(mirrored.sketchId);
  // (The debug count keeps the last regions while they are unavailable.)
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions?.status)
    .toBe("unavailable");
  await expectCopyInvalid("after re-entry");

  // Recovery on the reopened file (fresh history): Replace mirror line… →
  // pick the spare line → the staged copy is drawn about it before the
  // confirm → Replace is one action; the mirror heals.
  await glidePress(
    page,
    mirrorPanel(page).getByRole("button", { name: "Replace mirror line…" }),
  );
  await expect(mirrorPanel(page)).toHaveCount(0, { timeout: 15_000 });
  const previewSample = { x: COPY_RIM_SAMPLE.x, y: COPY_RIM_SAMPLE.y - 120 };
  await workbench.clearHoverByLeavingViewport();
  const empty = await cropPixels(workbench, previewSample, 12);
  await glideClick(workbench, ids.spots.spare!);
  const repair = page.locator(
    '[data-sketch-viewport-floating-input="sketch-mirror-repair-confirm"]',
  );
  await expect(repair.locator("[data-floating-input-readout]")).toHaveText(
    /^Use ‘.+’ as the mirror line$/,
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () =>
        maxColorDistance(await cropPixels(workbench, previewSample, 12), empty),
      { message: "the staged copy is drawn about the picked line" },
    )
    .toBeGreaterThan(60);
  await expect(undoEntries(page, "Replace Mirror Line")).toHaveCount(0);
  await glidePress(page, repair.getByRole("button", { name: "Replace" }));
  await expect(undoEntries(page, "Replace Mirror Line")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(mirrorPanel(page)).toContainText("Healthy", { timeout: 15_000 });
  await expect(brokenStatus).toHaveCount(0);
  const repaired = await sketchSnapshot(page);
  const [mirror] = mirrorsOf(repaired);
  expect(mirror!.mirrorReference).toEqual({
    kind: "lineEntity",
    entityId: ids.spare,
  });
  expect(mirror!.outputs[0]!.outputEntityId, "the copy keeps its id").toBe(
    ids.copy,
  );
  const [lineStart, lineEnd] = entityOf(repaired, ids.spare!).pointIds!;
  const image = reflectAbout(
    positionOf(repaired, entityOf(repaired, ids.seed).pointIds![0]!),
    positionOf(repaired, lineStart!),
    positionOf(repaired, lineEnd!),
  );
  const copyCentre = positionOf(
    repaired,
    entityOf(repaired, ids.copy).pointIds![0]!,
  );
  expect(
    Math.hypot(copyCentre[0] - image[0], copyCentre[1] - image[1]),
    "the copy is the original's image about the new line",
  ).toBeLessThan(1e-6);
  await expect
    .poll(async () => (await sketchSnapshot(page)).liveRegions, {
      timeout: 30_000,
    })
    .toEqual({ status: "current", count: 2 });

  // Finished, the repaired sketch offers its regions again.
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
  await workbench.activateFeature("extrude");
  await expect
    .poll(
      async () =>
        (await regionTargets(page)).filter((target) =>
          target.startsWith(`${mirrored.sketchId}.`),
        ).length,
      { timeout: 30_000 },
    )
    .toBe(2);
});
