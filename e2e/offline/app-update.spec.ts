import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import { OCC_ASSET_VERSION } from "../../src/infrastructure/occ/asset-version";
import { FeatureWorkbenchHarness } from "../helpers/feature-workbench";
import {
  reachable,
  startPreview,
  stopPreview,
} from "../helpers/offline-preview";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e, offline sub-lane (`bun run test:e2e:offline`; docs/testing.md).
// Seam: the vite-plugin-pwa / Workbox service worker of two real production
// builds (cadara-vk96): a client of the pre-Workbox worker migrates through
// the update prompt and loses its legacy caches; a later deploy is detected
// when the network returns, its worker downloads only the files whose
// content changed, Reload switches to it, and the unchanged files it never
// downloaded still serve an offline reload. Offline, the kernel is answered
// only for the exact versioned URL the app requests, never for another
// version (an old worker must not hand its kernel to newer app code). Only a browser runs service
// workers, and only a production build has one.

const CURRENT_DIST = ".tmp-offline-dist";
// The "next deploy": the same build with another Sentry release, which
// changes the chunks that embed it (and the HTML that loads them) only.
const NEXT_DIST = ".tmp-offline-dist-next";
const LEGACY_SERVICE_WORKER = "occ-asset-cache-sw.js";
const UPDATE_TITLE = "A new version of CADara is available";

async function buildNextDeploy() {
  await promisify(execFile)(
    "bunx",
    [
      "vite",
      "build",
      "--config",
      "vite.offline-test.config.ts",
      "--outDir",
      NEXT_DIST,
      "--emptyOutDir",
    ],
    {
      env: {
        ...process.env,
        SENTRY_AUTH_TOKEN: "",
        SENTRY_RELEASE: "cadara@offline-update-next",
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

/** Root-relative paths of the files in `next` that `current` lacks or differs in. */
async function changedFiles(current: string, next: string) {
  const changed: string[] = [];
  for (const entry of await readdir(next, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(
      next,
      path.join(entry.parentPath, entry.name),
    );
    const nextBytes = await readFile(path.join(next, relative));
    const currentBytes = await readFile(path.join(current, relative)).catch(
      () => null,
    );
    if (!currentBytes?.equals(nextBytes))
      changed.push(`/${relative.split(path.sep).join("/")}`);
  }
  return changed.sort();
}

const entryScript = async (dist: string) =>
  (await readFile(path.join(dist, "app.html"), "utf8")).match(
    /<script type="module"[^>]*src="([^"]+)"/,
  )![1]!;

const controllerScript = (page: Page) =>
  page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller
      ? new URL(navigator.serviceWorker.controller.scriptURL).pathname
      : null;
  });

/** Clicks Reload in the update prompt and waits for the reloaded app. */
async function acceptUpdate(page: Page, workbench: FeatureWorkbenchHarness) {
  const prompt = page.getByRole("status").filter({ hasText: UPDATE_TITLE });
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText(/v\d+\.\d+\.\d+ \S+/);
  await Promise.all([
    page.waitForEvent("load", { timeout: 60_000 }),
    prompt.getByRole("button", { name: "Reload" }).click(),
  ]);
  await workbench.expectMachine("idle", 60_000);
}

test("a legacy-worker client migrates through the update prompt; the next deploy is detected, downloads only its changed files and serves an offline reload", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(600_000);
  const baseURL = testInfo.project.use.baseURL!;
  await buildNextDeploy();
  // A stand-in for the pre-Workbox worker: same scope and script name,
  // activates and claims at once (as /occ-asset-cache-sw.js did).
  await writeFile(
    path.join(CURRENT_DIST, LEGACY_SERVICE_WORKER),
    `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));`,
  );
  let server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    await page.goto(`${baseURL}/`);
    await page.evaluate(async (script) => {
      for (const name of [
        "cadara-app-assets-legacy",
        "cadara-occ-assets-opencascade-legacy",
        "unrelated-e2e-cache",
      ])
        await caches.open(name);
      await navigator.serviceWorker.register(`/${script}?v=legacy`);
    }, LEGACY_SERVICE_WORKER);
    await expect
      .poll(() => controllerScript(page), { timeout: 30_000 })
      .toBe(`/${LEGACY_SERVICE_WORKER}`);

    // The app registers the Workbox worker: an update of this registration.
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithRepository();
    await acceptUpdate(page, workbench);
    expect(await controllerScript(page)).toBe("/service-worker.js");
    expect(
      (await page.evaluate(() => caches.keys())).filter(
        (name) => !name.startsWith("workbox-precache-"),
      ),
      "the legacy caches are gone, other caches stay",
    ).toEqual(["unrelated-e2e-cache"]);

    // Deploy the next build and let the open tab notice it.
    await stopPreview(server, baseURL);
    server = startPreview(
      baseURL,
      testInfo.outputPath("preview-next.log"),
      NEXT_DIST,
    );
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    const workerDownloads: string[] = [];
    const recordWorkerDownload = (request: {
      url(): string;
      serviceWorker(): unknown;
    }) => {
      if (request.serviceWorker())
        workerDownloads.push(new URL(request.url()).pathname);
    };
    context.on("request", recordWorkerDownload);
    // The update check runs when the network returns (and hourly, and when
    // the tab becomes visible).
    await context.setOffline(true);
    await context.setOffline(false);
    await expect(
      page.getByRole("status").filter({ hasText: UPDATE_TITLE }),
    ).toBeVisible({ timeout: 90_000 });
    context.off("request", recordWorkerDownload);

    const changed = (await changedFiles(CURRENT_DIST, NEXT_DIST)).filter(
      (file) => file !== "/service-worker.js",
    );
    expect(changed, "premise: the next deploy changed the app entry").toContain(
      await entryScript(NEXT_DIST),
    );
    expect(
      // The script itself is the browser's update check, not a precache fetch.
      [...new Set(workerDownloads)]
        .filter((file) => file !== "/service-worker.js")
        .sort(),
      "the new worker downloaded exactly the changed files",
    ).toEqual(changed);

    await acceptUpdate(page, workbench);
    expect(
      await page.evaluate(() =>
        [...document.scripts].map((script) => new URL(script.src).pathname),
      ),
    ).toContain(await entryScript(NEXT_DIST));
    await expect(
      page.getByRole("status").filter({ hasText: UPDATE_TITLE }),
    ).toHaveCount(0);

    // Offline, the unchanged files kept from the previous deploy serve it.
    await stopPreview(server, baseURL);
    await context.setOffline(true);
    const session = await context.newCDPSession(page);
    await session.send("Network.clearBrowserCache");
    await session.detach();
    await page.reload();
    await workbench.expectMachine("idle", 60_000);
    const fetchKernel = (version: string) =>
      page.evaluate(
        (url) =>
          fetch(url).then(
            (response) => response.status,
            () => "unreachable",
          ),
        `/cadara-occ.wasm?v=${version}`,
      );
    expect(await fetchKernel(OCC_ASSET_VERSION)).toBe(200);
    expect(
      await fetchKernel(`${OCC_ASSET_VERSION}-next`),
      "another kernel version is not served from the precache",
    ).toBe("unreachable");
  } finally {
    await stopPreview(server, baseURL);
    await rm(path.join(CURRENT_DIST, LEGACY_SERVICE_WORKER), { force: true });
  }
});
