import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import {
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetManifestSchemaVersion,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { MeshReconstructionProvenance } from '@/contracts/modeling/mesh-reconstruction'

export type GeometryAssetHash = `sha256:${string}`
export type GeometryAssetFormat = 'step' | 'stl' | '3mf' | 'baked-occ' | 'baked-mesh' | 'cadara-brep'
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
  selectedFileName?: string
  stepDocumentName?: string
  sourceHash?: GeometryAssetHash
  sourceFormat?: 'step' | 'stl' | '3mf'
  sourceStored?: false
  generator?: string
  reconstruction?: MeshReconstructionProvenance
}

export type GeometryAssetPoint3 = readonly [number, number, number]
export type GeometryAssetTriangle = readonly [number, number, number]

export interface CadaraBrepVertexRecord {
  vertexKey: string
  point: GeometryAssetPoint3
}

export interface CadaraBrepEdgeRecord {
  edgeKey: string
  vertices: readonly [number, number]
  curve: {
    kind: 'lineSegment'
  }
}

export interface CadaraBrepCoedgeRecord {
  coedgeKey: string
  edgeIndex: number
  reversed: boolean
}

export interface CadaraBrepLoopRecord {
  loopKey: string
  coedgeIndices: number[]
}

export interface CadaraBrepFaceRecord {
  faceKey: string
  outerLoopIndex: number
  surface: {
    kind: 'plane'
    origin: GeometryAssetPoint3
    normal: GeometryAssetPoint3
  }
  triangles: GeometryAssetTriangle[]
}

export interface CadaraBrepShellRecord {
  shellKey: string
  faceIndices: number[]
  closed: boolean
}

export interface CadaraBrepSolidRecord {
  solidKey: string
  shellIndices: number[]
}

export interface CadaraBrepTopologyRecord {
  vertices: CadaraBrepVertexRecord[]
  edges: CadaraBrepEdgeRecord[]
  coedges: CadaraBrepCoedgeRecord[]
  loops: CadaraBrepLoopRecord[]
  faces: CadaraBrepFaceRecord[]
  shells: CadaraBrepShellRecord[]
  solids: CadaraBrepSolidRecord[]
}

export type CadaraBrepFacetedTriangleInput = readonly [GeometryAssetPoint3, GeometryAssetPoint3, GeometryAssetPoint3]

export interface CadaraBrepGeometryAssetBody {
  bodyKey: string
  label: string
  solidKey?: string
  topology: CadaraBrepTopologyRecord
}

export interface CadaraBrepGeometryAssetData {
  kind: 'cadaraBrep'
  schemaVersion: 'cadara-brep/v1alpha1'
  source: {
    importedFormat: 'step'
    sourceStored: false
    rootDocumentName?: string
  }
  bodies: CadaraBrepGeometryAssetBody[]
}

export interface BakedMeshGeometryAssetData {
  kind: 'bakedMeshGeometry'
  schemaVersion: 'baked-mesh-geometry/v1alpha1'
  vertices: GeometryAssetPoint3[]
  indices: GeometryAssetTriangle[]
}

export type GeometryAssetData =
  | CadaraBrepGeometryAssetData
  | BakedMeshGeometryAssetData

