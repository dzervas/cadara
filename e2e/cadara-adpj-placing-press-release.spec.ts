import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the canvas press that places a
// dimension, and its release, while the Dimension tool's pointer-following
// preview redraws its drag handle (an overlay element above the canvas)
// under the pointer between the press and the release. Only the browser has
// the hit testing, boundary events and pointer capture involved.
//
// The preview's dimension line passes through the pointer, so it is drawn
// under the pointer a render after the pointer arrives. A press that reached
// the canvas before that render lost its release: the handle drawn under the
// pointer took a `pointerleave` from the canvas, which forgot the press, so
// the value input never opened. Here the page is held busy while the pointer moves to the placing point
// and presses, so both arrive before the preview is redrawn there.
test.use({ viewport: { width: 1440, height: 960 } });

test("a Distance placing press on the canvas keeps its release when the preview's handle is redrawn under the pointer before the release", async ({
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
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 500, y: 380 });
  await workbench.clickViewportAt({ x: 760, y: 380 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await workbench.openToolMenu("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await workbench.clickViewportAt({ x: 600, y: 380 });

  const canvas = (await workbench.viewport().boundingBox())!;
  const away = { x: canvas.x + 630, y: canvas.y + 520 };
  const place = { x: canvas.x + 630, y: canvas.y + 440 };
  const handle = "[data-sketch-viewport-drag-handle]";
  const topAt = (point: { x: number; y: number }) =>
    page.evaluate(
      ({ point, handle }) =>
        document.elementFromPoint(point.x, point.y)?.closest(handle)
          ? "handle"
          : document.elementFromPoint(point.x, point.y)?.tagName,
      { point, handle },
    );
  await page.mouse.move(away.x, away.y, { steps: 8 });
  await workbench.waitForAnimationFrames(3);
  expect(
    await topAt(away),
    "premise: the preview's handle is drawn under the pointer",
  ).toBe("handle");
  expect(
    await topAt(place),
    "premise: the placing point is bare canvas until the preview follows",
  ).toBe("CANVAS");

  await page.evaluate(() => {
    const presses: string[] = [];
    (window as unknown as { __placingPresses: string[] }).__placingPresses =
      presses;
    window.addEventListener(
      "pointerdown",
      (event) =>
        presses.push(
          event.target instanceof Element ? event.target.tagName : "",
        ),
      { capture: true, once: true },
    );
    setTimeout(() => {
      const end = performance.now() + 300;
      while (performance.now() < end);
    }, 0);
  });
  await Promise.all([page.mouse.move(place.x, place.y), page.mouse.down()]);
  await workbench.waitForAnimationFrames(3);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __placingPresses: string[] }).__placingPresses,
    ),
    "premise: the press reached the canvas",
  ).toEqual(["CANVAS"]);
  expect(
    await topAt(place),
    "premise: the preview's handle is now drawn under the pressed pointer",
  ).toBe("handle");
  await page.mouse.up();

  await expect(
    page.locator("[data-sketch-viewport-floating-input]"),
    "the release places the dimension and opens its value input",
  ).toBeVisible();
});
