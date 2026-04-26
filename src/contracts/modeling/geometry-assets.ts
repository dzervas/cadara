import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import {
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetManifestSchemaVersion,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { MeshReconstructionProvenance } from '@/contracts/modeling/mesh-reconstruction'
import type { ImportBinding } from '@/contracts/import/binding'

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
  /** Carries external source metadata for refresh/relink without a separate manifest. */
  importBinding?: ImportBinding
}

export type GeometryAssetPoint3 = readonly [number, number, number]
export type GeometryAssetPoint2 = readonly [number, number]
export type GeometryAssetTriangle = readonly [number, number, number]
export type GeometryAssetParameterRange = readonly [number, number]

export interface CadaraBrepBezierCurve3Record {
  kind: 'bezier'
  poles: GeometryAssetPoint3[]
  weights?: number[]
  parameterRange: GeometryAssetParameterRange
}

export interface CadaraBrepBSplineCurve3Record {
  kind: 'bSpline'
  degree: number
  periodic: boolean
  poles: GeometryAssetPoint3[]
  weights?: number[]
  knots: number[]
  multiplicities: number[]
  parameterRange: GeometryAssetParameterRange
}

export interface CadaraBrepBezierCurve2Record {
  kind: 'bezier'
  poles: GeometryAssetPoint2[]
  weights?: number[]
  parameterRange: GeometryAssetParameterRange
}

export interface CadaraBrepBSplineCurve2Record {
  kind: 'bSpline'
  degree: number
  periodic: boolean
  poles: GeometryAssetPoint2[]
  weights?: number[]
  knots: number[]
  multiplicities: number[]
  parameterRange: GeometryAssetParameterRange
}

export interface CadaraBrepBezierSurfaceRecord {
  kind: 'bezier'
  uPoleCount: number
  vPoleCount: number
  poles: GeometryAssetPoint3[]
  weights?: number[]
}

export interface CadaraBrepBSplineSurfaceRecord {
  kind: 'bSpline'
  uDegree: number
  vDegree: number
  uPeriodic: boolean
  vPeriodic: boolean
  uPoleCount: number
  vPoleCount: number
  poles: GeometryAssetPoint3[]
  weights?: number[]
  uKnots: number[]
  vKnots: number[]
  uMultiplicities: number[]
  vMultiplicities: number[]
}

export interface CadaraBrepSurfaceFrameRecord {
  origin: GeometryAssetPoint3
  zDirection: GeometryAssetPoint3
  xDirection: GeometryAssetPoint3
}

export type CadaraBrepCurve3Record =
  | {
      kind: 'line'
      origin: GeometryAssetPoint3
      direction: GeometryAssetPoint3
      parameterRange: GeometryAssetParameterRange
    }
  | {
      kind: 'circle'
      center: GeometryAssetPoint3
      axisDirection: GeometryAssetPoint3
      xDirection: GeometryAssetPoint3
      radius: number
      parameterRange: GeometryAssetParameterRange
    }
  | {
      kind: 'ellipse'
      center: GeometryAssetPoint3
      axisDirection: GeometryAssetPoint3
      xDirection: GeometryAssetPoint3
      majorRadius: number
      minorRadius: number
      parameterRange: GeometryAssetParameterRange
    }
  | CadaraBrepBezierCurve3Record
  | CadaraBrepBSplineCurve3Record

export type CadaraBrepCurve2Record =
  | {
      kind: 'line'
      origin: GeometryAssetPoint2
      direction: GeometryAssetPoint2
      parameterRange: GeometryAssetParameterRange
    }
  | {
      kind: 'circle'
      center: GeometryAssetPoint2
      xDirection: GeometryAssetPoint2
      radius: number
      parameterRange: GeometryAssetParameterRange
    }
  | {
      kind: 'ellipse'
      center: GeometryAssetPoint2
      xDirection: GeometryAssetPoint2
      majorRadius: number
      minorRadius: number
      parameterRange: GeometryAssetParameterRange
    }
  | {
      kind: 'polyline'
      points: GeometryAssetPoint2[]
      parameterRange: GeometryAssetParameterRange
    }
  | CadaraBrepBezierCurve2Record
  | CadaraBrepBSplineCurve2Record

export type CadaraBrepSurfaceRecord =
  | {
      kind: 'plane'
      frame: CadaraBrepSurfaceFrameRecord
    }
  | {
      kind: 'cylinder'
      frame: CadaraBrepSurfaceFrameRecord
      radius: number
    }
  | {
      kind: 'cone'
      frame: CadaraBrepSurfaceFrameRecord
      radius: number
      semiAngleRadians: number
    }
  | {
      kind: 'sphere'
      frame: CadaraBrepSurfaceFrameRecord
      radius: number
    }
  | {
      kind: 'torus'
      frame: CadaraBrepSurfaceFrameRecord
      majorRadius: number
      minorRadius: number
    }
  | {
      kind: 'surfaceOfRevolution'
      axisOrigin: GeometryAssetPoint3
      axisDirection: GeometryAssetPoint3
      basisCurve: CadaraBrepCurve3Record
    }
  | {
      kind: 'surfaceOfLinearExtrusion'
      direction: GeometryAssetPoint3
      basisCurve: CadaraBrepCurve3Record
    }
  | CadaraBrepBezierSurfaceRecord
  | CadaraBrepBSplineSurfaceRecord

