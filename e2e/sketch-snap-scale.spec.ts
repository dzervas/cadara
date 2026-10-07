import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md) — the screen scale only exists in the real
// viewport (camera, canvas size, wheel zoom) and reaches snapping through
// the pointer events. Seam: snap tolerances are screen pixels (T13-D13):
// the same screen offset from an endpoint snaps at two zoom levels; 15.6 px
// (outside the 12 px point radius, but inside the radius a scale frozen at
// 1× would give after the ~2.9× zoom) and 42 px snap at neither. The
// sketch origin sits at the viewport centre, which wheel zoom keeps fixed,
// so the endpoint drawn there keeps its pixel.
const CENTER = { x: 720, y: 480 };
const OTHER_END = { x: 800, y: 400 };
// Away from the line, its ends and both axes: hovering here clears the
// active snap (and its 16 px exit radius) before each probe.
const NEUTRAL = { x: 300, y: 800 };
// ≈ 8.5 px diagonally: inside the 12 px point radius, off both axes.
const NEAR = { x: CENTER.x + 6, y: CENTER.y + 6 };
// ≈ 15.6 px diagonally, 11 px off both axes (beyond the 10 px curve radius).
const MID = { x: CENTER.x + 11, y: CENTER.y + 11 };
// ≈ 42 px diagonally: outside every snap radius, 30 px off both axes.
const FAR = { x: CENTER.x + 30, y: CENTER.y + 30 };
const ZOOM_TICKS = 21;

async function snapIndicator(workbench: SketchWorkbenchHarness) {
  const indicator = workbench.page.locator(
    '[data-sketch-viewport-geometry="snapIndicator"]',
  );
  if ((await indicator.count()) === 0) return null;
  const viewport = await workbench.viewport().boundingBox();
  const box = await indicator.first().boundingBox();
  if (!viewport || !box) throw new Error("Viewport or indicator not visible.");
  return {
    kind: await indicator.first().getAttribute("data-sketch-snap-kind"),
    x: box.x + box.width / 2 - viewport.x,
    y: box.y + box.height / 2 - viewport.y,
  };
}

async function hover(
  workbench: SketchWorkbenchHarness,
  point: { x: number; y: number },
) {
  await workbench.hoverViewportAt(point);
  await workbench.waitForAnimationFrames(3);
  return snapIndicator(workbench);
}

/** Hover from the neutral spot, so no earlier snap is still active. */
async function freshHover(
  workbench: SketchWorkbenchHarness,
  point: { x: number; y: number },
) {
  expect(
    await hover(workbench, NEUTRAL),
    "the neutral spot snaps to nothing",
  ).toBe(null);
  return hover(workbench, point);
}

test("T13f: the same screen offset from an endpoint snaps at 1× and ~2.9× zoomed in; 15.6 px and 42 px snap at neither", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  // A line ending at the viewport centre; Escape ends the chain, Line stays
  // armed, so hovering previews snaps.
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(OTHER_END);
  await workbench.clickViewportAt(CENTER);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");

  const expectEndpointAtCenter = async (label: string) => {
    const near = await freshHover(workbench, NEAR);
    expect(near?.kind, `${label}: 8.5 px from the endpoint snaps`).toBe(
      "endpoint",
    );
    expect(
      Math.hypot(near!.x - CENTER.x, near!.y - CENTER.y),
      `${label}: the indicator sits on the endpoint`,
    ).toBeLessThan(1.5);
    expect(
      await freshHover(workbench, MID),
      `${label}: 15.6 px from the endpoint snaps to nothing`,
    ).toBe(null);
    expect(
      await freshHover(workbench, FAR),
      `${label}: 42 px from the endpoint snaps to nothing`,
    ).toBe(null);
  };

  await expectEndpointAtCenter("1×");
  expect(
    (await freshHover(workbench, OTHER_END))?.kind,
    "premise: 1×, the other end is an endpoint",
  ).toBe("endpoint");

  // Zoom in about the viewport centre.
  await workbench.hoverViewportAt(CENTER);
  for (let tick = 0; tick < ZOOM_TICKS; tick += 1) {
    await page.mouse.wheel(0, -120);
  }
  await workbench.waitForAnimationFrames(6);

  // The zoom happened and is well over 2×: the other end moved outward along
  // its ray from the centre; find it by its endpoint snap.
  expect(
    (await freshHover(workbench, OTHER_END))?.kind,
    "zoomed: the other end's old pixel is on the line, not at its end",
  ).toBe("nearestOnLine");
  const dx = OTHER_END.x - CENTER.x;
  const dy = OTHER_END.y - CENTER.y;
  const length = Math.hypot(dx, dy);
  let zoom = 0;
  for (let radius = length; radius < 450 && zoom === 0; radius += 8) {
    const found = await hover(workbench, {
      x: CENTER.x + (dx / length) * radius,
      y: CENTER.y + (dy / length) * radius,
    });
    if (found?.kind === "endpoint")
      zoom = Math.hypot(found.x - CENTER.x, found.y - CENTER.y) / length;
  }
  expect(
    zoom,
    "the zoom factor (other end found after zooming)",
  ).toBeGreaterThan(2.5);

  await expectEndpointAtCenter("zoomed");
});
