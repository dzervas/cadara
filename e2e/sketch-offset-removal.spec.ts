import { expect, test } from "@playwright/test";

import {
  waitForCommittedAction,
  waitForRedoneAction,
  waitForUndoneAction,
  type CanvasPoint,
} from "./helpers/acceptance";
import {
  cropPixels,
  entityTarget,
  glideClick,
  glidePress,
  hoverUntil,
  openTopSketch,
  placeFreely,
  sketchSnapshot,
  type MirrorSketchSnapshot,
  type Vec,
} from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness, sketchDiagnosticMessage } from "./helpers/sketch-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T17c ([TECH] T17-5) offset removal and
// the F1 blocked-offset tint in the real workbench: the Offset tool's
// certified commit (derivation worker), a gliding selection of an output →
// the selection-context Offset panel → the reducer → the authored history
// (one "Remove Offset" action, Undo/Redo); and the rendered invalid tint of
// a failed offset's outputs. Only the browser composes pointer → pick stack
// → panel → session → history → derivation round → renderer. The write set
// and the panel state are pinned by the logic rows (`derived-removal.spec`,
// `offset-actions.spec`, `sketch-authored-actions.spec`).

const OFFSET_TOOL =
  "Offset a connected chain with a durable offset relationship.";
// Viewport 1440×960, top plane (origin at (720, 480), Y up). Every placement
// uses Shift (no inferred constraint).
const SPLINE = [
  { x: 600, y: 560 },
  { x: 720, y: 440 },
  { x: 840, y: 560 },
] as const;
const LINE_END = { x: 980, y: 560 } as const;
// Two lines with a corner at (840, 560); the outward offset joins them with
// a joint arc.
const CHAIN = [
  { x: 560, y: 560 },
  { x: 840, y: 560 },
  { x: 840, y: 340 },
] as const;

/** The sketch → canvas map, from two placed points and their sketch positions. */
function screenMap(
  placed: readonly [CanvasPoint, CanvasPoint],
  sketch: readonly [Vec, Vec],
) {
  const k = (placed[1].x - placed[0].x) / (sketch[1][0] - sketch[0][0]);
  return (point: Vec): CanvasPoint => ({
    x: placed[0].x + k * (point[0] - sketch[0][0]),
    y: placed[0].y - k * (point[1] - sketch[0][1]),
  });
}

const positionOf = (snap: MirrorSketchSnapshot, id: string) =>
  snap.points.find((point) => point.id === id)!.position;

/** Selects the chain (gliding picks), sets the side and distance, and commits one offset. */
async function commitOffset(
  workbench: SketchWorkbenchHarness,
  picks: readonly { around: CanvasPoint; entityId: string }[],
  side: CanvasPoint,
  distance: string,
  committedLabel: string,
) {
  const page = workbench.page;
  await workbench.activateTool(OFFSET_TOOL);
  for (const pick of picks)
    await glideClick(
      workbench,
      await hoverUntil(workbench, pick.around, entityTarget(pick.entityId)),
    );
  await page.getByRole("textbox", { name: "Distance" }).fill(distance);
  const canvas = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(canvas.x + side.x, canvas.y + side.y, { steps: 8 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible({ timeout: 15_000 });
  // A commit that waits for the preview's certification lands with the
  // publication event; it is the same "Commit Offset" action (T17c3). The
  // certification may take a while on a loaded lane.
  await waitForCommittedAction(
    page,
    committedLabel,
    () =>
      glidePress(page, floatingInput.getByRole("button", { name: "Create" })),
    { timeout: 60_000 },
  );
  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), { timeout: 5_000 })
    .toMatch(/collecting|editing/);
}

