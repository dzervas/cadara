import { expect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

declare global {
  interface Window {
    __e2eViewportFrameTimes?: number[];
  }
}

test.setTimeout(90_000);

// A viewport frame is one task that issued WebGL draw or clear calls on the
// main viewport canvas (not the view cube's): R3F draws a whole frame inside
// one animation-frame callback.
async function recordViewportFrames(page: Page) {
  await page.addInitScript(() => {
    const frameTimes: number[] = (window.__e2eViewportFrameTimes = []);
    const drawing = new WeakSet<object>();
    for (const prototype of [
      WebGLRenderingContext.prototype,
      WebGL2RenderingContext.prototype,
    ] as unknown as Record<string, (...args: unknown[]) => unknown>[]) {
      for (const name of [
        "clear",
        "drawArrays",
        "drawElements",
        "drawArraysInstanced",
        "drawElementsInstanced",
        "drawRangeElements",
      ]) {
        const draw = prototype[name];
        if (!draw) continue;
        prototype[name] = function (
          this: WebGLRenderingContext,
          ...args: unknown[]
        ) {
          const canvas = this.canvas as HTMLCanvasElement;
          if (
            !drawing.has(canvas) &&
            canvas.closest?.("main") &&
            !canvas.closest('[data-testid="view-cube"]')
          ) {
            drawing.add(canvas);
            frameTimes.push(performance.now());
            queueMicrotask(() => drawing.delete(canvas));
          }
          return draw.apply(this, args);
        };
      }
    }
  });
}

/** Waits until the viewport drew nothing for `quietMs`; returns that time. */
async function waitForViewportQuiet(page: Page, quietMs = 1_000) {
  const handle = await page.waitForFunction(
    (quietMs) => {
      const last = window.__e2eViewportFrameTimes?.at(-1) ?? 0;
      const now = performance.now();
      return now - last >= quietMs ? now : false;
    },
    quietMs,
    { polling: 50, timeout: 30_000 },
  );
  return (await handle.jsonValue()) as number;
}

function viewportFramesSince(page: Page, since: number) {
  return page.evaluate(
    (since) =>
      (window.__e2eViewportFrameTimes ?? []).filter((time) => time >= since)
        .length,
    since,
  );
}

// A body rename changes no geometry, material, camera or highlight: the
// refreshed snapshot's renderables keep every mounted scene object, so the
// viewport draws nothing.
test("renaming a body draws no viewport frame", async ({ page }) => {
  await recordViewportFrames(page);
  await new FeatureWorkbenchHarness(page).openWithRepositoryAndOperationHistory(
    createBaseExtrudeOperationHistory(),
  );
  const row = page.locator(
    `[data-parts-tree-target="body:${FEATURE_FIXTURE.body}"]`,
  );
  const labelButton = row.locator("button").first();
  const original = await labelButton.innerText();
  await labelButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = row.getByRole("textbox", { name: `Rename ${original}` });
  await expect(input).toBeFocused();
  await page.keyboard.type("Mount plate");

  const before = await waitForViewportQuiet(page);
  expect(
    await viewportFramesSince(page, 0),
    "premise: the viewport draws frames this probe can count",
  ).toBeGreaterThan(0);
  await input.press("Enter");
  await expect(labelButton).toHaveText("Mount plate", { timeout: 10_000 });
  await expect(
    page
      .locator('[data-history-actions="contextual"]')
      .getByRole("button", { name: "Undo Rename Body", exact: true }),
  ).toBeEnabled({ timeout: 10_000 });
  await waitForViewportQuiet(page);

  expect(
    await viewportFramesSince(page, before),
    "a rename must not redraw the unchanged viewport",
  ).toBe(0);
});
