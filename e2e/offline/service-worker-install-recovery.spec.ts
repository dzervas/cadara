import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "../helpers/feature-workbench";
import {
  reachable,
  startPreview,
  stopPreview,
} from "../helpers/offline-preview";

// E2E lane: a real install fails inside Workbox, reaches the page's Sentry
// transport, then retries the current script although the active URL is gone.
test("a failed legacy-worker migration reports its cause to Sentry and recovers without requesting the deleted script", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = testInfo.project.use.baseURL!;
  const dist = ".tmp-offline-dist";
  const legacyPath = path.join(dist, "occ-asset-cache-sw.js");
  const workerSource = await readFile(
    path.join(dist, "service-worker.js"),
    "utf8",
  );
  const manifest = JSON.parse(
    workerSource.match(/\[\{"(?:url|revision)":.*?\}\]/s)![0],
  ) as { url: string }[];
  // A fallback font is in the offline shell but not requested by this browser's
  // page; failing it exercises installation without breaking the editor itself.
  const failingPath = `/${manifest.find(({ url }) => url.endsWith(".woff"))!.url}`;
  const envelopes: string[] = [];
  await context.route("**/api/*/envelope/**", async (route) => {
    envelopes.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    });
  });
  let failInstall = true;
  await context.route(`**${failingPath}`, (route) =>
    failInstall
      ? route.fulfill({ status: 503, body: "install failure fixture" })
      : route.continue(),
  );
  await writeFile(
    legacyPath,
    `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));`,
  );
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    await page.goto(baseURL);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/occ-asset-cache-sw.js?v=legacy");
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
      )
      .toContain("occ-asset-cache-sw.js");
    await rm(legacyPath);
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithRepository();
    await expect
      .poll(
        () =>
          envelopes.some(
            (body) =>
              body.includes("bad-precaching-response") &&
              body.includes(failingPath),
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    const events = envelopes.flatMap((body) =>
      body.split("\n").flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      }),
    );
    const failure = events.find(
      (event) =>
        event.contexts?.app_error?.context?.errorKind ===
        "bad-precaching-response",
    );
    expect(failure.contexts.app_error.context).toMatchObject({
      operation: "serviceWorker.install",
      url: `${baseURL}${failingPath}`,
      elapsedMs: expect.any(Number),
    });
    expect(failure.contexts.app_error.context.elapsedMs).toBeGreaterThanOrEqual(
      0,
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration())?.installing
              ?.state ?? null,
        ),
      )
      .toBeNull();

    const scriptRequests: string[] = [];
    context.on("request", (request) => {
      if (/\/(?:service-worker|occ-asset-cache-sw)\.js/.test(request.url()))
        scriptRequests.push(request.url());
    });
    failInstall = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const prompt = page
      .getByRole("status")
      .filter({ hasText: "A new version of CADara is available" });
    await expect(prompt).toBeVisible({ timeout: 60_000 });
    expect(
      scriptRequests.some((url) => url.includes("service-worker.js")),
    ).toBe(true);
    expect(
      scriptRequests.some((url) => url.includes("occ-asset-cache-sw.js")),
    ).toBe(false);
    await Promise.all([
      page.waitForEvent("load"),
      prompt.getByRole("button", { name: "Reload" }).click(),
    ]);
    await workbench.expectMachine("idle", 60_000);
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    ).toBe(`${baseURL}/service-worker.js`);
  } finally {
    await stopPreview(server, baseURL);
    await rm(legacyPath, { force: true });
  }
});
