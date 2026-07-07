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
    extrude?.tier === "parametric" &&
      extrude.target.kind === "feature" &&
      extrude.plannedExtrude !== undefined &&
      extrude.plannedExtrude.boolean.kind === "standalone" &&
      extrude.plannedExtrude.profiles.length === 1,
    "An extrude consuming a verified region of a parametric sketch should now plan parametric with a deferred standalone profile.",
  ).toBeTruthy();

  expect(
    !plan.requiresStudioBake,
    "With every feature parametric, no whole-studio bake is required.",
  ).toBeTruthy();

  expect(
    plan.tierCounts.parametric === 3 && plan.tierCounts.baked === 0,
    "Tier counts should reflect the fully-parametric plan (two sketches + one extrude).",
  ).toBeTruthy();
});

// ---- Synthetic seam coverage for scope-ambiguity and selector-failure -----

function makeStudioRead(input: {
  sketchEntities: {
    entityId: string;
    entityType: "circle" | "lineSegment";
    center3d?: [number, number, number];
    radius?: number;
    start3d?: [number, number, number];
    end3d?: [number, number, number];
  }[];
  extrudeOperation: string;
  priorExtrudes?: { featureId: string; operation: string }[];
}): StudioReadResult {
  const sketchFeatureId = "S1";
  const makeExtrude = (featureId: string, operation: string) => ({
    featureType: "extrude",
    featureId,
    name: featureId,
    parameters: [
      {
        parameterId: "entities",
        queries: [
          {
            queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
          },
        ],
      },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: "10 mm", value: 0.01 },
      { parameterId: "operationType", value: operation },
    ],
  });
  const features = [
    { featureType: "newSketch", featureId: sketchFeatureId, name: "Sketch 1" },
    ...(input.priorExtrudes ?? []).map((prior) =>
      makeExtrude(prior.featureId, prior.operation),
    ),
    makeExtrude("E_TARGET", input.extrudeOperation),
  ];
  return {
    studio: {
      elementId: "e1",
      name: "Synthetic",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features,
    solvedSketchesByFeatureId: new Map([
      [
        sketchFeatureId,
        {
          featureId: sketchFeatureId,
          entities: input.sketchEntities.map((entity) => ({
            entityId: entity.entityId,
            entityType: entity.entityType,
            onshapeEntityType:
              entity.entityType === "circle" ? "skCircle" : "skLineSegment",
            isConstruction: false,
            center3d: entity.center3d,
            radius: entity.radius,
            start3d: entity.start3d,
            end3d: entity.end3d,
          })),
        },
      ],
    ]),
    diagnostics: [],
  };
}

test("src/domain/import/onshape/fidelity-planner.spec.ts default-scope cut with a single upstream body plans parametric", () => {
  const read = makeStudioRead({
    sketchEntities: [
      { entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    priorExtrudes: [{ featureId: "E_BASE", operation: "NEW" }],
    extrudeOperation: "REMOVE",
  });
  const plan = planStudioFidelity(read);
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    cut?.tier === "parametric" &&
      cut.plannedExtrude?.boolean.kind === "deferredBody" &&
      cut.plannedExtrude.boolean.sourceFeatureId === "E_BASE",
    "A default-scope cut with exactly one prior body-producing extrude should plan parametric with a deferred body reference.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts ambiguous default-scope boolean stays probe-gated", () => {
  const read = makeStudioRead({
    sketchEntities: [
      { entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    extrudeOperation: "REMOVE",
  });
  const plan = planStudioFidelity(read);
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    cut?.tier === "baked" &&
      cut.reasonCodes.includes("needs-history-probe") &&
      !cut.reasonCodes.includes("needs-region-resolution"),
    "A default-scope cut with zero upstream bodies is a scope problem, not a region problem: it must be probe-gated.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts selector that verifies no closed region degrades with region-resolution", () => {
  const read = makeStudioRead({
    // A single open line segment yields no closed region to select.
    sketchEntities: [
      {
        entityId: "l1",
        entityType: "lineSegment",
        start3d: [0, 0, 0],
        end3d: [0.01, 0, 0],
      },
    ],
    extrudeOperation: "NEW",
  });
  const plan = planStudioFidelity(read);
  const extrude = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    extrude?.tier === "baked" &&
      extrude.reasonCodes.includes("needs-region-resolution"),
    "An extrude whose sketch has no verifiable closed region stays baked with needs-region-resolution.",
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
