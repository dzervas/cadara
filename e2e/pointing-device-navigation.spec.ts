import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(120_000);

for (const projection of ["Orthographic", "Perspective"] as const) {
  test(`${projection}: Mouse stays native; Touchpad pans, orbits and pinches`, async ({ page }) => {
    const workbench = new SketchWorkbenchHarness(page);
    await workbench.open();
    if (projection === "Perspective") {
      await page.getByRole("button", { name: "Viewport projection: Orthographic" }).click();
      await page.getByRole("menuitem", { name: "Perspective", exact: true }).click();
    }
    const canvas = page.getByLabel("3D viewport", { exact: true });
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas was not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const initial = await workbench.settledCamera();
    await page.mouse.wheel(50, 0);
    await workbench.waitForAnimationFrames(3);
    expect(await workbench.settledCamera(), "Mouse horizontal scroll stays a no-op").toEqual(initial);
    await page.mouse.wheel(0, 40);
    await expect.poll(() => workbench.settledCamera()).not.toEqual(initial);
    const mouseZoomed = await workbench.settledCamera();
    expect(mouseZoomed.target).toEqual(initial.target);

    await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
    await page.getByLabel("Pointing device", { exact: true }).selectOption("touchpad");
    await expect(page.getByText("Two-finger scroll pans", { exact: false })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const beforePan = await workbench.settledCamera();
    await page.mouse.wheel(30, 20);
    await expect.poll(async () => (await workbench.settledCamera()).target).not.toEqual(beforePan.target);
    const panned = await workbench.settledCamera();
    expect(panned.zoom).toBe(beforePan.zoom);
    for (let axis = 0; axis < 3; axis++) {
      expect(panned.position[axis]! - beforePan.position[axis]!).toBeCloseTo(panned.target[axis]! - beforePan.target[axis]!, 6);
    }
    await page.keyboard.down("Shift");
    await page.mouse.wheel(40, 20);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await workbench.settledCamera()).position).not.toEqual(panned.position);
    const orbited = await workbench.settledCamera();
    expect(orbited.target).toEqual(panned.target);
    expect(orbited.zoom).toBe(panned.zoom);
    const prevented = await canvas.evaluate((element) => {
      const event = new WheelEvent("wheel", { deltaY: -20, ctrlKey: true, shiftKey: true, cancelable: true, bubbles: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented, "pinch cannot zoom the browser").toBe(true);
    const pinched = await workbench.settledCamera();
    expect(pinched.target).toEqual(orbited.target);
    if (projection === "Orthographic") expect(pinched.zoom).toBeGreaterThan(orbited.zoom);
    else expect(pinched.position).not.toEqual(orbited.position);

    await workbench.reloadPreservingStorage();
    await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
    await expect(page.getByLabel("Pointing device", { exact: true })).toHaveValue("touchpad");
    await page.getByLabel("Pointing device", { exact: true }).selectOption("mouse");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    const restored = await workbench.settledCamera();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(30, 0);
    // Browser wheels arrive asynchronously; wait for the next frames before checking no-op.
    await workbench.waitForAnimationFrames(3);
    expect(await workbench.settledCamera()).toEqual(restored);
  });
}

test("Touchpad horizontal/line/page scroll and pinch reach the camera through a sketch annotation", async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  await page.getByLabel("Pointing device", { exact: true }).selectOption("touchpad");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await workbench.activateTool("Start a new sketch.");
  await page.getByRole("button", { name: /Top Plane/ }).first().click();
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 500, y: 380 });
  await workbench.clickViewportAt({ x: 760, y: 380 });
  await expect.poll(() => workbench.currentSketchSession()).toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page.getByRole("menuitem", { name: /Distance Create aligned distance dimensions/ }).click();
  await workbench.clickViewportAt({ x: 600, y: 380 });
  await workbench.clickViewportAt({ x: 630, y: 420 });
  const input = page.locator("[data-sketch-viewport-floating-input]");
  await expect(input).toBeVisible();
  await input.getByRole("button", { name: "Commit" }).click();
  await expect(input).toBeHidden();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const chip = page.locator('[data-sketch-annotation-kind="dimension"]').first();
  await expect(chip).toBeVisible();
  const before = await workbench.settledCamera();
  const box = await chip.boundingBox();
  if (!box) throw new Error("Annotation not visible");
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.wheel(24, 0);
  await expect.poll(async () => (await workbench.settledCamera()).target).not.toEqual(before.target);
  const after = await workbench.settledCamera();
  expect(after.zoom).toBe(before.zoom);

  // Existing overlay forwarding must copy modifiers AND deltaMode, once only.
  for (const deltaMode of [1, 2]) {
    const start = await workbench.settledCamera();
    await chip.evaluate((element, mode) => element.dispatchEvent(new WheelEvent("wheel", {
      deltaX: 0.1, deltaY: 0, deltaMode: mode, bubbles: true, cancelable: true,
    })), deltaMode);
    const moved = await workbench.settledCamera();
    expect(moved.target).not.toEqual(start.target);
    expect(moved.zoom).toBe(start.zoom);
  }
  const start = await workbench.settledCamera();
  await chip.evaluate((element) => element.dispatchEvent(new WheelEvent("wheel", {
    deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true,
  })));
  const zoomed = await workbench.settledCamera();
  expect(zoomed.target).toEqual(start.target);
  expect(zoomed.zoom / start.zoom).toBeCloseTo(Math.exp(0.1), 6);
});
