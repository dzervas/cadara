import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test, expect } from "vitest";

import type {
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type {
  OnshapeCaptureBundleV2,
  OnshapeRollbackSnapshot,
} from "@/contracts/import/onshape-capture-bundle";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateImportPreparedActions } from "@/contracts/import/validation";
import { validateFeatureDefinitionAuthoredValueInvariants } from "@/contracts/modeling/feature-authored-values";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createBuiltinImportProviderRegistry } from "@/domain/import/builtin-provider-composition";
import {
  assembleFixtureCaptureBundle,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import {
  onshapeImportProvider,
  cascadeUnavailableActionConsumers,
  rebaseExactBodyOwnerForPreparedActions,
  rebaseHistoricalTopologySelectorForPreparedActions,
} from "@/domain/import/onshape/provider";
import type { HistoricalTopologyPlanSelector } from "@/domain/import/historical-topology-selector";
import type { FeaturePlan } from "@/domain/import/onshape/fidelity-planner";
import { makeWaveARevolveCaptureBundle } from "@/domain/import/onshape/wave-a-capture-fixtures";
import { makeWaveWPatternCaptureBundle } from "@/domain/import/onshape/wave-w-pattern-capture-fixtures";
import {
  makeWaveXClosedHollowShellCaptureBundle,
  makeWaveXSurfaceExtrudeCaptureBundle,
} from "@/domain/import/onshape/wave-x-capture-fixtures";
import {
  createImportCapabilities,
  TopologyApplyRematchError,
} from "@/domain/import/orchestrator";
import type { ImportDeferredTopologyRef } from "@/contracts/import/actions";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { createGeometryAssetRecordFromReference } from "@/contracts/modeling/geometry-assets";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OCC_KERNEL_CAPABILITIES } from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";
import type { BodyId, EdgeId, FaceId, VertexId } from "@/contracts/shared/ids";

// Lane: logic. Seam: preparation replaces exploratory review action positions
// with the final emitted source-feature actions before the import contract leaves
// the provider; checkpoints may shift every later position.
test("preparation rebases historical selector source features after checkpoint reordering", () => {
  const selector: HistoricalTopologyPlanSelector = {
    kind: "historicalTopologyOf",
    expectedKind: "face",
    capturedSignature: {
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
      boundingBox: { low: [0, 0, 0], high: [1, 1, 0] },
    },
    // Exploratory review had extra checkpoints before both actions.
    witnessActionIndex: 7,
    successorActionIndexes: [13],
    witnessSourceFeatureId: "Extrude3",
    successorSourceFeatureIds: ["Shell1"],
    source: {
      consumerFeatureId: "Cutter",
      parameterId: "sketchPlane",
      deterministicId: "JQi",
    },
  };
  const finalActionLabels = ["walls", "checkpoint", "Extrude 3", "Sketch 2", "Shell 1", "Cutter"];
  const rebased = rebaseHistoricalTopologySelectorForPreparedActions({
    selector,
    actionIndexesBySourceFeatureId: new Map([
      ["Extrude3", [2]],
      ["Shell1", [4]],
    ]),
    orderedActions: [
      { kind: "addDocumentVariable", index: 0 },
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 2 },
      { kind: "commitSketch", index: 1 },
    ],
    consumerActionIndex: 5,
  });

  expect(rebased.witnessActionIndex).toBe(2);
  expect(rebased.successorActionIndexes).toEqual([4]);
  expect(finalActionLabels[rebased.witnessActionIndex]).toBe("Extrude 3");
  expect(finalActionLabels[rebased.successorActionIndexes[0]!]).toBe("Shell 1");
  expect(rebased).not.toHaveProperty("witnessSourceFeatureId");
  expect(rebased).not.toHaveProperty("successorSourceFeatureIds");
});

test("preparation fails when a historical selector source feature was not emitted", () => {
  const selector = {
    kind: "historicalTopologyOf",
    expectedKind: "face",
    capturedSignature: {
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
      boundingBox: { low: [0, 0, 0], high: [1, 1, 0] },
    },
    witnessActionIndex: 7,
    successorActionIndexes: [],
    witnessSourceFeatureId: "missing-witness",
    successorSourceFeatureIds: [],
    source: { consumerFeatureId: "Cutter", parameterId: "sketchPlane", deterministicId: "JQi" },
  } satisfies HistoricalTopologyPlanSelector;

  expect(() => rebaseHistoricalTopologySelectorForPreparedActions({
    selector,
    actionIndexesBySourceFeatureId: new Map(),
    orderedActions: [{ kind: "commitSketch", index: 0 }],
    consumerActionIndex: 1,
  })).toThrow("missing-witness for Cutter:sketchPlane:JQi must map to exactly one emitted action");
});

test("preparation rebases review-only Split owners after parametric producers emit", () => {
  const orderedActions = [
    { kind: "commitSketch" as const, index: 0 },
    { kind: "createFeature" as const, index: 0 },
    { kind: "commitSketch" as const, index: 1 },
    { kind: "createFeature" as const, index: 1 },
    { kind: "createFeature" as const, index: 2 },
  ];
  const rebase = (producerSourceFeatureId: string, deterministicId: string) =>
    rebaseExactBodyOwnerForPreparedActions({
      target: { kind: "bodyOfSourceFeature", producerSourceFeatureId, deterministicId },
      actionIndexesBySourceFeatureId: new Map([
        ["Extrude3", [1]],
        ["Extrude4", [3]],
      ]),
      exactBodyProducerActionIndexes: new Map([
        ["Extrude3", 1],
        ["Extrude4", 3],
      ]),
      orderedActions,
      consumerActionIndex: 4,
    });

  expect(rebase("Extrude3", "JND")).toEqual({ kind: "bodyOf", actionIndex: 1 });
  expect(rebase("Extrude4", "JaD")).toEqual({ kind: "bodyOf", actionIndex: 3 });
});

test("preparation fails when an exact Split owner was not emitted", () => {
  expect(() => rebaseExactBodyOwnerForPreparedActions({
    target: { kind: "bodyOfSourceFeature", producerSourceFeatureId: "Extrude4", deterministicId: "JaD" },
    actionIndexesBySourceFeatureId: new Map(),
    exactBodyProducerActionIndexes: new Map(),
    orderedActions: [{ kind: "createFeature", index: 0 }],
    consumerActionIndex: 1,
  })).toThrow("Extrude4 must map to exactly one emitted action");
});

// Lane: logic. Seam: fixed-point review invalidates consumers whose exact
// source-action dependencies disappear after containment demotes a producer.
test("producer demotion cascades through exact body, historical, and replay consumers", () => {
  const featurePlan = (
    onshapeFeatureId: string,
    overrides: Partial<FeaturePlan> = {},
  ): FeaturePlan => ({
    onshapeFeatureId,
    featureType: "fixture",
    label: onshapeFeatureId,
    tier: "parametric",
    target: { kind: "feature" },
    reasonCodes: [],
    suppressed: false,
    inputDependencies: [],
    inputFeatureIds: [],
    ...overrides,
  });
  const plans = [
    featurePlan("producer", {
      tier: "baked",
      target: { kind: "suppressed" },
      reasonCodes: ["feature-kernel-build-failed"],
      suppressed: true,
    }),
    featurePlan("split", {
      plannedAdvancedSolid: {
        kind: "split",
        parameters: {
          participants: [{
            role: "targetBody",
            targets: [{
              kind: "bodyOfSourceFeature",
              producerSourceFeatureId: "producer",
              deterministicId: "body_target",
            }],
          }],
        },
      } as never,
    }),
    featurePlan("historical-sketch", {
      featureType: "newSketch",
      target: {
        kind: "sketch",
        planeKey: "xy",
        probedFaceSelector: {
          kind: "historicalTopologyOf",
          expectedKind: "face",
          capturedSignature: { entityClass: "face", geometryType: "plane" },
          witnessActionIndex: 1,
          successorActionIndexes: [],
          witnessSourceFeatureId: "producer",
          successorSourceFeatureIds: [],
          source: {
            consumerFeatureId: "historical-sketch",
            parameterId: "sketchPlane",
            deterministicId: "face_target",
          },
        },
      } as never,
    }),
    featurePlan("replay", {
      plannedFeatureReplay: {
        kind: "linear",
        sourceFeatureIds: ["split"],
        direction: { kind: "construction", constructionId: "construction_x_axis" as never },
        instanceCount: 2,
        spacing: 10,
        oppositeDirection: false,
      },
    }),
    featurePlan("independent"),
  ];

  const cascaded = cascadeUnavailableActionConsumers(plans);
  const tierOf = (featureId: string) =>
    cascaded.find((plan) => plan.onshapeFeatureId === featureId);

  expect(tierOf("producer")?.reasonCodes).toEqual(["feature-kernel-build-failed"]);
  for (const featureId of ["split", "historical-sketch", "replay"]) {
    expect(tierOf(featureId)).toMatchObject({
      tier: "baked",
      target: { kind: "suppressed" },
      reasonCodes: ["downstream-of-baked"],
      suppressed: true,
    });
  }
  expect(tierOf("independent")?.tier).toBe("parametric");
});
function sourceFromBundle(bundle: unknown): ResolvedImportSource {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  return {
    name: "mounts.onshape-capture.json",
    origin: { kind: "localFile", fileName: "mounts.onshape-capture.json" },
    mediaType: "application/json",
    bytes,
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
    async bakeGeometry(input) {
      return {
        assetId: "asset_test_bake" as never,
        format: input.format,
        hash: "sha256:test-bake" as never,
        byteLength: input.bytes.byteLength,
      };
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
  // history probe intentionally absent (probe-less v1).
};

function createRevisionAgnosticRealSolver(): SketchSolverAdapter {
  return new Proxy({} as SketchSolverAdapter, {
    get(_target, property) {
      return (request: { documentId: DocumentId; revisionId: RevisionId }) => {
        const adapter = new SketchConstraintSolverAdapter({
          documentId: request.documentId,
          revisionId: request.revisionId,
        });
        const method = (adapter as unknown as Record<string, unknown>)[
          property as string
        ] as (input: unknown) => unknown;
        return method.call(adapter, request);
      };
    },
  });
}

type CustomOpenCascadeMainJSForImportTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let realOccImportTestRuntime: Promise<OpenCascadeInstance> | null = null;

function loadRealOccForImportTest() {
  realOccImportTestRuntime ??= (async () => {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJSForImportTest;
    };
    const wasmBinary = new Uint8Array(
      await readFile(new URL("../../../../public/cadara-occ.wasm", import.meta.url)),
    );
    return new module.default({ wasmBinary });
  })();
  return realOccImportTestRuntime;
}

function createRealOccModelingService(oc: OpenCascadeInstance) {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      documentId: "doc_workspace" as DocumentId,
      revisionId,
    });
  const service = createModelingService(
    new OpenCascadeKernelAdapter({
      solverAdapter: createSolver(null),
      solverAdapterFactory: createSolver,
      getOpenCascadeInstance: async () => oc,
    }),
    { currentDocumentId: "doc_workspace" },
  );
  return service;
}

function capabilitiesWithRealKernelProbe(): ImportCapabilities {
  return {
    ...capabilities,
    history: createKernelHistoryProbeSession({
      createService() {
        const service = createModelingService(
          new MockKernelAdapter({
            solverAdapter: createRevisionAgnosticRealSolver(),
          }),
          { currentDocumentId: "doc_workspace" },
        );
        return {
          ...service,
          async buildNativeExactBrepPayload(_input) {
            return {
              kind: "nativeTopologyPayload" as const,
              payload: createOccNativeExactBrepPayloadFromShimPayload({
                revisionId: "rev_probe_fixture" as RevisionId,
                target: {
                  kind: "body",
                  bodyId: "body_signature_fixture_box" as BodyId,
                },
                bodyId: "body_signature_fixture_box" as BodyId,
                bodyLabel: "Probe fixture box",
                nativePayload: parseNativeShimPayloadJson(
                  JSON.stringify(boxFixture.exactBrep),
                ),
              }),
              diagnostics: [],
            };
          },
        };
      },
    }),
  };
}

function makeFaceSketchBundle() {
  return {
    formatVersion: 1,
    provenance: {
      capturedAt: "2026-07-08T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "d".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [
      {
        elementId: "e1",
        name: "Probe",
        features: {
          features: [
            {
              featureType: "newSketch",
              featureId: "S_BASE",
              name: "Base sketch",
            },
            {
              featureType: "extrude",
              featureId: "E_BASE",
              name: "Base extrude",
              parameters: [
                {
                  parameterId: "entities",
                  queries: [
                    {
                      queryString:
                        'query = qSketchRegion(id + "S_BASE", true);',
                    },
                  ],
                },
                { parameterId: "endBound", value: "BLIND" },
                { parameterId: "depth", expression: "3 mm", value: 0.003 },
                { parameterId: "operationType", value: "NEW" },
              ],
            },
            {
              featureType: "newSketch",
              featureId: "S_FACE",
              name: "Face sketch",
              parameters: [
                {
                  parameterId: "sketchPlane",
                  queries: [{ deterministicIds: ["face_ref"] }],
                },
              ],
            },
            { featureType: "chamfer", featureId: "CHAMFER", name: "Chamfer" },
          ],
        },
        sketches: {
          sketches: [
            {
              featureId: "S_BASE",
              entities: [
                {
                  sketchEntityId: "circle_base",
                  sketchEntityType: "skCircle",
                  geometry: {
                    center3d: { x: 0.0005, y: 0.001, z: 0 },
                    radius: 0.0004,
                  },
                  isConstruction: false,
                },
              ],
            },
            {
              featureId: "S_FACE",
              entities: [
                {
                  sketchEntityId: "circle_1",
                  sketchEntityType: "skCircle",
                  geometry: {
                    center3d: { x: 0.0005, y: 0.001, z: 0.003 },
                    radius: 0.0001,
                  },
                  isConstruction: false,
                },
              ],
            },
          ],
        },
        parts: null,
        featureSpecs: { present: false, reason: "n/a" },
        profileEvidence: [{
          consumingFeatureId: "E_BASE",
          parameterId: "entities",
          queryIndex: 0,
          resultIndex: 0,
          deterministicId: "provider-base-profile",
          evaluatedAt: "historyPoint",
          kind: "sketchRegion",
          sourceSketchFeatureId: "S_BASE",
          interiorPoint3d: [0.0005, 0.001, 0],
        }],
        profileEvidenceSchemaVersion: 3,
        profileEvidenceManifest: [{
          consumingFeatureId: "E_BASE", parameterId: "entities", queryIndex: 0,
          sourceQueryString: 'query = qSketchRegion(id + "S_BASE", true);',
          kind: "faceResults", emittedRecordCount: 1, completed: true,
        }],
        resolvedReferences: [
          {
            deterministicId: "face_ref",
            evaluatedAt: "finalState",
            signature: {
              entityClass: "face",
              geometryType: "plane",
              definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
              centroid: [0.0005, 0.001, 0.003],
              boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
            },
          },
        ],
        groundTruth: {
          hasBodies: true,
          tessellationTolerance: 0.001,
          tessellatedFaces: {},
          step: "",
        },
        rollbackSnapshots: null,
      },
    ],
  };
}

