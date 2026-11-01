import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

// Lane: e2e, single-file sub-lane (`bun run test:e2e:single-file`;
// docs/testing.md). Seam: the artifact of `bun run build:single`
// (vite.single.config.ts) opened straight from disk with the network cut.
// Only a browser on a file:// page enforces the rules this build must meet:
// the inline app script must be a module (it uses import.meta), and a page
// with origin 'null' can start its workers only from inlined classic blob
// workers, never from separate worker files.
// Not yet covered: OCC-backed modelling, which needs the kernel embedded.

const SINGLE_FILE_HTML = path.resolve("dist/cadara-single.html");
// OCC worker, sketch-region derivation worker, document-sync worker.
const APP_WORKER_COUNT = 3;

test("the single-file build boots from file:// with the network cut and starts its workers from the page", async ({
  context,
  page,
}) => {
  await context.route(/^(https?|wss?):/, (route) => route.abort());
  const pageErrors: string[] = [];
  const failedFileLoads: string[] = [];
  const workerUrls: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("file:")) failedFileLoads.push(request.url());
  });
  page.on("worker", (worker) => workerUrls.push(worker.url()));

  await page.goto(pathToFileURL(SINGLE_FILE_HTML).href);

  const toolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await expect(toolbar).toBeVisible({ timeout: 30_000 });
  await expect(
    toolbar.locator("button[data-tool-tooltip]").first(),
  ).toBeVisible();
  await expect
    .poll(() => workerUrls.length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(APP_WORKER_COUNT);
  expect(
    workerUrls.filter((url) => !url.startsWith("blob:")),
    "every worker is inlined in the page",
  ).toEqual([]);
  expect(pageErrors, "no uncaught page errors").toEqual([]);
  expect(failedFileLoads, "nothing is loaded from beside the HTML").toEqual([]);
});
