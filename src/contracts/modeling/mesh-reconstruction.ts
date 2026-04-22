import type { GeometryAssetHash } from '@/contracts/modeling/geometry-assets'

export type MeshReconstructionResultClassification =
  | 'analytic'
  | 'facetedFallback'
  | 'rejected'
  | 'meshBodyException'

export interface MeshReconstructionSettings {
  qualityPreset: 'conservative'
  linearTolerance: number
  angularToleranceRadians: number
  unificationLinearTolerance?: number
  unificationAngularTolerance?: number
  maxFacetedTriangles: number
  maxFacetedVertices: number
  meshBodyFallback: 'disabled'
}

export interface MeshReconstructionQualityMetrics {
  triangleCount: number
  vertexCount: number
  openEdgeCount: number
  degenerateTriangleCount: number
  planarRegionCount: number
  cylindricalRegionCount: number
  analyticConfidence: number
  maxPlanarDeviation: number
  maxCylindricalDeviation: number | null
}

export interface MeshReconstructionSurfaceSummary {
  planarRegions: number
  cylindricalRegions: number
}

export interface MeshUnificationSurfaceTypeCounts {
  plane: number
  cylinder: number
  cone: number
  sphere: number
  torus: number
}

export interface MeshUnificationDiagnostics {
  preFaceCount: number
  postFaceCount: number
  mergedSurfaceTypes: MeshUnificationSurfaceTypeCounts
}

export interface MeshReconstructionProvenance {
  algorithmId: string
  algorithmVersion: string
  settings: MeshReconstructionSettings
  sourceHash: GeometryAssetHash
  resultClassification: MeshReconstructionResultClassification
  qualityMetrics: MeshReconstructionQualityMetrics
  surfaceSummary: MeshReconstructionSurfaceSummary
  unificationDiagnostics?: MeshUnificationDiagnostics
}

export const MESH_RECONSTRUCTION_ALGORITHM_ID = 'cadara-conservative-mesh-reconstruction'
export const MESH_RECONSTRUCTION_ALGORITHM_VERSION = '1'

export const DEFAULT_MESH_RECONSTRUCTION_SETTINGS: MeshReconstructionSettings = {
  qualityPreset: 'conservative',
  linearTolerance: 1e-5,
  angularToleranceRadians: 0.01,
  unificationLinearTolerance: 0.01,
  unificationAngularTolerance: 0.01,
  maxFacetedTriangles: 50_000,
  maxFacetedVertices: 50_000,
  meshBodyFallback: 'disabled',
}
