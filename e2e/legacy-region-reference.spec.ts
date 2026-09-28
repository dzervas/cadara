import { expect, test } from "@playwright/test";

import type { ModelingOperationHistoryPayload } from "../src/contracts/modeling/operation-history";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

test.setTimeout(90_000);

// T09 U5: region ids are the SHA-256 identity of the canonical boundary
// signature, and the former hash-suffix fallback is deleted. A persisted
// pre-canonical region label no longer resolves; the feature asks for
// reselection instead of silently binding to a lookalike region.
test("persisted legacy region labels require reselection after canonical region identity", async ({
  page,
}) => {
  const canonicalRegionId = FEATURE_FIXTURE.regionId;
  const legacyRegionId =
    "region_primary-sketch_entity_legacy_start-3h5wtq1po7fut";
  const history = JSON.parse(
    JSON.stringify(createBaseExtrudeOperationHistory()).replaceAll(
      canonicalRegionId,
      legacyRegionId,
    ),
  ) as ModelingOperationHistoryPayload;
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.openWithOperationHistory(history);

  await expect(
    page.getByRole("treeitem", {
      name: /Repair Extrude 1\. Edit Extrude 1 and choose a valid profile selection\./,
    }),
    "The feature whose legacy region no longer resolves asks for reselection.",
  ).toBeVisible({ timeout: 30_000 });
  await workbench.expectBodyAbsent(FEATURE_FIXTURE.body);
});
