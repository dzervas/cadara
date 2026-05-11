import {
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetSchemaVersion,
} from "@/contracts/shared/versioning";
import type {
  CadaraBrepGeometryAssetData,
  GeometryAssetBlobInput,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import {
  createCadaraFacetedBrepTopologyFromTriangles,
  encodeGeometryAssetData,
} from "@/contracts/modeling/geometry-assets";
import { hashGeometryAssetBytes } from "@/domain/modeling/geometry-asset-store";

export function createDeterministicCadaraBrepData(
  byteLength = 64 * 1024,
  seed = 17,
): CadaraBrepGeometryAssetData {
  return {
    kind: "cadaraBrep",
    schemaVersion: "cadara-brep/v1alpha1",
    source: {
      importedFormat: "step",
      sourceStored: false,
      rootDocumentName: "part.step",
    },
    bodies: [
      {
        bodyKey: "body_1",
        label: "part",
        solidKey: "part.step#solid-1",
        topology: createCadaraFacetedBrepTopologyFromTriangles(
          createDeterministicCubeTriangles(seed),
          `test_${seed}_${byteLength}`,
        ),
      },
    ],
  };
}

function createDeterministicCubeTriangles(seed: number) {
  const offset = (seed % 17) / 1000;
  const points = [
    [-0.5 + offset, -0.5, -0.5],
    [0.5 + offset, -0.5, -0.5],
    [0.5 + offset, 0.5, -0.5],
    [-0.5 + offset, 0.5, -0.5],
    [-0.5 + offset, -0.5, 0.5],
    [0.5 + offset, -0.5, 0.5],
    [0.5 + offset, 0.5, 0.5],
    [-0.5 + offset, 0.5, 0.5],
  ] as const;
  return [
    [points[0], points[2], points[1]],
    [points[0], points[3], points[2]],
    [points[4], points[5], points[6]],
    [points[4], points[6], points[7]],
    [points[0], points[1], points[5]],
    [points[0], points[5], points[4]],
    [points[1], points[2], points[6]],
    [points[1], points[6], points[5]],
    [points[2], points[3], points[7]],
    [points[2], points[7], points[6]],
    [points[3], points[0], points[4]],
    [points[3], points[4], points[7]],
  ] as const;
}

export function createDeterministicGeometryAssetBytes(
  byteLength = 64 * 1024,
  seed = 17,
) {
  return encodeGeometryAssetData(
    createDeterministicCadaraBrepData(byteLength, seed),
  );
}

export async function createDeterministicGeometryAsset(
  input: {
    assetId?: GeometryAssetRecord["assetId"];
    ownerFeatureIds?: GeometryAssetRecord["ownerFeatureIds"];
    byteLength?: number;
    seed?: number;
  } = {},
): Promise<GeometryAssetBlobInput> {
  const data = createDeterministicCadaraBrepData(input.byteLength, input.seed);
  const bytes = encodeGeometryAssetData(data);
  const asset: GeometryAssetRecord = {
    schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION as GeometryAssetSchemaVersion,
    assetId: input.assetId ?? "asset_test_geometry",
    hash: await hashGeometryAssetBytes(bytes),
    byteLength: bytes.byteLength,
    format: "cadara-brep",
    mediaType: "application/vnd.cadara.brep+json",
    provenance: {
      kind: "imported",
      sourceName: "part.step",
      selectedFileName: "part.step",
      stepDocumentName: "part.step",
      sourceFormat: "step",
    },
    data,
    ownerFeatureIds: input.ownerFeatureIds ?? ["feature_imported_geometry"],
  };

  return { asset, bytes };
}
