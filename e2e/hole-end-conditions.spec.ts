import { expect, test } from "@playwright/test";

import { createCommitSketchHistoryEntry } from "../src/contracts/modeling/operation-history";
import { FeatureWorkbenchHarness, FEATURE_FIXTURE } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";
import {
  bodyTopology,
  entityRef,
  sketchPoint,
  sketchRequest,
} from "./helpers/seeded-sketches";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

/**
 * The base extrude (a 10.5 x 9.5 rectangle on the top plane, extruded 10 along
 * +z) plus a sketch on the same plane holding one authored point inside the
 * rectangle: a hole there runs up the body from its bottom face.
 */
function holeLocationHistory() {
  const base = createBaseExtrudeOperationHistory();
  const request = sketchRequest(
    "sketch_hole",
    "Hole Location",
    [sketchPoint("sketch_hole", "sketch_point_hole_center", [-10.25, -0.25])],
    [
      {
        kind: "point",
        entityId: "sketch_entity_hole_center",
        label: "Hole center",
        target: entityRef("sketch_hole", "sketch_entity_hole_center"),
        isConstruction: false,
        pointId: "sketch_point_hole_center",
      },
    ],
  );
  return {
    ...base,
    entries: [
      ...base.entries,
      createCommitSketchHistoryEntry(request, "sketch_hole"),
    ],
  };
}

test("the hole panel offers Extrude's end conditions and cuts up to a picked part", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(holeLocationHistory());
  await expect
    .poll(() => bodyTopology(page, FEATURE_FIXTURE.body).then((t) => t?.faces))
    .toBe(6);

  await workbench.activateTool("Cut holes from sketch-point locations.");
  await workbench.selectFirstReferenceMatching(/^sketch_hole\..*sketch_point_hole_center$/);
  await workbench.selectReference(FEATURE_FIXTURE.body);

  const endCondition = page.getByRole("combobox", { name: "End condition" });
  await expect(endCondition).toHaveValue("Blind");
  await endCondition.click();
  for (const option of ["Up to next", "Up to face", "Up to vertex", "Through all"]) {
    await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  }
  await page.getByRole("option", { name: "Up to part", exact: true }).click();
  await expect(endCondition).toHaveValue("Up to part");
  await expect(page.getByRole("spinbutton", { name: "Depth" })).toHaveCount(0);
  await expect(page.getByText("Select one body target.")).toBeVisible();

  // The default 5-deep blind bore would stop inside the 10-tall body and add a
  // bore and a floor face; ending at the part's far face adds only the bore.
  await page.getByRole("button", { name: /^Up to part target None/ }).click();
  await workbench.selectReference(FEATURE_FIXTURE.body);
  await expect(page.getByText("Select one body target.")).toHaveCount(0);
  await workbench.commitFeature("feature_hole-1");
  await expect
    .poll(() => bodyTopology(page, FEATURE_FIXTURE.body).then((t) => t?.faces), {
      timeout: 30_000,
    })
    .toBe(7);
});
