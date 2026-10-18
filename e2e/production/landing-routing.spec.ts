import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const landingHeading = "Good things start with a part.";

test("root and unknown pages serve the landing without starting the editor", async ({
  page,
}) => {
  const kernelRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/cadara-occ\.(?:js|wasm)(?:\?|$)/.test(request.url()))
      kernelRequests.push(request.url());
  });
  for (const [path, status] of [
    ["/", 200],
    ["/missing-page", 404],
    ["/nested/missing/page?from=test", 404],
    ["/app/not-an-editor-route", 404],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(status);
    await expect(
      page.getByRole("heading", { name: landingHeading, exact: true }),
    ).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(3);
    await expect(page.getByText("Preparing the model…")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("link", { name: "Launch CADara", exact: true }),
    ).toHaveAttribute("href", "/app");
    await expect(
      page.getByRole("link", {
        name: "GitHub repository (opens in a new tab)",
      }),
    ).toHaveAttribute("target", "_blank");
    await expect(page.getByLabel("Landing prototype switcher")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(kernelRequests).toEqual([]);
});

test("app and its trailing-slash canonical URL load the editor", async ({
  page,
  request,
}) => {
  const redirect = await request.get("/app/", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers().location).toMatch(/\/app$/);
  await page.goto("/app/?cadTestMode=true");
  await expect(page).toHaveURL(/\/app\?cadTestMode=true$/);
  await expect(page.locator('button[data-tool-id="sketch"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: landingHeading, exact: true }),
  ).toHaveCount(0);
});

test("root assets retain their types and missing assets stay failures", async ({
  request,
}) => {
  const wasm = await request.get("/cadara-occ.wasm?v=routing-probe", {
    headers: { Range: "bytes=0-7" },
  });
  expect([200, 206]).toContain(wasm.status());
  expect(wasm.headers()["content-type"]).toContain("application/wasm");
  expect((await wasm.body()).subarray(0, 4)).toEqual(
    Buffer.from([0, 97, 115, 109]),
  );
  const serviceWorker = await request.get("/occ-asset-cache-sw.js");
  expect(serviceWorker.status()).toBe(200);
  expect(serviceWorker.headers()["content-type"]).toMatch(/javascript/);
  const icon = await request.get("/icons/GitHub-logo.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  expect((await request.get("/assets/missing-worker.js")).status()).toBe(404);
  expect((await request.get("/assets/missing-kernel.wasm")).status()).toBe(404);
});

test("models load from a nested 404 page and open in the real app", async ({
  page,
}) => {
  const errors: string[] = [];
  const meshes: number[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".stl"))
      meshes.push(response.status());
  });
  const response = await page.goto("/nested/example-start");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Preparing the model…")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect.poll(() => meshes.length).toBe(12);
  expect(meshes.every((status) => status === 200)).toBe(true);
  const document = JSON.parse(
    readFileSync("landing/examples/bracket/model.cadara", "utf8"),
  ) as { name: string };
  await page
    .locator(".collection-piece")
    .filter({ hasText: "Angle bracket" })
    .getByRole("button", { name: "Make it yours", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
  await expect(
    page.getByRole("tab").filter({ hasText: document.name }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-parts-tree-target^="body:"]')).toHaveCount(
    1,
    { timeout: 90_000 },
  );
  await expect(
    page.getByRole("status", { name: "Initial model render pending" }),
  ).toBeHidden({ timeout: 90_000 });
  expect(errors).toEqual([]);
});
