import {
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import type {
  GeometryAssetBlobInput,
  GeometryAssetHash,
  GeometryAssetRecord,
} from '@/contracts/modeling/geometry-assets'
import type { MeshImportSourceFormat } from '@/contracts/modeling/mesh-import'
import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import type { MeshPoint, MeshTriangle } from '@/domain/modeling/mesh-parser'

export const BAKED_MESH_GEOMETRY_MEDIA_TYPE = 'application/vnd.cadara.baked-mesh+json'
const BAKED_MESH_GEOMETRY_SCHEMA_VERSION = 'baked-mesh-geometry/v1alpha1'

interface BakedMeshGeometryPayload {
  schemaVersion: typeof BAKED_MESH_GEOMETRY_SCHEMA_VERSION
  vertices: MeshPoint[]
  indices: Array<readonly [number, number, number]>
}

export type MeshBakeResult =
  | { ok: true; assetInput: GeometryAssetBlobInput; triangleCount: number }
  | { ok: false; reason: string; triangleCount: number }

export async function createBakedMeshGeometryAsset(input: {
  triangles: readonly MeshTriangle[]
  sourceFileName: string
  sourceFormat: MeshImportSourceFormat
  sourceHash: GeometryAssetHash
  ownerFeatureId: FeatureId
}): Promise<MeshBakeResult> {
  const normalized = normalizeMeshTriangles(input.triangles)
  if (!normalized.ok) {
    return {
      ok: false,
      reason: normalized.reason,
      triangleCount: input.triangles.length,
    }
  }

  const bytes = encodeBakedMeshGeometry(normalized.payload)
  const hash = await hashGeometryAssetBytes(bytes)
  const asset: GeometryAssetRecord = {
    schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION as GeometryAssetSchemaVersion,
    assetId: createBakedMeshAssetId(hash),
    hash,
    byteLength: bytes.byteLength,
    format: 'baked-mesh',
    mediaType: BAKED_MESH_GEOMETRY_MEDIA_TYPE,
    provenance: {
      kind: 'generated',
      sourceName: input.sourceFileName,
      sourceHash: input.sourceHash,
      sourceFormat: input.sourceFormat,
      sourceStored: false,
      generator: 'basic-mesh-baker/v1',
    },
    ownerFeatureIds: [input.ownerFeatureId],
  }

  return {
    ok: true,
    assetInput: { asset, bytes },
    triangleCount: input.triangles.length,
  }
}

export function parseBakedMeshGeometry(bytes: Uint8Array): BakedMeshGeometryPayload {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as BakedMeshGeometryPayload
  if (
    value.schemaVersion !== BAKED_MESH_GEOMETRY_SCHEMA_VERSION
    || !Array.isArray(value.vertices)
    || !Array.isArray(value.indices)
  ) {
    throw new Error('Baked mesh geometry asset payload is invalid.')
  }

  return value
}

export function bakedMeshGeometryToAsciiStl(payload: BakedMeshGeometryPayload, solidName: string) {
  const lines = [`solid ${sanitizeStlName(solidName)}`]
  for (const [firstIndex, secondIndex, thirdIndex] of payload.indices) {
    const first = payload.vertices[firstIndex]
    const second = payload.vertices[secondIndex]
    const third = payload.vertices[thirdIndex]
    if (!first || !second || !third) {
      throw new Error('Baked mesh geometry asset contains an invalid triangle index.')
    }

    const normal = calculateNormal(first, second, third)
    lines.push(
      `facet normal ${formatNumber(normal[0])} ${formatNumber(normal[1])} ${formatNumber(normal[2])}`,
      ' outer loop',
      `  vertex ${formatPoint(first)}`,
      `  vertex ${formatPoint(second)}`,
      `  vertex ${formatPoint(third)}`,
      ' endloop',
      'endfacet',
    )
  }
  lines.push(`endsolid ${sanitizeStlName(solidName)}`)

  return `${lines.join('\n')}\n`
}

function normalizeMeshTriangles(triangles: readonly MeshTriangle[]) {
  if (triangles.length === 0) {
    return { ok: false as const, reason: 'Mesh contains no triangles.' }
  }

  const vertexIndexes = new Map<string, number>()
  const vertices: MeshPoint[] = []
  const indices: Array<readonly [number, number, number]> = []
  const edgeCounts = new Map<string, number>()

  for (const triangle of triangles) {
    if (!triangle.every(isFinitePoint)) {
      return { ok: false as const, reason: 'Mesh contains non-finite vertex coordinates.' }
    }

    if (triangleArea(triangle) <= 1e-12) {
      return { ok: false as const, reason: 'Mesh contains degenerate triangles.' }
    }

    const triangleIndexes = triangle.map((point) => {
      const key = pointKey(point)
      const existing = vertexIndexes.get(key)
      if (existing !== undefined) {
        return existing
      }

      const nextIndex = vertices.length
      vertexIndexes.set(key, nextIndex)
      vertices.push([roundCoordinate(point[0]), roundCoordinate(point[1]), roundCoordinate(point[2])])
      return nextIndex
    }) as [number, number, number]

    indices.push(triangleIndexes)
    addEdge(edgeCounts, triangleIndexes[0], triangleIndexes[1])
    addEdge(edgeCounts, triangleIndexes[1], triangleIndexes[2])
    addEdge(edgeCounts, triangleIndexes[2], triangleIndexes[0])
  }

  const openEdgeCount = [...edgeCounts.values()].filter((count) => count !== 2).length
  if (openEdgeCount > 0) {
    return { ok: false as const, reason: 'Mesh triangles do not form a closed manifold shell.' }
  }

  return {
    ok: true as const,
    payload: {
      schemaVersion: BAKED_MESH_GEOMETRY_SCHEMA_VERSION,
      vertices,
      indices,
    } satisfies BakedMeshGeometryPayload,
  }
}

function encodeBakedMeshGeometry(payload: BakedMeshGeometryPayload) {
  return new TextEncoder().encode(JSON.stringify(payload))
}

function createBakedMeshAssetId(hash: GeometryAssetHash): GeometryAssetId {
  return `asset_baked_mesh_${hash.replace(/^sha256:/, '').slice(0, 16)}` as GeometryAssetId
}

function isFinitePoint(point: MeshPoint) {
  return point.every((component) => Number.isFinite(component))
}

function pointKey(point: MeshPoint) {
  return `${roundCoordinate(point[0])},${roundCoordinate(point[1])},${roundCoordinate(point[2])}`
}

function roundCoordinate(value: number) {
  return Math.round(value * 1e7) / 1e7
}

function addEdge(edges: Map<string, number>, first: number, second: number) {
  const key = first < second ? `${first}:${second}` : `${second}:${first}`
  edges.set(key, (edges.get(key) ?? 0) + 1)
}

function triangleArea([first, second, third]: MeshTriangle) {
  const ab = [second[0] - first[0], second[1] - first[1], second[2] - first[2]] as const
  const ac = [third[0] - first[0], third[1] - first[1], third[2] - first[2]] as const
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ] as const
  return Math.hypot(cross[0], cross[1], cross[2]) / 2
}

function calculateNormal(first: MeshPoint, second: MeshPoint, third: MeshPoint): MeshPoint {
  const ab = [second[0] - first[0], second[1] - first[1], second[2] - first[2]] as const
  const ac = [third[0] - first[0], third[1] - first[1], third[2] - first[2]] as const
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ] as const
  const length = Math.hypot(normal[0], normal[1], normal[2])
  return length === 0 ? [0, 0, 0] : [normal[0] / length, normal[1] / length, normal[2] / length]
}

function formatPoint(point: MeshPoint) {
  return `${formatNumber(point[0])} ${formatNumber(point[1])} ${formatNumber(point[2])}`
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toPrecision(12).replace(/0+$/, '').replace(/\.$/, '')
}

function sanitizeStlName(value: string) {
  return value.replace(/[^\w.-]+/g, '_')
}
