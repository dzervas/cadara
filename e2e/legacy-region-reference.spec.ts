import { expect, test } from "@playwright/test";

import type { ModelingOperationHistoryPayload } from "../src/contracts/modeling/operation-history";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import {
  createBaseExtrudeOperationHistory,
  FEATURE_FIXTURE,
} from "./helpers/modeling-fixtures";

test.setTimeout(90_000);

test("persisted legacy region labels resolve after canonical region rebuild", async ({
  page,
}) => {
  const canonicalRegionId = FEATURE_FIXTURE.regionId;
  const stableHash = canonicalRegionId.slice(canonicalRegionId.lastIndexOf("-"));
  const legacyRegionId = `region_primary-sketch_entity_legacy_start${stableHash}`;
  const history = JSON.parse(
    JSON.stringify(createBaseExtrudeOperationHistory()).replaceAll(
      canonicalRegionId,
      legacyRegionId,
    ),
  ) as ModelingOperationHistoryPayload;
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.openWithOperationHistory(history);

  await workbench.expectBodyPresent(FEATURE_FIXTURE.body);
  await expect(
    page.getByRole("alert").filter({ hasText: /does not resolve on sketch/i }),
  ).toHaveCount(0);
});