test("provider.spec.ts ignores profile evidence without the current completion manifest", async () => {
  const bundle = makeWaveWPatternCaptureBundle();
  const studio = bundle.partStudios.find((candidate) => candidate.elementId === "wave-w-pattern-linear")!;
  studio.profileEvidenceSchemaVersion = 2;
  delete studio.profileEvidenceManifest;

  const review = await onshapeImportProvider.review({ source: sourceFromBundle(bundle), capabilities });
  const plan = review.providerReview.studios
    .find((candidate) => candidate.elementId === studio.elementId)
    ?.featurePlans.find((candidate) => candidate.onshapeFeatureId === "E_LINEAR_BASE");
  expect(plan).toMatchObject({ tier: "baked", reasonCodes: ["needs-region-resolution"] });
});

function makeFaceSketchExtrudeBundle(): OnshapeCaptureBundleV2 {
  const bundle = structuredClone(makeFaceSketchBundle()) as unknown as OnshapeCaptureBundleV2;
  const studio = bundle.partStudios[0]!;
  const features = (studio.features as { features: Record<string, unknown>[] }).features;
  const chamferIndex = features.findIndex((feature) => feature.featureId === "CHAMFER");
  features.splice(chamferIndex, 0, {
    featureType: "extrude",
    featureId: "E_FACE",
    name: "Face extrude",
    parameters: [
      {
        parameterId: "entities",
        queries: [{ queryString: 'query = qSketchRegion(id + "S_FACE", true);' }],
      },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: "1 mm", value: 0.001 },
      { parameterId: "operationType", value: "NEW" },
    ],
  });
  studio.profileEvidence?.push({
    consumingFeatureId: "E_FACE",
    parameterId: "entities",
    queryIndex: 0,
    resultIndex: 0,
    deterministicId: "provider-face-profile",
    evaluatedAt: "historyPoint",
    kind: "sketchRegion",
    sourceSketchFeatureId: "S_FACE",
    interiorPoint3d: [0.0005, 0.001, 0.003],
  });
  studio.profileEvidenceManifest?.push({
    consumingFeatureId: "E_FACE",
    parameterId: "entities",
    queryIndex: 0,
    sourceQueryString: 'query = qSketchRegion(id + "S_FACE", true);',
    kind: "faceResults",
    emittedRecordCount: 1,
    completed: true,
  });
  studio.resolvedReferences.push({
    deterministicId: "face_ref",
    evaluatedAt: "historyPoint",
    consumingFeatureId: "S_FACE",
    signature: {
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
      centroid: [0.0005, 0.001, 0.003],
      boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
    },
  });
  return bundle;
}


function makeDurableSubtopologyBundle(): OnshapeCaptureBundleV2 {
  const bundle = makeSegmentedCheckpointBundle();
  const studio = bundle.partStudios[0]!;
  const features = (studio.features as { features: Record<string, unknown>[] }).features;
  const chamfer = features.find((feature) => feature.featureId === "CHAMFER")!;
  Object.assign(chamfer, {
    parameters: [
      {
        parameterId: "entities",
        queries: [{ deterministicIds: ["edge_ref"] }],
      },
      { parameterId: "chamferMethod", value: "FACE_OFFSET" },
      { parameterId: "chamferType", value: "EQUAL_OFFSETS" },
      { parameterId: "width", expression: "1 mm", value: 0.001 },
    ],
  });
  studio.resolvedReferences.push({
    deterministicId: "edge_ref",
    evaluatedAt: "historyPoint",
    consumingFeatureId: "CHAMFER",
    signature: {
      entityClass: "edge",
      geometryType: "line",
      definingData: { direction: [1, 0, 0] },
      centroid: [0.0005, 0, 0.003],
      boundingBox: { low: [0, 0, 0.003], high: [0.001, 0, 0.003] },
    },
  });
  return bundle;
}

function makeSegmentedCheckpointBundle(): OnshapeCaptureBundleV2 {
  const bundle = structuredClone(makeFaceSketchBundle()) as unknown as OnshapeCaptureBundleV2;
  bundle.formatVersion = 2;
  const studio = bundle.partStudios[0]!;
  const rawFeatures = studio.features as { features: Record<string, unknown>[] };
  const baseExtrude = rawFeatures.features.find(
    (feature) => feature.featureId === "E_BASE",
  )!;
  rawFeatures.features.splice(2, 0, {
    ...structuredClone(baseExtrude),
    featureId: "E_INDEPENDENT",
    name: "Independent extrude",
  });
  rawFeatures.features.push(
    {
      featureType: "assignVariable",
      featureId: "V_AFTER",
      name: "After checkpoint",
      parameters: [
        { parameterId: "name", value: "afterCheckpoint" },
        { parameterId: "value", expression: "4 mm", value: 0.004 },
      ],
    },
    {
      ...structuredClone(baseExtrude),
      featureId: "E_AFTER",
      name: "After checkpoint extrude",
    },
    {
      featureType: "chamfer",
      featureId: "CHAMFER_TWO",
      name: "Second chamfer",
    },
  );

  const body = (id: string, extent: number) => ({
    id,
    faces: [{
      id: `${id}-face`,
      facets: [{
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: extent, y: 0, z: 0 },
          { x: extent, y: 1, z: 1 },
        ],
      }],
    }],
  });
  const snapshot = (
    featureId: string,
    bodies: ReturnType<typeof body>[],
  ): OnshapeRollbackSnapshot => ({
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: { bodies },
  });
  studio.rollbackSnapshots = [
    snapshot("S_BASE", []),
    snapshot("E_BASE", [body("A", 1)]),
    snapshot("E_INDEPENDENT", [body("A", 1), body("B", 1)]),
    snapshot("S_FACE", [body("A", 1), body("B", 1)]),
    snapshot("CHAMFER", [body("A", 2), body("B", 1)]),
    snapshot("V_AFTER", [body("A", 2), body("B", 1)]),
    snapshot("E_AFTER", [body("A", 2), body("B", 1), body("C", 1)]),
    snapshot("CHAMFER_TWO", [body("A", 2), body("B", 2), body("C", 1)]),
  ];
  studio.profileEvidence?.push(
    {
      consumingFeatureId: "E_INDEPENDENT", parameterId: "entities", queryIndex: 0,
      resultIndex: 0, deterministicId: "provider-independent-profile",
      evaluatedAt: "historyPoint", kind: "sketchRegion", sourceSketchFeatureId: "S_BASE",
      interiorPoint3d: [0.0005, 0.001, 0],
    },
    {
      consumingFeatureId: "E_AFTER", parameterId: "entities", queryIndex: 0,
      resultIndex: 0, deterministicId: "provider-after-profile",
      evaluatedAt: "historyPoint", kind: "sketchRegion", sourceSketchFeatureId: "S_BASE",
      interiorPoint3d: [0.0005, 0.001, 0],
    },
  );
  studio.profileEvidenceManifest?.push(
    ...["E_INDEPENDENT", "E_AFTER"].map((consumingFeatureId) => ({
      consumingFeatureId, parameterId: "entities", queryIndex: 0,
      sourceQueryString: 'query = qSketchRegion(id + "S_BASE", true);',
      kind: "faceResults" as const, emittedRecordCount: 1, completed: true as const,
    })),
  );
  studio.groundTruth = {
    hasBodies: true,
    tessellationTolerance: 0.0001,
    tessellatedFaces: {
      bodies: [body("A", 2), body("B", 2), body("C", 1)],
    },
    step: "",
  };
  return bundle;
}

function makeCapturedFrameCheckpointBundle(): OnshapeCaptureBundleV2 {
  const bundle = structuredClone(makeFaceSketchBundle()) as unknown as OnshapeCaptureBundleV2;
  bundle.formatVersion = 2;
  const studio = bundle.partStudios[0]!;
  const rawFeatures = studio.features as { features: Record<string, unknown>[] };
  const baseExtrude = rawFeatures.features.find(
    (feature) => feature.featureId === "E_BASE",
  )!;
  rawFeatures.features = [
    rawFeatures.features[0]!,
    baseExtrude,
    {
      featureType: "transform",
      featureId: "TRANSFORM",
      name: "Transform checkpoint",
      parameters: [
        { parameterId: "transformType", value: "ROTATION" },
        { parameterId: "entities", queries: [{ deterministicIds: ["A"] }] },
      ],
    },
    rawFeatures.features.find((feature) => feature.featureId === "S_FACE")!,
    {
      ...structuredClone(baseExtrude),
      featureId: "E_AFTER",
      name: "Extrude after checkpoint",
      parameters: [
        {
          parameterId: "entities",
          queries: [{ queryString: 'query = qSketchRegion(id + "S_FACE", true);' }],
        },
        { parameterId: "endBound", value: "BLIND" },
        { parameterId: "depth", expression: "2 mm", value: 0.002 },
        { parameterId: "operationType", value: "ADD" },
      ],
    },
  ];

  studio.profileEvidence?.push({
    consumingFeatureId: "E_AFTER", parameterId: "entities", queryIndex: 0,
    resultIndex: 0, deterministicId: "provider-captured-frame-profile",
    evaluatedAt: "historyPoint", kind: "sketchRegion", sourceSketchFeatureId: "S_FACE",
    interiorPoint3d: [0.0005, 0.001, 0.003],
  });
  studio.profileEvidenceManifest?.push({
    consumingFeatureId: "E_AFTER", parameterId: "entities", queryIndex: 0,
    sourceQueryString: 'query = qSketchRegion(id + "S_FACE", true);',
    kind: "faceResults", emittedRecordCount: 1, completed: true,
  });
  studio.resolvedReferences = [{
    deterministicId: "face_ref",
    evaluatedAt: "historyPoint",
    consumingFeatureId: "S_FACE",
    signature: {
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
      centroid: [0.0005, 0.001, 0.003],
      boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
    },
  }];
  const body = (extent: number) => ({
    id: "A",
    faces: [{
      id: "A-face",
      facets: [{
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: extent, y: 0, z: 0 },
          { x: 0, y: 1, z: 1 },
        ],
      }],
    }],
  });
  const snapshot = (featureId: string, extent: number): OnshapeRollbackSnapshot => ({
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: { bodies: extent === 0 ? [] : [body(extent)] },
  });
  studio.rollbackSnapshots = [
    snapshot("S_BASE", 0),
    snapshot("E_BASE", 1),
    snapshot("TRANSFORM", 2),
    snapshot("S_FACE", 2),
    snapshot("E_AFTER", 3),
  ];
  studio.groundTruth = {
    hasBodies: true,
    tessellationTolerance: 0.0001,
    tessellatedFaces: { bodies: [body(3)] },
    step: "",
  };
  return bundle;
}

function makeCPlaneSketchBundle(options: { recoverable: boolean }) {
  return {
    formatVersion: 1,
    provenance: {
      capturedAt: "2026-07-08T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "d".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [
      {
        elementId: "e1",
        name: "Incline",
        features: {
          features: [
            {
              featureType: "cPlane",
              featureId: "C_PLANE",
              name: "Incline",
            },
            {
              featureType: "newSketch",
              featureId: "S_INCLINE",
              name: "Screen Outline",
              parameters: [
                {
                  parameterId: "sketchPlane",
                  queries: [
                    {
                      queryString:
                        'query=qCompressed(1.0,"$operationIdB2$IdA1$C_PLANEplaneOpS9",id);',
                      deterministicIds: ["incline_ref"],
                    },
                  ],
                },
              ],
            },
          ],
        },
        sketches: {
          sketches: [
            {
              featureId: "S_INCLINE",
              entities: [
                {
                  sketchEntityId: "circle_incline",
                  sketchEntityType: "skCircle",
                  geometry: {
                    center3d: { x: 0.0005, y: 0.001, z: 0.01 },
                    radius: 0.0002,
                  },
                  isConstruction: false,
                },
              ],
            },
          ],
        },
        parts: null,
        featureSpecs: { present: false, reason: "n/a" },
        resolvedReferences: [
          options.recoverable
            ? {
                deterministicId: "incline_ref",
                evaluatedAt: "finalState",
                signature: {
                  entityClass: "face",
                  geometryType: "plane",
                  definingData: {
                    origin: [0, 0, 0.01],
                    normal: [0, 0, 1],
                    xDirection: [1, 0, 0],
                  },
                  centroid: [0.0005, 0.001, 0.01],
                  boundingBox: {
                    low: [0, 0, 0.01],
                    high: [0.001, 0.002, 0.01],
                  },
                },
              }
            : {
                deterministicId: "incline_ref",
                evaluatedAt: "finalState",
                unresolved: { reason: "mid-history-geometry-unavailable" },
              },
        ],
        groundTruth: {
          hasBodies: false,
        },
        rollbackSnapshots: null,
      },
    ],
  };
}

