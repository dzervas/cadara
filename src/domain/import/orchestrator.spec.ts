import { expect, test } from "vitest";

import {
  createImportCapabilities,
  ImportCapabilityError,
} from "@/domain/import/orchestrator";
import {
  createMemoryGeometryAssetStore,
  type GeometryAssetStore,
  type GeometryAssetStorePutResult,
} from "@/domain/modeling/geometry-asset-store";
import type { GeometryAssetBlobInput } from "@/contracts/modeling/geometry-assets";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";

function makeSnapshot() {
  return {
    document: {
      documentId: "doc_import_bake" as DocumentId,
      revisionId: "rev_import_bake" as RevisionId,
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
        [1, 0, 0],
        [0, 1, 0],
      ],
      indices: [[0, 1, 2]],
    }),
  );
}

class RecordingGeometryAssetStore implements GeometryAssetStore {
  readonly inner = createMemoryGeometryAssetStore();
  readonly putResults: GeometryAssetStorePutResult[] = [];
  readonly putInputs: GeometryAssetBlobInput[] = [];

  async put(input: GeometryAssetBlobInput) {
    this.putInputs.push(input);
    const result = await this.inner.put(input);
    this.putResults.push(result);
    return result;
  }

  async get(asset: GeometryAssetBlobInput["asset"]) {
    return this.inner.get(asset);
  }

  async has(asset: GeometryAssetBlobInput["asset"]) {
    return this.inner.has(asset);
  }
}

test("bakeGeometry persists baked mesh bytes and returns a self-describing asset reference", async () => {
  const store = new RecordingGeometryAssetStore();
  const capabilities = createImportCapabilities({} as never, makeSnapshot(), {
    assetStore: store,
  });
  const bytes = makeBakedMeshBytes();

  const reference = await capabilities.modeling.bakeGeometry({
    bytes,
    format: "baked-mesh",
  });

  expect(reference.assetId.startsWith("asset_baked_")).toBeTruthy();
  expect(reference.format).toBe("baked-mesh");
  expect(reference.byteLength).toBe(bytes.byteLength);
  expect(reference.hash.startsWith("sha256:")).toBeTruthy();
  expect(store.putResults[0]).toMatchObject({ ok: true, deduped: false });
  await expect(store.get(store.putInputs[0]!.asset)).resolves.toMatchObject({
    ok: true,
    bytes,
  });
});

test("bakeGeometry deduplicates baked mesh bytes by content hash", async () => {
  const store = new RecordingGeometryAssetStore();
  const capabilities = createImportCapabilities({} as never, makeSnapshot(), {
    assetStore: store,
  });
  const bytes = makeBakedMeshBytes();

  const firstReference = await capabilities.modeling.bakeGeometry({
    bytes,
    format: "baked-mesh",
  });
  const secondReference = await capabilities.modeling.bakeGeometry({
    bytes,
    format: "baked-mesh",
  });

  expect(secondReference.assetId).toBe(firstReference.assetId);
  expect(secondReference.hash).toBe(firstReference.hash);
  expect(store.putResults[1]).toMatchObject({ ok: true, deduped: true });
});

test("bakeGeometry rejects invalid baked mesh bytes with a structured capability error", async () => {
  const capabilities = createImportCapabilities({} as never, makeSnapshot());

  await expect(
    capabilities.modeling.bakeGeometry({
      bytes: new TextEncoder().encode("not json"),
      format: "baked-mesh",
    }),
  ).rejects.toMatchObject({
    name: "ImportCapabilityError",
    code: "import-capability-invalid-geometry",
    format: "baked-mesh",
  } satisfies Partial<ImportCapabilityError>);
});

test("bakeGeometry rejects unsupported geometry formats with a structured capability error", async () => {
  const capabilities = createImportCapabilities({} as never, makeSnapshot());

  await expect(
    capabilities.modeling.bakeGeometry({
      bytes: makeBakedMeshBytes(),
      format: "step",
    }),
  ).rejects.toMatchObject({
    name: "ImportCapabilityError",
    code: "import-capability-unsupported-format",
    format: "step",
  } satisfies Partial<ImportCapabilityError>);
});
