import { expect, test } from "vitest";

import type { ImportCapabilities } from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";
import { validateImportPreparedActions } from "@/contracts/import/validation";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { planStudioFidelity } from "@/domain/import/onshape/fidelity-planner";
import {
  loftFeatureTranslator,
  sweepFeatureTranslator,
} from "@/domain/import/onshape/wave-a-feature-translators";
import {
  makeWaveARevolveBreadthCaptureBundle,
  makeWaveARevolveCaptureBundle,
} from "@/domain/import/onshape/wave-a-capture-fixtures";
import {
  makeWaveTLoftCaptureBundle,
  makeWaveTSweepCaptureBundle,
} from "@/domain/import/onshape/wave-t-capture-fixtures";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import {
  ImportDeferredMaterializer,
  orderedOutputKey,
} from "@/domain/import/orchestrator";

function parsedRead(bundle: unknown, elementId?: string) {
  const parsed = validateOnshapeCaptureBundle(bundle);
  if (!parsed.success) {
    throw new Error(`Synthetic Wave A capture must validate: ${JSON.stringify(parsed.issues)}`);
  }
  return readPartStudio(
    parsed.data,
    elementId ?? parsed.data.partStudios[0]!.elementId,
  );
}

function sourceFromBundle(bundle: unknown): ResolvedImportSource {
  return {
    name: "wave-t-sweep.onshape-capture.json",
    origin: {
      kind: "localFile",
      fileName: "wave-t-sweep.onshape-capture.json",
    },
    mediaType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(bundle)),
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

const capabilities: ImportCapabilities = {
  context: {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
  },
  modeling: {
    async bakeGeometry() {
      throw new Error("not used");
    },
    async reconstructMeshToBrep() {
      throw new Error("not used");
    },
  },
  sketch: {
    async convertVectorToSketch() {
      throw new Error("not used");
    },
  },
  assets: {
    async registerGeometryAsset() {
      throw new Error("not used");
    },
    async storeEmbeddedBinary() {
      throw new Error("not used");
    },
  },
};

function revolvePlan(
  bundle: ReturnType<typeof makeWaveARevolveBreadthCaptureBundle>,
) {
  return planStudioFidelity(parsedRead(bundle)).featurePlans.find(
    (plan) => plan.featureType === "revolve",
  )!;
}

function revolveFeature(bundle: ReturnType<typeof makeWaveARevolveBreadthCaptureBundle>) {
  return bundle.partStudios[0]!.features.features.find(
    (feature) => feature.featureType === "revolve",
  )!;
}

function parameter(
  feature: ReturnType<typeof revolveFeature>,
  parameterId: string,
) {
  return feature.parameters.find((candidate) => candidate.parameterId === parameterId)!;
}

test("Wave A FULL revolve resolves qNthElement to the same-sketch construction line", () => {
  const bundle = makeWaveARevolveCaptureBundle();
  bundle.partStudios[0]!.features.features.find(
    (feature) => feature.featureType === "revolve",
  )!.parameters.push({
    btType: "BTMParameterBoolean-144",
    parameterId: "fullRevolve",
    value: true,
  });
  const plan = planStudioFidelity(parsedRead(bundle))
    .featurePlans.find((candidate) => candidate.featureType === "revolve")!;

  expect(plan).toMatchObject({ tier: "parametric", reasonCodes: [] });
  expect(plan.plannedRevolve?.axis).toMatchObject({
    sketchFeatureId: "S_PROFILE",
  });
  expect(plan.plannedRevolve?.extent).toEqual({
    mode: "oneSide",
    end: { kind: "full" },
  });
});

test("Wave A revolve plans remote sketch axis, two-side extent, and deferred cut body scope", () => {
  const plan = revolvePlan(makeWaveARevolveBreadthCaptureBundle());

  expect(plan).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
    inputFeatureIds: ["S_PROFILE", "S_AXIS", "F_BASE"],
    plannedRevolve: {
      axis: { sketchFeatureId: "S_AXIS" },
      extent: {
        mode: "twoSide",
        firstEnd: { kind: "blind", direction: "counterClockwise" },
        secondEnd: { kind: "blind", direction: "clockwise" },
      },
      operation: { source: "literal", value: "cut" },
      boolean: { kind: "deferredBody", sourceFeatureId: "F_BASE" },
    },
  });
});

