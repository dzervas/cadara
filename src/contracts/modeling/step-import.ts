import type { FeatureId, GeometryAssetId } from '@/contracts/shared/ids'
import type { GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'

export type StepImportLengthUnit = 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
export type StepImportUnitSource = 'file' | 'user'
export type StepImportUpAxis = 'z' | 'y'

export interface StepImportUnitResolution {
  source: StepImportUnitSource
  resolvedUnit: StepImportLengthUnit
  scaleToDocument: number
}

export interface StepImportOrientation {
  upAxis: StepImportUpAxis
  handedness: 'rightHanded'
}

export interface StepImportPlacementTransform {
  translation: readonly [number, number, number]
  rotationEulerRadians: readonly [number, number, number]
  scale: number
}

export interface StepImportFeatureParameters {
  assetId: GeometryAssetId
  unit: StepImportUnitResolution
  orientation: StepImportOrientation
  placement: StepImportPlacementTransform
  label: string
}

export type StepImportDiagnosticCode =
  | 'step-import-unreadable-file'
  | 'step-import-unsupported-structure'
  | 'step-import-no-solids'
  | 'step-import-missing-asset'

export interface StepImportDiagnosticDetail {
  kind: 'stepImport'
  code: StepImportDiagnosticCode
  assetId?: GeometryAssetId
  sourceName?: string
  skippedUnsupportedCount?: number
}

export function createStepImportDiagnostic(
  code: StepImportDiagnosticCode,
  message: string,
  input: {
    asset?: GeometryAssetRecord
    assetId?: GeometryAssetId
    featureId?: FeatureId
    sourceName?: string
    skippedUnsupportedCount?: number
    severity?: ModelingDiagnostic['severity']
  } = {},
): ModelingDiagnostic {
  return {
    code,
    severity: input.severity ?? 'error',
    message,
    featureId: input.featureId ?? input.asset?.ownerFeatureIds[0] ?? null,
    target: null,
    detail: {
      kind: 'stepImport',
      code,
      assetId: input.assetId ?? input.asset?.assetId,
      sourceName: input.sourceName,
      skippedUnsupportedCount: input.skippedUnsupportedCount,
    },
  }
}