function probeSignature(id: string): HistoryProbeTopologySignature {
  return {
    entityClass: "face",
    geometryType: "plane",
    definingData: {
      origin: [0, 0, 3],
      normal: [0, 0, 1],
      xDirection: [1, 0, 0],
    },
    centroid: [0.5, 1, 3],
    boundingBox: { low: [0, 0, 3], high: [1, 2, 3] },
    reference: {
      kind: "face",
      bodyId: "body_probe" as BodyId,
      faceId: id as FaceId,
    },
  };
}

function bodyProbeSignature(
  id: string,
  low: [number, number, number],
  high: [number, number, number],
): HistoryProbeTopologySignature {
  return {
    entityClass: "body",
    geometryType: "solid",
    boundingBox: { low, high },
    centroid: [
      (low[0] + high[0]) / 2,
      (low[1] + high[1]) / 2,
      (low[2] + high[2]) / 2,
    ],
    reference: { kind: "body", bodyId: id as BodyId },
  };
}

// A parametric base extrude followed by two stacked transform (translation)
// consumers over the same body. Each consumer's captured signature reflects the
// body's pre-consumer state (mm-scale), so C2 only matches once C1 is parametric.
function makeStackedTransformChainBundle(): OnshapeCaptureBundleV2 {
  const query = (parameterId: string, ids: string[]) => ({
    parameterId,
    queries: ids.map((refId) => ({
      queryString: `query=${refId}`,
      deterministicIds: [refId],
    })),
  });
  const facesFor = (
    id: string,
    low: [number, number, number],
    high: [number, number, number],
  ) => ({
    id,
    faces: [{
      id: `${id}_face`,
      facets: [
        {
          vertices: [
            { x: low[0], y: low[1], z: low[2] },
            { x: high[0], y: low[1], z: low[2] },
            { x: high[0], y: high[1], z: high[2] },
          ],
        },
        {
          vertices: [
            { x: low[0], y: low[1], z: low[2] },
            { x: high[0], y: high[1], z: high[2] },
            { x: low[0], y: high[1], z: high[2] },
          ],
        },
      ],
    }],
  });
  const translate = (featureId: string) => ({
    featureType: "transform",
    featureId,
    name: featureId,
    parameters: [
      query("entities", ["A"]),
      { parameterId: "transformType", value: "TRANSLATION_BY_XYZ" },
      { parameterId: "dx", expression: "5 mm", value: 0.005 },
      { parameterId: "dy", expression: "0 mm", value: 0 },
      { parameterId: "dz", expression: "0 mm", value: 0 },
      { parameterId: "makeCopy", value: false },
    ],
  });
  const snapshot = (
    featureId: string,
    bodies: ReturnType<typeof facesFor>[],
  ): OnshapeRollbackSnapshot => ({
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: { bodies },
  });
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-18T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "d".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [{
      elementId: "e1",
      name: "Stacked transforms",
      features: {
        features: [
          {
            featureType: "newSketch",
            featureId: "S1",
            name: "S1",
            parameters: [query("sketchPlane", ["Top"])],
          },
          {
            featureType: "extrude",
            featureId: "E1",
            name: "E1",
            parameters: [
              {
                parameterId: "entities",
                queries: [{ queryString: 'query = qSketchRegion(id + "S1", true);' }],
              },
              { parameterId: "endBound", value: "BLIND" },
              { parameterId: "depth", expression: "10 mm", value: 0.01 },
              { parameterId: "operationType", value: "NEW" },
            ],
          },
          translate("C1"),
          translate("C2"),
        ],
      },
      sketches: {
        sketches: [{
          featureId: "S1",
          entities: [{
            sketchEntityId: "c1",
            sketchEntityType: "skCircle",
            geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.004 },
            isConstruction: false,
          }],
        }],
      },
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      profileEvidence: [{
        consumingFeatureId: "E1", parameterId: "entities", queryIndex: 0,
        resultIndex: 0, deterministicId: "stacked-profile", evaluatedAt: "historyPoint",
        kind: "sketchRegion", sourceSketchFeatureId: "S1", interiorPoint3d: [0, 0, 0],
      }],
      profileEvidenceSchemaVersion: 3,
      profileEvidenceManifest: [{
        consumingFeatureId: "E1", parameterId: "entities", queryIndex: 0,
        sourceQueryString: 'query = qSketchRegion(id + "S1", true);',
        kind: "faceResults", emittedRecordCount: 1, completed: true,
      }],
      resolvedReferences: [{
        deterministicId: "Top",
        evaluatedAt: "finalState",
        signature: {
          entityClass: "face",
          geometryType: "plane",
          definingData: { normal: [0, 0, 1] },
          isDefaultPlane: true,
        },
      }],
      groundTruth: {
        hasBodies: true,
        tessellationTolerance: 0.0001,
        tessellatedFaces: {
          bodies: [facesFor("A", [0.01, 0, 0], [0.018, 0.008, 0.01])],
        },
        step: "",
      },
      rollbackSnapshots: [
        snapshot("S1", []),
        snapshot("E1", [facesFor("A", [0, 0, 0], [0.008, 0.008, 0.01])]),
        snapshot("C1", [facesFor("A", [0.005, 0, 0], [0.013, 0.008, 0.01])]),
        snapshot("C2", [facesFor("A", [0.01, 0, 0], [0.018, 0.008, 0.01])]),
      ],
    }],
  } as unknown as OnshapeCaptureBundleV2;
}

function durableConsumerProbeSignatures(): HistoryProbeTopologySignature[] {
  return [
    probeSignature("face_match"),
    {
      entityClass: "edge",
      geometryType: "line",
      definingData: { direction: [1, 0, 0] },
      centroid: [0.5, 0, 3],
      boundingBox: { low: [0, 0, 3], high: [1, 0, 3] },
      reference: {
        kind: "edge",
        bodyId: "body_probe" as BodyId,
        edgeId: "edge_match" as EdgeId,
      },
    },
    {
      entityClass: "vertex",
      geometryType: "point",
      centroid: [0, 0, 3],
      boundingBox: { low: [0, 0, 3], high: [0, 0, 3] },
      reference: {
        kind: "vertex",
        bodyId: "body_probe" as BodyId,
        vertexId: "vertex_match" as VertexId,
      },
    },
    {
      entityClass: "body",
      geometryType: "solid",
      centroid: [0.5, 1, 1.5],
      boundingBox: { low: [0, 0, 0], high: [1, 2, 3] },
      reference: { kind: "body", bodyId: "body_probe" as BodyId },
    },
  ];
}

function capabilitiesWithProbe(
  signatures: readonly HistoryProbeTopologySignature[],
): ImportCapabilities {
  return {
    ...capabilities,
    history: {
      async evaluateHistoryProbe(input) {
        return {
          steps: Array.from(
            { length: Math.max(1, input.actions.orderedActions?.length ?? 0) },
            () => ({ status: "rebuilt" as const, signatures: [...signatures] }),
          ),
        };
      },
    },
  };
}

function topologyActionOrdinal(input: {
  actions: {
    orderedActions?: readonly { kind: string; index: number }[];
    createFeatures?: readonly { definition: unknown }[];
    commitSketches?: readonly { definition: unknown }[];
  };
}, featureId: string, selectorKind: "topologyOf" | "historicalTopologyOf"): number {
  const hasSelector = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (
      (value as { kind?: unknown }).kind === selectorKind &&
      (value as { source?: { consumerFeatureId?: unknown } }).source?.consumerFeatureId === featureId
    ) return true;
    return Array.isArray(value)
      ? value.some(hasSelector)
      : Object.values(value).some(hasSelector);
  };
  return input.actions.orderedActions?.findIndex((action) => {
    const request = action.kind === "createFeature"
      ? input.actions.createFeatures?.[action.index]
      : action.kind === "commitSketch"
        ? input.actions.commitSketches?.[action.index]
        : undefined;
    return request ? hasSelector(request.definition) : false;
  }) ?? -1;
}

function capabilitiesWithContainmentFailure(input: {
  featureId: string;
  signatures: readonly HistoryProbeTopologySignature[];
  failHistoricalRetry?: boolean;
  diagnosticCode?: "topology-apply-rematch-failed" | "feature-kernel-build-failed";
}) {
  const base = capabilitiesWithProbe(input.signatures);
  const history = base.history!;
  let directContainmentFailures = 0;
  let historicalContainmentFailures = 0;
  return {
    capabilities: {
      ...base,
      history: {
        async evaluateHistoryProbe(probeInput: Parameters<typeof history.evaluateHistoryProbe>[0]) {
          const isContainment =
            probeInput.consumerFeatureId === undefined &&
            probeInput.includeFinalTessellation !== true;
          const directOrdinal = topologyActionOrdinal(probeInput, input.featureId, "topologyOf");
          const historicalOrdinal = topologyActionOrdinal(
            probeInput,
            input.featureId,
            "historicalTopologyOf",
          );
          const failedOrdinal = isContainment && directOrdinal >= 0
            ? (directContainmentFailures += 1, directOrdinal)
            : isContainment && input.failHistoricalRetry && historicalOrdinal >= 0
              ? (historicalContainmentFailures += 1, historicalOrdinal)
              : -1;
          if (failedOrdinal < 0) return history.evaluateHistoryProbe(probeInput);
          const count = probeInput.actions.orderedActions?.length ?? 0;
          return {
            steps: Array.from({ length: count }, (_, ordinal) =>
              ordinal === failedOrdinal
                ? {
                    status: "failed" as const,
                    diagnostics: [{
                      severity: "error" as const,
                      code: input.diagnosticCode ?? "topology-apply-rematch-failed",
                      message: "structured containment failure",
                    }],
                  }
                : { status: "rebuilt" as const, signatures: [...input.signatures] },
            ),
          };
        },
      },
    } satisfies ImportCapabilities,
    containmentFailures: () => ({ directContainmentFailures, historicalContainmentFailures }),
  };
}

function makeUpToVertexExtrudeBundle(
  includeVertexHistoryBinding: boolean,
  includeUnboundBooleanScope = false,
  includeStartFace = false,
  includeBooleanScopeHistoryBinding = false,
): OnshapeCaptureBundleV2 {
  const bundle = structuredClone(makeFaceSketchBundle()) as unknown as OnshapeCaptureBundleV2;
  bundle.formatVersion = 2;
  const studio = bundle.partStudios[0]!;
  const features = (studio.features as { features: Record<string, unknown>[] }).features;
  features.splice(2, 0, {
    featureType: "extrude",
    featureId: "E_VERTEX",
    name: "Up to vertex",
    parameters: [
      {
        parameterId: "entities",
        queries: [{ queryString: 'query = qSketchRegion(id + "S_BASE", true);' }],
      },
      { parameterId: "endBound", value: "UP_TO_VERTEX" },
      {
        parameterId: "endBoundEntityVertex",
        queries: [{ queryString: "query = qVertexTarget();", deterministicIds: ["vertex_target"] }],
      },
      ...(includeStartFace
        ? [
            { parameterId: "startOffset", value: true },
            { parameterId: "startOffsetBound", value: "ENTITY" },
            {
              parameterId: "startOffsetEntity",
              queries: [{ queryString: "query = qStartFace();", deterministicIds: ["start_face_target"] }],
            },
          ]
        : []),
      { parameterId: "operationType", value: includeUnboundBooleanScope ? "REMOVE" : "NEW" },
      ...(includeUnboundBooleanScope
        ? [{
            parameterId: "booleanScope",
            queries: [{ queryString: "query = qBodyTarget();", deterministicIds: ["body_target"] }],
          }]
        : []),
    ],
  });
  studio.profileEvidence?.push({
    consumingFeatureId: "E_VERTEX",
    parameterId: "entities",
    queryIndex: 0,
    resultIndex: 0,
    deterministicId: "provider-vertex-profile",
    evaluatedAt: "historyPoint",
    kind: "sketchRegion",
    sourceSketchFeatureId: "S_BASE",
    interiorPoint3d: [0.0005, 0.001, 0],
  });
  studio.profileEvidenceManifest?.push({
    consumingFeatureId: "E_VERTEX",
    parameterId: "entities",
    queryIndex: 0,
    sourceQueryString: 'query = qSketchRegion(id + "S_BASE", true);',
    kind: "faceResults",
    emittedRecordCount: 1,
    completed: true,
  });
  if (includeVertexHistoryBinding) {
    studio.resolvedReferences.push({
      deterministicId: "vertex_target",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "E_VERTEX",
      signature: {
        entityClass: "vertex",
        geometryType: "point",
        centroid: [0, 0, 0.003],
        boundingBox: { low: [0, 0, 0.003], high: [0, 0, 0.003] },
      },
    });
  }
  if (includeStartFace) {
    studio.resolvedReferences.push({
      deterministicId: "start_face_target",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "E_VERTEX",
      signature: {
        entityClass: "face",
        geometryType: "plane",
        definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
        centroid: [0.0005, 0.001, 0.003],
        boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
      },
    });
  }
  if (includeBooleanScopeHistoryBinding) {
    studio.resolvedReferences.push({
      deterministicId: "body_target",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "E_VERTEX",
      signature: {
        entityClass: "body",
        geometryType: "solid",
        centroid: [0.005, 0.005, 0.005],
        boundingBox: { low: [0, 0, 0], high: [0.01, 0.01, 0.01] },
      },
    });
  }
  studio.rollbackSnapshots = [];
  return bundle;
}

function vertexProbeSignature(): HistoryProbeTopologySignature {
  return {
    entityClass: "vertex",
    geometryType: "point",
    centroid: [0, 0, 3],
    boundingBox: { low: [0, 0, 3], high: [0, 0, 3] },
    reference: {
      kind: "vertex",
      bodyId: "body_probe" as BodyId,
      vertexId: "vertex_match" as VertexId,
    },
  };
}

