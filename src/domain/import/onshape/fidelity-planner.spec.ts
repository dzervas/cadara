import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test, expect } from "vitest";

import {
  assembleFixtureMountsBundle,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import type { StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { planStudioFidelity } from "@/domain/import/onshape/fidelity-planner";
import {
  validateOnshapeCaptureBundle,
  type OnshapeRollbackSnapshot,
} from "@/contracts/import/onshape-capture-bundle";

test("src/domain/import/onshape/fidelity-planner.spec.ts", async () => {
  const bundle = await assembleFixtureMountsBundle();
  const read = readPartStudio(bundle, FIXTURE_PART_STUDIO_ID);
  const plan = planStudioFidelity(read);
  expect(read.features[0]?.constraints?.map((entry) => entry.constraintType)).toEqual([
    "HORIZONTAL",
    "LENGTH",
    "OFFSET",
  ]);

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

  expect(plan.bakeStrategy).toEqual({ kind: "none" });
  expect(
    !plan.requiresStudioBake,
    "With every feature parametric, no whole-studio bake is required.",
  ).toBeTruthy();

  expect(
    plan.tierCounts.parametric === 3 && plan.tierCounts.baked === 0,
    "Tier counts should reflect the fully-parametric plan (two sketches + one extrude).",
  ).toBeTruthy();
});


const realBundleCases = [
  [
    "40a51fb8fa82fd4565151114.onshape-capture.json",
    { parametric: 8, baked: 2, geometryOnly: 0 },
  ],
  [
    "9841e486906fa2ce62d74d8e.onshape-capture.json",
    { parametric: 6, baked: 35, geometryOnly: 0 },
  ],
] as const;

test.skipIf(realBundleCases.some(([fileName]) => !existsSync(fileName)))(
  "src/domain/import/onshape/fidelity-planner.spec.ts real bundles contain no Wave A features and retain baseline counts",
  async () => {
  for (const [fileName, expected] of realBundleCases) {
    const parsed = validateOnshapeCaptureBundle(JSON.parse(await readFile(fileName, "utf8")));
    if (!parsed.success) throw new Error(`Real capture ${fileName} must validate.`);
    const studio = parsed.data.partStudios[0]!;
    const read = readPartStudio(parsed.data, studio.elementId);
    expect(
      read.features.some((feature) =>
        ["revolve", "thicken", "sweep", "loft"].includes(feature.featureType),
      ),
    ).toBe(false);
    const plan = planStudioFidelity(read, {
      captureFormatVersion: parsed.data.formatVersion,
      historyProbeAvailable: true,
    });
    expect(plan.tierCounts).toEqual(expected);
    expect(plan.bakeStrategy.kind).toBe("segments");
    expect(plan.requiresStudioBake).toBe(false);
  }
});


test("src/domain/import/onshape/fidelity-planner.spec.ts prefers the consuming feature's history-point record", () => {
  const read: StudioReadResult = {
    studio: {
      elementId: "e1",
      name: "History point",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [
        {
          deterministicId: "plane-id",
          evaluatedAt: "finalState",
          unresolved: { reason: "consumed later" },
        },
        {
          deterministicId: "plane-id",
          evaluatedAt: "historyPoint",
          consumingFeatureId: "S1",
          signature: {
            entityClass: "face",
            geometryType: "PLANE",
            definingData: { normal: [0, 0, 1] },
            isDefaultPlane: true,
          },
        },
      ],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features: [
      {
        featureType: "newSketch",
        featureId: "S1",
        parameters: [
          {
            parameterId: "sketchPlane",
            queries: [{ deterministicIds: ["plane-id"] }],
          },
        ],
      },
    ],
    solvedSketchesByFeatureId: new Map(),
    diagnostics: [],
  };

  const plan = planStudioFidelity(read);
  expect(plan.featurePlans[0]?.tier).toBe("parametric");
  expect(plan.featurePlans[0]?.target).toMatchObject({ kind: "sketch", planeKey: "xy" });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts retains v1 final-state planning", () => {
  const read = makeStudioRead({
    sketchEntities: [{ entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 }],
    extrudeOperation: "NEW",
  });
  const plan = planStudioFidelity(read, { captureFormatVersion: 1 });
  expect(plan.featurePlans[0]?.tier).toBe("parametric");
  expect(plan.bakeStrategy).toEqual({ kind: "none" });
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
  sketchConstraints?: StudioReadResult["features"][number]["constraints"];
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
  const features: StudioReadResult["features"] = [
    {
      featureType: "newSketch",
      featureId: sketchFeatureId,
      name: "Sketch 1",
      constraints: input.sketchConstraints,
    },
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

test("src/domain/import/onshape/fidelity-planner.spec.ts relationship-bearing fixture sketch remains parametric", () => {
  const read = makeStudioRead({
    sketchEntities: [
      {
        entityId: "seed_line",
        entityType: "lineSegment",
        start3d: [0, 0, 0],
        end3d: [0.01, 0, 0],
      },
      {
        entityId: "offset_line",
        entityType: "lineSegment",
        start3d: [0, 0.002, 0],
        end3d: [0.01, 0.002, 0],
      },
      { entityId: "profile", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    sketchConstraints: [
      {
        constraintType: "HORIZONTAL",
        entityId: "seed-horizontal",
        parameters: [{ parameterId: "localFirst", value: "seed_line", hasExternalQuery: false }],
      },
      {
        constraintType: "LENGTH",
        entityId: "seed-length",
        parameters: [
          { parameterId: "localFirst", value: "seed_line", hasExternalQuery: false },
          { parameterId: "length", expression: "10 mm", hasExternalQuery: false },
        ],
      },
      {
        constraintType: "OFFSET",
        entityId: "seed-offset",
        parameters: [
          { parameterId: "localMaster", value: "seed_line", hasExternalQuery: false },
          { parameterId: "localOffset", value: "offset_line", hasExternalQuery: false },
          { parameterId: "halfSpace0", value: "RIGHT", hasExternalQuery: false },
        ],
      },
    ],
    extrudeOperation: "NEW",
  });

  const plan = planStudioFidelity(read);
  const sketch = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "S1");
  const extrude = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    sketch?.tier === "parametric" && extrude?.tier === "parametric",
    "Constraint/dimension/derivation records on a fixture sketch should not demote otherwise translatable sketch/extrude planning.",
  ).toBeTruthy();
});

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

function rollbackSnapshot(
  featureId: string,
  bodyEnd: number | null,
): OnshapeRollbackSnapshot {
  return {
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: {
      bodies: bodyEnd === null ? [] : [{
        id: "A",
        faces: [{
          id: "A-face",
          facets: [{
            vertices: [
              { x: 0, y: 0, z: 0 },
              { x: bodyEnd, y: 0, z: 0 },
              { x: bodyEnd, y: 1, z: 1 },
            ],
          }],
        }],
      }],
    },
  };
}

test("src/domain/import/onshape/fidelity-planner.spec.ts reviewer demotion replans a v2 body run into a segment", () => {
  const read = makeStudioRead({
    sketchEntities: [
      { entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    priorExtrudes: [{ featureId: "E_BASE", operation: "NEW" }],
    extrudeOperation: "REMOVE",
  });
  read.studio.groundTruth = {
    hasBodies: true,
    tessellationTolerance: 0.0001,
    tessellatedFaces: {},
    step: "",
  };
  read.studio.rollbackSnapshots = [
    rollbackSnapshot("S1", null),
    rollbackSnapshot("E_BASE", 1),
    rollbackSnapshot("E_TARGET", 2),
  ];

  const baseline = planStudioFidelity(read, { captureFormatVersion: 2 });
  expect(baseline.bakeStrategy).toEqual({ kind: "none" });

  const demoted = planStudioFidelity(read, {
    captureFormatVersion: 2,
    demotedFeatureIds: ["E_TARGET"],
  });
  expect(demoted.requiresStudioBake).toBe(false);
  expect(demoted.bakeStrategy).toMatchObject({
    kind: "segments",
    segments: [{
      fromFeatureId: "E_TARGET",
      boundaryFeatureId: "E_TARGET",
      checkpointBodyDeterministicIds: ["A"],
      consumedBodyDeterministicIds: ["A"],
      replacementProducerFeatureIds: ["E_BASE"],
    }],
  });
  expect(demoted.featurePlans.find((plan) => plan.onshapeFeatureId === "E_TARGET")?.tier)
    .toBe("baked");
});

function makeTwoBranchStudioRead(): StudioReadResult {
  const sketchFeature = (
    featureId: string,
    name: string,
  ) => ({ featureType: "newSketch", featureId, name });
  const extrudeFeature = (
    featureId: string,
    sketchFeatureId: string,
    operation: string,
  ) => ({
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

  return {
    studio: {
      elementId: "e1",
      name: "Two branch",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [],
      groundTruth: { hasBodies: true },
      rollbackSnapshots: null,
    },
    features: [
      sketchFeature("S_BAD", "Baked sketch source"),
      extrudeFeature("E_BAD", "S_BAD", "NEW"),
      sketchFeature("S_GOOD", "Independent sketch"),
      extrudeFeature("E_GOOD", "S_GOOD", "NEW"),
      extrudeFeature("E_CUT", "S_GOOD", "REMOVE"),
    ],
    solvedSketchesByFeatureId: new Map([
      [
        "S_BAD",
        {
          featureId: "S_BAD",
          entities: [
            {
              entityId: "bad_line",
              entityType: "lineSegment",
              onshapeEntityType: "skLineSegment",
              isConstruction: false,
              start3d: [0, 0, 0],
              end3d: [0.01, 0, 0],
            },
          ],
        },
      ],
      [
        "S_GOOD",
        {
          featureId: "S_GOOD",
          entities: [
            {
              entityId: "good_circle",
              entityType: "circle",
              onshapeEntityType: "skCircle",
              isConstruction: false,
              center3d: [0.05, 0.05, 0],
              radius: 0.005,
            },
          ],
        },
      ],
    ]),
    diagnostics: [],
  };
}

test("src/domain/import/onshape/fidelity-planner.spec.ts independent branch stays parametric after a baked branch", () => {
  const plan = planStudioFidelity(makeTwoBranchStudioRead());
  const byId = new Map(plan.featurePlans.map((entry) => [entry.onshapeFeatureId, entry]));
  const baked = byId.get("E_BAD");
  const independent = byId.get("E_GOOD");

  expect(
    baked?.tier === "baked" &&
      baked.reasonCodes.includes("needs-region-resolution") &&
      !baked.reasonCodes.includes("downstream-of-baked"),
    "The first branch should bake for its own selector failure, not because of cascade.",
  ).toBeTruthy();
  expect(
    independent?.tier === "parametric" &&
      independent.target.kind === "feature" &&
      independent.inputDependencies.some(
        (input) => input.kind === "sketch" && input.featureId === "S_GOOD",
      ) &&
      !independent.reasonCodes.includes("downstream-of-baked"),
    "An independent sketch/extrude branch after a baked branch should remain live.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts true dependent of baked body lineage still bakes", () => {
  const plan = planStudioFidelity(makeTwoBranchStudioRead());
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_CUT");

  expect(
    cut?.tier === "baked" &&
      cut.reasonCodes.includes("extrude-default-scope-ambiguous") &&
      !cut.reasonCodes.includes("needs-region-resolution") &&
      !cut.reasonCodes.includes("downstream-of-baked"),
    "A default-scope boolean with multiple body candidates should retain its specific scope-ambiguity reason rather than silently targeting the visible parametric body.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts deferred body from a baked lineage propagates downstream-of-baked", () => {
  const read = makeTwoBranchStudioRead();
  read.features = read.features.filter((feature) => feature.featureId !== "E_GOOD");
  const plan = planStudioFidelity(read);
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_CUT");

  expect(
    cut?.tier === "baked" &&
      cut.reasonCodes.includes("downstream-of-baked") &&
      cut.inputDependencies.some(
        (input) => input.kind === "body" && input.featureId === "E_BAD",
      ) &&
      cut.inputFeatureIds.includes("E_BAD"),
    "When the only body lineage candidate is baked, the consuming boolean is a true dependent and carries downstream-of-baked.",
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
