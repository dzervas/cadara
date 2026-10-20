import { expect, type Page } from "@playwright/test";
import type { SketchWorkbenchHarness } from "./sketch-workbench";

// Shared e2e fixture for the dense-annotation rows (T14f clusters, T14g
// wheel): a fan of eight 200 px lines from P with ten constraints.

export type ViewportPoint = { x: number; y: number };

/** The fan's shared end point P and its eight 200 px lines L1…L8. */
export const P = { x: 500, y: 330 };
export const ANGLES = [25, 65, 115, 155, 205, 245, 295, 335];
export const along = (origin: ViewportPoint, angle: number, length: number) => {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.round(origin.x + length * Math.cos(radians)),
    y: Math.round(origin.y - length * Math.sin(radians)),
  };
};

export const layer = (page: Page) =>
  page.locator("[data-sketch-annotation-layer]");
const showAllSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Show all constraints" });

/**
 * Eight lines from P; Parallel + Equal on each opposite pair (L1/L5, L2/L6,
 * L3/L7, L4/L8: 8 constraints anchored exactly at P + (18, −18)), and
 * Perpendicular + Equal on L1/L3 (2 more, between L1 and L3). Show all on,
 * the P cluster is 8 glyphs: 4 + `+4` at K = 4, 2 + `+6` at K = 2.
 */
export async function buildDenseFan(workbench: SketchWorkbenchHarness) {
  await buildFan(workbench, ANGLES, [
    ["Constrain two lines to remain parallel.", 0, 4],
    ["Constrain two lines to equal length or two circles to equal radius.", 0, 4],
    ["Constrain two lines to remain parallel.", 1, 5],
    ["Constrain two lines to equal length or two circles to equal radius.", 1, 5],
    ["Constrain two lines to remain parallel.", 2, 6],
    ["Constrain two lines to equal length or two circles to equal radius.", 2, 6],
    ["Constrain two lines to remain parallel.", 3, 7],
    ["Constrain two lines to equal length or two circles to equal radius.", 3, 7],
    ["Constrain two lines to remain perpendicular.", 0, 2],
    ["Constrain two lines to equal length or two circles to equal radius.", 0, 2],
  ]);
}

/** The wide fan's fourteen 200 px lines from P (seven opposite pairs). */
export const WIDE_ANGLES = [
  10, 35, 60, 85, 110, 140, 160, 190, 215, 240, 265, 290, 320, 340,
];

/**
 * T14g review A-4: fourteen lines from P; Parallel + Equal on each opposite
 * pair (14 constraints at P: the P cluster, beyond the wheel's 12 spokes)
 * and Equal on L1/L3 (one more, away from P). Show all on, the P cluster is
 * 4 + `+10` at K = 4.
 */
export async function buildWideFan(workbench: SketchWorkbenchHarness) {
  await buildFan(workbench, WIDE_ANGLES, [
    ...Array.from({ length: 7 }, (_, index) => [
      ["Constrain two lines to remain parallel.", index, index + 7] as const,
      ["Constrain two lines to equal length or two circles to equal radius.", index, index + 7] as const,
    ]).flat(),
    ["Constrain two lines to equal length or two circles to equal radius.", 0, 2],
  ]);
}

async function buildFan(
  workbench: SketchWorkbenchHarness,
  angles: readonly number[],
  constrain: readonly (readonly [string, number, number])[],
) {
  const page = workbench.page;
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  for (const [index, angle] of angles.entries()) {
    await workbench.activateTool("Create line geometry.");
    await workbench.hoverViewportAtReal(P);
    await workbench.waitForAnimationFrames(3);
    await workbench.clickViewportAt(P);
    await workbench.hoverViewportAtReal(along(P, angle, 200));
    await workbench.waitForAnimationFrames(3);
    await workbench.clickViewportAt(along(P, angle, 200));
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${index + 1} entities staged`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await workbench.waitForAnimationFrames(2);
  }
  for (const [tool, first, second] of constrain) {
    await workbench.activateTool(tool);
    await workbench.clickViewportAt(along(P, angles[first]!, 100));
    await workbench.clickViewportAt(along(P, angles[second]!, 100));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await workbench.waitForAnimationFrames(2);
  }
  await page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect(
    page.locator("[data-sketch-constraint-row]"),
    `premise: the ${constrain.length} constraints are authored`,
  ).toHaveCount(constrain.length);
  await expect(
    page.locator(
      "[data-sketch-constraint-row][data-sketch-constraint-problem]",
    ),
    "premise: none is a problem (problems are never clustered)",
  ).toHaveCount(0);
}

export async function setShowAll(
  workbench: SketchWorkbenchHarness,
  on: boolean,
) {
  const toggle = showAllSwitch(workbench.page);
  if ((await toggle.isChecked()) !== on) {
    await toggle.click({ force: true });
  }
  await expect(toggle).toBeChecked({ checked: on });
  await workbench.waitForAnimationFrames(3);
}
