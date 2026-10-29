import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { captureActionableErrorRecords } from "./helpers/error-reporting";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// A user's enclosure: rolled back to Fillet 2, a chamfer inserted on an
// edge of the lid. A later face sketch's supporting face no longer resolves
// in its history position. That used to make every restore (the reload) throw
// and lose the model; now the sketch carries a repairable diagnostic on its
// timeline item, nothing raises an error, and Change Sketch Plane repairs it.
// The kernel seam is covered by
// opencascade-kernel-adapter.unresolved-sketch-support.heavy.spec.ts.

test.setTimeout(240_000);
test.use({ viewport: { width: 1600, height: 960 } });

const ORPHANED_SKETCH = "sketch_0ea9f583-56d5-4234-94db-32c276b396f5";
const CHAMFER = "feature_chamfer-3";
const CHAMFERED_EDGE =
  "body_feature_extrude-7.edge_body_feature_extrude-7_g4161b03398d80fed";

interface SavedDocument {
  features: { featureId: string; definition: unknown }[];
  featureOrder: string[];
  historyOrder: { kind: string; featureId?: string }[];
  topologyLineage?: { featureId: string }[];
  cursor: unknown;
}

/** The saved document as it was before the chamfer was inserted. */
async function beforeChamferInsertion() {
  const saved = JSON.parse(
    await readFile(
      "test/fixtures/documents/enclosure-chamfer-orphans-face-sketch.json",
      "utf8",
    ),
  ) as SavedDocument;
  return {
    ...saved,
    features: saved.features.filter((entry) => entry.featureId !== CHAMFER),
    featureOrder: saved.featureOrder.filter((entry) => entry !== CHAMFER),
    historyOrder: saved.historyOrder.filter(
      (entry) => entry.featureId !== CHAMFER,
    ),
    topologyLineage: saved.topologyLineage?.filter(
      (record) => record.featureId !== CHAMFER,
    ),
    cursor: { kind: "feature", featureId: "feature_fillet-2" },
  };
}

const sketchItem = (page: Page) =>
  page.locator(`button[data-history-sketch-id="${ORPHANED_SKETCH}"]`);

async function expectNoErrorRaised(
  page: Page,
  records: ReturnType<typeof captureActionableErrorRecords>,
  step: string,
) {
  for (const title of [
    "Workbench action failed",
    "History restore failed",
    "Document refresh failed",
  ]) {
    await expect(page.getByText(title), `${step}: no "${title}"`).toHaveCount(
      0,
    );
  }
  expect(records, `${step}: no reported application error`).toEqual([]);
}

async function expectSketchNeedsNewPlane(page: Page) {
  await expect(sketchItem(page)).toHaveAttribute("data-feature-error", "true", {
    timeout: 60_000,
  });
  await expect(sketchItem(page)).toHaveAttribute(
    "data-repair-guidance",
    /Change Sketch Plane/,
  );
}

test("a chamfer inserted mid-history that orphans a face sketch raises no error, marks the sketch and Change Sketch Plane repairs it", async ({
  page,
}) => {
  const records = captureActionableErrorRecords(page);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await openDocumentCopy(
    page,
    await beforeChamferInsertion(),
    "enclosure.cadara",
  );
  await expect(sketchItem(page)).toBeVisible({ timeout: 120_000 });
  await workbench.expectBodyPresent("body_feature_extrude-7");
  await workbench.waitForRenderIdle(60_000);

  await workbench.activateFeature("chamfer");
  await workbench.selectReference(CHAMFERED_EDGE);
  await workbench.setNumericField("Distance", 1);
  await workbench.expectFeaturePreviewReady("chamfer");
  await workbench.commitFeature(CHAMFER);
  await expectSketchNeedsNewPlane(page);
  await expectNoErrorRaised(page, records, "after the chamfer");

  // The reload restores the stored document: it used to throw here.
  await workbench.reloadPreservingRepositoryStorage();
  await workbench.waitForRenderIdle(60_000);
  await workbench.expectBodyPresent("body_feature_extrude-7");
  await expectSketchNeedsNewPlane(page);
  await expectNoErrorRaised(page, records, "after the reload");

  await sketchItem(page).click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Change Sketch Plane" }).click();
  await page.getByRole("button", { name: /^Support plane/ }).click();
  // The picker takes the plane as the new support; the editor selection
  // stays on the sketch.
  expect(
    await page.evaluate(
      () =>
        window.__cadaraDebug?.selectTarget("construction_plane-xy") ?? false,
    ),
    "the XY plane is selectable",
  ).toBe(true);
  await page.getByRole("button", { name: "Commit" }).click();
  await expect(sketchItem(page)).not.toHaveAttribute("data-feature-error", {
    timeout: 60_000,
  });
  await expectNoErrorRaised(page, records, "after Change Sketch Plane");
});
