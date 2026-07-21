import { expect, test } from "vitest";

import type {
  ImportCreateFeatureRequest,
  ImportDeferredTopologyRef,
} from "@/contracts/import/actions";
import type { BodyId, RevisionId, SketchId } from "@/contracts/shared/ids";
import { ImportDeferredMaterializer } from "@/domain/import/orchestrator";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";
import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";

function payload(bodyId: BodyId) {
  return createOccNativeExactBrepPayloadFromShimPayload({
    revisionId: "rev_live" as RevisionId,
    target: { kind: "body", bodyId },
    bodyId,
    bodyLabel: "Live box",
    nativePayload: parseNativeShimPayloadJson(JSON.stringify(boxFixture.exactBrep)),
  });
}

const livePayload = payload("body_live" as BodyId);
const derived = deriveKernelTopologySignaturesFromExactBrepPayload(livePayload);
if (derived.status !== "available") throw new Error("Expected fixture signatures.");

function selector(kind: "body" | "face" | "edge"): ImportDeferredTopologyRef {
  const signature = derived.signatures.find((entry) => entry.entityClass === kind)!;
  return {
    kind: "topologyOf",
    expectedKind: kind,
    capturedSignature: {
      entityClass: signature.entityClass,
      geometryType: signature.geometryType,
      definingData: signature.definingData,
      centroid: signature.centroid,
      boundingBox: signature.boundingBox,
    },
    tolerance: {
      linear: 0.001,
      angularRadians: 0.001,
      relative: 0.000001,
      ambiguityMargin: 0.000001,
    },
    source: {
      consumerFeatureId: "consumer",
      parameterId: kind,
      deterministicId: `source-${kind}`,
    },
  };
}

function materializer(bodyIds: BodyId[] = ["body_live" as BodyId]) {
  return new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_live",
            bodies: bodyIds.map((bodyId) => ({ bodyId })),
          },
        } as never;
      },
      async buildNativeExactBrepPayload(input) {
        return {
          kind: "nativeTopologyPayload" as const,
          payload: payload(input.target.bodyId),
          diagnostics: [],
        };
      },
    },
  });
}

function checkpointSelector(): ImportDeferredTopologyRef {
  return {
    kind: "topologyOf",
    expectedKind: "body",
    capturedSignature: {
      entityClass: "body",
      geometryType: "tessellated-body",
      boundingBox: { low: [0, 0, 0], high: [2, 4, 6] },
      centroid: [1, 2, 3],
    },
    tolerance: {
      linear: 0.001,
      angularRadians: 0.001,
      relative: 0.000001,
      ambiguityMargin: 0.000001,
    },
    source: {
      consumerFeatureId: "checkpoint-consumer",
      parameterId: "body",
      deterministicId: "source-checkpoint-body",
    },
  };
}

function bodyOnlyMaterializer(bodyIds: BodyId[]) {
  return new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_checkpoint",
            bodies: bodyIds.map((bodyId) => ({
              bodyId,
              topologyPresentation: "bodyOnlyMesh",
            })),
            render: {
              records: bodyIds.map((bodyId) => ({
                ownerBodyId: bodyId,
                geometry: {
                  kind: "mesh",
                  vertexPositions: [[0, 0, 0], [2, 4, 6]],
                },
              })),
            },
          },
        } as never;
      },
      async buildNativeExactBrepPayload() {
        throw new Error("body-only checkpoints must not request native topology");
      },
    },
  });
}

const basis = {
  contractVersion: "cadara-contract/v1alpha1",
  documentId: "doc_live",
  baseRevisionId: "rev_live",
  featureLabel: "Topology consumer",
} as const;

async function materialize(definition: unknown) {
  return materializer().materializeFeatureRequest(
    { ...basis, definition } as ImportCreateFeatureRequest,
    { kind: "createFeature", index: 0 },
  );
}

