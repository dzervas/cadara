import { test, expect } from "vitest";

import {
  assembleFixtureMountsBundle,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import type { StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { planStudioFidelity } from "@/domain/import/onshape/fidelity-planner";

test("src/domain/import/onshape/fidelity-planner.spec.ts", async () => {
  const bundle = await assembleFixtureMountsBundle();
  const read = readPartStudio(bundle, FIXTURE_PART_STUDIO_ID);
  const plan = planStudioFidelity(read);

  const byId = new Map(
    plan.featurePlans.map((entry) => [entry.onshapeFeatureId, entry]),
  );

  const firstSketch = byId.get("FOoap8tw3jKAJf5_0");
  expect(
    firstSketch?.tier === "parametric" &&
      firstSketch.target.kind === "sketch" &&
      firstSketch.target.planeKey === "xy",
    "A sketch on the captured Top datum plane should plan as a parametric XY sketch.",
  ).toBeTruthy();

  const extrude = byId.get("FG094ehBlsq34dl_0");
  expect(
    extrude?.tier === "baked" &&
      extrude.reasonCodes.includes("needs-region-resolution"),
    "An extrude consumes a sketch region and must degrade to baked with the precise region-resolution reason, not the probe reason.",
  ).toBeTruthy();

  expect(
    plan.requiresStudioBake,
    "A studio with bodies and a degraded solid feature needs the final-body bake.",
  ).toBeTruthy();

  expect(
    plan.tierCounts.parametric >= 1 && plan.tierCounts.baked >= 1,
    "Tier counts should reflect the mixed-fidelity plan.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts assignVariable label", () => {
  const read: StudioReadResult = {
    studio: {
      elementId: "e1",
      name: "Vars",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features: [
      {
        featureType: "assignVariable",
        featureId: "FVAR_1",
        name: "Variable 1",
        parameters: [
          { parameterId: "name", value: "nail" },
          { parameterId: "value", expression: "4 mm", value: 0.004 },
        ],
      },
    ],
    solvedSketchesByFeatureId: new Map(),
    diagnostics: [],
  };

  const plan = planStudioFidelity(read);
  expect(
    plan.featurePlans[0]?.label,
    "An assignVariable feature should be labelled by its authored variable name, not the generic feature name.",
  ).toBe("nail");
  expect(
    plan.featurePlans[0]?.tier === "parametric" &&
      plan.featurePlans[0]?.target.kind === "variable",
    "assignVariable should plan as a parametric document variable.",
  ).toBeTruthy();
});
