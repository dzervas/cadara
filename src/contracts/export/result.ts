export type { DocumentExportDiagnostic as ExportDiagnostic, DocumentExportDiagnosticSeverity as ExportDiagnosticSeverity } from '@/contracts/modeling/export'

import type { DocumentExportDiagnostic } from '@/contracts/modeling/export'

export interface ExportSuccessResult {
  ok: true
  payload: string | Uint8Array
  diagnostics: DocumentExportDiagnostic[]
}

export interface ExportFailureResult {
  ok: false
  diagnostics: DocumentExportDiagnostic[]
}

export type ExportResult = ExportSuccessResult | ExportFailureResult
