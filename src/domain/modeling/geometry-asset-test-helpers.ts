import {
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import type {
  GeometryAssetBlobInput,
  GeometryAssetRecord,
} from '@/contracts/modeling/geometry-assets'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'

export function createDeterministicGeometryAssetBytes(byteLength = 64 * 1024, seed = 17) {
  const bytes = new Uint8Array(byteLength)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed + index * 31 + Math.floor(index / 7)) % 256
  }
  return bytes
}

export async function createDeterministicGeometryAsset(input: {
  assetId?: GeometryAssetRecord['assetId']
  ownerFeatureIds?: GeometryAssetRecord['ownerFeatureIds']
  byteLength?: number
  seed?: number
} = {}): Promise<GeometryAssetBlobInput> {
  const bytes = createDeterministicGeometryAssetBytes(input.byteLength, input.seed)
  const asset: GeometryAssetRecord = {
    schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION as GeometryAssetSchemaVersion,
    assetId: input.assetId ?? 'asset_test_geometry',
    hash: await hashGeometryAssetBytes(bytes),
    byteLength: bytes.byteLength,
    format: 'step',
    mediaType: 'model/step',
    provenance: {
      kind: 'imported',
      sourceName: 'part.step',
      selectedFileName: 'part.step',
      stepDocumentName: 'part.step',
      sourceFormat: 'step',
    },
    ownerFeatureIds: input.ownerFeatureIds ?? ['feature_imported_geometry'],
  }

  return { asset, bytes }
}
