import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import type { GeometryAssetHash } from '@/contracts/modeling/geometry-assets'
import { getGeometryAssetHashPrefix } from '@/contracts/modeling/geometry-assets'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type {
  MeshReconstructionProvenance,
  MeshReconstructionQualityMetrics,
  MeshReconstructionResultClassification,
  MeshReconstructionSettings,
} from '@/contracts/modeling/mesh-reconstruction'

export type MeshImportSourceFormat = 'stl' | '3mf'
export type MeshImportUnitSource = 'user'
export type MeshImportUpAxis = 'z' | 'y'

export interface MeshImportUnitResolution {
  source: MeshImportUnitSource
  resolvedUnit: 'millimeter'
  scaleToDocument: number
}

export interface MeshImportOrientation {
  upAxis: MeshImportUpAxis
  handedness: 'rightHanded'
}

export interface MeshImportPlacementTransform {
  translation: readonly [number, number, number]
  rotationEulerRadians: readonly [number, number, number]
  scale: number
}

export interface MeshImportResolvedSettings {
  unit: MeshImportUnitResolution
  orientation: MeshImportOrientation
  placement: MeshImportPlacementTransform
}

export interface MeshImportSourceProvenance {
  originalFileName: string
  sourceFormat: MeshImportSourceFormat
  sourceHash: GeometryAssetHash
  sourceStored: false
}

export interface MeshImportFeatureParameters {
  assetId: GeometryAssetId
  source: MeshImportSourceProvenance
  resolvedSettings: MeshImportResolvedSettings
  reconstruction?: MeshReconstructionProvenance
  label: string
}

export type MeshImportDiagnosticCode =
  | 'mesh-import-source-discard-warning'
  | 'mesh-import-parse-failed'
  | 'mesh-import-conversion-failed'
  | 'mesh-import-uncertain-analytic-recovery'
  | 'mesh-import-faceted-fallback-limit-exceeded'
  | 'mesh-import-faceted-fallback-acceptance-required'
  | 'mesh-import-mesh-body-fallback-disabled'
  | 'mesh-import-missing-baked-asset'

export interface MeshImportDiagnosticDetail {
  kind: 'meshImport'
  code: MeshImportDiagnosticCode
  sourceFormat?: MeshImportSourceFormat
  sourceHashPrefix?: string
  triangleCount?: number
  conversionPhase?: 'parse' | 'validate' | 'bake' | 'restore'
  rejectionReason?: string
  sourceStored?: false
  resultClassification?: MeshReconstructionResultClassification
  reconstructionSettings?: MeshReconstructionSettings
  qualityMetrics?: MeshReconstructionQualityMetrics
}

export function createMeshImportDiagnostic(
  code: MeshImportDiagnosticCode,
  message: string,
  input: {
    featureId?: FeatureId
    sourceFormat?: MeshImportSourceFormat
    sourceHash?: GeometryAssetHash
    triangleCount?: number
    conversionPhase?: MeshImportDiagnosticDetail['conversionPhase']
    rejectionReason?: string
    severity?: ModelingDiagnostic['severity']
    resultClassification?: MeshReconstructionResultClassification
    reconstructionSettings?: MeshReconstructionSettings
    qualityMetrics?: MeshReconstructionQualityMetrics
  } = {},
): ModelingDiagnostic {
  return {
    code,
    severity: input.severity ?? (code === 'mesh-import-source-discard-warning' ? 'warning' : 'error'),
    message,
    featureId: input.featureId ?? null,
    target: null,
    detail: {
      kind: 'meshImport',
      code,
      sourceFormat: input.sourceFormat,
      sourceHashPrefix: input.sourceHash ? getGeometryAssetHashPrefix(input.sourceHash) : undefined,
      triangleCount: input.triangleCount,
      conversionPhase: input.conversionPhase,
      rejectionReason: input.rejectionReason,
      sourceStored: false,
      resultClassification: input.resultClassification,
      reconstructionSettings: input.reconstructionSettings,
      qualityMetrics: input.qualityMetrics,
    },
  }
}
