import { expect, test } from "vitest";

import { BAKED_BODY_FEATURE_SCHEMA_VERSION, CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { CreateFeatureRequest } from "@/contracts/modeling/schema";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import { createImportCapabilities } from "@/domain/import/orchestrator";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createGeometryAssetComposition } from "@/infrastructure/modeling/browser-geometry-asset-store";

function makeSnapshot() {
  return {
    document: {
      documentId: "doc_workspace" as DocumentId,
      revisionId: "rev_0001" as RevisionId,
    },
  } as never;
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
      ],
      indices: [[0, 1, 2]],
    }),
  );
}

// Composition seam: the import baking capability (writer) and the kernel asset
// resolver (reader) must share one GeometryAssetStore. Both ends are obtained
// from the single production composition helper (createGeometryAssetComposition)
// against one store instance — they are never constructed independently.
test("baked import bytes resolve through the shared app geometry-asset store into the kernel", async () => {
  const store = createMemoryGeometryAssetStore();
  const { assetStore, resolver } = createGeometryAssetComposition(store);
  const capabilities = createImportCapabilities({} as never, makeSnapshot(), {
    assetStore,
  });
  const adapter = new MockKernelAdapter({ assetResolver: resolver });

  const reference = await capabilities.modeling.bakeGeometry({
    bytes: makeBakedMeshBytes(),
    format: "baked-mesh",
  });

  const resolved = await resolver.resolveGeometryAsset(reference);
  expect(resolved?.format).toBe("baked-mesh");

  const snapshot = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace" as DocumentId,
  });
  const response = await adapter.createFeature({
    contractVersion: CONTRACT_VERSION,
    documentId: snapshot.snapshot.document.documentId,
    baseRevisionId: snapshot.snapshot.document.revisionId,
    featureLabel: "Composed baked body",
    definition: {
      kind: "bakedBody",
      featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
      parameters: {
        ...reference,
        label: "Composed baked body",
        provenance: { source: "onshape", reason: "onshape-studio-bake-required" },
      },
    },
  } satisfies CreateFeatureRequest);

  // Surface the rejection reason if the seam regresses (lifted from the
  // tmp-repro instrumentation) so a broken store/resolver share shows the real
  // diagnostic instead of a bare boolean.
  expect(
    response.revisionState.kind,
    `bakedBody should commit through the shared store/resolver; diagnostics: ${JSON.stringify(
      response.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    )}`,
  ).toBe("accepted");
  expect(response.changedTargets[0]).toMatchObject({ kind: "body" });
});

test("resolver returns null for an asset the shared store never baked", async () => {
  const store = createMemoryGeometryAssetStore();
  const { resolver } = createGeometryAssetComposition(store);

  await expect(
    resolver.resolveGeometryAsset({
      assetId: "asset_never_baked" as never,
      format: "baked-mesh",
      hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      byteLength: 128,
    }),
  ).resolves.toBeNull();
});