test("T17c: a spline offset's shell → Offset panel → Remove offset: one Remove Offset action; the shell, the line output and their points (the free shell terminal included) go, the seeds stay put; Undo/Redo", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await openTopSketch(workbench);
  // A spline arch continued by a line snapped to its end: an open chain, so
  // the shell's free terminal point is referenced by no entity (a lone open
  // spline shows no offset preview in the browser, recorded in T17c.md).
  await workbench.activateTool("Create spline geometry.");
  await placeFreely(workbench, SPLINE, true);
  await workbench.activateTool("Create line geometry.");
  await glideClick(workbench, SPLINE[2]);
  await glideClick(workbench, LINE_END);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const drawn = await sketchSnapshot(page);
  const spline = drawn.entities.find((entity) => entity.kind === "spline")!;
  const line = drawn.entities.find((entity) => entity.kind === "lineSegment")!;
  expect(drawn.entities, "premise: the spline and its line").toHaveLength(2);
  expect(
    drawn.points,
    "premise: the line starts on the spline's end",
  ).toHaveLength(4);
  await commitOffset(
    workbench,
    [
      { around: { x: 660, y: 470 }, entityId: spline.id },
      { around: { x: 920, y: 560 }, entityId: line.id },
    ],
    { x: 720, y: 400 },
    "0.1",
    "Commit Offset",
  );
  const created = await sketchSnapshot(page);
  const shell = created.entities.find(
    (entity) => entity.kind === "derivedPiecewiseCubic",
  );
  expect(shell, "the offset made a shell").toBeDefined();
  // The shell and the line output, trimmed at one shared point; the shell's
  // other terminal is free.
  expect(created.entities).toHaveLength(4);
  expect(created.points).toHaveLength(drawn.points.length + 3);

  // Select the shell by a gliding hover + click (it runs just beside the
  // arch, by the offset distance).
  const selectShell = async () => {
    await glideClick(
      workbench,
      await hoverUntil(
        workbench,
        { x: 660, y: 470 },
        entityTarget(shell!.id),
        40,
      ),
    );
    await expect
      .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
      .toContain(shell!.id);
  };
  await selectShell();
  const panel = page.getByRole("region", { name: "Offset" });
  const consequence =
    /^Offsetoffset \d+HealthyEdit distanceRemove offsetRemoves 2 offset curves\.$/;
  await expect(panel).toHaveText(consequence, { timeout: 15_000 });
  // Delete alone is refused (the selection clears, as after any Delete),
  // and the text names the panel.
  await page.keyboard.press("Delete");
  await expect(
    sketchDiagnosticMessage(page).filter({ hasText: /offset spline curve/ }),
  ).toHaveText(
    "An offset spline curve is part of its offset and can't be deleted on its own. To remove the whole offset, select it, then Offset → Remove offset.",
    { timeout: 15_000 },
  );
  expect((await sketchSnapshot(page)).entities, "nothing was deleted").toEqual(
    created.entities,
  );
  await selectShell();
  await expect(panel).toHaveText(consequence, { timeout: 15_000 });
  // Exactly one action, on top of the offset's commit (by sequence).
  await waitForCommittedAction(page, "Remove Offset", () =>
    glidePress(page, panel.getByRole("button", { name: "Remove offset" })),
  );

  const removed = await sketchSnapshot(page);
  expect(removed.derivedRelationships, "the offset is gone").toEqual([]);
  expect(
    removed.entities.map((entity) => entity.id),
    "only the seeds are left",
  ).toEqual([spline.id, line.id]);
  expect(
    removed.points.map((point) => point.id),
    "every output point (the free shell terminal, the shared trim point) is swept; the seed points stay",
  ).toEqual(drawn.points.map((point) => point.id));
  for (const point of removed.points)
    expect(point.position, `${point.id} did not move`).toEqual(
      positionOf(created, point.id),
    );
  await expect(panel, "nothing selected, nothing listed").toHaveCount(0, {
    timeout: 15_000,
  });

  await waitForUndoneAction(page, "Remove Offset", () =>
    page.keyboard.press("Control+z"),
  );
  const restored = await sketchSnapshot(page);
  expect(restored.entities.map((entity) => entity.id)).toEqual(
    created.entities.map((entity) => entity.id),
  );
  expect(restored.points.map((point) => point.id)).toEqual(
    created.points.map((point) => point.id),
  );
  expect(restored.derivedRelationships).toEqual(created.derivedRelationships);
  await waitForRedoneAction(page, "Remove Offset", () =>
    page.keyboard.press("Control+Shift+z"),
  );
  expect(
    (await sketchSnapshot(page)).entities.map((entity) => entity.id),
  ).toEqual([spline.id, line.id]);
});

