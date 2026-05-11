export type ImportDiagnosticSeverity = "info" | "warning" | "error";

/**
 * Returned from review and prepare; orchestrator surfaces these to the user.
 */
export interface ImportDiagnostic {
  severity: ImportDiagnosticSeverity;
  message: string;
  code?: string;
}