test.each([
  ["ADD", "join"],
  ["REMOVE", "cut"],
  ["INTERSECT", "intersect"],
] as const)("Wave A revolve maps %s through deferred body lineage", (operationType, operation) => {
  const bundle = makeWaveARevolveBreadthCaptureBundle();
  parameter(revolveFeature(bundle), "operationType").value = operationType;

  expect(revolvePlan(bundle).plannedRevolve).toMatchObject({
    operation: { source: "literal", value: operation },
    boolean: { kind: "deferredBody", sourceFeatureId: "F_BASE" },
  });
});

test("Wave A revolve maps a symmetric blind extent", () => {
  const bundle = makeWaveARevolveBreadthCaptureBundle();
  const feature = revolveFeature(bundle);
  parameter(feature, "hasSecondDirection").value = false;
  parameter(feature, "endBound").value = "SYMMETRIC";

  expect(revolvePlan(bundle).plannedRevolve?.extent).toMatchObject({
    mode: "symmetric",
    end: { kind: "blind" },
  });
});

test.each([
  ["bodyType", "SURFACE", "revolve-body-type-unsupported"],
  ["operationType", "OFFSET", "revolve-operation-unsupported"],
  ["entities", "missing-profile", "revolve-profile-unresolved"],
  ["axis", "canonical-datum-axis", "revolve-axis-unresolved"],
  ["endBound", "UP_TO_FACE", "revolve-extent-unsupported"],
] as const)("Wave A revolve reports the exact %s degradation", (parameterId, value, reason) => {
  const bundle = makeWaveARevolveBreadthCaptureBundle();
  const feature = revolveFeature(bundle);
  const target = parameter(feature, parameterId);
  if (parameterId === "entities") {
    target.queries = [{ queryString: 'query = qSketchRegion(id + "S_MISSING", true);' }];
  } else if (parameterId === "axis") {
    target.queries = [{ queryString: 'query = qCreatedBy(id + "TopaxisOp", EntityType.EDGE);' }];
  } else {
    target.value = value;
  }

  expect(revolvePlan(bundle)).toMatchObject({
    tier: "baked",
    reasonCodes: [reason],
  });
});

function makeFallbackRead(featureType: "sweep" | "loft"): StudioReadResult {
  return {
    studio: {
      elementId: "e1",
      name: "Wave A synthetic",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "synthetic" },
      resolvedReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features: [{
      featureType,
      featureId: `F_${featureType.toUpperCase()}`,
      name: featureType,
      parameters: [],
    }],
    solvedSketchesByFeatureId: new Map(),
    diagnostics: [],
  };
}

function fallbackPlan(featureType: "sweep" | "loft") {
  const read = makeFallbackRead(featureType);
  const translator = {
    sweep: sweepFeatureTranslator,
    loft: loftFeatureTranslator,
  }[featureType];
  return translator.plan({
    feature: read.features[0]!,
    label: featureType,
    onshapeSuppressed: false,
    read,
    references: new Map(),
    state: {
      sketchPlansByFeatureId: new Map(),
      bodyProducingFeatureIds: [],
    },
  });
}

function waveTLoftTranslatorPlan() {
  const read = parsedRead(makeWaveTLoftCaptureBundle());
  const feature = read.features.find((candidate) => candidate.featureType === "loft")!;
  return loftFeatureTranslator.plan({
    feature,
    label: feature.name ?? feature.featureId,
    onshapeSuppressed: false,
    read,
    references: new Map(),
    state: {
      sketchPlansByFeatureId: new Map([
        ["WT_LOFT_A", { tier: "parametric", planeKey: "xy" }],
        ["WT_LOFT_B", { tier: "parametric", planeKey: "xy" }],
      ]),
      bodyProducingFeatureIds: [],
    },
  });
}

test("Wave T loft resolves each ordered array entry to one sketch region", () => {
  expect(waveTLoftTranslatorPlan()).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
    inputFeatureIds: ["WT_LOFT_A", "WT_LOFT_B"],
    plannedLoft: {
      profiles: [
        { sketchFeatureId: "WT_LOFT_A" },
        { sketchFeatureId: "WT_LOFT_B" },
      ],
    },
  });
});

test("Wave T loft accepts the ordered wireProfilesArray spelling", () => {
  const bundle = makeWaveTLoftCaptureBundle();
  const loft = bundle.partStudios[0]!.features.features.find(
    (candidate) => candidate.featureType === "loft",
  )!;
  const profiles = loft.parameters.find(
    (candidate) => candidate.parameterId === "sheetProfilesArray",
  ) as Record<string, unknown>;
  profiles.parameterId = "wireProfilesArray";
  for (const item of profiles.items as { parameters: Record<string, unknown>[] }[]) {
    item.parameters[0]!.parameterId = "wireProfileEntities";
  }

  const read = parsedRead(bundle);
  const feature = read.features.find((candidate) => candidate.featureType === "loft")!;
  const plan = loftFeatureTranslator.plan({
    feature,
    label: feature.name ?? feature.featureId,
    onshapeSuppressed: false,
    read,
    references: new Map(),
    state: {
      sketchPlansByFeatureId: new Map([
        ["WT_LOFT_A", { tier: "parametric", planeKey: "xy" }],
        ["WT_LOFT_B", { tier: "parametric", planeKey: "xy" }],
      ]),
      bodyProducingFeatureIds: [],
    },
  });
  expect(plan).toMatchObject({ tier: "parametric", reasonCodes: [] });
});