test("src/domain/import/onshape/provider.spec.ts resolves a standalone UP_TO_VERTEX once without probing its unresolved action", async () => {
  const prefixConsumers: (string | undefined)[] = [];
  const wholePlanContainsTopologySlot: boolean[] = [];
  const probeCapabilities: ImportCapabilities = {
    ...capabilities,
    history: {
      async evaluateHistoryProbe(input) {
        prefixConsumers.push(input.consumerFeatureId);
        if (input.consumerFeatureId === undefined) {
          wholePlanContainsTopologySlot.push(JSON.stringify(input.actions).includes("topologySlot"));
        }
        if (input.consumerFeatureId === "E_VERTEX") {
          expect(JSON.stringify(input.actions)).not.toContain("topologySlot");
        }
        return {
          steps: Array.from(
            { length: Math.max(1, input.actions.orderedActions?.length ?? 0) },
            () => ({ status: "rebuilt" as const, signatures: [vertexProbeSignature()] }),
          ),
        };
      },
    },
  };
  const source = sourceFromBundle(makeUpToVertexExtrudeBundle(true));
  const review = await onshapeImportProvider.review({ source, capabilities: probeCapabilities });
  const vertexPlan = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "E_VERTEX",
  );

  expect(vertexPlan).toMatchObject({
    tier: "parametric",
    target: { kind: "feature" },
    reasonCodes: [],
    suppressed: false,
    plannedExtrude: {
      extent: {
        mode: "oneSide",
        end: { kind: "upToVertex", target: { kind: "topologyOf", expectedKind: "vertex" } },
      },
    },
  });
  expect(prefixConsumers.filter((consumerId) => consumerId === "E_VERTEX"))
    .toEqual(["E_VERTEX"]);
  expect(wholePlanContainsTopologySlot.length).toBeGreaterThan(0);
  expect(wholePlanContainsTopologySlot).toEqual(
    Array.from({ length: wholePlanContainsTopologySlot.length }, () => false),
  );

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: probeCapabilities,
  });
  expect(actions.createFeatures?.find((action) => action.featureLabel === "Up to vertex"))
    .toMatchObject({ definition: { kind: "extrude" } });
  expect(JSON.stringify(actions)).not.toContain("topologySlot");
});

test("src/domain/import/onshape/provider.spec.ts keeps an UP_TO_VERTEX without its exact binding baked and unprepared", async () => {
  const source = sourceFromBundle(makeUpToVertexExtrudeBundle(false));
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([vertexProbeSignature()]),
  });
  const vertexPlan = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "E_VERTEX",
  );
  expect(vertexPlan).toMatchObject({
    tier: "baked",
    target: { kind: "suppressed" },
    suppressed: true,
    reasonCodes: ["extrude-extent-topology-unresolved"],
  });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: capabilitiesWithProbe([vertexProbeSignature()]),
  });
  // Feature-level fail-closed: the unresolvable extrude emits no create action,
  // but the rest of the studio still prepares (no whole-studio throw).
  expect(actions.createFeatures?.some((action) => action.featureLabel === "Up to vertex"))
    .toBe(false);
  expect(actions.createFeatures?.some((action) => action.featureLabel === "Base extrude"))
    .toBe(true);
  expect(JSON.stringify(actions)).not.toContain("topologySlot");
  expect(validateImportPreparedActions(actions).success).toBe(true);
});

test("src/domain/import/onshape/provider.spec.ts resolves extent and scope atomically", async () => {
  const source = sourceFromBundle(makeUpToVertexExtrudeBundle(true, true));
  const probeCapabilities = capabilitiesWithProbe([
    vertexProbeSignature(),
    bodyProbeSignature("scope-body", [0, 0, 0], [10, 10, 10]),
  ]);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: probeCapabilities,
  });
  const vertexPlan = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "E_VERTEX",
  );
  expect(vertexPlan).toMatchObject({
    tier: "baked",
    target: { kind: "suppressed" },
    suppressed: true,
  });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: probeCapabilities,
  });
  expect(actions.createFeatures?.some((action) => action.featureLabel === "Up to vertex"))
    .toBe(false);
  expect(JSON.stringify(actions)).not.toContain("firstEndVertex");
});

// Lane: logic (per docs/testing.md — exported importer review/prepare seam).
// Seam: entityOffset start-face and explicit REMOVE scope selectors bind together
// before prepare emits the extrude action.
test("src/domain/import/onshape/provider.spec.ts prepares entityOffset start face and explicit REMOVE scope atomically", async () => {
  const source = sourceFromBundle(makeUpToVertexExtrudeBundle(true, true, true, true));
  const probeCapabilities = capabilitiesWithProbe([
    vertexProbeSignature(),
    probeSignature("start-face"),
    bodyProbeSignature("scope-body", [0, 0, 0], [10, 10, 10]),
  ]);
  const review = await onshapeImportProvider.review({ source, capabilities: probeCapabilities });
  const plan = review.providerReview.studios[0]?.featurePlans.find(
    (feature) => feature.onshapeFeatureId === "E_VERTEX",
  );
  expect(plan).toMatchObject({
    tier: "parametric",
    plannedExtrude: {
      startExtent: {
        kind: "entityOffset",
        target: { kind: "topologyOf", expectedKind: "face" },
      },
      boolean: {
        kind: "topologyTargets",
        targets: [{ kind: "topologyOf", expectedKind: "body" }],
      },
    },
  });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: probeCapabilities,
  });
  const extrude = actions.createFeatures?.find(
    (action) => action.featureLabel === "Up to vertex",
  );
  expect(extrude).toMatchObject({
    definition: {
      kind: "extrude",
      parameters: {
        startExtent: {
          kind: "entityOffset",
          target: { kind: "topologyOf", expectedKind: "face" },
        },
        operation: { source: "literal", value: "cut" },
        booleanScope: {
          kind: "targetBody",
          bodyId: { kind: "topologyOf", expectedKind: "body" },
        },
      },
    },
  });
});

test("src/domain/import/onshape/provider.spec.ts surfaces human-readable review copy for an unresolved extrude extent", async () => {
  const source = sourceFromBundle(makeUpToVertexExtrudeBundle(false));
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([vertexProbeSignature()]),
  });
  const schema = onshapeImportProvider.getReviewFormSchema(
    review,
    onshapeImportProvider.createDefaultSelections(review),
  );
  // The new reason code must render dedicated review copy (REVIEW_REASON_COPY is
  // an exhaustive Record<PlanReasonCode, string>, so this also guards the entry).
  expect(JSON.stringify(schema)).toContain(
    "extrude start-entity, up-to, or boolean-scope topology could not be resolved as a durable reference",
  );
});

// Lane: logic (per docs/testing.md — exported importer review/prepare seam).
// Seam: an Onshape SURFACE extrude becomes a surface extrude feature definition
// carrying deferred open sketch-curve profiles and no boolean state.
test("src/domain/import/onshape/provider.spec.ts prepares a SURFACE Extrude 4 as a surface extrude feature", async () => {
  const source = sourceFromBundle(makeWaveXSurfaceExtrudeCaptureBundle());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([]),
  });
  expect(review.providerReview.valid).toBe(true);
  expect(review.providerReview.studios).toHaveLength(2);

  for (const studio of review.providerReview.studios) {
    const surface = studio.featurePlans.find((feature) => feature.label === "Extrude 4");
    expect(surface).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
      suppressed: false,
    });
    expect(surface?.plannedExtrude?.resultBodyType).toBe("surface");
  }

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: capabilitiesWithProbe([]),
  });
  const surfaceExtrude = actions.createFeatures?.find(
    (request) =>
      request.definition.kind === "extrude" &&
      request.definition.parameters.resultBodyType === "surface",
  );
  if (surfaceExtrude?.definition.kind !== "extrude") {
    throw new Error("Expected a prepared surface extrude feature.");
  }
  const parameters = surfaceExtrude.definition.parameters;
  expect(parameters.resultBodyType).toBe("surface");
  expect(parameters).not.toHaveProperty("operation");
  expect(parameters).not.toHaveProperty("booleanScope");
  expect(parameters.profiles).toEqual([
    {
      kind: "sketchEntity",
      sketchId: { kind: "sketchIdOf", actionIndex: 0 },
      entityId: "sketch_entity_S_SURFACE_S_SURFACE_chainSegA",
    },
    {
      kind: "sketchEntity",
      sketchId: { kind: "sketchIdOf", actionIndex: 0 },
      entityId: "sketch_entity_S_SURFACE_S_SURFACE_chainSegB",
    },
  ]);
  expect(validateImportPreparedActions(actions).success).toBe(true);
});

// Lane: logic (per docs/testing.md — this tests the exported importer
// provider/review/prepare seam, not presentation behavior).
// Seam: a captured empty-opening hollow shell resolves its exact singleton body
// scope into a closedHollow action rather than offsetAllFaces or a bake.
test("src/domain/import/onshape/provider.spec.ts promotes a synthetic closed hollow shell", async () => {
  const source = sourceFromBundle(makeWaveXClosedHollowShellCaptureBundle());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([{
      entityClass: "body",
      geometryType: "solid",
      boundingBox: {
        low: [-4, -4, 0],
        high: [4, 4, 10],
      },
      centroid: [0, 0, 5],
      reference: { kind: "body", bodyId: "probe_closed_hollow" as BodyId },
    }]),
  });
  const studio = review.providerReview.studios[0];
  const shell = studio?.featurePlans.find(
    (feature) => feature.onshapeFeatureId === "SHELL_CLOSED",
  );
  expect(shell, JSON.stringify(studio?.featurePlans)).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
  });

});

// Lane: logic (per docs/testing.md — exercises the exported importer
// review/apply seam, not presentation behavior).
// Seam: a live topologyOf apply no-match triggers one stricter historical-prefix
// retry. A unique historical witness with the same current OCC key promotes the
// feature and its dependent without weakening geometric rematching.
test("src/domain/import/onshape/provider.spec.ts retries an apply-time topology no-match through historical lineage", async () => {
  const rematchSelector: ImportDeferredTopologyRef = {
    kind: "topologyOf",
    expectedKind: "face",
    capturedSignature: {
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
      centroid: [0.0005, 0.001, 0.003],
      boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
    },
    tolerance: { linear: 0.01, angularRadians: 0.01, relative: 0.01, ambiguityMargin: 0.5 },
    source: {
      consumerFeatureId: "S_FACE",
      parameterId: "sketchPlane",
      deterministicId: "face_ref",
    },
  };

  const base = capabilitiesWithProbe([probeSignature("face_match")]);
  const innerProbe = base.history!;
  let injectedFailure = false;
  const capabilitiesWithApplyRematchFailure: ImportCapabilities = {
    ...base,
    history: {
      async evaluateHistoryProbe(input) {
        // Simulate the live OCC prefix rejecting S_FACE's captured topology
        // reference the first time a probe applies it, exactly as the real
        // kernel materializer throws when the recorded signature no longer
        // rematches. Subsequent probes (after S_FACE is baked) proceed.
        if (!injectedFailure) {
          injectedFailure = true;
          throw new TopologyApplyRematchError(
            rematchSelector,
            "wants face for face_ref; live match noMatch || rejected nothing || live prefix 0: empty",
          );
        }
        return innerProbe.evaluateHistoryProbe(input);
      },
    },
  };

  const source = sourceFromBundle(makeFaceSketchExtrudeBundle());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithApplyRematchFailure,
  });

  expect(injectedFailure, "the probe should have reported an apply-time rematch failure").toBe(true);
  const plans = review.providerReview.studios[0]!.featurePlans;
  const byId = (id: string) => plans.find((plan) => plan.onshapeFeatureId === id);

  expect(byId("S_FACE"), JSON.stringify(plans)).toMatchObject({
    tier: "parametric",
    suppressed: false,
    target: {
      probedFaceSelector: {
        kind: "historicalTopologyOf",
        expectedKind: "face",
        source: { consumerFeatureId: "S_FACE", deterministicId: "face_ref" },
      },
    },
  });
  expect(JSON.stringify((byId("S_FACE")?.target as { probedFaceSelector?: unknown })
    ?.probedFaceSelector)).not.toContain("body_probe");
  expect(byId("E_FACE")?.tier).toBe("parametric");

  // Independent upstream geometry stays parametric: one rejected feature does
  // not bake the rest of the studio.
  expect(byId("E_BASE")?.tier).toBe("parametric");
});

// Lane: logic (per docs/testing.md — exported importer review seam).
// Seam: a full-plan structured topology rematch refusal gets exactly one
// historical retry before containment, so a successful historical selector is
// never placed in the per-activation containment-rejection set.
test("src/domain/import/onshape/provider.spec.ts retries a direct containment rematch through historical lineage", async () => {
  const probe = capabilitiesWithContainmentFailure({
    featureId: "E_VERTEX",
    signatures: [vertexProbeSignature()],
  });
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeUpToVertexExtrudeBundle(true)),
    capabilities: probe.capabilities,
  });
  const plans = review.providerReview.studios[0]!.featurePlans;
  const vertexExtrude = plans.find((plan) => plan.onshapeFeatureId === "E_VERTEX");

  expect(probe.containmentFailures()).toEqual({
    directContainmentFailures: 1,
    historicalContainmentFailures: 0,
  });
  expect(vertexExtrude, JSON.stringify(plans)).toMatchObject({
    tier: "parametric",
    suppressed: false,
    plannedExtrude: {
      extent: { mode: "oneSide", end: { target: { kind: "historicalTopologyOf" } } },
    },
  });
});

