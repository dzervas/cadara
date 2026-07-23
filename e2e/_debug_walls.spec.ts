import { existsSync } from "node:fs";

import { test } from "@playwright/test";

import { importBundle, PART_STUDIO_BUNDLE_PATH } from "./helpers/onshape-import";

test.setTimeout(300_000);

test("DEBUG walls import timing", async ({ page }) => {
  test.skip(!existsSync(PART_STUDIO_BUNDLE_PATH), "no bundle");
  const t0 = Date.now();
  await importBundle(page, PART_STUDIO_BUNDLE_PATH);
  console.log("IMPORT_MS", Date.now() - t0);
  const state = await page.evaluate(() => window.__cadaraDebug!.getState());
  console.log("FEATURES", state.featureIds.length, "DIAG", state.snapshotDiagnosticsCount);
});
