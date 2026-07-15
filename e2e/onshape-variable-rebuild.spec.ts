import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  editVariable,
  importBundle,
  MOUNTS_BUNDLE_PATH,
  PART_STUDIO_BUNDLE_PATH,
} from "./helpers/onshape-import";

test.setTimeout(120_000);

test("real Onshape variable edit preserves the imported sketch region", async ({
  page,
}) => {
  test.skip(
    !existsSync(MOUNTS_BUNDLE_PATH),
    "Real Onshape capture is not present locally.",
  );
  await importBundle(page, MOUNTS_BUNDLE_PATH, true);
  const rebuilt = await editVariable(page, "nail", "5");

  expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  expect(rebuilt.selectableTargets).toContain(
    "sketch_primary.region_primary-sketch_entity_FOoap8tw3jKAJf5_0_ATLNdmpEpWg5-3h5wtq1po7fut",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: /does not resolve on sketch/i }),
  ).toHaveCount(0);
});

test("second real Onshape bundle updates walls against the latest revision", async ({
  page,
}) => {
  test.skip(
    !existsSync(PART_STUDIO_BUNDLE_PATH),
    "Second real Onshape capture is not present locally.",
  );
  await importBundle(page, PART_STUDIO_BUNDLE_PATH);
  await editVariable(page, "walls", "3");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /request revision .* does not match current revision/i }),
  ).toHaveCount(0);
  await expect(page.getByText(/Workbench action failed/i)).toHaveCount(0);
});
