import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type {
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateImportPreparedActions } from "@/contracts/import/validation";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createBuiltinImportProviderRegistry } from "@/domain/import/builtin-provider-composition";
import {
  assembleFixtureCaptureBundle,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import { makeWaveARevolveCaptureBundle } from "@/domain/import/onshape/wave-a-capture-fixtures";
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

test("src/domain/import/onshape/provider.spec.ts real-bundle Wave A tier counts remain unchanged", async () => {
  const cases = [
    ["40a51fb8fa82fd4565151114.onshape-capture.json", { parametric: 6, baked: 4, geometryOnly: 0 }],
    ["9841e486906fa2ce62d74d8e.onshape-capture.json", { parametric: 6, baked: 35, geometryOnly: 0 }],
  ] as const;
  for (const [fileName, expected] of cases) {
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

test("src/domain/import/onshape/provider.spec.ts durable naming gate blocks unique face sketches", async () => {
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
    faceSketch?.tier === "baked" &&
      faceSketch.reasonCodes.includes("topology-durable-naming-unavailable"),
    "A unique face match must remain baked while durable subtopology naming is disabled.",
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
    actions.commitSketches?.some((sketch) => sketch.plane.support.kind === "face"),
  ).toBe(false);
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
      faceSketch.reasonCodes.includes("topology-durable-naming-unavailable"),
    "A face sketch must not ship a subtopology support while durable naming is disabled.",
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
