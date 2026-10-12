import { expect, test } from "@playwright/test";

import {
  glideDrag,
  waitForCommittedAction,
  waitForUndoneAction,
} from "./helpers/acceptance";
import {
  glideClick,
  glidePress,
  placeFreely,
} from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: T15d either-side mirror editing in the
// real workbench: the Sketch Mirror tool (reached through tool search), the
// viewport's D9′ drag target on a mirror copy, a gliding pointer through the
// coupled solve, and one authored action with Undo. Only the browser
// composes pointer → pick stack → session → history. The full mirror E2E
// suite is T15e.

// Viewport 1440×960; top plane: sketch origin at (720, 480), Y up.
const SEED_START = { x: 420, y: 300 };
const SEED_END = { x: 560, y: 240 };
const AXIS_START = { x: 300, y: 420 };
const AXIS_END = { x: 1000, y: 420 };
// The copy of SEED_START about the axis (screen y 420).
const COPY_START = { x: 420, y: 540 };
const COPY_TARGET = { x: 380, y: 590 };

type LivePoint = { id: string; position: readonly [number, number] };

async function livePoints(workbench: SketchWorkbenchHarness) {
  const snapshot = await workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snapshot) throw new Error("No live sketch snapshot.");
  return (snapshot as { points: LivePoint[] }).points;
}

const byId = (points: readonly LivePoint[], id: string) =>
  points.find((point) => point.id === id)!.position;

async function hoveredPointId(
  workbench: SketchWorkbenchHarness,
  at: { x: number; y: number },
) {
  await workbench.hoverViewportAt(at);
  await workbench.waitForAnimationFrames(2);
  let hovered = "";
  await expect
    .poll(
      async () => {
        hovered = await workbench.currentHoverTarget();
        return hovered;
      },
      { message: `a sketch point is hovered at ${JSON.stringify(at)}` },
    )
    .toMatch(/sketch_point_/);
  return hovered.match(/sketch_point_[\w-]+/)![0];
}

test("T15d: dragging a mirror copy's end with a gliding pointer moves its seed as the mirror image, keeps the axis, and Undo restores in one step", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await glidePress(
    page,
    page.getByRole("button", { name: /Top Plane/ }).first(),
  );
  await workbench.expectSketchSessionActive();

  // The seed line, then the construction axis, placed with Shift so no
  // inferred constraint is authored: the sketch has no constraint at all
  // (probe 9a: before T15d such a copy drag took the unconstrained fast path
  // and silently snapped back).
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, [SEED_START, SEED_END]);
  await workbench.activateTool(
    "Toggle sketch geometry construction-only or mark new sketch geometry as construction.",
  );
  await workbench.activateTool("Create line geometry.");
  await placeFreely(workbench, [AXIS_START, AXIS_END]);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("2 entities staged");

  // Sketch Mirror: the seed, then the axis as the final pick.
  const search = page.getByPlaceholder("Search tools");
  await search.fill("Sketch Mirror");
  await search.press("Enter");
  await glideClick(workbench, { x: 490, y: 270 });
  await glideClick(workbench, { x: 800, y: 420 });
  // T16d: the picks stage the mirror; Enter confirms it.
  await expect(
    page.locator(
      '[data-sketch-viewport-floating-input="sketch-mirror-confirm"]',
    ),
  ).toBeVisible({ timeout: 10_000 });
  await waitForCommittedAction(page, "Mirror", () =>
    page.keyboard.press("Enter"),
  );
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("3 entities staged");
  await page.keyboard.press("Escape");

  const seedStart = await hoveredPointId(workbench, SEED_START);
  const axisStart = await hoveredPointId(workbench, AXIS_START);
  const axisEnd = await hoveredPointId(workbench, AXIS_END);
  const copyStart = await hoveredPointId(workbench, COPY_START);
  expect(new Set([seedStart, axisStart, axisEnd, copyStart]).size).toBe(4);
  // The copy is a drag target (D9′): the grab cursor shows on it.
  await expect
    .poll(() => workbench.viewport().evaluate((canvas) => canvas.style.cursor))
    .toBe("grab");
  const before = await livePoints(workbench);
  const axisY = byId(before, axisStart)[1];
  expect(
    Math.abs(
      byId(before, copyStart)[1] + byId(before, seedStart)[1] - 2 * axisY,
    ),
    "premise: the copy is the seed's mirror image",
  ).toBeLessThan(1e-9);

  // A gliding drag of the copy's end (several pointer moves, never a jump):
  // one committed action.
  await waitForCommittedAction(page, "Move Sketch Geometry", () =>
    glideDrag(workbench, COPY_START, COPY_TARGET),
  );
  const after = await livePoints(workbench);
  const copy = byId(after, copyStart);
  const seed = byId(after, seedStart);
  const pixel =
    (byId(before, axisEnd)[0] - byId(before, axisStart)[0]) /
    (AXIS_END.x - AXIS_START.x);
  expect(
    Math.hypot(
      copy[0] - byId(before, copyStart)[0],
      copy[1] - byId(before, copyStart)[1],
    ) / pixel,
    "the copy's end followed the pointer (≈ 64 px)",
  ).toBeGreaterThan(40);
  expect(
    Math.abs(seed[0] - copy[0]),
    "the seed end is the mirror image (x)",
  ).toBeLessThan(1e-6);
  expect(
    Math.abs(seed[1] + copy[1] - 2 * axisY),
    "the seed end is the mirror image (y)",
  ).toBeLessThan(1e-6);
  expect(byId(after, axisStart), "the axis stays").toEqual(
    byId(before, axisStart),
  );
  expect(byId(after, axisEnd), "the axis stays").toEqual(byId(before, axisEnd));

  // Undo restores the pre-drag sketch in one step.
  await waitForUndoneAction(page, "Move Sketch Geometry", () =>
    page.keyboard.press("Control+z"),
  );
  await expect
    .poll(async () => {
      const undone = await livePoints(workbench);
      return [seedStart, copyStart, axisStart, axisEnd].map((id) =>
        byId(undone, id),
      );
    })
    .toEqual(
      [seedStart, copyStart, axisStart, axisEnd].map((id) => byId(before, id)),
    );
  await expect
    .poll(() => workbench.currentSketchSession())
    .toContain("3 entities staged");
});
