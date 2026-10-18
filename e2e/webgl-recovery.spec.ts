import { expect, test } from "@playwright/test";

import { captureActionableErrorRecords } from "./helpers/error-reporting";

for (const surface of ["viewport", "view-cube"] as const) {
  test(`${surface} WebGL failure is reported immediately and can retry without reloading`, async ({
    page,
  }) => {
    const reportedErrors = captureActionableErrorRecords(page);
    const unhandledErrors: string[] = [];
    page.on("pageerror", (error) => unhandledErrors.push(error.message));
    await page.addInitScript((failingSurface) => {
      const state = Object.assign(window, { __failWebGl: true });
      state.__failWebGl = true;
      const original = HTMLCanvasElement.prototype.getContext;
      const surfaces = new WeakMap<HTMLCanvasElement, string>();
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        options?: unknown,
      ) {
        if (type === "webgl2") {
          // R3F requests high-performance; the independent cube uses Three's default.
          if (!surfaces.has(this))
            surfaces.set(
              this,
              (options as WebGLContextAttributes | undefined)
                ?.powerPreference === "high-performance"
                ? "viewport"
                : "view-cube",
            );
          if (state.__failWebGl && surfaces.get(this) === failingSurface) {
            const event = new Event("webglcontextcreationerror");
            Object.defineProperty(event, "statusMessage", {
              value: "Injected GPU allocation failure",
            });
            this.dispatchEvent(event);
            return null;
          }
        }
        return (
          original as (
            this: HTMLCanvasElement,
            type: string,
            options?: unknown,
          ) => RenderingContext | null
        ).call(this, type, options);
      } as typeof original;
    }, surface);

    await page.goto("/app?cadTestMode=true");
    const recovery = page
      .getByRole("alert")
      .filter({ hasText: "The 3D view couldn’t start" });
    await expect(recovery).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("toolbar", { name: "CAD tools" })).toBeVisible();
    await expect(page.getByLabel("Initial model render pending")).toHaveCount(0);
    await expect
      .poll(() =>
        reportedErrors.some((record) =>
          record.text.includes("webgl-initialization"),
        ),
      )
      .toBe(true);
    await expect(
      page.getByText("Workbench view crashed", { exact: true }),
    ).toHaveCount(0);
    await recovery.getByText("Technical details", { exact: true }).click();
    await expect(recovery).toContainText(`Renderer: ${surface}`);
    await expect(recovery).toContainText("Injected GPU allocation failure");
    expect(unhandledErrors).toEqual([]);

    await page.evaluate(() => {
      Object.assign(window, { __failWebGl: false });
    });
    await recovery.getByRole("button", { name: "Retry graphics" }).click();
    await expect(recovery).toHaveCount(0);
    await expect(page.locator('canvas[aria-label="3D viewport"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="view-cube"] canvas'),
    ).toBeVisible();
    expect(unhandledErrors).toEqual([]);
  });
}
