import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { waitForCommittedAction } from "../helpers/acceptance";
import { saveDocumentCopy } from "../helpers/document-files";
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

/** `vite preview` of the offline build on the project's base URL port. */
function startPreview(baseURL: string, logPath: string) {
  const log = openSync(logPath, "a");
  const server = spawn(
    "bunx",
    [
      "vite",
      "preview",
      "--config",
      "vite.offline-test.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      new URL(baseURL).port,
      "--strictPort",
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  return server;
}

const reachable = (url: string) =>
  fetch(url).then(
    (response) => response.ok,
    () => false,
  );

/** Stops the preview's process group and waits until its port is closed. */
async function stopPreview(server: ChildProcess, baseURL: string) {
  try {
    process.kill(-server.pid!, "SIGTERM");
  } catch (error) {
    // Already stopped (the row stops it once to cut the network).
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  await expect
    .poll(() => reachable(baseURL), {
      message: "the preview server is gone",
      timeout: 15_000,
    })
    .toBe(false);
}

/** Two full circles (canvas) that overlap: three regions. */
const OVERLAPPING_CIRCLES = [
  { centre: { x: 640, y: 470 }, rim: { x: 720, y: 470 } },
  { centre: { x: 740, y: 470 }, rim: { x: 820, y: 470 } },
];

/** File → New. */
async function newDocument(page: Page) {
  await page.getByRole("button", { name: "File" }).click();
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