// Lane: logic (per docs/testing.md — exported importer review seam).
// Seam: a historical selector that survives its exact prefix is not rejected by
// a whole-plan containment replay; checkpoints are replacement geometry, not
// historical lineage evidence.
test("src/domain/import/onshape/provider.spec.ts preserves historical lineage when containment replays a checkpoint", async () => {
  const probe = capabilitiesWithContainmentFailure({
    featureId: "E_VERTEX",
    signatures: [vertexProbeSignature()],
  });
  const history = probe.capabilities.history!;
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeUpToVertexExtrudeBundle(true)),
    capabilities: {
      ...probe.capabilities,
      history: {
        async evaluateHistoryProbe(input) {
          const historicalOrdinal = topologyActionOrdinal(input, "E_VERTEX", "historicalTopologyOf");
          if (
            input.consumerFeatureId === undefined &&
            input.includeFinalTessellation !== true &&
            historicalOrdinal >= 0
          ) {
            throw new TopologyApplyRematchError({
              kind: "historicalTopologyOf",
              expectedKind: "vertex",
              capturedSignature: vertexProbeSignature(),
              tolerance: { linear: 0.01, angularRadians: 0.01, relative: 0.01, ambiguityMargin: 0.5 },
              source: { consumerFeatureId: "E_VERTEX", parameterId: "endBoundEntityVertex", deterministicId: "vertex_target" },
            });
          }
          return history.evaluateHistoryProbe(input);
        },
      },
    },
  });

  const vertexExtrude = review.providerReview.studios[0]!.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "E_VERTEX",
  );
  expect(vertexExtrude).toMatchObject({
    tier: "parametric",
    suppressed: false,
    plannedExtrude: { extent: { mode: "oneSide", end: { target: { kind: "historicalTopologyOf" } } } },
  });
});

// Lane: logic (per docs/testing.md — exported importer review seam).
// Seam: if the historical selector also fails in the apply-equivalent plan, the
// feature fails closed to baked rather than retrying or preserving a live selector.
test("src/domain/import/onshape/provider.spec.ts contains a second historical rematch failure", async () => {
  const probe = capabilitiesWithContainmentFailure({
    featureId: "E_VERTEX",
    signatures: [vertexProbeSignature()],
    failHistoricalRetry: true,
  });
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeUpToVertexExtrudeBundle(true)),
    capabilities: probe.capabilities,
  });
  const plans = review.providerReview.studios[0]!.featurePlans;
  const vertexExtrude = plans.find((plan) => plan.onshapeFeatureId === "E_VERTEX");

  expect(probe.containmentFailures()).toEqual({
    directContainmentFailures: 1,
    historicalContainmentFailures: 2,
  });
  expect(vertexExtrude).toMatchObject({
    tier: "baked",
    target: { kind: "suppressed" },
    suppressed: true,
    reasonCodes: ["feature-kernel-build-failed"],
  });
});

// Lane: logic (per docs/testing.md — exported importer review seam).
// Seam: containment only requests historical lineage for the exact structured
// rematch code; ordinary kernel build failures retain normal feature demotion.
test("src/domain/import/onshape/provider.spec.ts contains a non-topology kernel failure without historical retry", async () => {
  const probe = capabilitiesWithContainmentFailure({
    featureId: "E_VERTEX",
    signatures: [vertexProbeSignature()],
    diagnosticCode: "feature-kernel-build-failed",
  });
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeUpToVertexExtrudeBundle(true)),
    capabilities: probe.capabilities,
  });
  const plans = review.providerReview.studios[0]!.featurePlans;
  const vertexExtrude = plans.find((plan) => plan.onshapeFeatureId === "E_VERTEX");

  expect(probe.containmentFailures()).toEqual({
    directContainmentFailures: 2,
    historicalContainmentFailures: 0,
  });
  expect(vertexExtrude).toMatchObject({
    tier: "baked",
    target: { kind: "suppressed" },
    suppressed: true,
    reasonCodes: ["feature-kernel-build-failed"],
  });
});

test("src/domain/import/onshape/provider.spec.ts registration and acceptance", async () => {
  const registry = createBuiltinImportProviderRegistry();
  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const matches = registry.matchProviders(source);
  expect(
    matches.some((provider) => provider.id === "onshape-capture-bundle"),
    "The Onshape provider should be registered and match .onshape-capture.json sources.",
  ).toBeTruthy();
  expect(
    registry
      .getAcceptedFileTypes()
      .some((type) => type.extension === "onshape-capture.json"),
    "The bundle extension should be advertised as an accepted import file type.",
  ).toBeTruthy();
});


test("src/domain/import/onshape/provider.spec.ts emits a deferred parametric revolve action", async () => {
  const source = sourceFromBundle(makeWaveARevolveCaptureBundle());
  const review = await onshapeImportProvider.review({ source, capabilities });
  const revolvePlan = review.providerReview.studios[0]?.featurePlans.find(
    (entry) => entry.onshapeFeatureId === "F_REVOLVE",
  );
  expect(revolvePlan?.tier).toBe("parametric");

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  const revolve = actions.createFeatures?.find(
    (entry) => entry.definition.kind === "revolve",
  );
  expect(revolve?.definition.kind).toBe("revolve");
  if (revolve?.definition.kind !== "revolve") {
    throw new Error("Expected a prepared revolve feature.");
  }
  expect(revolve.definition.parameters.profiles[0]).toMatchObject({
    kind: "regionOf",
    actionIndex: 1,
  });
  expect(revolve.definition.parameters.axis).toMatchObject({
    kind: "sketchEntity",
    sketchId: { kind: "sketchIdOf", actionIndex: 1 },
  });
  expect(validateImportPreparedActions(actions).success).toBe(true);
});

const realBundleCases = [
  [
    "test/fixtures/onshape-captures/40a51fb8fa82fd4565151114.onshape-capture.json",
    { parametric: 7, baked: 3, geometryOnly: 0 },
  ],
  [
    "test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json",
    { parametric: 6, baked: 35, geometryOnly: 0 },
  ],
] as const;

test.skipIf(realBundleCases.some(([fileName]) => !existsSync(fileName)))(
  "src/domain/import/onshape/provider.spec.ts real-bundle no-history tier counts retain the pinned baselines",
  async () => {
  for (const [fileName, expected] of realBundleCases) {
    const bundle = JSON.parse(await readFile(fileName, "utf8"));
    const review = await onshapeImportProvider.review({
      source: sourceFromBundle(bundle),
      capabilities,
    });
    expect(review.providerReview.studios[0]?.tierCounts).toEqual(expected);
    expect(
      review.providerReview.studios[0]?.featurePlans.some((entry) =>
        ["revolve", "thicken", "sweep", "loft"].includes(entry.featureType),
      ),
    ).toBe(false);
  }
});


// Lane: logic (per docs/testing.md — real provider review → prepared-action
// seam). This pins the exact producer identities used by d3cd9's native sheet
// split before the browser applies the prepared payload.
const D3_CAPTURE_FIXTURE =
  "test/fixtures/onshape-captures/d3cd9b09c3c36af1dd2efae9.onshape-capture.json";

test.skipIf(!existsSync(D3_CAPTURE_FIXTURE))(
  "d3cd9 prepares the Mirror 1, surface Extrude 4, and Split 1 producer chain without a fallback",
  async () => {
    const bundle = JSON.parse(await readFile(D3_CAPTURE_FIXTURE, "utf8"));
    const oc = await loadRealOccForImportTest();
    const service = createRealOccModelingService(oc);
    const snapshot = await service.getCurrentDocumentSnapshot();
    const realProbeCapabilities = createImportCapabilities(service, snapshot, {
      history: createKernelHistoryProbeSession({
        createService: () => createRealOccModelingService(oc),
      }),
    });
    const source = sourceFromBundle(bundle);
    const review = await onshapeImportProvider.review({
      source,
      capabilities: realProbeCapabilities,
    });
    const splitStudio = review.providerReview.studios.find((studio) =>
      studio.featurePlans.some((plan) => plan.label === "Split 1"),
    );
    expect(splitStudio, "Expected d3cd9's studio review.").toBeDefined();
    expect(
      splitStudio?.featurePlans.filter((plan) => plan.tier === "parametric"),
      "The real OCC review must retain all 24 d3cd9 features parametrically before preparation.",
    ).toHaveLength(24);
    expect(
      splitStudio?.featurePlans
        .filter((plan) => plan.tier === "baked")
        .map((plan) => plan.label),
      "No d3cd9 feature may bake: split-piece profile lineage and full-membership sheet-split slots replay Extrude 8 parametrically.",
    ).toEqual([]);
    expect(
      splitStudio?.featurePlans.find((plan) => plan.label === "Split 1"),
      "Split 1 must stay parametric on the native sheet-split tool-history path.",
    ).toMatchObject({ tier: "parametric", reasonCodes: [] });
    const actions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: onshapeImportProvider.createDefaultSelections(review),
      capabilities: realProbeCapabilities,
    });
    const featuresByLabel = new Map(
      (actions.createFeatures ?? []).map((feature) => [feature.featureLabel, feature]),
    );
    const actionIndexFor = (featureLabel: string) => {
      const feature = featuresByLabel.get(featureLabel);
      expect(feature, `Expected prepared feature ${featureLabel}.`).toBeDefined();
      if (!feature) throw new Error(`Expected prepared feature ${featureLabel}.`);
      const actionIndex = actions.orderedActions?.findIndex(
        (action) =>
          action.kind === "createFeature" && actions.createFeatures?.[action.index] === feature,
      );
      expect(actionIndex, `Expected ordered action for ${featureLabel}.`).toBeGreaterThanOrEqual(0);
      if (actionIndex === undefined || actionIndex < 0) {
        throw new Error(`Expected ordered action for ${featureLabel}.`);
      }
      return { feature, actionIndex };
    };

    const mirror = actionIndexFor("Mirror 1");
    const surfaceExtrude = actionIndexFor("Extrude 4");
    const split = actionIndexFor("Split 1");
    expect([
      [mirror.feature.featureLabel, mirror.feature.definition.kind],
      [surfaceExtrude.feature.featureLabel, surfaceExtrude.feature.definition.kind],
      [split.feature.featureLabel, split.feature.definition.kind],
    ]).toEqual([
      ["Mirror 1", "mirror"],
      ["Extrude 4", "extrude"],
      ["Split 1", "split"],
    ]);
    expect(mirror.actionIndex).toBeLessThan(surfaceExtrude.actionIndex);
    expect(surfaceExtrude.actionIndex).toBeLessThan(split.actionIndex);
    if (split.feature.definition.kind !== "split") {
      throw new Error("Expected prepared Split 1 action.");
    }
    expect(split.feature.definition.parameters.participants).toMatchObject([
      { role: "targetBody", targets: [{ kind: "bodyOf", actionIndex: mirror.actionIndex }] },
      {
        role: "toolBody",
        targets: [{ kind: "bodyOf", actionIndex: surfaceExtrude.actionIndex }],
      },
    ]);
    expect(split.feature.topologyFallback).toBeUndefined();
    expect(validateImportPreparedActions(actions).success).toBe(true);
  },
  3_600_000,
);

test("src/domain/import/onshape/provider.spec.ts unique face sketches follow the durable naming capability gate", async () => {
  const bundle = structuredClone(
    makeFaceSketchBundle(),
  ) as unknown as OnshapeCaptureBundleV2;
  bundle.partStudios[0]!.resolvedReferences.push({
    deterministicId: "face_ref",
    evaluatedAt: "historyPoint",
    consumingFeatureId: "S_FACE",
    signature: {
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
      centroid: [0.0005, 0.001, 0.003],
      boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
    },
  });
  const source = sourceFromBundle(bundle);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  const studio = review.providerReview.studios[0];
  const faceSketch = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );
  const chamfer = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "CHAMFER",
  );

  expect(
    OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming
      ? faceSketch?.tier === "parametric" &&
        faceSketch.reasonCodes.includes("sketch-on-probed-face")
      : faceSketch?.tier === "baked" &&
        faceSketch.reasonCodes.includes("topology-durable-naming-unavailable"),
    "A unique face match must follow the kernel's durable topology naming capability.",
  ).toBeTruthy();
  expect(
    chamfer?.tier === "baked" &&
      chamfer.reasonCodes.includes("chamfer-width-unreadable") &&
      !chamfer.reasonCodes.includes("needs-history-probe"),
    "A malformed chamfer must report its parameter mapping failure before topology resolution.",
  ).toBeTruthy();

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  expect(
    actions.commitSketches?.some(
      (sketch) =>
        sketch.plane.support.kind === "topologyOf" &&
        sketch.plane.support.expectedKind === "face",
    ),
  ).toBe(OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming);
});

test("src/domain/import/onshape/provider.spec.ts chamfer promotes with matching durable edge evidence", async () => {
  const source = sourceFromBundle(makeDurableSubtopologyBundle());
  const probeCapabilities = capabilitiesWithProbe(durableConsumerProbeSignatures());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: probeCapabilities,
  });
  const studio = review.providerReview.studios[0]!;
  expect(
    studio.featurePlans.find((plan) => plan.onshapeFeatureId === "CHAMFER"),
    JSON.stringify(studio.featurePlans),
  ).toMatchObject({ tier: "parametric", reasonCodes: [], suppressed: false });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: probeCapabilities,
  });
  const chamferAction = actions.createFeatures?.find((action) => action.definition.kind === "chamfer");
  expect(chamferAction).toBeDefined();
  expect(chamferAction?.definition.parameters.options?.distance).toEqual({
    source: "literal",
    value: 1,
  });
  if (!chamferAction) throw new Error("Expected chamfer action.");
  expect(
    validateFeatureDefinitionAuthoredValueInvariants(chamferAction.definition).map(
      (issue) => issue.message,
    ),
  ).toEqual([]);
  expect(validateImportPreparedActions(actions).success).toBe(true);
});

