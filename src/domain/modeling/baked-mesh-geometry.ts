import {
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import type {
  GeometryAssetBlobInput,
  GeometryAssetHash,
  GeometryAssetRecord,
} from '@/contracts/modeling/geometry-assets'
import {
  DEFAULT_MESH_RECONSTRUCTION_SETTINGS,
  MESH_RECONSTRUCTION_ALGORITHM_ID,
  MESH_RECONSTRUCTION_ALGORITHM_VERSION,
  type MeshReconstructionProvenance,
  type MeshReconstructionQualityMetrics,
  type MeshReconstructionResultClassification,
  type MeshReconstructionSettings,
  type MeshReconstructionSurfaceSummary,
} from '@/contracts/modeling/mesh-reconstruction'
import type { MeshImportSourceFormat } from '@/contracts/modeling/mesh-import'
import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import type { MeshPoint, MeshTriangle } from '@/domain/modeling/mesh-parser'

export const BAKED_MESH_GEOMETRY_MEDIA_TYPE = 'application/vnd.cadara.baked-mesh+json'
const BAKED_MESH_GEOMETRY_SCHEMA_VERSION = 'baked-mesh-geometry/v1alpha1'

export interface BakedMeshGeometryPayload {
  schemaVersion: typeof BAKED_MESH_GEOMETRY_SCHEMA_VERSION
  vertices: MeshPoint[]
  indices: Array<readonly [number, number, number]>
}

export type MeshBakeResult =
  | {
    ok: true
    assetInput: GeometryAssetBlobInput
    triangleCount: number
    reconstruction: MeshReconstructionProvenance
  }
  | {
    ok: false
    reason: string
    triangleCount: number
    resultClassification: MeshReconstructionResultClassification
    reconstruction: Omit<MeshReconstructionProvenance, 'sourceHash'>
    diagnosticCode: 'mesh-import-conversion-failed'
      | 'mesh-import-faceted-fallback-limit-exceeded'
      | 'mesh-import-faceted-fallback-acceptance-required'
      | 'mesh-import-mesh-body-fallback-disabled'
  }

export interface MeshReconstructionEvaluation {
  resultClassification: MeshReconstructionResultClassification
  settings: MeshReconstructionSettings
  qualityMetrics: MeshReconstructionQualityMetrics
  surfaceSummary: MeshReconstructionSurfaceSummary
  rejectionReason: string | null
}

export async function createBakedMeshGeometryAsset(input: {
  triangles: readonly MeshTriangle[]
  sourceFileName: string
  sourceFormat: MeshImportSourceFormat
  sourceHash: GeometryAssetHash
  ownerFeatureId: FeatureId
  acceptFacetedFallback?: boolean
  settings?: MeshReconstructionSettings
}): Promise<MeshBakeResult> {
  const settings = input.settings ?? DEFAULT_MESH_RECONSTRUCTION_SETTINGS
  const evaluation = evaluateMeshReconstructionFallbacks(input.triangles, settings)
  const reconstruction = createMeshReconstructionProvenance(input.sourceHash, evaluation)
  const normalized = normalizeMeshTriangles(input.triangles)
  if (!normalized.ok) {
    return {
      ok: false,
      reason: normalized.reason,
      triangleCount: input.triangles.length,
      resultClassification: evaluation.resultClassification,
      reconstruction,
      diagnosticCode: 'mesh-import-conversion-failed',
    }
  }

  if (evaluation.resultClassification === 'rejected') {
    const limitExceeded = evaluation.qualityMetrics.triangleCount > settings.maxFacetedTriangles
      || evaluation.qualityMetrics.vertexCount > settings.maxFacetedVertices
    return {
      ok: false,
      reason: evaluation.rejectionReason ?? 'Mesh reconstruction rejected the source geometry.',
      triangleCount: input.triangles.length,
      resultClassification: evaluation.resultClassification,
      reconstruction,
      diagnosticCode: limitExceeded
        ? 'mesh-import-faceted-fallback-limit-exceeded'
        : 'mesh-import-conversion-failed',
    }
  }

  if (evaluation.resultClassification === 'meshBodyException') {
    return {
      ok: false,
      reason: evaluation.rejectionReason ?? 'Persistent mesh body fallback is not enabled.',
      triangleCount: input.triangles.length,
      resultClassification: evaluation.resultClassification,
      reconstruction,
      diagnosticCode: 'mesh-import-mesh-body-fallback-disabled',
    }
  }

  if (evaluation.resultClassification === 'facetedFallback' && input.acceptFacetedFallback !== true) {
    return {
      ok: false,
      reason: 'Faceted fallback requires explicit user acceptance before commit.',
      triangleCount: input.triangles.length,
      resultClassification: evaluation.resultClassification,
      reconstruction,
      diagnosticCode: 'mesh-import-faceted-fallback-acceptance-required',
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
      generator: `${MESH_RECONSTRUCTION_ALGORITHM_ID}/v${MESH_RECONSTRUCTION_ALGORITHM_VERSION}`,
      reconstruction,
    },
    data: {
      kind: 'bakedMeshGeometry',
      schemaVersion: normalized.payload.schemaVersion,
      vertices: normalized.payload.vertices,
      indices: normalized.payload.indices,
    },
    ownerFeatureIds: [input.ownerFeatureId],
  }

  return {
    ok: true,
    assetInput: { asset, bytes },
    triangleCount: input.triangles.length,
    reconstruction,
  }
}

export function evaluateMeshReconstructionFallbacks(
  triangles: readonly MeshTriangle[],
  settings: MeshReconstructionSettings = DEFAULT_MESH_RECONSTRUCTION_SETTINGS,
): MeshReconstructionEvaluation {
  const topology = analyzeMeshTopology(triangles)
  const surfaceAnalysis = topology.ok
    ? analyzeAnalyticSurfaces(topology.payload, settings)
    : createEmptySurfaceAnalysis()
  const surfaceSummary = {
    planarRegions: surfaceAnalysis.planarRegionCount,
    cylindricalRegions: surfaceAnalysis.cylindricalRegionCount,
  }
  const qualityMetrics: MeshReconstructionQualityMetrics = {
    triangleCount: triangles.length,
    vertexCount: topology.vertexCount,
    openEdgeCount: topology.openEdgeCount,
    degenerateTriangleCount: topology.degenerateTriangleCount,
    planarRegionCount: surfaceAnalysis.planarRegionCount,
    cylindricalRegionCount: surfaceAnalysis.cylindricalRegionCount,
    analyticConfidence: surfaceAnalysis.analyticConfidence,
    maxPlanarDeviation: surfaceAnalysis.maxPlanarDeviation,
    maxCylindricalDeviation: surfaceAnalysis.maxCylindricalDeviation,
  }

  if (!topology.ok) {
    return {
      resultClassification: 'rejected',
      settings,
      qualityMetrics,
      surfaceSummary,
      rejectionReason: topology.reason,
    }
  }

  if (
    surfaceAnalysis.analyticConfidence >= 0.98
    && surfaceAnalysis.planarRegionCount + surfaceAnalysis.cylindricalRegionCount > 0
  ) {
    return {
      resultClassification: 'analytic',
      settings,
      qualityMetrics,
      surfaceSummary,
      rejectionReason: null,
    }
  }

  if (topology.payload.indices.length > settings.maxFacetedTriangles) {
    return {
      resultClassification: 'meshBodyException',
      settings,
      qualityMetrics,
      surfaceSummary,
      rejectionReason: `Faceted fallback exceeds the ${settings.maxFacetedTriangles} triangle limit. Persistent mesh body fallback is not enabled.`,
    }
  }

  if (topology.payload.vertices.length > settings.maxFacetedVertices) {
    return {
      resultClassification: 'meshBodyException',
      settings,
      qualityMetrics,
      surfaceSummary,
      rejectionReason: `Faceted fallback exceeds the ${settings.maxFacetedVertices} vertex limit. Persistent mesh body fallback is not enabled.`,
    }
  }

  return {
    resultClassification: 'facetedFallback',
    settings,
    qualityMetrics,
    surfaceSummary,
    rejectionReason: 'Analytic reconstruction confidence is below the conservative threshold.',
  }
}

export function createMeshSizeLimitEvaluation(input: {
  triangleCount: number
  settings?: MeshReconstructionSettings
}): MeshReconstructionEvaluation | null {
  const settings = input.settings ?? DEFAULT_MESH_RECONSTRUCTION_SETTINGS
  if (input.triangleCount <= settings.maxFacetedTriangles) {
    return null
  }

  const rejectionReason = `Faceted fallback exceeds the ${settings.maxFacetedTriangles} triangle limit. Persistent mesh body fallback is not enabled.`
  return {
    resultClassification: 'meshBodyException',
    settings,
    qualityMetrics: {
      triangleCount: input.triangleCount,
      vertexCount: input.triangleCount * 3,
      openEdgeCount: 0,
      degenerateTriangleCount: 0,
      planarRegionCount: 0,
      cylindricalRegionCount: 0,
      analyticConfidence: 0,
      maxPlanarDeviation: 0,
      maxCylindricalDeviation: null,
    },
    surfaceSummary: {
      planarRegions: 0,
      cylindricalRegions: 0,
    },
    rejectionReason,
  }
}

function createMeshReconstructionProvenance(
  sourceHash: GeometryAssetHash,
  evaluation: MeshReconstructionEvaluation,
): MeshReconstructionProvenance {
  return {
    algorithmId: MESH_RECONSTRUCTION_ALGORITHM_ID,
    algorithmVersion: MESH_RECONSTRUCTION_ALGORITHM_VERSION,
    settings: evaluation.settings,
    sourceHash,
    resultClassification: evaluation.resultClassification,
    qualityMetrics: evaluation.qualityMetrics,
    surfaceSummary: evaluation.surfaceSummary,
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
  const analyzed = analyzeMeshTopology(triangles)
  if (!analyzed.ok) {
    return {
      ok: false as const,
      reason: analyzed.reason,
    }
  }

  return {
    ok: true as const,
    payload: analyzed.payload,
  }
}

function analyzeMeshTopology(triangles: readonly MeshTriangle[]) {
  if (triangles.length === 0) {
    return {
      ok: false as const,
      reason: 'Mesh contains no triangles.',
      vertexCount: 0,
      openEdgeCount: 0,
      degenerateTriangleCount: 0,
    }
  }

  const vertexIndexes = new Map<string, number>()
  const vertices: MeshPoint[] = []
  const indices: Array<readonly [number, number, number]> = []
  const edgeCounts = new Map<string, number>()
  let degenerateTriangleCount = 0

  for (const triangle of triangles) {
    if (!triangle.every(isFinitePoint)) {
      return {
        ok: false as const,
        reason: 'Mesh contains non-finite vertex coordinates.',
        vertexCount: vertices.length,
        openEdgeCount: 0,
        degenerateTriangleCount,
      }
    }

    if (triangleArea(triangle) <= 1e-12) {
      degenerateTriangleCount += 1
      continue
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
  if (degenerateTriangleCount > 0) {
    return {
      ok: false as const,
      reason: 'Mesh contains degenerate triangles.',
      vertexCount: vertices.length,
      openEdgeCount,
      degenerateTriangleCount,
    }
  }

  if (openEdgeCount > 0) {
    return {
      ok: false as const,
      reason: 'Mesh triangles do not form a closed manifold shell.',
      vertexCount: vertices.length,
      openEdgeCount,
      degenerateTriangleCount,
    }
  }

  return {
    ok: true as const,
    vertexCount: vertices.length,
    openEdgeCount,
    degenerateTriangleCount,
    payload: {
      schemaVersion: BAKED_MESH_GEOMETRY_SCHEMA_VERSION,
      vertices,
      indices,
    } satisfies BakedMeshGeometryPayload,
  }
}

function createEmptySurfaceAnalysis() {
  return {
    planarRegionCount: 0,
    cylindricalRegionCount: 0,
    analyticConfidence: 0,
    maxPlanarDeviation: 0,
    maxCylindricalDeviation: null as number | null,
  }
}

function analyzeAnalyticSurfaces(
  payload: BakedMeshGeometryPayload,
  settings: MeshReconstructionSettings,
) {
  const planar = analyzePlanarRegions(payload, settings)
  const cylindrical = analyzeCylindricalRegions(payload, settings)
  const covered = new Set([...planar.coveredTriangleIndexes, ...cylindrical.coveredTriangleIndexes])

  return {
    planarRegionCount: planar.regionCount,
    cylindricalRegionCount: cylindrical.regionCount,
    analyticConfidence: payload.indices.length === 0 ? 0 : covered.size / payload.indices.length,
    maxPlanarDeviation: planar.maxDeviation,
    maxCylindricalDeviation: cylindrical.maxDeviation,
  }
}

function analyzePlanarRegions(
  payload: BakedMeshGeometryPayload,
  settings: MeshReconstructionSettings,
) {
  const groups = new Map<string, {
    normal: MeshPoint
    distance: number
    triangleIndexes: number[]
    maxDeviation: number
  }>()

  for (const [triangleIndex, triangle] of payload.indices.entries()) {
    const first = payload.vertices[triangle[0]]!
    const second = payload.vertices[triangle[1]]!
    const third = payload.vertices[triangle[2]]!
    const normal = canonicalNormal(calculateNormal(first, second, third))
    const distance = dot(normal, first)
    const key = [
      quantize(normal[0], settings.angularToleranceRadians),
      quantize(normal[1], settings.angularToleranceRadians),
      quantize(normal[2], settings.angularToleranceRadians),
      quantize(distance, settings.linearTolerance),
    ].join(':')
    const group = groups.get(key) ?? {
      normal,
      distance,
      triangleIndexes: [],
      maxDeviation: 0,
    }
    group.triangleIndexes.push(triangleIndex)
    group.maxDeviation = Math.max(
      group.maxDeviation,
      Math.abs(dot(normal, first) - distance),
      Math.abs(dot(normal, second) - distance),
      Math.abs(dot(normal, third) - distance),
    )
    groups.set(key, group)
  }

  const coveredTriangleIndexes = new Set<number>()
  let regionCount = 0
  let maxDeviation = 0
  for (const group of groups.values()) {
    maxDeviation = Math.max(maxDeviation, group.maxDeviation)
    if (group.triangleIndexes.length < 2 || group.maxDeviation > settings.linearTolerance) {
      continue
    }

    regionCount += 1
    for (const triangleIndex of group.triangleIndexes) {
      coveredTriangleIndexes.add(triangleIndex)
    }
  }

  return { regionCount, coveredTriangleIndexes, maxDeviation }
}

function analyzeCylindricalRegions(
  payload: BakedMeshGeometryPayload,
  settings: MeshReconstructionSettings,
) {
  let best = {
    regionCount: 0,
    coveredTriangleIndexes: new Set<number>(),
    maxDeviation: null as number | null,
  }

  for (const axis of [0, 1, 2] as const) {
    const candidate = analyzeCylinderAlongAxis(payload, settings, axis)
    if (candidate.coveredTriangleIndexes.size > best.coveredTriangleIndexes.size) {
      best = candidate
    }
  }

  return best
}

function analyzeCylinderAlongAxis(
  payload: BakedMeshGeometryPayload,
  settings: MeshReconstructionSettings,
  axis: 0 | 1 | 2,
) {
  const radialAxes = [0, 1, 2].filter((index) => index !== axis) as [number, number]
  const axisValues = payload.vertices.map((vertex) => vertex[axis])
  const minAxis = Math.min(...axisValues)
  const maxAxis = Math.max(...axisValues)
  const extent = maxAxis - minAxis
  const sideTriangleIndexes: number[] = []

  for (const [triangleIndex, triangle] of payload.indices.entries()) {
    const vertices = triangle.map((index) => payload.vertices[index]!)
    const onMinCap = vertices.every((vertex) => Math.abs(vertex[axis] - minAxis) <= settings.linearTolerance)
    const onMaxCap = vertices.every((vertex) => Math.abs(vertex[axis] - maxAxis) <= settings.linearTolerance)
    if (!onMinCap && !onMaxCap) {
      sideTriangleIndexes.push(triangleIndex)
    }
  }

  if (extent <= settings.linearTolerance || sideTriangleIndexes.length < 8) {
    return { regionCount: 0, coveredTriangleIndexes: new Set<number>(), maxDeviation: null }
  }

  const sideVertices = uniqueTriangleVertices(payload, sideTriangleIndexes)
  const center = [
    average(sideVertices.map((vertex) => vertex[radialAxes[0]])),
    average(sideVertices.map((vertex) => vertex[radialAxes[1]])),
  ] as const
  const radii = sideVertices.map((vertex) =>
    Math.hypot(vertex[radialAxes[0]] - center[0], vertex[radialAxes[1]] - center[1]),
  )
  const radius = average(radii)
  const maxDeviation = Math.max(...radii.map((value) => Math.abs(value - radius)))
  const angularBins = new Set(sideVertices.map((vertex) => {
    const angle = Math.atan2(vertex[radialAxes[1]] - center[1], vertex[radialAxes[0]] - center[0])
    return Math.round(angle / (Math.PI / 16))
  }))

  if (radius <= settings.linearTolerance || maxDeviation > settings.linearTolerance * 10 || angularBins.size < 8) {
    return { regionCount: 0, coveredTriangleIndexes: new Set<number>(), maxDeviation }
  }

  return {
    regionCount: 1,
    coveredTriangleIndexes: new Set(sideTriangleIndexes),
    maxDeviation,
  }
}

function uniqueTriangleVertices(payload: BakedMeshGeometryPayload, triangleIndexes: readonly number[]) {
  const vertexIndexes = new Set<number>()
  for (const triangleIndex of triangleIndexes) {
    for (const vertexIndex of payload.indices[triangleIndex]!) {
      vertexIndexes.add(vertexIndex)
    }
  }
  return [...vertexIndexes].map((index) => payload.vertices[index]!)
}

function canonicalNormal(normal: MeshPoint): MeshPoint {
  const firstSignificant = normal.find((component) => Math.abs(component) > 1e-12)
  return firstSignificant !== undefined && firstSignificant < 0
    ? [-normal[0], -normal[1], -normal[2]]
    : normal
}

function dot(left: MeshPoint, right: MeshPoint) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function quantize(value: number, tolerance: number) {
  return Math.round(value / tolerance)
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
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
