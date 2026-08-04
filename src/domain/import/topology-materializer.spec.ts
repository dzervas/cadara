import { expect, test } from "vitest";

import type {
  ImportCreateFeatureRequest,
  ImportDeferredTopologyRef,
} from "@/contracts/import/actions";
import { deriveImportRegionBoundaryIdentity } from "@/contracts/import/region-boundary-identity";
import type { BodyId, RevisionId, SketchId } from "@/contracts/shared/ids";
import type { RegionRecord } from "@/contracts/sketch/schema";
import { ImportDeferredMaterializer } from "@/domain/import/orchestrator";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";
import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";

function region(regionId: string, entityId = "boundary"): RegionRecord {
  return {
    regionId: regionId as RegionRecord["regionId"],
    isClosed: true,
    loops: [{
      loopId: `loop_${regionId}` as RegionRecord["loops"][number]["loopId"],
      role: "outer",
      orientation: "counterClockwise",
      isClosed: true,
      boundaryPointIds: [],
      segments: [{
        source: { kind: "entity", entityId },
        sourceSegmentOrdinal: 0,
        traversalDirection: "forward",
        startPointId: null,
        endPointId: null,
      }],
    }],
  } as RegionRecord;
}

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

function selector(kind: "body" | "face" | "edge" | "vertex"): ImportDeferredTopologyRef {
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

// Lane: logic. Seam: multiple topologyOf selectors materialized at one live
// revision share one exact-BRep signature derivation; a revision change misses.
test("caches exact live topology signatures per modeling revision", async () => {
  let revisionId = "rev_live" as RevisionId;
  let exactPayloadCalls = 0;
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId,
            bodies: [{ bodyId: "body_live" as BodyId }],
          },
        } as never;
      },
      async buildNativeExactBrepPayload(input) {
        exactPayloadCalls += 1;
        return {
          kind: "nativeTopologyPayload" as const,
          payload: payload(input.target.bodyId),
          diagnostics: [],
        };
      },
    },
  });

  await expect(instance.resolveDeferredTopologyRef(selector("face"))).resolves.toMatchObject({
    kind: "face",
  });
  await expect(instance.resolveDeferredTopologyRef(selector("edge"))).resolves.toMatchObject({
    kind: "edge",
  });
  expect(exactPayloadCalls).toBe(1);

  revisionId = "rev_next" as RevisionId;
  instance.invalidateLiveSignatures();
  await instance.resolveDeferredTopologyRef(selector("body"));
  expect(exactPayloadCalls).toBe(2);
});

// Lane: logic. Seam: an exact body scope limits native signature extraction to
// that body rather than deriving and subsequently discarding sibling bodies.
test("derives live topology only for an exact selector body scope", async () => {
  const exactPayloadBodies: BodyId[] = [];
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_scoped",
            bodies: [
              { bodyId: "body_target" as BodyId },
              { bodyId: "body_unrelated" as BodyId },
            ],
          },
        } as never;
      },
      async buildNativeExactBrepPayload(input) {
        exactPayloadBodies.push(input.target.bodyId);
        return {
          kind: "nativeTopologyPayload" as const,
          payload: payload(input.target.bodyId),
          diagnostics: [],
        };
      },
    },
  });
  const face = {
    ...selector("face"),
    bodyScope: "body_target" as BodyId,
  };
  const edge = {
    ...selector("edge"),
    bodyScope: "body_target" as BodyId,
  };

  await expect(instance.resolveDeferredTopologyRef(face)).resolves.toMatchObject({
    kind: "face",
    bodyId: "body_target",
  });
  await instance.resolveDeferredTopologyRef(edge);
  expect(exactPayloadBodies).toEqual(["body_target"]);
});

