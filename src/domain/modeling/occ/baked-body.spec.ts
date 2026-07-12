import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  BAKED_BODY_FEATURE_SCHEMA_VERSION,
  CONTRACT_VERSION,
} from "@/contracts/shared/versioning";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId, GeometryAssetId } from "@/contracts/shared/ids";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  type OccAuthoringFeatureRecord,
} from "@/domain/modeling/occ/authoring-state";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import {
  createMemoryGeometryAssetStore,
  hashGeometryAssetBytes,
} from "@/domain/modeling/geometry-asset-store";
import {
  createGeometryAssetRecordFromReference,
  type BakedGeometryAssetReference,
} from "@/contracts/modeling/geometry-assets";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";

async function getBrowserOpenCascadeInstance() {
  const module = (await import("../../../../public/cadara-occ.js")) as {
    default: new (
      input: Record<string, unknown>,
    ) => Promise<OpenCascadeInstance>;
  };
  return new module.default({
    wasmBinary: new Uint8Array(
      await readFile(
        new URL("../../../../public/cadara-occ.wasm", import.meta.url),
      ),
    ),
  });
}

function makeBakedMeshBytes() {
  return new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      indices: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    }),
  );
}
function makeOpenBakedMeshBytes() {
  return new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      indices: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
      ],
    }),
  );
}

function cubeTriangles(
  originX: number,
  originY: number,
  originZ: number,
  size: number,
) {
  const corners = [
    [originX, originY, originZ],
    [originX + size, originY, originZ],
    [originX + size, originY + size, originZ],
    [originX, originY + size, originZ],
    [originX, originY, originZ + size],
    [originX + size, originY, originZ + size],
    [originX + size, originY + size, originZ + size],
    [originX, originY + size, originZ + size],
  ];
  const quads = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  const vertices: number[][] = [];
  const indices: number[][] = [];
  for (const quad of quads) {
    const base = vertices.length;
    vertices.push(
      corners[quad[0]!]!,
      corners[quad[1]!]!,
      corners[quad[2]!]!,
      corners[quad[3]!]!,
    );
    indices.push([base, base + 1, base + 2]);
    indices.push([base, base + 2, base + 3]);
  }
  return { vertices, indices };
}

// A multi-solid baked-mesh soup: two spatially-disjoint cubes concatenated into
// one vertex/index buffer, matching how the Onshape provider flattens a
// split-part/booleanBodies studio (several bodies) into a single baked asset.
function makeTwoDisjointCubesBytes() {
  const first = cubeTriangles(0, 0, 0, 10);
  const second = cubeTriangles(50, 0, 0, 10);
  const vertices = [...first.vertices];
  const indices = [...first.indices];
  const offset = first.vertices.length;
  vertices.push(...second.vertices);
  indices.push(
    ...second.indices.map((triangle) =>
      triangle.map((index) => index + offset),
    ),
  );
  return new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices,
      indices,
      components: [
        {
          sourceComponentKey: "captured-body-0",
          indexStart: 0,
          indexCount: first.indices.length,
        },
        {
          sourceComponentKey: "captured-body-1",
          indexStart: first.indices.length,
          indexCount: second.indices.length,
        },
      ],
    }),
  );
}

const PLACEHOLDER_HASH =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;

function bakedBodyDefinition(
  assetId: GeometryAssetId,
  hash: string = PLACEHOLDER_HASH,
  byteLength = 128,
): FeatureDefinition {
  return {
    kind: "bakedBody",
    featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
    parameters: {
      assetId,
      format: "baked-mesh",
      hash: hash as BakedGeometryAssetReference["hash"],
      byteLength,
      label: "Persisted baked body",
      provenance: {
        source: "onshape",
        sourceName: "Reopened studio",
        reason: "test-bake",
      },
    },
  };
}

test("OCC bakedBody materializes resolved baked-mesh assets as durable bodies and reuses the shape cache", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const assetId = "asset_occ_baked_mesh" as GeometryAssetId;
  const definition = bakedBodyDefinition(assetId);
  const feature: OccAuthoringFeatureRecord = {
    featureId: "feature_occ_baked" as FeatureId,
    definition,
    label: "Persisted baked body",
    suppressed: false,
  };
  const state = createOccAuthoringState(oc, {
    resolvedGeometryAssets: new Map([
      [assetId, { bytes: makeBakedMeshBytes(), format: "baked-mesh" }],
    ]),
  });

  const rebuilt = applyOccFeatureToAuthoringState(state, feature);
  const rebuiltAgain = applyOccFeatureToAuthoringState(state, feature);

  expect(rebuilt.bodies[0]?.bodyId).toBe("body_feature_occ_baked");
  expect(rebuilt.bodies[0]?.topology.faceIds.length).toBeGreaterThan(0);
  expect(rebuilt.features[0]?.producedTargets).toEqual([
    { kind: "body", bodyId: "body_feature_occ_baked" },
  ]);
  expect(state.bakedShapeCache.has(assetId)).toBeTruthy();
  expect(rebuiltAgain.bodies[0]?.topology.faceIds.length).toBe(
    rebuilt.bodies[0]?.topology.faceIds.length,
  );
});

