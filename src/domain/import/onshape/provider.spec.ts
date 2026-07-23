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
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import { makeWaveARevolveCaptureBundle } from "@/domain/import/onshape/wave-a-capture-fixtures";
import { makeWaveXSurfaceExtrudeCaptureBundle } from "@/domain/import/onshape/wave-x-capture-fixtures";
import { createImportCapabilities } from "@/domain/import/orchestrator";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { createGeometryAssetRecordFromReference } from "@/contracts/modeling/geometry-assets";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
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

test("src/domain/import/onshape/provider.spec.ts cannot promote a SURFACE Extrude 4 under review", async () => {
  const review = await onshapeImportProvider.review({
    source: sourceFromBundle(makeWaveXSurfaceExtrudeCaptureBundle()),
    capabilities: capabilitiesWithProbe([]),
  });
  expect(review.providerReview.valid).toBe(true);
  expect(review.providerReview.studios).toHaveLength(2);

  for (const studio of review.providerReview.studios) {
    const surface = studio.featurePlans.find((feature) => feature.label === "Extrude 4");
    expect(surface).toMatchObject({
      tier: "baked",
      reasonCodes: ["extrude-body-type-unsupported"],
      suppressed: true,
    });
    expect(surface?.plannedExtrude).toBeUndefined();

    const schema = onshapeImportProvider.getReviewFormSchema(review, {
      studioElementId: studio.elementId,
      demotedFeatureIds: [],
    });
    const field = schema.sections
      .find((section) => section.id === "fidelity-report")
      ?.fields.find((candidate) => candidate.id === `feature-${surface?.onshapeFeatureId}`);
    expect(field).toMatchObject({
      kind: "summary",
      value: expect.stringContaining("only solid extrudes can import as parametric solid features"),
    });
  }
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
    "40a51fb8fa82fd4565151114.onshape-capture.json",
    { parametric: 7, baked: 3, geometryOnly: 0 },
  ],
  [
    "9841e486906fa2ce62d74d8e.onshape-capture.json",
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
