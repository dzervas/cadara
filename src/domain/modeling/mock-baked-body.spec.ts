import { expect, test } from "vitest";

import { BAKED_BODY_FEATURE_SCHEMA_VERSION, CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { CreateFeatureRequest, FeatureDefinition } from "@/contracts/modeling/schema";
import type { DocumentId, GeometryAssetId } from "@/contracts/shared/ids";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { combineAdvancedFeatureExample } from "@/contracts/modeling/advanced-solid";

function bakedBodyDefinition(assetId: GeometryAssetId): FeatureDefinition {
  return {
    kind: "bakedBody",
    featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
    parameters: {
      assetId,
      format: "baked-mesh",
      hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      byteLength: 3,
      label: "Mock baked body",
      provenance: { source: "generated", reason: "test-bake" },
    },
  };
}

async function createBakedBody(adapter: MockKernelAdapter, definition: FeatureDefinition) {
  const snapshot = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace" as DocumentId,
  });
  return adapter.createFeature({
    contractVersion: CONTRACT_VERSION,
    documentId: snapshot.snapshot.document.documentId,
    baseRevisionId: snapshot.snapshot.document.revisionId,
    featureLabel: "Mock baked body",
    definition,
  } satisfies CreateFeatureRequest);
}

test("MockKernelAdapter materializes bakedBody as a durable body when the resolver provides the asset", async () => {
  const assetId = "asset_mock_baked_mesh" as GeometryAssetId;
  const adapter = new MockKernelAdapter({
    assetResolver: {
      async resolveGeometryAsset(reference) {
        return reference.assetId === assetId
          ? { bytes: new Uint8Array([1, 2, 3]), format: "baked-mesh" }
          : null;
      },
    },
  });

  const response = await createBakedBody(adapter, bakedBodyDefinition(assetId));
  const snapshot = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: response.documentId,
  });

  expect(response.revisionState.kind).toBe("accepted");
  expect(response.changedTargets[0]).toMatchObject({ kind: "body" });
  expect(snapshot.snapshot.document.bodies.some((body) =>
    body.bodyId === response.changedTargets[0]?.bodyId,
  )).toBeTruthy();
  expect(snapshot.snapshot.document.render.records.some((record) =>
    record.ownerFeatureId === response.featureId && record.geometry.kind === "mesh",
  )).toBeTruthy();
});

test("MockKernelAdapter accepts a downstream boolean targeting a baked body", async () => {
  const assetId = "asset_mock_boolean_baked_mesh" as GeometryAssetId;
  const adapter = new MockKernelAdapter({
    assetResolver: {
      async resolveGeometryAsset(reference) {
        return reference.assetId === assetId
          ? { bytes: new Uint8Array([1, 2, 3]), format: "baked-mesh" }
          : null;
      },
    },
  });
  const baked = await createBakedBody(adapter, bakedBodyDefinition(assetId));
  const bakedBodyTarget = baked.changedTargets.find(
    (target): target is Extract<typeof target, { kind: "body" }> =>
      target.kind === "body",
  );
  expect(bakedBodyTarget).toBeTruthy();
  const snapshot = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: baked.documentId,
  });

  const combine = await adapter.createFeature({
    contractVersion: CONTRACT_VERSION,
    documentId: baked.documentId,
    baseRevisionId: snapshot.snapshot.document.revisionId,
    featureLabel: "Boolean on baked body",
    definition: {
      ...combineAdvancedFeatureExample,
      parameters: {
        ...combineAdvancedFeatureExample.parameters,
        participants: [
          { role: "targetBody", targets: [bakedBodyTarget!] },
          { role: "toolBody", targets: [{ kind: "body", bodyId: "body_part-1" }] },
        ],
      },
    },
  });

  expect(combine.revisionState.kind).toBe("accepted");
});

test("MockKernelAdapter rejects bakedBody without a resolver asset and emits a structured diagnostic", async () => {
  const adapter = new MockKernelAdapter();
  const response = await createBakedBody(
    adapter,
    bakedBodyDefinition("asset_missing_mock_baked_mesh" as GeometryAssetId),
  );

  expect(response.revisionState.kind).toBe("rejected");
  expect(response.diagnostics.some((diagnostic) =>
    diagnostic.code === "baked-body-assetMissing" &&
    diagnostic.detail?.kind === "bakedBody" &&
    diagnostic.detail.reason === "assetMissing",
  )).toBeTruthy();
});
