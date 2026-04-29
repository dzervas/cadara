import type { BaseDocumentRequest } from '@/contracts/modeling/schema'
import type { DurableRef } from '@/contracts/shared/references'
import type { RevisionId } from '@/contracts/shared/ids'

export type DocumentExportPayload = string | Uint8Array
export type DocumentExportDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface DocumentExportDiagnostic {
  code: string
  severity: DocumentExportDiagnosticSeverity
  message: string
  target: DurableRef | null
}

export interface CadaraExportOptions {
  pretty: boolean
}

export interface DocumentExportRequest extends BaseDocumentRequest {
  baseRevisionId: RevisionId
  target: DurableRef
  targetLabel: string
  format: string
  options: unknown
}

export interface DocumentExportSuccessResult {
  ok: true
  format: string
  filename: string
  extension: string
  mimeType: string
  payload: DocumentExportPayload
  diagnostics: DocumentExportDiagnostic[]
}

export interface DocumentExportFailureResult {
  ok: false
  format: string
  diagnostics: DocumentExportDiagnostic[]
}

export type DocumentExportResult = DocumentExportSuccessResult | DocumentExportFailureResult
