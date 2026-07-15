import { expect, test } from "vitest";

import type {
  ImportCreateFeatureRequest,
  ImportDeferredTopologyRef,
} from "@/contracts/import/actions";
import type { BodyId, RevisionId } from "@/contracts/shared/ids";
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