test("Wave T loft rejects an array entry that resolves to multiple regions", () => {
  const bundle = makeWaveTLoftCaptureBundle();
  const firstSketch = bundle.partStudios[0]!.sketches.sketches.find(
    (candidate) => candidate.featureId === "WT_LOFT_A",
  )!;
  firstSketch.entities.push({
    sketchEntityId: "WT_LOFT_A_second_circle",
    sketchEntityType: "skCircle",
    geometry: { center3d: { x: 0.02, y: 0, z: 0 }, radius: 0.002 },
    isConstruction: false,
  });

  const read = parsedRead(bundle);
  const feature = read.features.find((candidate) => candidate.featureType === "loft")!;
  const plan = loftFeatureTranslator.plan({
    feature,
    label: feature.name ?? feature.featureId,
    onshapeSuppressed: false,
    read,
    references: new Map(),
    state: {
      sketchPlansByFeatureId: new Map([
        ["WT_LOFT_A", { tier: "parametric", planeKey: "xy" }],
        ["WT_LOFT_B", { tier: "parametric", planeKey: "xy" }],
      ]),
      bodyProducingFeatureIds: [],
    },
  });
  expect(plan).toMatchObject({
    tier: "baked",
    reasonCodes: ["loft-profile-unresolved"],
  });
});

test.each([
  ["addGuides", true, "loft-guides-unsupported"],
  ["startCondition", "MATCH_TANGENT", "loft-conditions-unsupported"],
  ["makePeriodic", true, "loft-periodicity-unsupported"],
] as const)("Wave T loft reports the exact %s degradation", (parameterId, value, reason) => {
  const bundle = makeWaveTLoftCaptureBundle();
  const loft = bundle.partStudios[0]!.features.features.find(
    (candidate) => candidate.featureType === "loft",
  )!;
  const existing = loft.parameters.find(
    (candidate) => candidate.parameterId === parameterId,
  ) as Record<string, unknown> | undefined;
  if (existing) {
    existing.value = value;
  } else {
    loft.parameters.push(
      typeof value === "boolean"
        ? { btType: "BTMParameterBoolean-144", parameterId, value }
        : { btType: "BTMParameterEnum-145", parameterId, value },
    );
  }
  const read = parsedRead(bundle);
  const feature = read.features.find((candidate) => candidate.featureType === "loft")!;
  const plan = loftFeatureTranslator.plan({
    feature,
    label: feature.name ?? feature.featureId,
    onshapeSuppressed: false,
    read,
    references: new Map(),
    state: {
      sketchPlansByFeatureId: new Map([
        ["WT_LOFT_A", { tier: "parametric", planeKey: "xy" }],
        ["WT_LOFT_B", { tier: "parametric", planeKey: "xy" }],
      ]),
      bodyProducingFeatureIds: [],
    },
  });
  expect(plan).toMatchObject({ tier: "baked", reasonCodes: [reason] });
});

test("Wave T provider promotes the captured cPlane sketch and emits ordered deferred loft profiles", async () => {
  const source = sourceFromBundle(makeWaveTLoftCaptureBundle());
  const historyCapabilities: ImportCapabilities = {
    ...capabilities,
    history: {
      async evaluateHistoryProbe(input) {
        return {
          steps: Array.from(
            { length: input.actions.orderedActions?.length ?? 0 },
            () => ({ status: "rebuilt" as const, signatures: [] }),
          ),
        };
      },
    },
  };
  const review = await onshapeImportProvider.review({
    source,
    capabilities: historyCapabilities,
  });
  expect(review.providerReview.studios[0]?.tierCounts).toEqual({
    parametric: 4,
    baked: 0,
    geometryOnly: 0,
  });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: historyCapabilities,
  });
  const loft = actions.createFeatures?.find(
    (candidate) => candidate.definition.kind === "loft",
  );
  expect(loft?.definition).toMatchObject({
    kind: "loft",
    parameters: {
      operationIntent: { source: "literal", value: "create" },
      participants: [{
        role: "profile",
        targets: [
          { kind: "regionOf", actionIndex: 0 },
          { kind: "regionOf", actionIndex: 2 },
        ],
      }],
    },
  });
  expect(validateImportPreparedActions(actions).success).toBe(true);
});