test("src/domain/import/onshape/provider.spec.ts unique face probe replans its blocked extrude", async () => {
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeFaceSketchExtrudeBundle()),
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  const plans = review.providerReview.studios[0]!.featurePlans;
  const faceSketch = plans.find((plan) => plan.onshapeFeatureId === "S_FACE");
  const faceExtrude = plans.find((plan) => plan.onshapeFeatureId === "E_FACE");

  expect(faceSketch).toMatchObject({
    tier: "parametric",
    reasonCodes: ["sketch-on-probed-face"],
  });
  expect(faceExtrude).toMatchObject({
    tier: "parametric",
    target: { kind: "feature" },
    reasonCodes: [],
    suppressed: false,
    plannedExtrude: {
      profiles: [{ kind: "sketchRegion", sketchFeatureId: "S_FACE" }],
    },
    inputDependencies: [{ kind: "sketch", featureId: "S_FACE" }],
    inputFeatureIds: ["S_FACE"],
  });
  expect(plans.findIndex((plan) => plan.onshapeFeatureId === "S_FACE")).toBeLessThan(
    plans.findIndex((plan) => plan.onshapeFeatureId === "E_FACE"),
  );
});

test("src/domain/import/onshape/provider.spec.ts source-ordered replanning promotes dependent FEATURE patterns and mirrors", async () => {
  const bundle = makeFaceSketchExtrudeBundle();
  const features = (bundle.partStudios[0]!.features as { features: Record<string, unknown>[] }).features;
  const featurePattern = (
    featureId: string,
    sourceFeatureIds: string[],
    featureType: "linearPattern" | "mirror",
  ) => ({
    featureType,
    featureId,
    name: featureId,
    parameters: [
      { parameterId: "patternType", value: "FEATURE" },
      { parameterId: "operationType", value: "NEW" },
      { parameterId: "fullFeaturePattern", value: true },
      { parameterId: "instanceFunction", featureIds: sourceFeatureIds },
      ...(featureType === "linearPattern"
        ? [
            { parameterId: "directionOne", queries: [{ queryString: "TopplaneOp" }] },
            { parameterId: "instanceCount", value: 2 },
            { parameterId: "distance", expression: "2 mm", value: 0.002 },
          ]
        : [{ parameterId: "mirrorPlane", queries: [{ queryString: "TopplaneOp" }] }]),
    ],
  });
  features.push(
    featurePattern("LINEAR_1", ["E_FACE"], "linearPattern"),
    featurePattern("LINEAR_2", ["LINEAR_1"], "linearPattern"),
    featurePattern("MIRROR_1", ["LINEAR_2"], "mirror"),
  );

  const source = sourceFromBundle(bundle);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  const plans = review.providerReview.studios[0]!.featurePlans;
  for (const featureId of ["E_FACE", "LINEAR_1", "LINEAR_2", "MIRROR_1"]) {
    expect(plans.find((plan) => plan.onshapeFeatureId === featureId)).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
    });
  }

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  const replays = actions.createFeatures?.filter(
    (action) => action.definition.kind === "featureReplay",
  ) ?? [];
  expect(replays.map((action) => action.definition.parameters.sourceFeatureIds)).toEqual([
    [{ kind: "featureOf", actionIndex: 3 }],
    [{ kind: "featureOf", actionIndex: 4 }],
    [{ kind: "featureOf", actionIndex: 5 }],
  ]);
});

test("src/domain/import/onshape/provider.spec.ts ambiguous probe leaves a face sketch and dependent extrude baked", async () => {
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeFaceSketchExtrudeBundle()),
    capabilities: capabilitiesWithProbe([
      probeSignature("face_a"),
      probeSignature("face_b"),
    ]),
  });
  const plans = review.providerReview.studios[0]!.featurePlans;

  expect(plans.find((plan) => plan.onshapeFeatureId === "S_FACE")).toMatchObject({
    tier: "baked",
  });
  expect(plans.find((plan) => plan.onshapeFeatureId === "E_FACE")).toMatchObject({
    tier: "baked",
    reasonCodes: ["needs-region-resolution"],
    suppressed: true,
  });
});

test("src/domain/import/onshape/provider.spec.ts ambiguous probe face sketch stays honestly baked", async () => {
  const source = sourceFromBundle(makeFaceSketchBundle());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([
      probeSignature("face_a"),
      probeSignature("face_b"),
    ]),
  });
  const faceSketch = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );

  expect(
    faceSketch?.tier === "baked" &&
      !faceSketch.reasonCodes.includes("sketch-on-probed-face"),
    "Ambiguous probe matches must not promote the face sketch; it stays honestly baked.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts an unresolved face sketch records why it stayed baked", async () => {
  // X.9.3 flywheel at the face-backed sketch seam. Both non-unique outcomes used
  // to return the plan unchanged, so the generic `needs-history-probe` copy hid
  // the real next root cause. The detail must name the wanted entity class, the
  // zero/one/many outcome, and a live-prefix census, without changing the tier.
  // The shipped fixture carries only `finalState` evidence, which exits earlier
  // at `sketch-face-on-checkpoint-body`. Give the sketch its own historyPoint
  // reference so the matcher is actually reached.
  const bundle = structuredClone(
    makeFaceSketchBundle(),
  ) as unknown as OnshapeCaptureBundleV2;
  bundle.partStudios[0]!.resolvedReferences = [
    {
      deterministicId: "face_ref",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "S_FACE",
      signature: {
        entityClass: "face",
        geometryType: "plane",
        definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
        centroid: [0.0005, 0.001, 0.003],
        boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
      },
    },
  ];
  const source = sourceFromBundle(bundle);

  const ambiguous = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([
      probeSignature("face_a"),
      probeSignature("face_b"),
    ]),
  });
  const ambiguousSketch = ambiguous.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );
  expect(ambiguousSketch?.tier).toBe("baked");
  expect(
    ambiguousSketch?.reasonDetail,
    "An ambiguous face sketch must name the tied live candidates and the live prefix.",
  ).toMatch(/matched 2 live faces, none uniquely/);
  expect(ambiguousSketch?.reasonDetail).toContain("live prefix 2:");

  const noMatch = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([]),
  });
  const noMatchSketch = noMatch.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );
  expect(noMatchSketch?.tier).toBe("baked");
  expect(
    noMatchSketch?.reasonDetail,
    "An empty live prefix must be reported as such, not as a silent unchanged plan.",
  ).toContain("live prefix 0: empty");
});

test("src/domain/import/onshape/provider.spec.ts contains an unbuildable feature and re-probes a failed face-backed sketch prefix", async () => {
  // A face-backed sketch can only be lifted onto a live face that apply will
  // actually present. When its prefix still contains a feature the live kernel
  // refuses, the prefix probe fails wholesale and the sketch sees no live faces
  // at all - a probe-session artifact, not a matching failure. The provider must
  // contain that refusal and re-probe, so the prefix is the one apply will build.
  //
  // Containment is deliberately lazy (it rebuilds the whole studio in the
  // kernel), so it must fire only after a sketch prefix actually failed.
  const bundle = structuredClone(
    makeFaceSketchBundle(),
  ) as unknown as OnshapeCaptureBundleV2;
  bundle.partStudios[0]!.resolvedReferences = [
    {
      deterministicId: "face_ref",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "S_FACE",
      signature: {
        entityClass: "face",
        geometryType: "plane",
        definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
        centroid: [0.0005, 0.001, 0.003],
        boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
      },
    },
  ];

  // The first `S_FACE` prefix probe refuses, standing in for a prefix that still
  // contains a feature the kernel cannot build; every later probe rebuilds.
  const probeOrder: string[] = [];
  let sketchPrefixProbes = 0;
  const probeCapabilities: ImportCapabilities = {
    ...capabilities,
    history: {
      async evaluateHistoryProbe(input) {
        const count = Math.max(1, input.actions.orderedActions?.length ?? 0);
        if (input.consumerFeatureId === "S_FACE") {
          sketchPrefixProbes += 1;
          probeOrder.push("sketchPrefix");
          if (sketchPrefixProbes === 1) {
            return {
              steps: [{
                status: "failed" as const,
                diagnostics: [{
                  severity: "error" as const,
                  code: "kernel-history-probe-step-failed",
                  message: "A prefix feature the kernel refuses.",
                }],
              }],
            };
          }
        } else if (input.includeFinalTessellation === undefined) {
          probeOrder.push("containment");
        }
        return {
          steps: Array.from({ length: count }, () => ({
            status: "rebuilt" as const,
            signatures: [probeSignature("face_match")],
          })),
        };
      },
    },
  };

  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(bundle),
    capabilities: probeCapabilities,
  });
  const faceSketch = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );

  expect(
    probeOrder[0],
    "Containment must be lazy: the sketch prefix is probed first, and containment only runs after it fails.",
  ).toBe("sketchPrefix");
  expect(
    probeOrder.slice(0, 3),
    JSON.stringify(probeOrder),
  ).toEqual(["sketchPrefix", "containment", "sketchPrefix"]);
  expect(
    OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming
      ? faceSketch?.reasonCodes.includes("sketch-on-probed-face")
      : faceSketch?.tier === "baked",
    "The re-probed prefix with one exact live face must promote the sketch.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts prefers the consumer-scoped historyPoint reference among duplicate deterministicIds", async () => {
  // Two resolved references share the deterministicId `face_ref`. The first is a
  // historyPoint captured for a *different* consumer and carries a signature that
  // sits far from the probed face; the second is the S_FACE consumer's own
  // historyPoint evidence and matches the probe. Consumer-aware selection must
  // pick the second — picking the first (source order) would fail to match and
  // leave the sketch baked.
  const bundle = structuredClone(
    makeFaceSketchBundle(),
  ) as unknown as OnshapeCaptureBundleV2;
  bundle.partStudios[0]!.resolvedReferences = [
    {
      deterministicId: "face_ref",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "SOME_OTHER_FEATURE",
      signature: {
        entityClass: "face",
        geometryType: "plane",
        definingData: { origin: [9, 9, 9], normal: [0, 0, 1] },
        centroid: [9, 9, 9],
        boundingBox: { low: [9, 9, 9], high: [9.001, 9.002, 9] },
      },
    },
    {
      deterministicId: "face_ref",
      evaluatedAt: "historyPoint",
      consumingFeatureId: "S_FACE",
      signature: {
        entityClass: "face",
        geometryType: "plane",
        definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
        centroid: [0.0005, 0.001, 0.003],
        boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
      },
    },
  ];
  const source = sourceFromBundle(bundle);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  const faceSketch = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );
  expect(
    OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming
      ? faceSketch?.tier === "parametric" &&
        faceSketch.reasonCodes.includes("sketch-on-probed-face")
      : faceSketch?.tier === "baked",
    "The consumer's own historyPoint signature must drive the probe match, not the first record sharing the deterministicId.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts a face sketch with only finalState evidence stays baked with sketch-face-on-checkpoint-body", async () => {
  // makeFaceSketchBundle ships a single `finalState` face reference and no
  // historyPoint evidence, so the probed face only exists on the checkpoint
  // (final-state) body. The planner must keep the sketch honestly baked with the
  // sketch-face-on-checkpoint-body reason rather than promoting on final-state
  // geometry.
  const source = sourceFromBundle(makeFaceSketchBundle());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  const faceSketch = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );
  expect(
    faceSketch?.tier === "baked" &&
      faceSketch.reasonCodes.includes("sketch-face-on-checkpoint-body") &&
      !faceSketch.reasonCodes.includes("sketch-on-probed-face"),
    "Final-state-only evidence must keep the face sketch baked with the checkpoint-body reason.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts fixed-point promotion resolves a stacked topology-consumer chain across iterations", async () => {
  // A parametric base body feeds two stacked transform consumers. C2 consumes the
  // body *after* C1 has moved it, so C2's pre-consumer prefix can only match once
  // C1 has itself been promoted to parametric. The fixed-point promotion loop
  // must therefore lift C1 first and re-derive C2's prefix before C2 can match —
  // a single non-iterative pass would leave C2 baked.
  const source = sourceFromBundle(makeStackedTransformChainBundle());
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([
      bodyProbeSignature("pre-C1", [0, 0, 0], [8, 8, 10]),
      bodyProbeSignature("pre-C2", [5, 0, 0], [13, 8, 10]),
    ]),
  });
  const studio = review.providerReview.studios[0]!;
  const tierOf = (featureId: string) =>
    studio.featurePlans.find((plan) => plan.onshapeFeatureId === featureId);
  expect(tierOf("E1"), JSON.stringify(studio.featurePlans)).toMatchObject({
    tier: "parametric",
  });
  expect(tierOf("C1"), JSON.stringify(studio.featurePlans)).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
  });
  expect(tierOf("C2"), JSON.stringify(studio.featurePlans)).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
  });
  expect(
    studio.bakeStrategy.kind,
    "A fully promoted chain needs no baked checkpoints.",
  ).toBe("none");
});

