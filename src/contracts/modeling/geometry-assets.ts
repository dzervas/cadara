import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import {
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetManifestSchemaVersion,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'

export type GeometryAssetHash = `sha256:${string}`
export type GeometryAssetFormat = 'step' | 'stl' | '3mf' | 'baked-occ' | 'baked-mesh'
export type GeometryAssetProvenanceKind = 'imported' | 'generated'
export type GeometryAssetDiagnosticCode =
  | 'geometry-asset-missing'
  | 'geometry-asset-corrupt'
  | 'geometry-asset-unsupported'
  | 'geometry-asset-unavailable'
  | 'geometry-asset-storage-failed'

export interface GeometryAssetProvenance {
  kind: GeometryAssetProvenanceKind
  sourceName?: string
  sourceHash?: GeometryAssetHash
  sourceFormat?: 'step' | 'stl' | '3mf'
  sourceStored?: false
  generator?: string
}

export interface GeometryAssetRecord {
  schemaVersion: GeometryAssetSchemaVersion
  assetId: GeometryAssetId
  hash: GeometryAssetHash
  byteLength: number
  format: GeometryAssetFormat
  mediaType: string
  provenance: GeometryAssetProvenance
  ownerFeatureIds: FeatureId[]
}

export interface GeometryAssetManifest {
  schemaVersion: GeometryAssetManifestSchemaVersion
  records: GeometryAssetRecord[]
}

export interface GeometryAssetAvailability {
  assetId: GeometryAssetId
  hash: GeometryAssetHash
  byteLength: number
  format: GeometryAssetFormat
  available: boolean
}

export interface GeometryAssetDiagnosticDetail {
  kind: 'geometryAsset'
  code: GeometryAssetDiagnosticCode
  assetId: GeometryAssetId
  hash: GeometryAssetHash
  hashPrefix: string
  byteLength: number
  format: GeometryAssetFormat
  mediaType: string
  ownerFeatureIds: FeatureId[]
}

export interface GeometryAssetBlobInput {
  asset: GeometryAssetRecord
  bytes: Uint8Array
}

export const EMPTY_GEOMETRY_ASSET_MANIFEST: GeometryAssetManifest = {
  schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  records: [],
}

export function createEmptyGeometryAssetManifest(): GeometryAssetManifest {
  return structuredClone(EMPTY_GEOMETRY_ASSET_MANIFEST)
}

export function normalizeGeometryAssetRecord(record: GeometryAssetRecord): GeometryAssetRecord {
  return {
    ...record,
    schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION,
    ownerFeatureIds: [...new Set(record.ownerFeatureIds)].sort() as FeatureId[],
  }
}

export function normalizeGeometryAssetManifest(manifest: GeometryAssetManifest): GeometryAssetManifest {
  const recordsById = new Map<GeometryAssetId, GeometryAssetRecord>()
  for (const record of manifest.records) {
    const normalized = normalizeGeometryAssetRecord(record)
    const existing = recordsById.get(normalized.assetId)
    if (!existing) {
      recordsById.set(normalized.assetId, normalized)
      continue
    }

    recordsById.set(normalized.assetId, normalizeGeometryAssetRecord({
      ...existing,
      ownerFeatureIds: [...existing.ownerFeatureIds, ...normalized.ownerFeatureIds],
    }))
  }

  return {
    schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
    records: [...recordsById.values()].sort((left, right) => left.assetId.localeCompare(right.assetId)),
  }
}

export function createGeometryAssetDiagnostic(
  code: GeometryAssetDiagnosticCode,
  asset: GeometryAssetRecord,
  message: string,
): ModelingDiagnostic {
  return {
    code,
    severity: code === 'geometry-asset-unavailable' ? 'warning' : 'error',
    message,
    featureId: asset.ownerFeatureIds[0] ?? null,
    target: null,
    detail: {
      kind: 'geometryAsset',
      code,
      assetId: asset.assetId,
      hash: asset.hash,
      hashPrefix: getGeometryAssetHashPrefix(asset.hash),
      byteLength: asset.byteLength,
      format: asset.format,
      mediaType: asset.mediaType,
      ownerFeatureIds: [...asset.ownerFeatureIds],
    },
  }
}

export function getGeometryAssetHashPrefix(hash: GeometryAssetHash) {
  return hash.replace(/^sha256:/, '').slice(0, 12)
}

export function getGeometryAssetPackagePath(asset: GeometryAssetRecord) {
  return `assets/sha256/${asset.hash.replace(/^sha256:/, '')}.bin`
}
