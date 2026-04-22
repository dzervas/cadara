import { z } from 'zod'

import type { GeometryAssetHash } from '@/contracts/modeling/geometry-assets'
import type {
  MeshUnificationDiagnostics,
  MeshReconstructionProvenance,
  MeshReconstructionQualityMetrics,
  MeshReconstructionSettings,
  MeshReconstructionSurfaceSummary,
} from '@/contracts/modeling/mesh-reconstruction'

export function createMeshReconstructionSettingsSchema() {
  return z.object({
    qualityPreset: z.literal('conservative'),
    linearTolerance: z.number().positive('Mesh reconstruction linear tolerance must be positive.'),
    angularToleranceRadians: z.number().positive('Mesh reconstruction angular tolerance must be positive.'),
    unificationLinearTolerance: z.number().positive('Mesh unification linear tolerance must be positive.').optional(),
    unificationAngularTolerance: z.number().positive('Mesh unification angular tolerance must be positive.').optional(),
    maxFacetedTriangles: z.number().int().positive('Mesh reconstruction triangle limit must be positive.'),
    maxFacetedVertices: z.number().int().positive('Mesh reconstruction vertex limit must be positive.'),
    meshBodyFallback: z.literal('disabled'),
  }).strict().transform((value) => value as MeshReconstructionSettings)
}

export function createMeshReconstructionQualityMetricsSchema() {
  return z.object({
    triangleCount: z.number().int().nonnegative(),
    vertexCount: z.number().int().nonnegative(),
    openEdgeCount: z.number().int().nonnegative(),
    degenerateTriangleCount: z.number().int().nonnegative(),
    planarRegionCount: z.number().int().nonnegative(),
    cylindricalRegionCount: z.number().int().nonnegative(),
    analyticConfidence: z.number().min(0).max(1),
    maxPlanarDeviation: z.number().nonnegative(),
    maxCylindricalDeviation: z.number().nonnegative().nullable(),
  }).strict().transform((value) => value as MeshReconstructionQualityMetrics)
}

export function createMeshReconstructionSurfaceSummarySchema() {
  return z.object({
    planarRegions: z.number().int().nonnegative(),
    cylindricalRegions: z.number().int().nonnegative(),
  }).strict().transform((value) => value as MeshReconstructionSurfaceSummary)
}

export function createMeshUnificationDiagnosticsSchema() {
  return z.object({
    preFaceCount: z.number().int().nonnegative(),
    postFaceCount: z.number().int().nonnegative(),
    mergedSurfaceTypes: z.object({
      plane: z.number().int().nonnegative(),
      cylinder: z.number().int().nonnegative(),
      cone: z.number().int().nonnegative(),
      sphere: z.number().int().nonnegative(),
      torus: z.number().int().nonnegative(),
    }).strict(),
  }).strict().transform((value) => value as MeshUnificationDiagnostics)
}

export function createMeshReconstructionProvenanceSchema(
  sourceHashSchema: z.ZodType<GeometryAssetHash>,
) {
  return z.object({
    algorithmId: z.string().trim().min(1, 'Mesh reconstruction algorithm id is required.'),
    algorithmVersion: z.string().trim().min(1, 'Mesh reconstruction algorithm version is required.'),
    settings: createMeshReconstructionSettingsSchema(),
    sourceHash: sourceHashSchema,
    resultClassification: z.union([
      z.literal('analytic'),
      z.literal('facetedFallback'),
      z.literal('rejected'),
      z.literal('meshBodyException'),
    ]),
    qualityMetrics: createMeshReconstructionQualityMetricsSchema(),
    surfaceSummary: createMeshReconstructionSurfaceSummarySchema(),
    unificationDiagnostics: createMeshUnificationDiagnosticsSchema().optional(),
  }).strict().transform((value) => value as MeshReconstructionProvenance)
}