test("src/domain/import/onshape/provider.spec.ts review -> prepare pipeline", async () => {
  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const review = await onshapeImportProvider.review({ source, capabilities });
  expect(
    review.providerReview.valid && review.providerReview.studios.length === 2,
    "Review should validate the bundle and surface both Part Studios.",
  ).toBeTruthy();
  const fixtureRelationships = review.providerReview.studios
    .find((studio) => studio.elementId === FIXTURE_PART_STUDIO_ID)
    ?.sketchRelationshipSummaries.find(
      (entry) => entry.featureId === "FOoap8tw3jKAJf5_0",
    );
  expect(fixtureRelationships?.summary).toEqual({
    constraints: { carried: 1, dropped: 0 },
    dimensions: { carried: 1, dropped: 0 },
    derivations: { carried: 1, dropped: 0 },
  });

  const selections = onshapeImportProvider.createDefaultSelections(review);
  const schema = onshapeImportProvider.getReviewFormSchema(review, selections);
  expect(
    schema.sections.some((section) => section.id === "fidelity-report"),
    "The review form should include a per-feature fidelity report section.",
  ).toBeTruthy();
  expect(
    schema.sections.some((section) => section.id === "verification"),
    "The review form should surface verification status.",
  ).toBeTruthy();

  const relationshipSection = schema.sections.find(
    (section) => section.id === "sketch-relationships",
  );
  expect(
    relationshipSection,
    "The review form should include a sketch relationship carried/dropped summary section.",
  ).toBeDefined();
  const fidelitySection = schema.sections.find(
    (section) => section.id === "fidelity-report",
  );
  const selectedStudio = review.providerReview.studios.find(
    (studio) => studio.elementId === selections.studioElementId,
  );
  expect(fidelitySection).toBeDefined();
  for (const plan of selectedStudio?.featurePlans ?? []) {
    const field = fidelitySection?.fields.find(
      (candidate) => candidate.id === `feature-${plan.onshapeFeatureId}`,
    );
    expect(field?.kind).toBe("summary");
    const value = field?.kind === "summary" ? field.value : "";
    expect(value).toContain(`${plan.tier}`);
    for (const reason of plan.reasonCodes) {
      expect(
        value.includes(reason),
        `Review diagnostics must present ${reason} as human-readable copy.`,
      ).toBe(false);
    }
  }
  const sketchPlan = selectedStudio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "FOoap8tw3jKAJf5_0",
  );
  const sketchField = fidelitySection?.fields.find(
    (candidate) => candidate.id === `feature-${sketchPlan?.onshapeFeatureId}`,
  );
  expect(sketchField?.kind === "summary" && sketchField.value).toContain(
    "carried/dropped: constraints 1/0, dimensions 1/0, derivations 1/0",
  );

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections,
    capabilities,
  });

  expect(
    validateImportPreparedActions(actions).success,
    "Prepared actions (including the ordered sequence) should satisfy the contract invariants.",
  ).toBeTruthy();

  const orderedCount = actions.orderedActions?.length ?? 0;
  const totalActions =
    (actions.addDocumentVariables?.length ?? 0) +
    (actions.commitSketches?.length ?? 0) +
    (actions.createFeatures?.length ?? 0);
  expect(
    orderedCount === totalActions,
    "Every emitted parametric action should appear in the ordered sequence.",
  ).toBeTruthy();
  const preparedFixtureSketch = actions.commitSketches?.find(
    (commit) => commit.sketchLabel === "Sketch 1",
  );
  expect(preparedFixtureSketch?.definition.constraints.map((entry) => entry.kind)).toEqual([
    "horizontal",
    "fixPoint",
  ]);
  expect(preparedFixtureSketch?.definition.dimensions.map((entry) => entry.kind)).toEqual([
    "lineLength",
  ]);
  expect(
    preparedFixtureSketch?.definition.derivedRelationships?.map((entry) => entry.kind),
  ).toEqual(["offset"]);

  expect(
    actions.createFeatures?.some((action) => action.definition.kind === "extrude"),
    "A captured profile with a certified witness should emit its exact regionOf extrude action.",
  ).toBeTruthy();

  expect(
    actions.binding?.kind === "localFile" &&
      actions.binding.fingerprint === source.fingerprint,
    "Prepare should attach a local-file binding carrying the bundle fingerprint.",
  ).toBeTruthy();

  expect(
    actions.diagnostics?.some(
      (diagnostic) => diagnostic.code === "onshape-fidelity-summary",
    ),
    "Prepare should emit an honest per-tier fidelity summary diagnostic.",
  ).toBeTruthy();

  const cachedActions = await onshapeImportProvider.prepare({
    source: {
      ...source,
      bytes: new TextEncoder().encode("{ no second decode should occur }"),
    },
    review,
    selections,
    capabilities,
  });
  expect(
    validateImportPreparedActions(cachedActions).success,
    "Prepare should reuse the validated bundle and parsed studio owned by its review session.",
  ).toBeTruthy();
  expect(cachedActions.orderedActions).toEqual(actions.orderedActions);

  const invalidSource: ResolvedImportSource = {
    ...source,
    bytes: new TextEncoder().encode("{ not a bundle }"),
  };
  const invalidReview = await onshapeImportProvider.review({
    source: invalidSource,
    capabilities,
  });
  expect(
    !invalidReview.providerReview.valid &&
      invalidReview.diagnostics.some(
        (diagnostic) => diagnostic.code === "onshape-bundle-invalid",
      ),
    "An invalid bundle should fail review with a structured diagnostic and no studios.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts probe final tessellation drives full verification", async () => {
  const bundle = await assembleFixtureCaptureBundle();
  bundle.partStudios.find((studio) => studio.elementId === FIXTURE_PART_STUDIO_ID)!.groundTruth = {
    hasBodies: true,
    tessellationTolerance: 0.001,
    tessellatedFaces: {
      bodies: [{
        faces: [{
          facets: [{ vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] }],
        }],
      }],
    },
    step: "",
  };
  const source = sourceFromBundle(bundle);
  let requestedFinalTessellation = false;
  const review = await onshapeImportProvider.review({
    source,
    capabilities: {
      ...capabilities,
      history: {
        async evaluateHistoryProbe(input) {
          // Review runs several probes; only the verification probe needs the
          // final tessellation, so record that one happened rather than what
          // the last probe asked for.
          requestedFinalTessellation ||= input.includeFinalTessellation === true;
          return { steps: [], finalTessellation: { points: [0, 0, 0, 1000, 0, 0, 1000, 1000, 0] } };
        },
      },
    },
  });
  const studio = review.providerReview.studios.find(
    (candidate) => candidate.hasBodies,
  );

  expect(requestedFinalTessellation).toBe(true);
  expect(
    studio?.tierCounts.baked === 0 && studio.verification.status === "passing",
    "Certified profile evidence and a matching non-empty final tessellation should fully verify the fixture studio.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts no fabricated construction supports ship for a face sketch", async () => {
  const source = sourceFromBundle(makeFaceSketchBundle());
  const realProbeCapabilities = capabilitiesWithRealKernelProbe();

  const review = await onshapeImportProvider.review({
    source,
    capabilities: realProbeCapabilities,
  });
  const studio = review.providerReview.studios[0];
  const baseExtrude = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "E_BASE",
  );
  const faceSketch = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );

  expect(
    baseExtrude?.tier === "parametric",
    "The synthetic fixture must build a real parametric prefix before the face sketch probe runs.",
  ).toBeTruthy();
  expect(
    faceSketch?.tier === "baked" &&
      faceSketch.reasonCodes.includes("sketch-face-on-checkpoint-body"),
    "A face sketch whose plane resolves only on checkpoint-baked geometry stays honestly baked without fabricating a construction support.",
  ).toBeTruthy();

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: realProbeCapabilities,
  });

  expect(
    (actions.commitSketches ?? []).every(
      (sketch) =>
        sketch.plane.support.kind !== "construction" ||
        (!sketch.plane.support.constructionId.startsWith(
          "construction_import_captured_",
        ) &&
          !sketch.plane.support.constructionId.startsWith(
            "construction_pending_",
          )),
    ),
    "Prepared actions must never carry a fabricated captured-frame or pending construction support.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts studio bake emits a baked body from ground-truth tessellation", async () => {
  const bundle = makeFaceSketchBundle();
  const studio = bundle.partStudios[0]!;
  studio.groundTruth = {
    hasBodies: true,
    tessellationTolerance: 0.001,
    step: "",
    tessellatedFaces: {
      bodies: [
        {
          id: "ground-truth-body",
          faces: [
            {
              facets: [
                {
                  vertices: [
                    { x: 0, y: 0, z: 0 },
                    { x: 0.01, y: 0, z: 0 },
                    { x: 0, y: 0.01, z: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  } as never;
  const source = sourceFromBundle(bundle);
  const assetStore = createMemoryGeometryAssetStore();

  const bakeCapabilities = createImportCapabilities(
    {} as never,
    {
      document: { documentId: "doc_workspace", revisionId: "rev_1" },
    } as never,
    { assetStore },
  );

  const review = await onshapeImportProvider.review({
    source,
    capabilities: bakeCapabilities,
  });
  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: bakeCapabilities,
  });

  const bakedBody = actions.createFeatures?.find(
    (feature) => feature.definition.kind === "bakedBody",
  );
  expect(
    bakedBody?.definition.kind === "bakedBody" &&
      bakedBody.definition.parameters.format === "baked-mesh" &&
      bakedBody.definition.parameters.provenance.source === "onshape",
    "A studio bake should emit a bakedBody action with onshape provenance when baking succeeds.",
  ).toBeTruthy();
  if (!bakedBody || bakedBody.definition.kind !== "bakedBody") {
    throw new Error("Expected studio bake to create a bakedBody feature.");
  }
  expect(
    bakedBody.definition.parameters.replacement,
    "A final-studio bake must explicitly supersede preceding imported body outputs.",
  ).toMatchObject({ kind: "replaceBodyOutputs" });
  const storedBake = await assetStore.get(
    createGeometryAssetRecordFromReference(bakedBody.definition.parameters),
  );
  expect(storedBake.ok).toBeTruthy();
  if (!storedBake.ok)
    throw new Error("Expected baked asset bytes in the shared store.");
  expect(
    (
      JSON.parse(new TextDecoder().decode(storedBake.bytes)) as {
        components?: unknown[];
      }
    ).components,
    "Provider must preserve each raw tessellation body as an explicit source component.",
  ).toEqual([
    expect.objectContaining({
      sourceComponentKey: "onshape-body:ground-truth-body",
      indexStart: 0,
      indexCount: 1,
    }),
  ]);

  expect(
    actions.diagnostics?.every(
      (diagnostic) => diagnostic.code !== "onshape-bake-unavailable",
    ),
    "Successful baking should not emit the bake-unavailable fallback.",
  ).toBeTruthy();
  expect(
    actions.diagnostics?.find(
      (diagnostic) => diagnostic.code === "onshape-bake-segment-legacy-fallback",
    )?.message,
  ).toContain("capture-v1");
  expect(
    actions.diagnostics?.find(
      (diagnostic) => diagnostic.code === "onshape-fidelity-summary",
    )?.message,
  ).toContain("bake strategy: legacy whole-studio (capture-v1), 0 checkpoints");
});

test("src/domain/import/onshape/provider.spec.ts keeps omitted final geometry unavailable without treating bodies as absent", async () => {
  const bundle = makeFaceSketchBundle();
  bundle.partStudios[0]!.groundTruth = {
    hasBodies: true,
    omittedReason: "no-final-bake-boundary",
  };
  const source = sourceFromBundle(bundle);
  const capabilities = createImportCapabilities(
    {} as never,
    {
      document: { documentId: "doc_workspace", revisionId: "rev_1" },
    } as never,
    { assetStore: createMemoryGeometryAssetStore() },
  );

  const review = await onshapeImportProvider.review({ source, capabilities });
  expect(review.providerReview.studios[0]?.hasBodies).toBe(true);
  expect(review.providerReview.studios[0]?.verification).toEqual({ status: "noGroundTruth" });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  expect(actions.createFeatures?.some((feature) => feature.definition.kind === "bakedBody")).toBe(false);
  expect(actions.diagnostics).toContainEqual(expect.objectContaining({
    code: "onshape-bake-unavailable",
    message: expect.stringContaining("intentionally omitted"),
  }));
});

test("src/domain/import/onshape/provider.spec.ts emits selective segment checkpoints at their source boundaries", async () => {
  const bundle = makeSegmentedCheckpointBundle();
  const source = sourceFromBundle(bundle);
  const assetStore = createMemoryGeometryAssetStore();
  const segmentedCapabilities: ImportCapabilities = {
    ...createImportCapabilities(
      {} as never,
      {
        document: { documentId: "doc_workspace", revisionId: "rev_1" },
      } as never,
      { assetStore },
    ),
    history: {
      async evaluateHistoryProbe(input) {
        return {
          steps: (input.actions.orderedActions ?? []).map(() => ({
            status: "rebuilt" as const,
            signatures: [],
          })),
        };
      },
    },
  };

  const review = await onshapeImportProvider.review({
    source,
    capabilities: segmentedCapabilities,
  });
  const studio = review.providerReview.studios[0];
  expect(studio?.bakeDiagnostics).toEqual([]);
  expect(studio?.bakeStrategy).toMatchObject({
    kind: "segments",
    segments: [
      {
        boundaryFeatureId: "CHAMFER",
        checkpointBodyDeterministicIds: ["A"],
        replacementProducerFeatureIds: ["E_BASE"],
      },
      {
        boundaryFeatureId: "CHAMFER_TWO",
        checkpointBodyDeterministicIds: ["B"],
        replacementProducerFeatureIds: ["E_INDEPENDENT"],
      },
    ],
  });

  const selections = onshapeImportProvider.createDefaultSelections(review);
  const segmentedSchema = onshapeImportProvider.getReviewFormSchema(review, selections);
  const segmentSection = segmentedSchema.sections.find(
    (section) => section.id === "bake-segments",
  );
  expect(segmentSection?.fields).toEqual([
    expect.objectContaining({
      id: "bake-strategy",
      kind: "summary",
      value: "Segmented — 2 baked-body checkpoints.",
    }),
    expect.objectContaining({
      id: "bake-checkpoint-count",
      kind: "summary",
      value: expect.stringContaining("2 checkpoints"),
    }),
    expect.objectContaining({
      id: "bake-segment-1",
      label: "Checkpoint 1 — Chamfer",
      value: expect.stringMatching(
        /Feature span: Face sketch → Chamfer; output bodies: A; consumed: A; carried: none; replaces 1 prior producer action;.*tessellation-backed checkpoint; preflight limitations: none\./,
      ),
    }),
    expect.objectContaining({
      id: "bake-segment-2",
      label: "Checkpoint 2 — Second chamfer",
      value: expect.stringContaining("output bodies: B"),
    }),
  ]);
  const segmentedFidelity = segmentedSchema.sections.find(
    (section) => section.id === "fidelity-report",
  );
  const chamferReview = segmentedFidelity?.fields.find(
    (field) => field.id === "feature-CHAMFER",
  );
  const chamferValue = chamferReview?.kind === "summary" && typeof chamferReview.value === "string" ? chamferReview.value : "";
  expect(chamferReview).toMatchObject({
    kind: "summary",
    value: expect.stringContaining(
      "represented by bake segment 1; intrinsic reason retained above",
    ),
  });
  for (const reason of studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "CHAMFER",
  )?.reasonCodes ?? []) {
    expect(chamferValue).not.toContain(reason);
  }

  const noBakeReview = structuredClone(review);
  noBakeReview.providerReview.studios[0]!.bakeStrategy = { kind: "none" };
  noBakeReview.providerReview.studios[0]!.bakeDiagnostics = [];
  const noBakeSection = onshapeImportProvider
    .getReviewFormSchema(noBakeReview, selections)
    .sections.find((section) => section.id === "bake-segments");
  expect(noBakeSection?.fields).toEqual([
    expect.objectContaining({
      id: "bake-strategy",
      value: "None — no baked-body checkpoints are required.",
    }),
    expect.objectContaining({
      id: "bake-checkpoint-count",
      value: expect.stringContaining("0 checkpoints"),
    }),
  ]);

  const legacyReview = structuredClone(review);
  legacyReview.providerReview.studios[0]!.bakeStrategy = {
    kind: "wholeStudioLegacy",
    reason: "segment-preflight-failed",
  };
  legacyReview.providerReview.studios[0]!.bakeDiagnostics = [{
    code: "bake-segment-boundary-snapshot-missing",
    segmentId: "bake-segment-1",
    featureId: "CHAMFER",
    message: "Exact rollback boundary unavailable.",
  }];
  const legacySection = onshapeImportProvider
    .getReviewFormSchema(legacyReview, selections)
    .sections.find((section) => section.id === "bake-segments");
  expect(legacySection?.fields).toEqual([
    expect.objectContaining({
      id: "bake-strategy",
      value: "Legacy whole-studio bake — segment preflight could not prove a safe checkpoint.",
    }),
    expect.objectContaining({
      id: "bake-checkpoint-count",
      value: expect.stringContaining("0 checkpoints"),
    }),
    expect.objectContaining({
      id: "bake-diagnostic-bake-segment-1-CHAMFER",
      label: "Checkpoint limitation — Chamfer",
      value: "bake segment boundary snapshot is missing. Exact rollback boundary unavailable.",
    }),
  ]);

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: segmentedCapabilities,
  });
  expect(validateImportPreparedActions(actions).success).toBe(true);
  expect(
    actions.diagnostics?.filter(
      (diagnostic) => diagnostic.code === "onshape-bake-segment-planned",
    ),
  ).toHaveLength(2);
  expect(
    actions.diagnostics?.filter(
      (diagnostic) => diagnostic.code === "onshape-bake-segment-tessellation-backed",
    ),
  ).toHaveLength(2);
  expect(
    actions.diagnostics?.find(
      (diagnostic) => diagnostic.code === "onshape-fidelity-summary",
    )?.message,
  ).toContain("bake strategy: segmented, 2 checkpoints");
  expect(actions.orderedActions).toHaveLength(
    (actions.addDocumentVariables?.length ?? 0) +
      (actions.commitSketches?.length ?? 0) +
      (actions.createFeatures?.length ?? 0),
  );

  const checkpointCreateIndexes = (actions.createFeatures ?? []).flatMap(
    (request, index) => request.definition.kind === "bakedBody" ? [index] : [],
  );
  expect(checkpointCreateIndexes).toHaveLength(2);
  const checkpointOrderedIndexes = checkpointCreateIndexes.map(
    (createIndex) => actions.orderedActions?.findIndex(
      (action) => action.kind === "createFeature" && action.index === createIndex,
    ) ?? -1,
  );
  const variableOrderedIndex = actions.orderedActions?.findIndex(
    (action) => action.kind === "addDocumentVariable",
  ) ?? -1;
  expect(checkpointOrderedIndexes[0]).toBeGreaterThanOrEqual(0);
  expect(checkpointOrderedIndexes[0]).toBeLessThan(variableOrderedIndex);
  expect(checkpointOrderedIndexes[1]).toBeGreaterThan(variableOrderedIndex);

  const baseCreateIndex = actions.createFeatures?.findIndex(
    (request) => request.featureLabel === "Base extrude",
  ) ?? -1;
  const independentCreateIndex = actions.createFeatures?.findIndex(
    (request) => request.featureLabel === "Independent extrude",
  ) ?? -1;
  const baseOrderedIndex = actions.orderedActions?.findIndex(
    (action) => action.kind === "createFeature" && action.index === baseCreateIndex,
  ) ?? -1;
  const independentOrderedIndex = actions.orderedActions?.findIndex(
    (action) => action.kind === "createFeature" && action.index === independentCreateIndex,
  ) ?? -1;
  const checkpoints = checkpointCreateIndexes.map(
    (index) => actions.createFeatures?.[index],
  );
  if (checkpoints.some((checkpoint) => checkpoint?.definition.kind !== "bakedBody")) {
    throw new Error("Expected two interleaved bakedBody checkpoints.");
  }
  const [firstCheckpoint, secondCheckpoint] = checkpoints;
  if (
    !firstCheckpoint || firstCheckpoint.definition.kind !== "bakedBody" ||
    !secondCheckpoint || secondCheckpoint.definition.kind !== "bakedBody"
  ) {
    throw new Error("Expected narrowed bakedBody checkpoints.");
  }
  expect(firstCheckpoint.definition.parameters.replacement).toEqual({
    kind: "replaceBodyOutputs",
    actionIndexes: [baseOrderedIndex],
  });
  expect(
    firstCheckpoint.definition.parameters.replacement.actionIndexes,
  ).not.toContain(independentOrderedIndex);
  expect(firstCheckpoint.definition.parameters.provenance.featureSpan).toEqual({
    fromFeatureId: "S_FACE",
    toFeatureId: "CHAMFER",
  });
  expect(secondCheckpoint.definition.parameters.replacement).toEqual({
    kind: "replaceBodyOutputs",
    actionIndexes: [independentOrderedIndex],
  });
  expect(secondCheckpoint.definition.parameters.provenance.featureSpan).toEqual({
    fromFeatureId: "CHAMFER_TWO",
    toFeatureId: "CHAMFER_TWO",
  });
});

test("src/domain/import/onshape/provider.spec.ts promotes a captured-frame sketch and extrude after a body-only checkpoint", async () => {
  const source = sourceFromBundle(makeCapturedFrameCheckpointBundle());
  const assetStore = createMemoryGeometryAssetStore();
  const checkpointCapabilities: ImportCapabilities = {
    ...createImportCapabilities(
      {} as never,
      {
        document: { documentId: "doc_workspace", revisionId: "rev_1" },
      } as never,
      { assetStore },
    ),
    history: {
      async evaluateHistoryProbe(input) {
        return {
          steps: (input.actions.orderedActions ?? []).map(() => ({
            status: "rebuilt" as const,
            signatures: [],
          })),
        };
      },
    },
  };

  const review = await onshapeImportProvider.review({
    source,
    capabilities: checkpointCapabilities,
  });
  const studio = review.providerReview.studios[0]!;
  expect(studio.featurePlans.find((plan) => plan.onshapeFeatureId === "TRANSFORM")).toMatchObject({
    tier: "baked",
    reasonCodes: ["transform-rotation-angle-unreadable"],
  });
  expect(studio.featurePlans.find((plan) => plan.onshapeFeatureId === "S_FACE")).toMatchObject({
    tier: "parametric",
    reasonCodes: ["sketch-on-captured-frame"],
  });
  expect(studio.featurePlans.find((plan) => plan.onshapeFeatureId === "E_AFTER")).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
  });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: checkpointCapabilities,
  });
  expect(validateImportPreparedActions(actions).success).toBe(true);
  const checkpointOrderedIndex = actions.orderedActions?.findIndex((action) =>
    action.kind === "createFeature" &&
    actions.createFeatures?.[action.index]?.definition.kind === "bakedBody"
  ) ?? -1;
  const planeOrderedIndex = actions.orderedActions?.findIndex((action) =>
    action.kind === "createFeature" &&
    actions.createFeatures?.[action.index]?.featureLabel === "Face sketch captured support"
  ) ?? -1;
  const sketchOrderedIndex = actions.orderedActions?.findIndex((action) =>
    action.kind === "commitSketch" &&
    actions.commitSketches?.[action.index]?.sketchLabel === "Face sketch"
  ) ?? -1;
  const extrudeOrderedIndex = actions.orderedActions?.findIndex((action) =>
    action.kind === "createFeature" &&
    actions.createFeatures?.[action.index]?.featureLabel === "Extrude after checkpoint"
  ) ?? -1;
  expect(checkpointOrderedIndex).toBeLessThan(planeOrderedIndex);
  expect(planeOrderedIndex).toBeLessThan(sketchOrderedIndex);
  expect(sketchOrderedIndex).toBeLessThan(extrudeOrderedIndex);

  const supportPlane = actions.createFeatures?.find(
    (action) => action.featureLabel === "Face sketch captured support",
  );
  expect(supportPlane?.definition).toMatchObject({
    kind: "plane",
    parameters: { mode: "explicitFrame" },
  });
  const sketch = actions.commitSketches?.find((action) => action.sketchLabel === "Face sketch");
  expect(sketch?.plane.support).toEqual({
    kind: "constructionOf",
    actionIndex: planeOrderedIndex,
  });
  expect(JSON.stringify(sketch)).not.toContain('"kind":"face"');
  expect(actions.createFeatures?.some(
    (action) => action.featureLabel === "Extrude after checkpoint" &&
      action.definition.kind === "extrude",
  )).toBe(true);
});

