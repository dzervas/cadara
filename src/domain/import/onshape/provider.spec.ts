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
              featureId: "S_FACE",
              entities: [
                {
                  sketchEntityId: "circle_1",
                  sketchEntityType: "skCircle",
                  geometry: { center3d: { x: 0.001, y: 0.001, z: 0 }, radius: 0.001 },
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
              definingData: { origin: [0, 0, 0.001], normal: [0, 0, 1] },
              centroid: [0.001, 0.001, 0.001],
              boundingBox: { low: [0, 0, 0.001], high: [0.002, 0.002, 0.001] },
            },
          },
        ],
        groundTruth: { hasBodies: true, tessellationTolerance: 0.001, tessellatedFaces: {}, step: "" },
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
      origin: [0, 0, 1],
      normal: [0, 0, 1],
      xDirection: [1, 0, 0],
    },
    centroid: [1, 1, 1],
    boundingBox: { low: [0, 0, 1], high: [2, 2, 1] },
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
      faceSketch.target.plane?.support.kind === "face" &&
      faceSketch.reasonCodes.includes("sketch-on-probed-face"),
    "A unique probe signature match should promote a face sketch to a parametric sketch on that face.",
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
  expect(actions.commitSketches?.[0]?.plane.support.kind).toBe("face");
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
      faceSketch.reasonCodes.includes("needs-history-probe"),
    "Ambiguous probe matches must degrade rather than guessing a face sketch support.",
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