test("Wave T sweep resolves one region profile and one solved sketch curve", () => {
  const plan = planStudioFidelity(parsedRead(makeWaveTSweepCaptureBundle()))
    .featurePlans.find((candidate) => candidate.featureType === "sweep")!;

  expect(plan).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
    inputFeatureIds: ["WT_SWEEP_PROFILE", "WT_SWEEP_PATH"],
    plannedSweep: {
      sketchFeatureId: "WT_SWEEP_PROFILE",
      path: { sketchFeatureId: "WT_SWEEP_PATH" },
    },
  });
});

test("Wave T sweep keeps a multi-curve sketch path baked", () => {
  const bundle = makeWaveTSweepCaptureBundle();
  const pathSketch = bundle.partStudios[0]!.sketches.sketches.find(
    (candidate) => candidate.featureId === "WT_SWEEP_PATH",
  )!;
  pathSketch.entities.push({
    sketchEntityId: "WT_SWEEP_PATH_second_circle",
    sketchEntityType: "skCircle",
    geometry: { center3d: { x: 0.01, y: 0, z: 0 }, radius: 0.002 },
    isConstruction: false,
  });

  const plan = planStudioFidelity(parsedRead(bundle)).featurePlans.find(
    (candidate) => candidate.featureType === "sweep",
  )!;
  expect(plan).toMatchObject({
    tier: "baked",
    reasonCodes: ["sweep-path-unresolved"],
  });
});

test("Wave T provider emits deferred sweep profile and path participants", async () => {
  const source = sourceFromBundle(makeWaveTSweepCaptureBundle());
  const review = await onshapeImportProvider.review({ source, capabilities });
  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  const sweep = actions.createFeatures?.find(
    (candidate) => candidate.definition.kind === "sweep",
  );

  expect(sweep?.definition).toMatchObject({
    kind: "sweep",
    parameters: {
      operationIntent: { source: "literal", value: "create" },
      participants: [
        {
          role: "profile",
          targets: [{ kind: "regionOf", actionIndex: 0 }],
        },
        {
          role: "path",
          targets: [
            {
              kind: "sketchEntity",
              sketchId: { kind: "sketchIdOf", actionIndex: 1 },
            },
          ],
        },
      ],
    },
  });
  expect(validateImportPreparedActions(actions).success).toBe(true);
});

test("Sweep path sketchIdOf materializes to the live committed sketch id", async () => {
  const outputRecords = new Map([
    [orderedOutputKey(1), { sketchId: "sketch_live_path" }],
  ]);
  const materializer = new ImportDeferredMaterializer({
    modelingService: {
      async getCurrentDocumentSnapshot() {
        throw new Error("not used");
      },
      async buildNativeExactBrepPayload() {
        throw new Error("not used");
      },
    },
    outputRecords,
  });
  const request = await materializer.materializeFeatureRequest(
    {
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
      baseRevisionId: "rev_1",
      featureLabel: "Sweep",
      definition: {
        kind: "sweep",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          operationIntent: { source: "literal", value: "create" },
          participants: [
            {
              role: "profile",
              targets: [
                {
                  kind: "region",
                  sketchId: "sketch_profile",
                  regionId: "region_profile",
                },
              ],
            },
            {
              role: "path",
              targets: [
                {
                  kind: "sketchEntity",
                  sketchId: { kind: "sketchIdOf", actionIndex: 1 },
                  entityId: "entity_path",
                },
              ],
            },
          ],
        },
      },
    },
    { kind: "createFeature", index: 0 },
  );

  expect(request.definition).toMatchObject({
    kind: "sweep",
    parameters: {
      participants: [
        { role: "profile" },
        {
          role: "path",
          targets: [
            {
              kind: "sketchEntity",
              sketchId: "sketch_live_path",
              entityId: "entity_path",
            },
          ],
        },
      ],
    },
  });
});


test("Wave A sweep degrades specifically when an Onshape path cannot be losslessly resolved", () => {
  expect(fallbackPlan("sweep")).toMatchObject({
    tier: "baked",
    reasonCodes: ["sweep-path-unresolved"],
  });
});

test("Wave A loft degrades specifically when ordered Onshape profile arrays cannot be resolved", () => {
  expect(fallbackPlan("loft")).toMatchObject({
    tier: "baked",
    reasonCodes: ["loft-profile-unresolved"],
  });
});
