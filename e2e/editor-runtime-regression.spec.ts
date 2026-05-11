import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

test("bootstraps editor state and restores persisted geometry across reload", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory());
  await expect(page.getByText("History restore failed")).toHaveCount(0);

  const selectedFaceLabel = await workbench.selectFirstReferenceMatching(
    /^Select .* body_feature_extrude-1\.face_/,
  );
  const expectedFaceTarget = selectedFaceLabel.match(
    / (body_feature_extrude-1\.face_[^\s]+)$/,
  )?.[1];

  if (!expectedFaceTarget) {
    throw new Error(
      `Could not extract a face target from ${selectedFaceLabel}.`,
    );
  }

  await workbench.reloadPreservingStorage();

  await expect(page.getByText("History restore failed")).toHaveCount(0);
  const reselectedFaceLabel = await workbench.selectFirstReferenceMatching(
    /^Select .* body_feature_extrude-1\.face_/,
  );
  expect(reselectedFaceLabel).toBe(selectedFaceLabel);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain(expectedFaceTarget);
});