// Lane: logic. Seam: probe-sampled exact signatures seed the deferred
// materializer at the same immutable revision without another snapshot.
test("resolves from primed exact signatures without resnapshotting", async () => {
  let snapshotCalls = 0;
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        snapshotCalls += 1;
        throw new Error("primed signatures must avoid a redundant snapshot");
      },
      async buildNativeExactBrepPayload() {
        throw new Error("primed signatures must avoid redundant native extraction");
      },
    },
  });
  instance.primeLiveSignatures("rev_live" as RevisionId, {
    status: "available",
    signatures: derived.signatures,
    diagnostics: [],
  });

  await expect(
    instance.resolveDeferredTopologyRef({
      ...selector("face"),
      bodyScope: "body_live" as BodyId,
    }),
  ).resolves.toMatchObject({ kind: "face", bodyId: "body_live" });
  expect(snapshotCalls).toBe(0);
});

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
        featureTypeVersion: "feature-type/extrude/v1alpha2",
        parameters: {
          resultBodyType: "solid",
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

test("materializes an exact deferred planar face profile before an extrude applies", async () => {
  const request = await materializer().materializeFeatureRequest(
    {
      ...basis,
      definition: {
        kind: "extrude",
        featureTypeVersion: "feature-type/extrude/v1alpha2",
        parameters: {
          resultBodyType: "solid",
          profiles: [selector("face")],
          startExtent: { kind: "profilePlane" },
          extent: { mode: "oneSide", end: { kind: "throughAll", direction: "positive" } },
          operation: { source: "literal", value: "newBody" },
          booleanScope: { kind: "standalone" },
        },
      },
    } as ImportCreateFeatureRequest,
    { kind: "createFeature", index: 0 },
  );

  expect(request.definition).toMatchObject({
    kind: "extrude",
    parameters: { profiles: [{ kind: "face", bodyId: "body_live" }] },
  });
  expect(JSON.stringify(request)).not.toContain("topologyOf");
});

test("materializes one-side deferred extrude face, part, and vertex targets", async () => {
  const ends = [
    ["upToFace", "face"],
    ["upToPart", "body"],
    ["upToVertex", "vertex"],
  ] as const;

  for (const [kind, expectedKind] of ends) {
    const request = await materialize({
      kind: "extrude",
      featureTypeVersion: "feature-type/extrude/v1alpha2",
      parameters: {
        resultBodyType: "solid",
        profiles: [{ kind: "region", sketchId: "sketch_live", regionId: "region_live" }],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind, direction: "positive", target: selector(expectedKind) },
        },
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    });
    if (request.definition.kind !== "extrude" || request.definition.parameters.extent.mode !== "oneSide") {
      throw new Error("Expected a one-side extrude.");
    }
    expect(request.definition.parameters.extent.end.target.kind).toBe(expectedKind);
    expect(JSON.stringify(request)).not.toContain("topologyOf");
  }
});

test("materializes both deferred two-side extrude targets", async () => {
  const request = await materialize({
    kind: "extrude",
    featureTypeVersion: "feature-type/extrude/v1alpha2",
    parameters: {
      resultBodyType: "solid",
      profiles: [{ kind: "region", sketchId: "sketch_live", regionId: "region_live" }],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "twoSide",
        firstEnd: { kind: "upToFace", direction: "positive", target: selector("face") },
        secondEnd: { kind: "upToVertex", direction: "negative", target: selector("vertex") },
      },
      operation: { source: "literal", value: "newBody" },
      booleanScope: { kind: "standalone" },
    },
  });

  expect(request.definition).toMatchObject({
    kind: "extrude",
    parameters: {
      extent: {
        mode: "twoSide",
        firstEnd: { kind: "upToFace", target: { kind: "face" } },
        secondEnd: { kind: "upToVertex", target: { kind: "vertex" } },
      },
    },
  });
  expect(JSON.stringify(request)).not.toContain("topologyOf");
});

test("rejects an extrude end whose resolved target kind does not match the end kind", async () => {
  await expect(
    materialize({
      kind: "extrude",
      featureTypeVersion: "feature-type/extrude/v1alpha2",
      parameters: {
        resultBodyType: "solid",
        profiles: [{ kind: "region", sketchId: "sketch_live", regionId: "region_live" }],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "upToFace", direction: "positive", target: selector("body") },
        },
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    }),
  ).rejects.toThrow("Deferred upToFace target resolved as body, expected face");
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


test("regionOf rematches importer boundary provenance on the committed sketch", async () => {
  const planned = region("region_planned");
  const live = region("region_live");
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_live",
            sketches: [{ sketchId: "sketch_live", regions: [live] }],
          },
        } as never;
      },
      async buildNativeExactBrepPayload() {
        throw new Error("not used");
      },
    },
  });
  instance.recordSketchOutput(0, "sketch_live" as SketchId);

  await expect(
    instance.resolveDeferredValue(
      {
        kind: "regionOf",
        actionIndex: 0,
        selector: {
          kind: "interiorPoint",
          point: [999, 999],
          expectedBoundaryIdentity: deriveImportRegionBoundaryIdentity(planned, [planned]),
        },
      },
      { kind: "createFeature", index: 1 },
    ),
  ).resolves.toEqual({
    kind: "region",
    sketchId: "sketch_live",
    regionId: "region_live",
  });
});

