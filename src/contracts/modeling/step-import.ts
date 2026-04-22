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

export type StepImportSourceAssetRole = 'root' | 'referenced'

export interface StepImportSourceAssetReference {
  role: StepImportSourceAssetRole
  assetId: GeometryAssetId
  selectedFileName: string
  documentName: string
}

export interface StepImportSelectedSolid {
  solidKey: string
  label: string
  sourceAssetId: GeometryAssetId
}

export interface StepImportReviewFileInput {
  fileName: string
  bytes: Uint8Array
}

export interface StepImportReviewResolvedSource {
  documentName: string
  fileName: string
  role: StepImportSourceAssetRole
}

export interface StepImportReviewSolidRow {
  solidKey: string
  label: string
  sourceFileName: string
  documentName: string
  importable: boolean
}

export interface StepImportReviewResult {
  rootFileName: string
  referencedDocumentNames: readonly string[]
  resolvedSources: readonly StepImportReviewResolvedSource[]
  solids: readonly StepImportReviewSolidRow[]
  diagnostics: readonly ModelingDiagnostic[]
}

interface StepImportFeatureParametersBase {
  unit: StepImportUnitResolution
  orientation: StepImportOrientation
  placement: StepImportPlacementTransform
  label: string
}

export interface StepImportSingleFileFeatureParameters extends StepImportFeatureParametersBase {
  assetId: GeometryAssetId
  sourceFiles?: undefined
  selectedSolids?: undefined
}

export interface StepImportMultiFileFeatureParameters extends StepImportFeatureParametersBase {
  assetId: GeometryAssetId
  sourceFiles: readonly StepImportSourceAssetReference[]
  selectedSolids: readonly StepImportSelectedSolid[]
}

export type StepImportFeatureParameters =
  | StepImportSingleFileFeatureParameters
  | StepImportMultiFileFeatureParameters

export function decodeStepString(value: string) {
  return value.replaceAll("''", "'")
}

export function findExternalStepDocumentNames(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes)
  const names = new Set<string>()
  const documentFilePattern = /DOCUMENT_FILE\s*\(\s*'((?:[^']|'')*)'/gi

  for (const match of text.matchAll(documentFilePattern)) {
    const name = decodeStepString(match[1] ?? '').trim()
    if (/\.(?:step|stp)$/i.test(name)) {
      names.add(name)
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right))
}

export function getStepDocumentBasename(name: string) {
  const trimmed = name.trim().replaceAll('\\', '/').replace(/[?#].*$/, '')
  const basename = trimmed.split('/').pop() ?? trimmed
  let decoded = basename
  try {
    decoded = decodeURIComponent(basename)
  } catch {
    decoded = basename
  }

  return decoded.normalize('NFC').toLocaleLowerCase('en-US')
}

export function createStepSolidKey(input: {
  documentName: string
  solidOrdinal: number
}) {
  return `${getStepDocumentBasename(input.documentName)}#solid-${input.solidOrdinal}`
}

export type StepImportDiagnosticCode =
  | 'step-import-unreadable-file'
  | 'step-import-unsupported-structure'
  | 'step-import-no-solids'
  | 'step-import-missing-asset'
  | 'step-import-missing-reference'
  | 'step-import-ambiguous-reference'
  | 'step-import-unreadable-referenced-file'
  | 'step-import-stale-selected-solid'
  | 'step-import-empty-selection'

export interface StepImportDiagnosticDetail {
  kind: 'stepImport'
  code: StepImportDiagnosticCode
  assetId?: GeometryAssetId
  sourceName?: string
  selectedFileName?: string
  documentName?: string
  solidKey?: string
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
    selectedFileName?: string
    documentName?: string
    solidKey?: string
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
      selectedFileName: input.selectedFileName,
      documentName: input.documentName,
      solidKey: input.solidKey,
      skippedUnsupportedCount: input.skippedUnsupportedCount,
    },
  }
}