test("src/domain/import/onshape/provider.spec.ts keeps a post-checkpoint sketch baked without unique planar frame evidence", async () => {
  const bundle = makeCapturedFrameCheckpointBundle();
  const studio = bundle.partStudios[0]!;
  studio.resolvedReferences = studio.resolvedReferences.map((reference) => ({
    ...reference,
    signature: "signature" in reference
      ? { ...reference.signature, geometryType: "cylinder" }
      : undefined,
  })) as typeof studio.resolvedReferences;
  const source = sourceFromBundle(bundle);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: capabilitiesWithProbe([]),
  });
  const reviewedStudio = review.providerReview.studios[0]!;
  expect(reviewedStudio.featurePlans.find((plan) => plan.onshapeFeatureId === "S_FACE")).toMatchObject({
    tier: "baked",
  });
  expect(reviewedStudio.featurePlans.find((plan) => plan.onshapeFeatureId === "E_AFTER")).toMatchObject({
    tier: "baked",
  });
  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: capabilitiesWithProbe([]),
  });
  expect(actions.createFeatures?.some(
    (action) => action.featureLabel === "Face sketch captured support",
  )).toBe(false);
});

test("src/domain/import/onshape/provider.spec.ts translates a recoverable cPlane to a parametric plane feature with a deferred sketch support", async () => {
  const source = sourceFromBundle(makeCPlaneSketchBundle({ recoverable: true }));
  const probeCapabilities = capabilitiesWithProbe([]);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: probeCapabilities,
  });
  const studio = review.providerReview.studios[0];
  const cPlane = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "C_PLANE",
  );
  const sketch = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_INCLINE",
  );

  expect(
    cPlane?.tier === "parametric" &&
      cPlane.target.kind === "plane" &&
      cPlane.reasonCodes.includes("plane-from-captured-frame"),
    "A recoverable cPlane must translate to a parametric plane feature with the captured-frame reason code.",
  ).toBeTruthy();
  expect(
    sketch?.tier === "parametric" &&
      sketch.reasonCodes.includes("sketch-on-translated-plane"),
    "A sketch on a translated cPlane must plan parametric and reference the translated plane.",
  ).toBeTruthy();

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: probeCapabilities,
  });

  const planeAction = (actions.createFeatures ?? []).find(
    (feature) => feature.definition?.kind === "plane",
  );
  expect(
    planeAction?.definition?.kind === "plane" &&
      planeAction.definition.parameters.mode === "explicitFrame",
    "Prepare must emit an explicit-frame plane feature for the translated cPlane.",
  ).toBeTruthy();
  const commit = actions.commitSketches?.[0];
  expect(
    commit?.plane.support.kind === "constructionOf",
    "The dependent sketch must defer its support to the plane feature via constructionOf.",
  ).toBeTruthy();

  // No prepared sketch may carry a support that no prepared action produces.
  expect(
    (actions.commitSketches ?? []).every(
      (entry) =>
        entry.plane.support.kind !== "construction" ||
        (!entry.plane.support.constructionId.startsWith(
          "construction_import_captured_",
        ) &&
          !entry.plane.support.constructionId.startsWith(
            "construction_pending_",
          )),
    ),
    "No prepared sketch may carry a fabricated construction support.",
  ).toBeTruthy();

  // The prepared actions must pass full contract validation, proving the
  // deferred constructionOf reference is legal and ordered.
  expect(
    validateImportPreparedActions(actions).success,
    "The translated plane + deferred sketch prepared actions must satisfy the import contract.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts leaves an unrecoverable cPlane baked and cascades to its dependent sketch", async () => {
  const source = sourceFromBundle(
    makeCPlaneSketchBundle({ recoverable: false }),
  );
  const probeCapabilities = capabilitiesWithProbe([]);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: probeCapabilities,
  });
  const studio = review.providerReview.studios[0];
  const cPlane = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "C_PLANE",
  );
  const sketch = studio?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_INCLINE",
  );

  expect(
    cPlane?.tier === "baked" &&
      !cPlane.reasonCodes.includes("plane-from-captured-frame"),
    "A cPlane whose geometry cannot be recovered must stay baked.",
  ).toBeTruthy();
  expect(
    sketch?.tier === "baked" &&
      !sketch.reasonCodes.includes("sketch-on-translated-plane"),
    "A sketch on an unrecoverable cPlane must degrade with it instead of shipping a fabricated support.",
  ).toBeTruthy();

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: probeCapabilities,
  });
  expect(
    (actions.commitSketches ?? []).every(
      (entry) => entry.plane.support.kind !== "constructionOf",
    ),
    "An unrecoverable cPlane must not leave a dangling constructionOf sketch support.",
  ).toBeTruthy();
});