// Zero identity matches fall back to the authored interior point; when that
// point contains no live region either, the resolution still fails loudly.
test("regionOf rejects when neither boundary provenance nor the interior point resolves", async () => {
  const planned = region("region_planned");
  const live = region("region_live", "other-boundary");
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_live",
            sketches: [{ sketchId: "sketch_live", regions: [live] }],
          },
        } as never;
      },
      async buildNativeExactBrepPayload() {
        throw new Error("not used");
      },
    },
  });
  instance.recordSketchOutput(0, "sketch_live" as SketchId);

  await expect(
    instance.resolveDeferredValue(
      {
        kind: "regionOf",
        actionIndex: 0,
        selector: {
          kind: "interiorPoint",
          point: [0, 0],
          expectedBoundaryIdentity: deriveImportRegionBoundaryIdentity(planned, [planned]),
        },
      },
      { kind: "createFeature", index: 1 },
    ),
  ).rejects.toThrow("live regions");
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

test("bodyOf rejects a producer with no body output", async () => {
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map([["ordered:0", { bodyIds: [] }]]),
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
  ).rejects.toThrow("produced 0 body ids, expected exactly one");
});

test("materializes topologyOf body selectors in extrude and revolve boolean scopes", async () => {
  const bodyId = "body_checkpoint" as BodyId;
  const instance = bodyOnlyMaterializer([bodyId]);
  const target = checkpointSelector();

  for (const kind of ["extrude", "revolve"] as const) {
    const definition = kind === "extrude"
      ? {
          kind,
          featureTypeVersion: "feature-type/extrude/v1alpha2",
          parameters: {
            resultBodyType: "solid",
            profiles: [{ kind: "region", sketchId: "sketch_profile", regionId: "region_profile" }],
            startExtent: { kind: "profilePlane" },
            extent: { mode: "oneSide", end: { kind: "blind", direction: "positive", distance: { source: "literal", value: 1 } } },
            operation: { source: "literal", value: "cut" },
            booleanScope: { kind: "targetBodies", bodyIds: [target] },
          },
        }
      : {
          kind,
          featureTypeVersion: "feature-type/revolve/v1alpha2",
          parameters: {
            resultBodyType: "solid",
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
      featureTypeVersion: "feature-type/revolve/v1alpha2",
      parameters: {
        resultBodyType: "solid",
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


test("materializes advanced bodyOf participants as durable body targets", async () => {
  const instance = new ImportDeferredMaterializer({
    outputRecords: new Map([
      ["ordered:0", { bodyIds: ["body_target" as BodyId] }],
      ["ordered:1", { bodyIds: ["body_tool" as BodyId] }],
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

  const request = await instance.materializeFeatureRequest({
    ...basis,
    definition: {
      kind: "split",
      featureTypeVersion: "advanced-solid-feature/v0",
      parameters: {
        participants: [
          { role: "targetBody", targets: [{ kind: "bodyOf", actionIndex: 0 }] },
          { role: "toolBody", targets: [{ kind: "bodyOf", actionIndex: 1 }] },
        ],
        options: { keepTools: false },
      },
    },
  } as ImportCreateFeatureRequest, { kind: "createFeature", index: 2 });

  expect(request.definition).toMatchObject({
    kind: "split",
    parameters: {
      participants: [
        { role: "targetBody", targets: [{ kind: "body", bodyId: "body_target" }] },
        { role: "toolBody", targets: [{ kind: "body", bodyId: "body_tool" }] },
      ],
    },
  });
});

test("honors an exact body scope during apply-time topology rematching", async () => {
  const scopedBodyId = "body_scoped" as BodyId;
  const instance = materializer(["body_live" as BodyId, scopedBodyId]);
  const scopedSelector = {
    ...selector("face"),
    bodyScope: scopedBodyId,
  };

  await expect(instance.resolveDeferredTopologyRef(scopedSelector)).resolves.toMatchObject({
    kind: "face",
    bodyId: scopedBodyId,
  });
  await expect(
    instance.resolveDeferredTopologyRef({
      ...scopedSelector,
      bodyScope: "body_absent" as BodyId,
    }),
  ).rejects.toThrow("Live topology rematch failed");
});
