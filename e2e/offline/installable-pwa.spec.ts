import { expect, test, type Page } from "@playwright/test";

import { waitForCommittedAction } from "../helpers/acceptance";
import { saveDocumentCopy } from "../helpers/document-files";
import { glideClick, openTopSketch } from "../helpers/mirror-workbench";
import {
  reachable,
  startPreview,
  stopPreview,
} from "../helpers/offline-preview";
import { FeatureWorkbenchHarness } from "../helpers/feature-workbench";
import { workbenchColors } from "../../src/theme/workbench-theme";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e, offline sub-lane (`bun run test:e2e:offline`; docs/testing.md).
// Seam: the installable PWA of the shipped build. Chromium reads the
// manifest linked from /app without errors (CDP `Page.getAppManifest`), and
// it installs /app over scope / with the .cadara file handler.
// `Page.getInstallabilityErrors` is not asserted: this Chromium reports no
// errors even for a page without a manifest. Once the
// service worker controls the page, the manifest and its generated icons are
// served with the network cut; after one online visit the start URL boots,
// opens, edits, saves and exports offline (the offline promise); the
// persistent-storage request and its warning. Installing, the OS launcher and
// the file double-click cannot be automated: they are human-trial steps.

const ICONS = [
  "/pwa-64x64.png",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/maskable-icon-512x512.png",
  "/apple-touch-icon-180x180.png",
  "/favicon.ico",
];

/**
 * A first local edit: a sketch with a circle, finished (sketch edits are
 * saved when the sketch is finished).
 */
async function addCircleSketch(workbench: FeatureWorkbenchHarness) {
  await openTopSketch(workbench);
  await workbench.activateTool("Create circular geometry.");
  await glideClick(workbench, { x: 640, y: 470 });
  await waitForCommittedAction(workbench.page, "Create Sketch Geometry", () =>
    glideClick(workbench, { x: 720, y: 470 }),
  );
  await workbench.page.keyboard.press("Escape");
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 60_000);
}

const saveActivityRing = (page: Page) =>
  page.locator("[data-workbench-file-menu] [data-save-activity-ring]");

test("Chromium reads the CADara manifest from /app without errors; the manifest and icons are served offline", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = testInfo.project.use.baseURL!;
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    await page.goto(`${baseURL}/app`);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            return navigator.serviceWorker.controller !== null;
          }),
        { message: "the service worker controls the app", timeout: 60_000 },
      )
      .toBe(true);

    const session = await context.newCDPSession(page);
    const appManifest = await session.send("Page.getAppManifest");
    await session.detach();
    expect(appManifest.url).toBe(`${baseURL}/manifest.webmanifest`);
    expect(appManifest.errors).toEqual([]);
    expect(JSON.parse(appManifest.data!)).toMatchObject({
      name: "CADara",
      short_name: "CADara",
      scope: "/",
      start_url: "/app",
      display: "standalone",
      theme_color: workbenchColors[9],
      background_color: workbenchColors[9],
      file_handlers: [
        {
          action: "/app",
          accept: { "application/vnd.cadara+json": [".cadara"] },
        },
      ],
    });

    await stopPreview(server, baseURL);
    await context.setOffline(true);
    const statuses = await page.evaluate(
      (paths) =>
        Promise.all(
          paths.map((path) =>
            fetch(path).then(
              (response) => [path, response.status] as const,
              () => [path, "unreachable"] as const,
            ),
          ),
        ),
      ["/manifest.webmanifest", ...ICONS],
    );
    expect(statuses).toEqual(
      ["/manifest.webmanifest", ...ICONS].map((path) => [path, 200]),
    );
  } finally {
    await stopPreview(server, baseURL);
  }
});

// The browser declines persistent storage for an uninstalled test profile,
// so after the first local save the shipped build asks, is declined and
// warns once; the warning waits for the user (no auto-dismiss) and is
// remembered, so later sessions are not nagged (the once-per-profile rule
// itself: src/application/workspace/storage-durability.spec.ts).
test("after the first local save, a declined persistent-storage request shows one dismissible warning suggesting export", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = testInfo.project.use.baseURL!;
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithRepository();
    await addCircleSketch(workbench);

    const warning = page
      .getByRole("status")
      .filter({ hasText: "Browser storage is not guaranteed" });
    await expect(warning).toBeVisible({ timeout: 60_000 });
    expect(
      await page.evaluate(() => navigator.storage.persisted()),
      "premise: this browser profile declined persistent storage",
    ).toBe(false);
    await expect(warning).toContainText(
      "Save As > Download a copy in the file menu",
    );
    // Warnings auto-dismiss after 15 s; this one waits for the user.
    await page.waitForTimeout(16_000);
    await expect(warning).toBeVisible();
    await warning.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(warning).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("cadara.storageDurabilityWarnings.v1"),
      ),
      "remembered, so later sessions are not warned again",
    ).toBe("not-persisted");
  } finally {
    await stopPreview(server, baseURL);
  }
});

// The offline promise: after one online visit to /app, an
// installed app's launch (a new window at the manifest's start_url, /app)
// boots with the network really cut, opens the stored document, edits it,
// saves it to browser storage (a reload, still offline, restores the edit)
// and exports it. The network is cut as in
// acceptance-mechanical-part-offline.spec.ts: the preview stopped, the
// context offline and Chromium's HTTP cache cleared, so only the service
// worker can serve the app. This guards the service worker's existing offline
// support through the manifest's start URL; it adds no code of its own.
test("after one online visit, the start URL boots offline, opens the stored document, and an edit is saved across a reload and exported", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(300_000);
  const baseURL = testInfo.project.use.baseURL!;
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    const online = new FeatureWorkbenchHarness(page);
    await online.openWithRepository();
    await online.expectWorkspaceInRepository();
    const documentId = await online.activeDocumentId();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            return navigator.serviceWorker.controller !== null;
          }),
        { message: "the service worker controls the app", timeout: 60_000 },
      )
      .toBe(true);

    await stopPreview(server, baseURL);
    await context.setOffline(true);
    const session = await context.newCDPSession(page);
    await session.send("Network.clearBrowserCache");
    await session.detach();
    await page.close();

    const appPage = await context.newPage();
    const app = new FeatureWorkbenchHarness(appPage);
    await app.openPreservingStorage("/app");
    expect(
      await appPage.evaluate(() =>
        fetch(`/?offline-probe=${Date.now()}`, { cache: "no-store" }).then(
          () => "reached",
          () => "unreachable",
        ),
      ),
      "premise: the network is off",
    ).toBe("unreachable");
    await app.expectMachine("idle", 60_000);
    expect(await app.activeDocumentId(), "the stored document opens").toBe(
      documentId,
    );

    await addCircleSketch(app);
    // Saved before the reload: a pending save would make the reload ask.
    await expect(saveActivityRing(appPage)).toHaveAttribute(
      "data-save-activity-ring",
      "idle",
      { timeout: 30_000 },
    );
    await appPage.reload();
    await app.expectMachine("idle", 60_000);
    expect(await app.activeDocumentId()).toBe(documentId);

    const exported = await saveDocumentCopy<{
      sketches: { definition: { entities: { kind: string }[] } }[];
    }>(appPage);
    expect(
      exported.sketches.flatMap((sketch) =>
        sketch.definition.entities.map((entity) => entity.kind),
      ),
      "the offline edit survived the reload and is exported",
    ).toContain("circle");
  } finally {
    await stopPreview(server, baseURL);
  }
});
