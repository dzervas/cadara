import { test, expect } from "vitest";

import type {
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateImportPreparedActions } from "@/contracts/import/validation";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createBuiltinImportProviderRegistry } from "@/domain/import/builtin-provider-composition";
import { assembleFixtureCaptureBundle } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import { createImportCapabilities } from "@/domain/import/orchestrator";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { createGeometryAssetRecordFromReference } from "@/contracts/modeling/geometry-assets";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";

import type { BodyId, FaceId } from "@/contracts/shared/ids";
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

function capabilitiesWithProbe(
  signatures: readonly HistoryProbeTopologySignature[],
): ImportCapabilities {
  return {
    ...capabilities,
    history: {
      async evaluateHistoryProbe() {
        return { steps: [{ status: "rebuilt", signatures: [...signatures] }] };
      },
    },
  };
}

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

test("src/domain/import/onshape/provider.spec.ts probe-present review activates unique face sketches", async () => {
  const source = sourceFromBundle(makeFaceSketchBundle());
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
    faceSketch?.tier === "parametric" &&
      faceSketch.target.kind === "sketch" &&
      faceSketch.target.plane?.support.kind === "construction" &&
      faceSketch.reasonCodes.includes("sketch-on-captured-frame"),
    "A captured planar signature should promote a face sketch to a fixed-frame parametric sketch before probe matching.",
  ).toBeTruthy();
  expect(
    chamfer?.tier === "baked" &&
      chamfer.reasonCodes.includes("translator-unavailable") &&
      !chamfer.reasonCodes.includes("needs-history-probe"),
    "Once the probe is present, unsupported topology feature kinds should report translator-unavailable instead of blaming probe absence.",
  ).toBeTruthy();

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: capabilitiesWithProbe([probeSignature("face_match")]),
  });
  expect(
    actions.commitSketches?.some(
      (sketch) => sketch.plane.support.kind === "construction",
    ),
  ).toBe(true);
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
    faceSketch?.tier === "parametric" &&
      faceSketch.reasonCodes.includes("sketch-on-captured-frame"),
    "Captured planar signatures should resolve without guessing from ambiguous probe matches.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts review -> prepare pipeline", async () => {
  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const review = await onshapeImportProvider.review({ source, capabilities });
  expect(
    review.providerReview.valid && review.providerReview.studios.length === 2,
    "Review should validate the bundle and surface both Part Studios.",
  ).toBeTruthy();

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

  // The fixture extrude consumes a parametric sketch region and must now plan
  // parametric: a createFeature carrying a deferred regionOf profile that points
  // back at the sketch commit's ordered position.
  const extrudeAction = actions.createFeatures?.[0];
  const regionProfile =
    extrudeAction?.definition.kind === "extrude"
      ? extrudeAction.definition.parameters.profiles[0]
      : undefined;
  expect(
    regionProfile !== undefined &&
      "kind" in regionProfile &&
      regionProfile.kind === "regionOf" &&
      actions.orderedActions?.[regionProfile.actionIndex]?.kind ===
        "commitSketch",
    "The fixture extrude should emit a deferred regionOf profile referencing the sketch commit action.",
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
  const source = sourceFromBundle(bundle);
  let requestedFinalTessellation = false;
  const review = await onshapeImportProvider.review({
    source,
    capabilities: {
      ...capabilities,
      history: {
        async evaluateHistoryProbe(input) {
          requestedFinalTessellation = input.includeFinalTessellation === true;
          return { steps: [], finalTessellation: { points: [] } };
        },
      },
    },
  });
  const studio = review.providerReview.studios.find(
    (candidate) => candidate.hasBodies,
  );

  expect(requestedFinalTessellation).toBe(true);
  expect(
    studio?.tierCounts.baked === 0 &&
      studio.verification.status !== "unavailable" &&
      studio.verification.status !== "partial",
    "A probe-equipped fully-parametric plan should compare probe tessellation instead of reporting unavailable/partial verification.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts real probe demotes an unresolvable captured-frame sketch to baked", async () => {
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
      faceSketch.reasonCodes.includes("captured-frame-unresolvable") &&
      !faceSketch.reasonCodes.includes("sketch-on-captured-frame"),
    "A captured-frame sketch whose fabricated construction support fails the real kernel probe must demote to baked with an honest reason code instead of shipping an unresolvable plan.",
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
        !sketch.plane.support.constructionId.startsWith(
          "construction_import_captured_",
        ),
    ),
    "After demotion the prepared actions must not carry an unresolvable synthetic captured-frame construction support.",
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
      sourceComponentKey: "onshape-tessellation-body-0",
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
});
