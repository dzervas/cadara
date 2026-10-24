import { expect, test, type Page } from "@playwright/test";
import type { AuthoredModelDocument } from "../../src/contracts/modeling/authored-document";

import { waitForCommittedAction } from "../helpers/acceptance";
import { openDocumentCopy, saveDocumentCopy } from "../helpers/document-files";
import { createRectangleProfileOperationHistory } from "../helpers/modeling-fixtures";
import {
  reachable,
  startPreview,
  stopPreview,
} from "../helpers/offline-preview";
import { FeatureWorkbenchHarness } from "../helpers/feature-workbench";
import { runMechanicalPartFlow } from "../helpers/mechanical-part";
import {
  glideClick,
  openTopSketch,
  sketchSnapshot,
} from "../helpers/mirror-workbench";

test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e, offline sub-lane (`bun run test:e2e:offline`; docs/testing.md).
// Seam: specification §1 "repeat file operations offline after the
// application is available" on the shipped build (T17-1′ b): the app is
// loaded once, then the network is really cut and the whole Category 1 flow
// (`runMechanicalPartFlow`, shared with the fast lane's E2E-1 row) runs in a
// document created offline. The network is cut by stopping the preview
// server (its process group, by PID) and `context.setOffline(true)`:
// Chromium's offline emulation alone lets a dedicated worker's script fetch
// through, so only a stopped server shows whether a worker first spawned
// offline can load (T17h2 F-1). No `route` (it disables the HTTP cache).
// Step → row map and discrimination: T17h2.md.

/** Two full circles (canvas) that overlap: three regions. */
const OVERLAPPING_CIRCLES = [
  { centre: { x: 640, y: 470 }, rim: { x: 720, y: 470 } },
  { centre: { x: 740, y: 470 }, rim: { x: 820, y: 470 } },
];

/** File → New. */
async function newDocument(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Created a new document." }),
  ).toBeVisible({ timeout: 10_000 });
}

test("§1 E2E-1 offline (production build, network really cut after load): File → New, overlapping circles derive regions through the kernel in a worker spawned offline; File → New, the whole Category 1 flow (sketch with live regions, dimensions, requirement, drag/Undo/Redo, Finish, Extrude picked in the viewport, Measure, Save As → Open a copy, re-enter, edit, Finish → rebuild), then Save As of the edit", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(600_000);
  const baseURL = testInfo.project.use.baseURL!;
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithRepository();
    // The application is available: loaded, and its service worker active
    // and controlling the page (the shipped build's offline support).
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

    // Cut the network.
    await stopPreview(server, baseURL);
    await context.setOffline(true);
    expect(
      await page.evaluate(() =>
        fetch(`/?offline-probe=${Date.now()}`, { cache: "no-store" }).then(
          () => "reached",
          () => "unreachable",
        ),
      ),
      "premise: the network is off",
    ).toBe("unreachable");
    const workersSpawnedOffline: string[] = [];
    page.on("worker", (worker) => workersSpawnedOffline.push(worker.url()));

    // A sketch whose live regions need the kernel in a derivation worker
    // spawned offline: two overlapping full circles (the circle pair goes
    // to OCC), in a new document; then Finish (T17h2 review R-1).
    await newDocument(page);
    await openTopSketch(workbench);
    await workbench.activateTool("Create circular geometry.");
    for (const circle of OVERLAPPING_CIRCLES) {
      await glideClick(workbench, circle.centre);
      await waitForCommittedAction(page, "Create Sketch Geometry", () =>
        glideClick(workbench, circle.rim),
      );
    }
    await expect
      .poll(async () => (await sketchSnapshot(page)).liveRegions, {
        message: "the kernel loads in a worker spawned offline",
        timeout: 60_000,
      })
      .toEqual({ status: "current", count: 3 });
    await page.keyboard.press("Escape");
    await workbench.activateTool("Exit the active sketch.");
    await workbench.expectMachine("idle", 60_000);

    // The Category 1 flow in another new document, created offline.
    await newDocument(page);
    await runMechanicalPartFlow(workbench);
    expect(
      workersSpawnedOffline.filter((url) =>
        /\/assets\/sketch-derivation\.worker-[^/]+\.js$/.test(url),
      ).length,
      "premise: the flow spawned sketch-derivation workers after the cut",
    ).toBeGreaterThan(0);

    // Save As of the reopened, edited document, still offline.
    const saved = await saveDocumentCopy<{
      sketches: {
        definition: {
          dimensions: { kind: string; value: { value: number } }[];
        };
      }[];
    }>(page);
    expect(
      saved.sketches[0]!.definition.dimensions.map((dimension) => [
        dimension.kind,
        dimension.value.value,
      ]),
      "the offline edit is saved",
    ).toEqual([["diameter", 4]]);
  } finally {
    await stopPreview(server, baseURL);
  }
});

// A navigation must be served by the service worker, not merely a warm HTTP
// cache. Also exercise a new page with the same persistent browser storage.
test("reload while offline boots and opens the document; a cold page starts offline too", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = testInfo.project.use.baseURL!;
  const server = startPreview(baseURL, testInfo.outputPath("preview.log"));
  try {
    await expect.poll(() => reachable(baseURL), { timeout: 60_000 }).toBe(true);
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithRepositoryAndOperationHistory(
      createRectangleProfileOperationHistory(),
    );
    const saved = await saveDocumentCopy<AuthoredModelDocument>(page);
    const expectDocumentGeometry = async (target: Page) => {
      const actual = await saveDocumentCopy<AuthoredModelDocument>(target);
      expect(actual.sketches).toHaveLength(1);
      // Repository round-trips can reorder the entity/point records.
      for (const key of ["entities", "points"] as const) {
        const expected = saved.sketches[0]!.definition[key];
        expect(actual.sketches[0]!.definition[key]).toHaveLength(
          expected.length,
        );
        expect(actual.sketches[0]!.definition[key]).toEqual(
          expect.arrayContaining(expected),
        );
      }
    };
    expect(saved.sketches).toHaveLength(1);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(
        () => page.evaluate(() => navigator.serviceWorker.controller !== null),
        {
          timeout: 60_000,
        },
      )
      .toBe(true);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "A new version of CADara is available" }),
      "the first install shows no update prompt",
    ).toHaveCount(0);

    await stopPreview(server, baseURL);
    await context.setOffline(true);
    // Clear Chromium's HTTP cache, not CacheStorage (the app's offline store).
    const session = await context.newCDPSession(page);
    await session.send("Network.clearBrowserCache");
    await session.detach();
    await page.reload();
    await workbench.expectMachine("idle", 60_000);
    await workbench.expectWorkspaceInRepository();
    await expectDocumentGeometry(page);
    await openDocumentCopy(page, saved, "offline-reload.cadara");
    await expectDocumentGeometry(page);

    await page.close();
    const coldPage = await context.newPage();
    // The landing entry is part of the shell too, even if never visited online.
    await coldPage.goto(`${baseURL}/`);
    await expect(coldPage).toHaveTitle(/CADara/);
    const coldWorkbench = new FeatureWorkbenchHarness(coldPage);
    await coldWorkbench.openWithRepository();
    await coldWorkbench.expectMachine("idle", 60_000);
    await openDocumentCopy(coldPage, saved, "offline-cold-start.cadara");
    await expectDocumentGeometry(coldPage);
  } finally {
    await stopPreview(server, baseURL);
  }
});