test("materializes topologyOf only in every blessed feature and sketch position", async () => {
  const requests = [
    await materialize({
      kind: "fillet",
      featureTypeVersion: "feature-type/fillet/v1alpha1",
      parameters: { edgeTargets: [selector("edge")], radius: { source: "literal", value: 1 } },
    }),
    await materialize({
      kind: "shell",
      featureTypeVersion: "feature-type/shell/v1alpha1",
      parameters: {
        bodyTarget: selector("body"),
        faceTargets: [selector("face")],
        thickness: { source: "literal", value: 1 },
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    }),
    await materialize({
      kind: "combine",
      featureTypeVersion: "advanced-solid-feature/v0",
      parameters: { participants: [{ role: "targetBody", targets: [selector("body")] }] },
    }),
    await materialize({
      kind: "plane",
      featureTypeVersion: "feature-type/plane/v1alpha1",
      parameters: { mode: "coplanar", reference: { target: selector("face") } },
    }),
  ];
  const sketch = await materializer().materializeCommitSketchRequest(
    { plane: { support: selector("face") } } as never,
    { kind: "commitSketch", index: 0 },
  );

  expect(JSON.stringify([...requests, sketch])).not.toContain("topologyOf");
  expect(requests[0]!.definition.kind).toBe("fillet");
  expect(sketch.plane.support.kind).toBe("face");
});


test("materializes deferred sketchPoint participants without changing body participants", async () => {
  const instance = materializer();
  instance.recordSketchOutput(0, "sketch_live" as SketchId);

  const request = await instance.materializeFeatureRequest(
    {
      ...basis,
      definition: {
        kind: "hole",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          participants: [
            {
              role: "location",
              targets: [
                {
                  kind: "sketchPoint",
                  sketchId: { kind: "sketchIdOf", actionIndex: 0 },
                  pointId: "sketch_point_hole_center",
                },
              ],
            },
            {
              role: "body",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
          ],
        },
      },
    } as ImportCreateFeatureRequest,
    { kind: "createFeature", index: 0 },
  );

  expect(JSON.stringify(request)).not.toContain("sketchIdOf");
  expect(request.definition).toMatchObject({
    kind: "hole",
    parameters: {
      participants: [
        {
          role: "location",
          targets: [
            {
              kind: "sketchPoint",
              sketchId: "sketch_live",
              pointId: "sketch_point_hole_center",
            },
          ],
        },
        {
          role: "body",
          targets: [{ kind: "body", bodyId: "body_target" }],
        },
      ],
    },
  });
});

test("materialized feature requests omit the import-only topology fallback property", async () => {
  const request = await materializer().materializeFeatureRequest(
    {
      ...basis,
      topologyFallback: undefined,
      definition: {
        kind: "extrude",
        featureTypeVersion: "feature-type/extrude/v1alpha1",
        parameters: {
          profiles: [{ kind: "region", sketchId: "sketch_live", regionId: "region_live" }],
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "throughAll", direction: "negative" },
          },
          operation: { source: "literal", value: "cut" },
          booleanScope: { kind: "targetBody", bodyId: "body_live" },
        },
      },
    } as ImportCreateFeatureRequest,
    { kind: "createFeature", index: 0 },
  );

  expect("topologyFallback" in request).toBe(false);
});

test("apply-time topology rematch resolves one body-only checkpoint from render evidence", async () => {
  const bodyId = "body_checkpoint" as BodyId;

  await expect(
    bodyOnlyMaterializer([bodyId]).resolveDeferredTopologyRef(checkpointSelector()),
  ).resolves.toEqual({ kind: "body", bodyId });
});

test("apply-time topology rematch rejects coincident body-only checkpoint ambiguity", async () => {
  await expect(
    bodyOnlyMaterializer([
      "body_checkpoint_a" as BodyId,
      "body_checkpoint_b" as BodyId,
    ]).resolveDeferredTopologyRef(checkpointSelector()),
  ).rejects.toThrow("Live topology rematch failed");
});

test("apply ambiguity swaps in the pre-registered baked fallback", async () => {
  const instance = materializer(["body_a" as BodyId, "body_b" as BodyId]);
  const request = await instance.materializeFeatureRequest(
    {
      ...basis,
      definition: {
        kind: "combine",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          participants: [{ role: "targetBody", targets: [selector("body")] }],
        },
      },
      topologyFallback: {
        ...basis,
        featureLabel: "Checkpoint",
        definition: {
          kind: "bakedBody",
          featureTypeVersion: "feature-type/baked-body/v1alpha1",
          parameters: {
            assetId: "asset_checkpoint",
            format: "baked-mesh",
            hash: `sha256:${"a".repeat(64)}`,
            byteLength: 1,
            label: "Checkpoint",
            provenance: { source: "onshape" },
            replacement: { kind: "replaceBodyOutputs", actionIndexes: [] },
          },
        },
      },
    } as ImportCreateFeatureRequest,
    { kind: "createFeature", index: 0 },
  );
  expect(request.definition.kind).toBe("bakedBody");
  expect(instance.takeTopologyFallbackSource()).toMatchObject({
    consumerFeatureId: "consumer",
    parameterId: "body",
  });
  expect(JSON.stringify(request)).not.toContain("topologyOf");
});


