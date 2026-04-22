import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import {
  getGeometryAssetPackagePath,
  type GeometryAssetBlobInput,
} from '@/contracts/modeling/geometry-assets'
import { serializeAuthoredDocumentJson } from '@/contracts/modeling/authored-document-serialization'

export const CADARA_PACKAGE_DOCUMENT_PATH = 'document.json'
export const CADARA_PACKAGE_MIME_TYPE = 'application/vnd.cadara+zip'
export const CADARA_JSON_MIME_TYPE = 'application/vnd.cadara+json'

export interface CadaraPackagePayload {
  document: unknown
  assets: readonly GeometryAssetBlobInput[]
}

export function createCadaraPackagePayload(input: CadaraPackagePayload): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [CADARA_PACKAGE_DOCUMENT_PATH]: strToU8(serializeAuthoredDocumentJson(input.document)),
  }
  const requiredAssets = getPackagedAssetRecords(input.document)
  const requiredAssetPaths = new Set(requiredAssets.map((asset) => getGeometryAssetPackagePath(asset)))

  for (const asset of input.assets) {
    const path = getGeometryAssetPackagePath(asset.asset)
    if (!requiredAssetPaths.has(path)) {
      throw new Error(`Cadara package asset ${asset.asset.assetId} is not referenced by document.json.`)
    }
    if (asset.bytes.byteLength !== asset.asset.byteLength) {
      throw new Error(`Cadara package asset ${asset.asset.assetId} byte length does not match its manifest record.`)
    }

    entries[path] = asset.bytes.slice()
  }

  for (const asset of requiredAssets) {
    const path = getGeometryAssetPackagePath(asset)
    const bytes = entries[path]
    if (!bytes) {
      throw new Error(`Cadara package is missing geometry asset ${asset.assetId}.`)
    }
    if (bytes.byteLength !== asset.byteLength) {
      throw new Error(`Cadara package asset ${asset.assetId} byte length does not match document.json.`)
    }
  }

  return zipSync(entries, { level: 6 })
}

export function parseCadaraPayload(bytes: Uint8Array): CadaraPackagePayload {
  if (isZipPayload(bytes)) {
    return parseCadaraPackagePayload(bytes)
  }

  return {
    document: JSON.parse(strFromU8(bytes)) as unknown,
    assets: [],
  }
}

export function parseCadaraPackagePayload(bytes: Uint8Array): CadaraPackagePayload {
  const entries = unzipSync(bytes)
  const documentBytes = entries[CADARA_PACKAGE_DOCUMENT_PATH]
  if (!documentBytes) {
    throw new Error('Cadara package is missing document.json.')
  }

  const document = JSON.parse(strFromU8(documentBytes)) as unknown
  const manifestRecords = getPackagedAssetRecords(document)
  const assets: GeometryAssetBlobInput[] = []

  for (const record of manifestRecords) {
    const path = getGeometryAssetPackagePath(record)
    const assetBytes = entries[path]
    if (!assetBytes) {
      throw new Error(`Cadara package is missing geometry asset ${record.assetId}.`)
    }

    assets.push({ asset: record, bytes: assetBytes.slice() })
  }

  return { document, assets }
}

export function isCadaraPackagePayload(value: unknown): value is CadaraPackagePayload {
  return typeof value === 'object'
    && value !== null
    && 'document' in value
    && Array.isArray((value as { assets?: unknown }).assets)
}

function isZipPayload(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

function getPackagedAssetRecords(document: unknown): GeometryAssetBlobInput['asset'][] {
  const assets = (document as { assets?: { records?: unknown[] } | unknown[] } | null)?.assets
  let records: unknown[] = []
  if (Array.isArray(assets)) {
    records = assets
  } else if (Array.isArray(assets?.records)) {
    records = assets.records
  }

  return records.filter(isPackagedAssetRecord)
}

function isPackagedAssetRecord(value: unknown): value is GeometryAssetBlobInput['asset'] {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { assetId?: unknown }).assetId === 'string'
    && typeof (value as { hash?: unknown }).hash === 'string'
    && typeof (value as { byteLength?: unknown }).byteLength === 'number'
    && typeof (value as { format?: unknown }).format === 'string'
    && typeof (value as { mediaType?: unknown }).mediaType === 'string'
}
