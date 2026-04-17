import type { BaseDocumentRequest } from '@/contracts/modeling/schema'
import type { DurableRef } from '@/contracts/shared/references'
import type { RevisionId } from '@/contracts/shared/ids'

export type DocumentExportFormat = 'stl' | 'step' | '3mf' | 'cadara'
export type DocumentExportPayload = string | Uint8Array
export type DocumentExportDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface DocumentExportDiagnostic {
  code: string
  severity: DocumentExportDiagnosticSeverity
  message: string
  target: DurableRef | null
}

export interface MeshExportAccuracyOptions {
  chordTolerance: number
  angleToleranceRadians: number
}

export interface StlExportOptions {
  meshAccuracy: MeshExportAccuracyOptions
  encoding: 'binary' | 'ascii'
}

export interface ThreeMfExportOptions {
  meshAccuracy: MeshExportAccuracyOptions
  unit: 'millimeter'
  includeMetadata: boolean
}

export interface StepExportOptions {
  schema: 'AP203' | 'AP214' | 'AP242'
  unit: 'millimeter'
}

export interface CadaraExportOptions {
  pretty: boolean
}

export type DocumentExportOptionsByFormat = {
  stl: StlExportOptions
  step: StepExportOptions
  '3mf': ThreeMfExportOptions
  cadara: CadaraExportOptions
}

export type DocumentExportOptions =
  | ({ format: 'stl' } & StlExportOptions)
  | ({ format: 'step' } & StepExportOptions)
  | ({ format: '3mf' } & ThreeMfExportOptions)
  | ({ format: 'cadara' } & CadaraExportOptions)

interface DocumentExportRequestBase extends BaseDocumentRequest {
  baseRevisionId: RevisionId
  target: DurableRef
  targetLabel: string
}

export type DocumentExportRequest =
  | (DocumentExportRequestBase & { format: 'stl'; options: StlExportOptions })
  | (DocumentExportRequestBase & { format: 'step'; options: StepExportOptions })
  | (DocumentExportRequestBase & { format: '3mf'; options: ThreeMfExportOptions })
  | (DocumentExportRequestBase & { format: 'cadara'; options: CadaraExportOptions })

export interface DocumentExportSuccessResult {
  ok: true
  format: DocumentExportFormat
  filename: string
  extension: string
  mimeType: string
  payload: DocumentExportPayload
  diagnostics: DocumentExportDiagnostic[]
}

export interface DocumentExportFailureResult {
  ok: false
  format: DocumentExportFormat
  diagnostics: DocumentExportDiagnostic[]
}

export type DocumentExportResult = DocumentExportSuccessResult | DocumentExportFailureResult