test("OCC bakedBody materializes every disjoint solid in the browser-native OCC build", async () => {
  const oc = await getBrowserOpenCascadeInstance();
  const assetId = "asset_occ_browser_multi_solid_mesh" as GeometryAssetId;
  const rebuilt = applyOccFeatureToAuthoringState(
    createOccAuthoringState(oc, {
      resolvedGeometryAssets: new Map([
        [assetId, { bytes: makeTwoDisjointCubesBytes(), format: "baked-mesh" }],
      ]),
    }),
    {
      featureId: "feature_occ_browser_baked" as FeatureId,
      definition: bakedBodyDefinition(assetId),
      label: "Browser baked body",
      suppressed: false,
    },
  );

  expect(rebuilt.diagnostics).toEqual([]);
  expect(rebuilt.bodies).toHaveLength(2);
  expect(rebuilt.bodies[0]?.topology.faceIds.length).toBeGreaterThan(0);
  expect(rebuilt.bodies[1]?.topology.faceIds.length).toBeGreaterThan(0);
});

test("OCC bakedBody materializes declared source components without topology inference", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const assetId = "asset_occ_multi_solid_mesh" as GeometryAssetId;
  const feature: OccAuthoringFeatureRecord = {
    featureId: "feature_occ_multi_solid" as FeatureId,
    definition: bakedBodyDefinition(assetId),
    label: "Multi solid baked body",
    suppressed: false,
  };
  const state = createOccAuthoringState(oc, {
    resolvedGeometryAssets: new Map([
      [assetId, { bytes: makeTwoDisjointCubesBytes(), format: "baked-mesh" }],
    ]),
  });

  const rebuilt = applyOccFeatureToAuthoringState(state, feature);

  expect(
    rebuilt.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  ).toEqual([]);
  expect(
    rebuilt.bodies.map(({ bodyId, label }) => ({ bodyId, label })),
  ).toEqual([
    {
      bodyId: "body_feature_occ_multi_solid_1",
      label: "Persisted baked body 1",
    },
    {
      bodyId: "body_feature_occ_multi_solid_2",
      label: "Persisted baked body 2",
    },
  ]);
  // Both bodies come from authoritative source ranges, not geometry-based splitting.
  expect(rebuilt.bodies[0]?.topology.faceIds.length).toBeGreaterThan(0);
  expect(rebuilt.bodies[1]?.topology.faceIds.length).toBeGreaterThan(0);
  expect(rebuilt.features[0]?.producedTargets).toEqual([
    { kind: "body", bodyId: "body_feature_occ_multi_solid_1" },
    { kind: "body", bodyId: "body_feature_occ_multi_solid_2" },
  ]);
});

test("OCC bakedBody keeps coincident source bodies separate when component metadata declares them", async () => {
  const cube = cubeTriangles(0, 0, 0, 10);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [...cube.vertices, ...cube.vertices],
      indices: [
        ...cube.indices,
        ...cube.indices.map((triangle) =>
          triangle.map((index) => index + cube.vertices.length),
        ),
      ],
      components: [
        {
          sourceComponentKey: "onshape-body-a",
          indexStart: 0,
          indexCount: cube.indices.length,
        },
        {
          sourceComponentKey: "onshape-body-b",
          indexStart: cube.indices.length,
          indexCount: cube.indices.length,
        },
      ],
    }),
  );
  const assetId = "asset_occ_coincident_bodies" as GeometryAssetId;
  const rebuilt = applyOccFeatureToAuthoringState(
    createOccAuthoringState(await getDefaultOpenCascadeInstance(), {
      resolvedGeometryAssets: new Map([
        [assetId, { bytes, format: "baked-mesh" }],
      ]),
    }),
    {
      featureId: "feature_occ_coincident_bodies" as FeatureId,
      definition: bakedBodyDefinition(assetId),
      label: "Coincident source bodies",
      suppressed: false,
    },
  );

  expect(rebuilt.diagnostics).toEqual([]);
  expect(rebuilt.bodies).toHaveLength(2);
});

test("OCC bakedBody rejects a declared component containing disconnected shells", async () => {
  const assetId = "asset_occ_invalid_declared_group" as GeometryAssetId;
  const first = cubeTriangles(0, 0, 0, 10);
  const second = cubeTriangles(50, 0, 0, 10);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [...first.vertices, ...second.vertices],
      indices: [
        ...first.indices,
        ...second.indices.map((triangle) =>
          triangle.map((index) => index + first.vertices.length),
        ),
      ],
      components: [
        {
          sourceComponentKey: "compound-without-solid-groups",
          indexStart: 0,
          indexCount: first.indices.length + second.indices.length,
        },
      ],
    }),
  );
  const rebuilt = applyOccFeatureToAuthoringState(
    createOccAuthoringState(await getDefaultOpenCascadeInstance(), {
      resolvedGeometryAssets: new Map([
        [assetId, { bytes, format: "baked-mesh" }],
      ]),
    }),
    {
      featureId: "feature_occ_invalid_declared_group" as FeatureId,
      definition: bakedBodyDefinition(assetId),
      label: "Invalid declared group",
      suppressed: false,
    },
  );

  expect(rebuilt.bodies).toEqual([]);
  expect(rebuilt.diagnostics).toEqual([
    expect.objectContaining({
      code: "baked-body-materializationFailed",
      message: expect.stringContaining(
        "source must provide one explicit component per solid",
      ),
    }),
  ]);
});

