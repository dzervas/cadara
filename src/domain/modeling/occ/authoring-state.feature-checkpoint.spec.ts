import { expect, test } from "vitest";

import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  type AuthoredValue,
} from "@/contracts/modeling/authored-values";
import type {
  DocumentVariableRecord,
  FeatureDefinition,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type { BodyId, FeatureId, SketchId } from "@/contracts/shared/ids";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { DocumentHistoryOrderEntry } from "@/domain/modeling/document-history";
import {
  checkpointOccFeatureStage,
  findReusableOccFeatureCheckpoint,
  type OccAuthoringFeatureRecord,
  type OccAuthoringState,
} from "@/domain/modeling/occ/authoring-state";
import type { OccFeatureTopologyStageMap } from "@/domain/modeling/occ/topology-stage";

// Lane: logic (docs/testing.md, Core and Domain: pure inputs and outputs).
// Seam: findReusableOccFeatureCheckpoint over checkpoints made by
// checkpointOccFeatureStage, with plain records and no OCC (cadara-di5). It
// decides which leading features a history rebuild may take from the previous
// build instead of rerunning them; a wrong answer shows stale geometry.
// Variable-driven sketch dimensions are cadara-afj3.

const extrude = (
  sketchId: SketchId,
  distance: AuthoredValue<number>,
): FeatureDefinition => ({
  kind: "extrude",
  featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
  parameters: {
    resultBodyType: "solid",
    profiles: [{ kind: "region", sketchId, regionId: `region_${sketchId}` }],
    startExtent: { kind: "profilePlane" },
    extent: {
      mode: "oneSide",
      end: { kind: "blind", direction: "positive", distance },
    },
    operation: createLiteralAuthoredValue("newBody"),
    booleanScope: { kind: "standalone" },
  },
});

const features: OccAuthoringFeatureRecord[] = [
  {
    featureId: "feature_1",
    label: "Extrude 1",
    suppressed: false,
    definition: extrude("sketch_1", createLiteralAuthoredValue(10)),
  },
  {
    featureId: "feature_2",
    label: "Extrude 2",
    suppressed: false,
    definition: extrude("sketch_2", createExpressionAuthoredValue("depth + 1")),
  },
  {
    featureId: "feature_3",
    label: "Extrude 3",
    suppressed: false,
    definition: extrude("sketch_3", createLiteralAuthoredValue(5)),
  },
];
/** sketch_3 has a dimension given by the variable `gap`. */
const sketches = (
  [
    ["sketch_1", createLiteralAuthoredValue(3)],
    ["sketch_2", createLiteralAuthoredValue(3)],
    ["sketch_3", createExpressionAuthoredValue("gap * 2")],
  ] as const
).map(
  ([sketchId, value]) =>
    ({
      sketchId,
      sketch: {
        definition: {
          points: [],
          entities: [],
          references: [],
          dimensions: [
            {
              dimensionId: `dimension_${sketchId}`,
              kind: "distance",
              label: "Distance",
              axis: "aligned",
              pointIds: ["point_a", "point_b"],
              value,
            },
          ],
        },
      },
    }) as unknown as SketchSnapshotRecord,
);
const variables: DocumentVariableRecord[] = [
  { variableId: "variable_depth", name: "depth", valueText: "9" },
  { variableId: "variable_width", name: "width", valueText: "4" },
  { variableId: "variable_gap", name: "gap", valueText: "2" },
];
const historyOrder: DocumentHistoryOrderEntry[] = features.flatMap(
  (feature, index) => [
    { kind: "sketch" as const, sketchId: sketches[index]!.sketchId },
    { kind: "feature" as const, featureId: feature.featureId },
  ],
);
/** Feature i creates body_(i+1); body_later belongs to a feature after them. */
const bodyIds: BodyId[] = ["body_1", "body_2", "body_3"];
const bodyLabels = new Map<BodyId, string>([
  ["body_1", "Extrude 1"],
  ["body_2", "Extrude 2"],
  ["body_3", "Extrude 3"],
  ["body_later", "Fillet 1"],
]);

/** The document context a rebuild starts from; `previousBuild` is the build the checkpoints come from. */
function createBase(overrides: Partial<OccAuthoringState> = {}) {
  return {
    sketches,
    variables,
    historyOrder,
    modelingTolerance: 1e-6,
    angularToleranceRadians: 0.1,
    bodyLabels,
    bodyAppearances: new Map(bodyIds.map((bodyId) => [bodyId, {}])),
    assets: { schemaVersion: "geometry-asset-manifest/v1alpha1", records: [] },
    ...overrides,
  } as unknown as OccAuthoringState;
}

const previousBuild = createBase();
/** Checkpoints of `previousBuild`; from feature index `diagnosticsFrom` on,
 * each holds a rebuild diagnostic. */
const createStages = (diagnosticsFrom = Infinity): OccFeatureTopologyStageMap =>
  new Map(
    features.map((feature, index) => {
      const featureId = feature.featureId;
      const state = {
        ...previousBuild,
        bodies: bodyIds
          .slice(0, index + 1)
          .map((bodyId) => ({ bodyId, label: bodyLabels.get(bodyId) })),
        constructions: [],
        constructionPlanes: [],
        features: features.slice(0, index + 1),
        entities: [],
        renderRecords: [],
        referenceState: {},
        diagnostics:
          index >= diagnosticsFrom
            ? [{ code: "rebuild-warning", featureId: feature.featureId }]
            : [],
        featureTopologyStages: new Map([
          [featureId, { featureId, outputs: new Map() }],
        ]),
      } as unknown as OccAuthoringState;
      return [
        featureId,
        checkpointOccFeatureStage(
          state,
          featureId,
          0,
        ).featureTopologyStages.get(featureId)!,
      ];
    }),
  );
const stages = createStages();

function reusedFeatureIds(
  base: OccAuthoringState,
  isReplayable: (feature: OccAuthoringFeatureRecord) => boolean = () => true,
  appliedFeatures: readonly OccAuthoringFeatureRecord[] = features,
  checkpoints = stages,
): FeatureId[] | null {
  const reusable = findReusableOccFeatureCheckpoint(
    checkpoints,
    base,
    appliedFeatures,
    isReplayable,
  );
  if (!reusable) return null;
  expect(reusable.prefixFeatures).toEqual(
    appliedFeatures.slice(0, reusable.prefixFeatures.length),
  );
  expect(reusable.checkpoint).toBe(
    checkpoints.get(reusable.prefixFeatures.at(-1)!.featureId)!.checkpoint,
  );
  return reusable.prefixFeatures.map((feature) => feature.featureId);
}

test("an unchanged history reuses every applied feature", () => {
  expect(reusedFeatureIds(createBase())).toEqual([
    "feature_1",
    "feature_2",
    "feature_3",
  ]);
  expect(
    reusedFeatureIds(
      createBase(),
      (feature) => feature.featureId !== "feature_3",
    ),
  ).toEqual(["feature_1", "feature_2"]);
});

test("replacing a sketch reuses exactly the features before the first one naming it", () => {
  // A commit re-solves the sketch into a new record.
  const editedSketches = sketches.map((sketch) =>
    sketch.sketchId === "sketch_2"
      ? {
          ...sketch,
          sketch: {
            ...sketch.sketch,
            definition: structuredClone(sketch.sketch.definition),
          },
        }
      : sketch,
  );
  expect(reusedFeatureIds(createBase({ sketches: editedSketches }))).toEqual([
    "feature_1",
  ]);
  expect(
    reusedFeatureIds(createBase({ sketches: sketches.slice(1) })),
    "A removed sketch counts as changed.",
  ).toBeNull();
});

test("a variable change reuses exactly the features before the first one it resolves differently", () => {
  const withVariable = (variableId: string, valueText: string) =>
    variables.map((variable) =>
      variable.variableId === variableId
        ? { ...variable, valueText }
        : variable,
    );
  expect(
    reusedFeatureIds(
      createBase({ variables: withVariable("variable_depth", "15") }),
    ),
  ).toEqual(["feature_1"]);
  expect(
    reusedFeatureIds(
      createBase({ variables: withVariable("variable_width", "8") }),
    ),
    "A variable no feature or sketch reads keeps the whole prefix.",
  ).toEqual(["feature_1", "feature_2", "feature_3"]);
});

test("a variable change reuses exactly the features before the first one fed by a sketch it resolves differently (cadara-afj3)", () => {
  // The sketch records stay the same objects: only their resolved dimension
  // values differ, so the variable alone invalidates their consumers.
  expect(
    reusedFeatureIds(
      createBase({
        variables: variables.map((variable) =>
          variable.name === "gap" ? { ...variable, valueText: "3" } : variable,
        ),
      }),
    ),
  ).toEqual(["feature_1", "feature_2"]);
  expect(
    reusedFeatureIds(
      createBase({
        variables: variables.filter((variable) => variable.name !== "gap"),
      }),
    ),
    "A removed variable leaves the sketch dimension unresolved, which also counts as changed.",
  ).toEqual(["feature_1", "feature_2"]);
});

test("a tolerance or earlier history-order change shortens the prefix or rejects it", () => {
  expect(reusedFeatureIds(createBase({ modelingTolerance: 1e-5 }))).toBeNull();
  expect(
    reusedFeatureIds(createBase({ angularToleranceRadians: 0.2 })),
  ).toBeNull();
  // sketch_3 now precedes feature_2: features up to feature_1 keep their order.
  const reordered = [
    historyOrder[0]!,
    historyOrder[1]!,
    historyOrder[4]!,
    historyOrder[2]!,
    historyOrder[3]!,
    historyOrder[5]!,
  ];
  expect(reusedFeatureIds(createBase({ historyOrder: reordered }))).toEqual([
    "feature_1",
  ]);
});

test("a body rename rejects only the checkpoints holding that body", () => {
  const renamed = (bodyId: BodyId) =>
    new Map([...bodyLabels, [bodyId, "Renamed"]]);
  expect(
    reusedFeatureIds(createBase({ bodyLabels: renamed("body_3") })),
  ).toEqual(["feature_1", "feature_2"]);
  expect(
    reusedFeatureIds(createBase({ bodyLabels: renamed("body_later") })),
    "A label of a body no checkpoint holds keeps the whole prefix.",
  ).toEqual(["feature_1", "feature_2", "feature_3"]);
});

test("a feature or sketch relabel keeps the prefix unless a checkpoint holds diagnostics, whose messages name them (cadara-kv69)", () => {
  const relabelledFeatures = (featureId: FeatureId) =>
    features.map((feature) =>
      feature.featureId === featureId
        ? { ...feature, label: "Relabelled" }
        : feature,
    );
  const relabelledSketches = (sketchId: SketchId) =>
    createBase({
      sketches: sketches.map((sketch) =>
        sketch.sketchId === sketchId
          ? {
              ...sketch,
              label: "Relabelled",
              sketch: { ...sketch.sketch, label: "Relabelled" },
            }
          : sketch,
      ),
    });
  const all = ["feature_1", "feature_2", "feature_3"];
  expect(
    reusedFeatureIds(createBase(), undefined, relabelledFeatures("feature_1")),
  ).toEqual(all);
  expect(reusedFeatureIds(relabelledSketches("sketch_1"))).toEqual(all);

  // feature_2 and feature_3's checkpoints hold a diagnostic.
  const withDiagnostics = createStages(1);
  expect(
    reusedFeatureIds(
      createBase(),
      undefined,
      relabelledFeatures("feature_3"),
      withDiagnostics,
    ),
  ).toEqual(["feature_1", "feature_2"]);
  expect(
    reusedFeatureIds(
      relabelledSketches("sketch_2"),
      undefined,
      features,
      withDiagnostics,
    ),
  ).toEqual(["feature_1"]);

  expect(
    reusedFeatureIds(
      createBase(),
      undefined,
      relabelledFeatures("feature_1"),
      createStages(2),
    ),
    "Only feature_3's checkpoint holds a diagnostic, so feature_2's takes the relabel.",
  ).toEqual(["feature_1", "feature_2"]);
});