export interface CadaraBrepVertexRecord {
  vertexKey: string
  point: GeometryAssetPoint3
}

export interface CadaraBrepEdgeRecord {
  edgeKey: string
  vertices: readonly [number, number]
  curve: CadaraBrepCurve3Record
}

export interface CadaraBrepCoedgeRecord {
  coedgeKey: string
  edgeIndex: number
  reversed: boolean
  curve2d: CadaraBrepCurve2Record
}

export interface CadaraBrepLoopRecord {
  loopKey: string
  coedgeIndices: number[]
}

export interface CadaraBrepFaceRecord {
  faceKey: string
  loopIndices: number[]
  surface: CadaraBrepSurfaceRecord
  meshVertices: GeometryAssetPoint3[]
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
    const firstPoint = vertices[low]!.point
    const secondPoint = vertices[high]!.point
    const direction = normalizeVector(subtractPoints(secondPoint, firstPoint))
    const parameterRange: GeometryAssetParameterRange = [0, distanceBetweenPoints(firstPoint, secondPoint)]
    edges.push({
      edgeKey: `${keyPrefix}_edge_${index + 1}`,
      vertices: [low, high],
      curve: {
        kind: 'line',
        origin: firstPoint,
        direction,
        parameterRange,
      },
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
    const planeFrame = createPlaneFrameFromTriangle(points, normal)
    const meshVertices = points.map((point) => normalizePoint(point))
    const edgePairs = [
      [triangleVertices[0], triangleVertices[1]],
      [triangleVertices[1], triangleVertices[2]],
      [triangleVertices[2], triangleVertices[0]],
    ] as const

    for (const [first, second] of edgePairs) {
      const edge = internEdge(first, second)
      const startPoint = vertices[first]!.point
      const endPoint = vertices[second]!.point
      const startUv = projectPointToPlaneFrame(startPoint, planeFrame)
      const endUv = projectPointToPlaneFrame(endPoint, planeFrame)
      const uvDirection = normalizePoint2(subtractPoints2(endUv, startUv))
      const uvLength = distanceBetweenPoints2(startUv, endUv)
      const coedgeIndex = coedges.length
      coedges.push({
        coedgeKey: `${keyPrefix}_coedge_${coedgeIndex + 1}`,
        edgeIndex: edge.edgeIndex,
        reversed: edge.reversed,
        curve2d: {
          kind: 'line',
          origin: startUv,
          direction: uvDirection,
          parameterRange: [0, uvLength],
        },
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
      loopIndices: [loopIndex],
      surface: {
        kind: 'plane',
        frame: planeFrame,
      },
      meshVertices,
      triangles: [[0, 1, 2]],
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

function normalizePoint2(point: GeometryAssetPoint2): GeometryAssetPoint2 {
  return [
    normalizeCoordinate(point[0]),
    normalizeCoordinate(point[1]),
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

function subtractPoints2(left: GeometryAssetPoint2, right: GeometryAssetPoint2): GeometryAssetPoint2 {
  return [left[0] - right[0], left[1] - right[1]]
}

function crossPoints(left: GeometryAssetPoint3, right: GeometryAssetPoint3): GeometryAssetPoint3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function magnitude3(point: GeometryAssetPoint3) {
  return Math.hypot(point[0], point[1], point[2])
}

function magnitude2(point: GeometryAssetPoint2) {
  return Math.hypot(point[0], point[1])
}

function normalizeVector(point: GeometryAssetPoint3): GeometryAssetPoint3 {
  const length = magnitude3(point)
  if (length <= 1e-12) {
    return [1, 0, 0]
  }
  return [
    normalizeCoordinate(point[0] / length),
    normalizeCoordinate(point[1] / length),
    normalizeCoordinate(point[2] / length),
  ]
}

function createPlaneFrameFromTriangle(
  points: readonly [GeometryAssetPoint3, GeometryAssetPoint3, GeometryAssetPoint3],
  normal: GeometryAssetPoint3,
): CadaraBrepSurfaceFrameRecord {
  const xSeed = subtractPoints(points[1], points[0])
  const xDirection = normalizeVector(xSeed)
  return {
    origin: normalizePoint(points[0]),
    zDirection: normalizeVector(normal),
    xDirection,
  }
}

function projectPointToPlaneFrame(
  point: GeometryAssetPoint3,
  frame: CadaraBrepSurfaceFrameRecord,
): GeometryAssetPoint2 {
  const relative = subtractPoints(point, frame.origin)
  const x = dotPoints(relative, frame.xDirection)
  const yDirection = normalizeVector(crossPoints(frame.zDirection, frame.xDirection))
  const y = dotPoints(relative, yDirection)
  return normalizePoint2([x, y])
}

function dotPoints(left: GeometryAssetPoint3, right: GeometryAssetPoint3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function distanceBetweenPoints(left: GeometryAssetPoint3, right: GeometryAssetPoint3) {
  return magnitude3(subtractPoints(right, left))
}

function distanceBetweenPoints2(left: GeometryAssetPoint2, right: GeometryAssetPoint2) {
  return magnitude2(subtractPoints2(right, left))
}