test("OCC bakedBody rejects an open mesh with a structured materialization diagnostic", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const assetId = "asset_occ_open_mesh" as GeometryAssetId;
  const rebuilt = applyOccFeatureToAuthoringState(
    createOccAuthoringState(oc, {
      resolvedGeometryAssets: new Map([
        [assetId, { bytes: makeOpenBakedMeshBytes(), format: "baked-mesh" }],
      ]),
    }),
    {
      featureId: "feature_occ_open_mesh" as FeatureId,
      definition: bakedBodyDefinition(assetId),
      label: "Open baked body",
      suppressed: false,
    },
  );

  expect(rebuilt.bodies).toEqual([]);
  expect(rebuilt.diagnostics).toEqual([
    expect.objectContaining({
      code: "baked-body-materializationFailed",
      detail: expect.objectContaining({
        kind: "bakedBody",
        reason: "materializationFailed",
      }),
    }),
  ]);
});

test("OCC bakedBody reports a structured diagnostic when the pre-resolved asset map is missing the asset", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const assetId = "asset_occ_missing_mesh" as GeometryAssetId;
  const feature: OccAuthoringFeatureRecord = {
    featureId: "feature_occ_missing_baked" as FeatureId,
    definition: bakedBodyDefinition(assetId),
    label: "Missing baked body",
    suppressed: false,
  };

  const rebuilt = applyOccFeatureToAuthoringState(
    createOccAuthoringState(oc),
    feature,
  );

  expect(rebuilt.bodies.length).toBe(0);
  expect(
    rebuilt.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "baked-body-assetMissing" &&
        diagnostic.detail?.kind === "bakedBody" &&
        diagnostic.detail.reason === "assetMissing",
    ),
  ).toBeTruthy();
});

test("OCC adapter rebuilds a reopened bakedBody document from the persisted asset store with no session state", async () => {
  const assetId = "asset_reopened_baked_mesh" as GeometryAssetId;

  // Persist bytes exactly as bakeGeometry would, then reconstruct the store
  // record purely from the definition-carried reference.
  const store = createMemoryGeometryAssetStore();
  const bytes = makeBakedMeshBytes();
  const hash = await hashGeometryAssetBytes(bytes);
  const reference: BakedGeometryAssetReference = {
    assetId,
    format: "baked-mesh",
    hash,
    byteLength: bytes.byteLength,
  };
  const putResult = await store.put({
    asset: createGeometryAssetRecordFromReference(reference),
    bytes,
  });
  expect(putResult.ok).toBeTruthy();

  const definition = bakedBodyDefinition(assetId, hash, bytes.byteLength);
  const document: AuthoredModelDocument = {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
    name: "Reopened baked document",
    revisionId: "rev_0002" as never,
    settings: OCC_KERNEL_SETTINGS,
    variables: [],
    sketches: [],
    features: [
      {
        featureId: "feature_reopened_baked" as FeatureId,
        label: "Reopened baked body",
        suppressed: false,
        definition,
      },
    ],
    featureOrder: ["feature_reopened_baked" as FeatureId],
    historyOrder: [
      { kind: "feature", featureId: "feature_reopened_baked" as FeatureId },
    ],
    cursor: {
      kind: "feature",
      featureId: "feature_reopened_baked" as FeatureId,
    },
    bodyLabels: [],
    assets: { schemaVersion: "geometry-asset-manifest/v1alpha1", records: [] },
    embeddedBinaryAssets: [],
  };

  // A COMPLETELY FRESH adapter/resolver: it holds only the persisted store and
  // resolves strictly from the definition-carried reference — no shared registry.
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: new SketchConstraintSolverAdapter({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: document.revisionId,
    }),
    getOpenCascadeInstance: getBrowserOpenCascadeInstance,
    assetResolver: {
      async resolveGeometryAsset(requestedReference) {
        const stored = await store.get(
          createGeometryAssetRecordFromReference(requestedReference),
        );
        return stored.ok
          ? { bytes: stored.bytes.slice(), format: requestedReference.format }
          : null;
      },
    },
  });

  await adapter.restoreAuthoredModelDocument(document);
  const { snapshot } = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  });

  expect(snapshot.document.bodies).toEqual([
    expect.objectContaining({
      bodyId: "body_feature_reopened_baked",
      label: "Persisted baked body",
    }),
  ]);
  expect(snapshot.document.features).toEqual([
    expect.objectContaining({
      featureId: "feature_reopened_baked",
      producedTargets: [
        { kind: "body", bodyId: "body_feature_reopened_baked" },
      ],
    }),
  ]);
});