export interface GeometryAssetRecord {
  schemaVersion: GeometryAssetSchemaVersion
  assetId: GeometryAssetId
  hash: GeometryAssetHash
  byteLength: number
  format: GeometryAssetFormat
  mediaType: string
  provenance: GeometryAssetProvenance
  data?: GeometryAssetData
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
    data: record.data ? structuredClone(record.data) : undefined,
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

export function getEmbeddedGeometryAssetBytes(asset: GeometryAssetRecord): Uint8Array | null {
  switch (asset.data?.kind) {
    case 'cadaraBrep':
      return encodeGeometryAssetData(asset.data)
    case 'bakedMeshGeometry':
      return encodeGeometryAssetData(asset.data)
    default:
      return null
  }
}

export function encodeGeometryAssetData(data: GeometryAssetData): Uint8Array {
  switch (data.kind) {
    case 'cadaraBrep':
      return new TextEncoder().encode(JSON.stringify({
        kind: data.kind,
        schemaVersion: data.schemaVersion,
        source: data.source,
        bodies: data.bodies,
      }))
    case 'bakedMeshGeometry':
      return new TextEncoder().encode(JSON.stringify({
        schemaVersion: data.schemaVersion,
        vertices: data.vertices,
        indices: data.indices,
      }))
  }
}

export function createCadaraFacetedBrepTopologyFromTriangles(
  triangles: readonly CadaraBrepFacetedTriangleInput[],
  keyPrefix = 'faceted',
): CadaraBrepTopologyRecord {
  const vertices: CadaraBrepVertexRecord[] = []
  const vertexIndexByKey = new Map<string, number>()
  const edges: CadaraBrepEdgeRecord[] = []
  const edgeIndexByKey = new Map<string, number>()
  const coedges: CadaraBrepCoedgeRecord[] = []
  const loops: CadaraBrepLoopRecord[] = []
  const faces: CadaraBrepFaceRecord[] = []

  const internVertex = (point: GeometryAssetPoint3) => {
    const key = createPointKey(point)
    const existing = vertexIndexByKey.get(key)
    if (existing !== undefined) {
      return existing
    }

    const index = vertices.length
    vertices.push({
      vertexKey: `${keyPrefix}_vertex_${index + 1}`,
      point: normalizePoint(point),
    })
    vertexIndexByKey.set(key, index)
    return index
  }

  const internEdge = (first: number, second: number) => {
    const low = Math.min(first, second)
    const high = Math.max(first, second)
    const key = `${low}:${high}`
    const existing = edgeIndexByKey.get(key)
    if (existing !== undefined) {
      return { edgeIndex: existing, reversed: first !== low }
    }

    const index = edges.length
    edges.push({
      edgeKey: `${keyPrefix}_edge_${index + 1}`,
      vertices: [low, high],
      curve: { kind: 'lineSegment' },
    })
    edgeIndexByKey.set(key, index)
    return { edgeIndex: index, reversed: first !== low }
  }

  for (const triangle of triangles) {
    const triangleVertices = triangle.map(internVertex) as [number, number, number]
    const points = triangleVertices.map((index) => vertices[index]!.point) as [GeometryAssetPoint3, GeometryAssetPoint3, GeometryAssetPoint3]
    const normal = calculateTriangleNormal(points)
    if (!normal) {
      continue
    }

    const faceIndex = faces.length
    const coedgeIndices: number[] = []
    const edgePairs = [
      [triangleVertices[0], triangleVertices[1]],
      [triangleVertices[1], triangleVertices[2]],
      [triangleVertices[2], triangleVertices[0]],
    ] as const

    for (const [first, second] of edgePairs) {
      const edge = internEdge(first, second)
      const coedgeIndex = coedges.length
      coedges.push({
        coedgeKey: `${keyPrefix}_coedge_${coedgeIndex + 1}`,
        edgeIndex: edge.edgeIndex,
        reversed: edge.reversed,
      })
      coedgeIndices.push(coedgeIndex)
    }

    const loopIndex = loops.length
    loops.push({
      loopKey: `${keyPrefix}_loop_${loopIndex + 1}`,
      coedgeIndices,
    })
    faces.push({
      faceKey: `${keyPrefix}_face_${faceIndex + 1}`,
      outerLoopIndex: loopIndex,
      surface: {
        kind: 'plane',
        origin: points[0],
        normal,
      },
      triangles: [triangleVertices],
    })
  }

  if (faces.length === 0) {
    throw new Error('Cadara B-rep topology requires at least one non-degenerate triangle.')
  }

  return {
    vertices,
    edges,
    coedges,
    loops,
    faces,
    shells: [{
      shellKey: `${keyPrefix}_shell_1`,
      faceIndices: faces.map((_face, index) => index),
      closed: true,
    }],
    solids: [{
      solidKey: `${keyPrefix}_solid_1`,
      shellIndices: [0],
    }],
  }
}

function createPointKey(point: GeometryAssetPoint3) {
  return point.map((coordinate) => normalizeCoordinate(coordinate).toFixed(9)).join(':')
}

function normalizePoint(point: GeometryAssetPoint3): GeometryAssetPoint3 {
  return [
    normalizeCoordinate(point[0]),
    normalizeCoordinate(point[1]),
    normalizeCoordinate(point[2]),
  ]
}

function normalizeCoordinate(value: number) {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(12))
}

function calculateTriangleNormal(
  points: readonly [GeometryAssetPoint3, GeometryAssetPoint3, GeometryAssetPoint3],
): GeometryAssetPoint3 | null {
  const ab = subtractPoints(points[1], points[0])
  const ac = subtractPoints(points[2], points[0])
  const normal = crossPoints(ab, ac)
  const length = Math.hypot(normal[0], normal[1], normal[2])
  if (length <= 1e-12) {
    return null
  }

  return [
    normalizeCoordinate(normal[0] / length),
    normalizeCoordinate(normal[1] / length),
    normalizeCoordinate(normal[2] / length),
  ]
}

function subtractPoints(left: GeometryAssetPoint3, right: GeometryAssetPoint3): GeometryAssetPoint3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function crossPoints(left: GeometryAssetPoint3, right: GeometryAssetPoint3): GeometryAssetPoint3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}