test("T17c F1: a failed offset (its joint arc deleted): its outputs are drawn with the invalid tint and its seeds are not; a dimension on an output is styled blocked (G16″); the Offset panel says why", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await openTopSketch(workbench);
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, CHAIN);
  const drawn = await sketchSnapshot(page);
  const [first, second] = drawn.entities;
  await commitOffset(
    workbench,
    // The vertical line first: the distance popup opens near the pointer
    // and would cover it.
    [
      { around: { x: 840, y: 450 }, entityId: second!.id },
      { around: { x: 650, y: 560 }, entityId: first!.id },
    ],
    { x: 880, y: 600 },
    "0.5",
    "Commit Offset",
  );
  const created = await sketchSnapshot(page);
  const offset = created.derivedRelationships[0]!;
  const lineOutputs = offset.outputs.map((output) => output.outputEntityId);
  const joint = created.entities.find(
    (entity) => entity.kind === "arc" && !lineOutputs.includes(entity.id),
  );
  expect(joint, "premise: a joint arc joins the outputs").toBeDefined();
  const toScreen = screenMap(
    [CHAIN[0], CHAIN[1]],
    [
      positionOf(drawn, drawn.points[0]!.id),
      positionOf(drawn, drawn.points[1]!.id),
    ],
  );
  const midpointOf = (snap: MirrorSketchSnapshot, entityId: string) => {
    const entity = snap.entities.find(
      (candidate) => candidate.id === entityId,
    )!;
    const [a, b] = entity.pointIds!.map((id) => positionOf(snap, id));
    const at = toScreen([(a![0] + b![0]) / 2, (a![1] + b![1]) / 2]);
    return { x: Math.round(at.x), y: Math.round(at.y) };
  };
  const outputOf = (seed: string) =>
    offset.outputs.find((output) => output.seedEntityId === seed)!
      .outputEntityId;
  // The tint is read on the horizontal output and its seed; the dimension
  // goes on the vertical output (G16″ problem styling also marks geometry
  // tied to a blocked requirement, T08b-g7b A4, so it is kept apart).
  const outputSpot = midpointOf(created, outputOf(first!.id));
  const seedSpot = midpointOf(created, first!.id);
  // The invalid tint is the danger red family, drawn pale (measured on a
  // tinted output line: (218, 198, 197), (176, 161, 161)): count pixels
  // redder than grey. Plain geometry is grey (r = g = b, up to ≈ 199 when
  // bright), so it never counts.
  const redAt = async (at: CanvasPoint) =>
    (await cropPixels(workbench, at, 6))
      .flat()
      .filter(([r, g, b]) => r - Math.max(g, b) > 10).length;
  await workbench.clearHoverByLeavingViewport();
  await expect
    .poll(() => redAt(outputSpot), {
      message: "control: the certified output is not drawn invalid",
      timeout: 15_000,
    })
    .toBe(0);

  // Review R-2: a driving length on the vertical output (picked by a
  // gliding hover, placed right of it).
  const dimensioned = midpointOf(created, outputOf(second!.id));
  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await glidePress(
    page,
    page.getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    }),
  );
  await glideClick(
    workbench,
    await hoverUntil(
      workbench,
      dimensioned,
      entityTarget(outputOf(second!.id)),
    ),
  );
  await glideClick(workbench, { x: dimensioned.x + 70, y: dimensioned.y });
  const valueInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(valueInput).toBeVisible({ timeout: 15_000 });
  await waitForCommittedAction(page, "Commit Constraint Value", () =>
    glidePress(page, valueInput.getByRole("button", { name: "Commit" })),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const chip = page.locator('[data-sketch-annotation-kind="dimension"]');
  await expect(chip).toHaveCount(1);
  const row = page.locator("[data-sketch-constraint-row]").first();
  await expect(chip, "control: not a problem").not.toHaveAttribute(
    "style",
    /--workbench-shell-danger-text/,
  );
  await expect(row).not.toHaveAttribute("data-sketch-constraint-problem");

  // Delete the joint arc (an ordinary Delete of one output): the offset
  // stays and fails ([TECH] G18; label-based diagnostic, T17c).
  const arcCentre = positionOf(created, joint!.pointIds![0]!);
  const arcStart = positionOf(created, joint!.pointIds![1]!);
  const arcEnd = positionOf(created, joint!.pointIds![2]!);
  const mid: Vec = [
    (arcStart[0] + arcEnd[0]) / 2 - arcCentre[0],
    (arcStart[1] + arcEnd[1]) / 2 - arcCentre[1],
  ];
  const radius = Math.hypot(
    arcStart[0] - arcCentre[0],
    arcStart[1] - arcCentre[1],
  );
  const scale = radius / Math.hypot(mid[0], mid[1]);
  const onArc = toScreen([
    arcCentre[0] + mid[0] * scale,
    arcCentre[1] + mid[1] * scale,
  ]);
  await glideClick(
    workbench,
    await hoverUntil(
      workbench,
      { x: Math.round(onArc.x), y: Math.round(onArc.y) },
      entityTarget(joint!.id),
    ),
  );
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 15_000 })
    .toContain(joint!.id);
  await waitForCommittedAction(page, "Delete Sketch Item", () =>
    page.keyboard.press("Delete"),
  );
  expect(
    (await sketchSnapshot(page)).derivedRelationships.map((entry) => entry.id),
    "the offset stays",
  ).toEqual([offset.id]);
  await workbench.clearHoverByLeavingViewport();
  await expect
    .poll(() => redAt(outputSpot), {
      message: "the failed offset's output is drawn invalid",
      timeout: 30_000,
    })
    .toBeGreaterThan(3);
  expect(await redAt(seedSpot), "its seed is not").toBe(0);
  // Review R-2 (G16″): the dimension on the failed offset's output is
  // blocked and drawn as a problem, listed first with its status.
  await expect(
    chip,
    "the blocked dimension is styled as a problem",
  ).toHaveAttribute("style", /--workbench-shell-danger-text/, {
    timeout: 15_000,
  });
  await expect(row).toHaveAttribute("data-sketch-constraint-problem", "");
  await expect(row.locator("[data-sketch-constraint-problem-text]")).toHaveText(
    /^Blocked/,
  );
  // Review R-1: the seed's Offset panel says why, by label.
  await glideClick(
    workbench,
    await hoverUntil(workbench, seedSpot, entityTarget(first!.id)),
  );
  await expect(page.getByRole("region", { name: "Offset" })).toContainText(
    /Broken: the joint arc between the offset curves of ‘Line \d’ and ‘Line \d’ was deleted\. Undo, or remove the offset\./,
    { timeout: 15_000 },
  );
});
