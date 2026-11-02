import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

declare global {
  interface Window {
    __e2eViewportFrameTimes?: number[];
  }
}

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
async function waitForViewportQuiet(page: Page, quietMs = 1_500) {
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

/** True when every editor effect the debug trace saw start has finished. */
function editorEffectsSettled(page: Page) {
  return page.evaluate(() => {
    const entries = (window.__cadaraDebug?.getTrace().entries ??
      []) as readonly {
      kind: string;
      effect?: unknown;
      event?: { type?: string };
    }[];
    // Effects of an earlier editor session (before the opened document's)
    // never complete in the trace.
    const sessionStart = entries.findLastIndex(
      (entry) => entry.event?.type === "session.started",
    );
    const pending = new Map<string, number>();
    for (const record of entries.slice(sessionStart + 1)) {
      if (!record.kind.startsWith("effect-")) continue;
      const key = JSON.stringify(record.effect);
      const count = pending.get(key) ?? 0;
      pending.set(
        key,
        record.kind === "effect-started" ? count + 1 : count - 1,
      );
    }
    return [...pending.values()].every((count) => count <= 0);
  });
}

/**
 * Waits for a settled viewport: no editor effect running, render-idle (the
 * scene proven) and no frame drawn since. Opening the wheel refines its
 * tessellation in the background well after its first render-idle; frames
 * of that refinement are not the gesture measured.
 */
async function waitForSettledViewport(
  page: Page,
  workbench: FeatureWorkbenchHarness,
) {
  for (;;) {
    await expect
      .poll(() => editorEffectsSettled(page), { timeout: 60_000 })
      .toBe(true);
    await workbench.waitForRenderIdle(30_000);
    const quietAt = await waitForViewportQuiet(page);
    const settled =
      (await editorEffectsSettled(page)) &&
      (await page.evaluate(
        () => document.querySelector('[data-render-idle="true"]') !== null,
      ));
    if (settled) return quietAt;
  }
}

function viewportFramesSince(page: Page, since: number) {
  return page.evaluate(
    (since) =>
      (window.__e2eViewportFrameTimes ?? []).filter((time) => time >= since)
        .length,
    since,
  );
}

// Hiding or showing a body redraws the viewport once with the new scene and
// once to prove it is unchanged (the render-idle proof). It re-tessellates
// nothing: the wheel's large body sets the document's tessellation tier, and
// a tier chosen over the visible bodies only re-tessellated the hub (four
// more frames) on every hide and show.
test("hiding and showing a body draws at most two viewport frames each", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await recordViewportFrames(page);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const document: unknown = JSON.parse(
    await readFile("landing/examples/wheel/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, document, "wheel.cadara");
  await workbench.waitForRenderIdle(60_000);

  const row = page
    .getByRole("complementary", { name: "Parts and objects" })
    .getByRole("treeitem")
    .filter({ hasText: /^Wheel$/ });
  for (const hide of [true, false]) {
    await row.hover();
    const toggle = row.getByRole("button", {
      name: `${hide ? "Hide" : "Show"} Wheel`,
      exact: true,
    });
    await toggle.hover();
    const before = await waitForSettledViewport(page, workbench);
    expect(
      await viewportFramesSince(page, 0),
      "premise: the viewport draws frames this probe can count",
    ).toBeGreaterThan(0);
    await toggle.click();
    if (hide) await expect(row).toHaveAttribute("data-hidden", "true");
    else await expect(row).not.toHaveAttribute("data-hidden");
    await workbench.waitForRenderIdle(30_000);
    await waitForViewportQuiet(page);
    expect(
      await viewportFramesSince(page, before),
      `${hide ? "hiding" : "showing"} a body draws the new scene and one frame proving it`,
    ).toBeLessThanOrEqual(2);
  }
});