test("bodyOf requires exactly one producer body output", async () => {
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map([
      ["ordered:0", { bodyIds: ["body_a" as BodyId, "body_b" as BodyId] }],
    ]),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        throw new Error("not used");
      },
      async buildNativeExactBrepPayload() {
        throw new Error("not used");
      },
    },
  });

  await expect(
    instance.resolveDeferredValue(
      { kind: "bodyOf", actionIndex: 0 },
      { kind: "createFeature", index: 1 },
    ),
  ).rejects.toThrow("produced 2 body ids, expected exactly one");
});

test("materializes topologyOf body selectors in extrude and revolve boolean scopes", async () => {
  const bodyId = "body_checkpoint" as BodyId;
  const instance = bodyOnlyMaterializer([bodyId]);
  const target = checkpointSelector();

  for (const kind of ["extrude", "revolve"] as const) {
    const definition = kind === "extrude"
      ? {
          kind,
          featureTypeVersion: "feature-type/extrude/v1alpha1",
          parameters: {
            profiles: [{ kind: "region", sketchId: "sketch_profile", regionId: "region_profile" }],
            startExtent: { kind: "profilePlane" },
            extent: { mode: "oneSide", end: { kind: "blind", direction: "positive", distance: { source: "literal", value: 1 } } },
            operation: { source: "literal", value: "cut" },
            booleanScope: { kind: "targetBodies", bodyIds: [target] },
          },
        }
      : {
          kind,
          featureTypeVersion: "feature-type/revolve/v1alpha1",
          parameters: {
            profiles: [{ kind: "region", sketchId: "sketch_profile", regionId: "region_profile" }],
            axis: { kind: "sketchEntity", sketchId: "sketch_axis", entityId: "sketch_entity_axis" },
            startAngle: { source: "literal", value: 0 },
            extent: { mode: "oneSide", end: { kind: "full" } },
            operation: { source: "literal", value: "cut" },
            booleanScope: { kind: "targetBody", bodyId: target },
          },
        };
    const request = await instance.materializeFeatureRequest(
      { ...basis, definition } as ImportCreateFeatureRequest,
      { kind: "createFeature", index: 0 },
    );
    expect(JSON.stringify(request)).not.toContain("topologyOf");
    if (request.definition.kind === "extrude") {
      expect(request.definition.parameters.booleanScope).toEqual({
        kind: "targetBodies",
        bodyIds: [bodyId],
      });
    } else if (request.definition.kind === "revolve") {
      expect(request.definition.parameters.booleanScope).toEqual({
        kind: "targetBody",
        bodyId,
      });
    }
  }
});

test("materializes deferred revolve body scope and advanced construction participants", async () => {
  const outputRecords = new Map([
    ["ordered:0", { bodyIds: ["body_target" as BodyId] }],
    ["ordered:1", { constructionIds: ["construction_translated"] }],
  ]);
  const instance = new ImportDeferredMaterializer({
    outputRecords,
    modelingService: {
      async getCurrentDocumentSnapshot() {
        throw new Error("not used");
      },
      async buildNativeExactBrepPayload() {
        throw new Error("not used");
      },
    },
  });

  const revolve = await instance.materializeFeatureRequest({
    ...basis,
    definition: {
      kind: "revolve",
      featureTypeVersion: "feature-type/revolve/v1alpha1",
      parameters: {
        profiles: [{ kind: "region", sketchId: "sketch_profile", regionId: "region_profile" }],
        axis: { kind: "sketchEntity", sketchId: "sketch_axis", entityId: "sketch_entity_axis" },
        startAngle: { source: "literal", value: 0 },
        extent: { mode: "oneSide", end: { kind: "full" } },
        operation: { source: "literal", value: "cut" },
        booleanScope: { kind: "targetBody", bodyId: { kind: "bodyOf", actionIndex: 0 } },
      },
    },
  } as ImportCreateFeatureRequest, { kind: "createFeature", index: 0 });
  expect(revolve.definition).toMatchObject({
    kind: "revolve",
    parameters: { booleanScope: { kind: "targetBody", bodyId: "body_target" } },
  });

  const mirror = await instance.materializeFeatureRequest({
    ...basis,
    definition: {
      kind: "mirror",
      featureTypeVersion: "advanced-solid-feature/v0",
      parameters: {
        participants: [{ role: "plane", targets: [{ kind: "constructionOf", actionIndex: 1 }] }],
        options: { copy: true },
      },
    },
  } as ImportCreateFeatureRequest, { kind: "createFeature", index: 1 });
  expect(mirror.definition).toMatchObject({
    kind: "mirror",
    parameters: {
      participants: [{ role: "plane", targets: [{ kind: "construction", constructionId: "construction_translated" }] }],
    },
  });
});
