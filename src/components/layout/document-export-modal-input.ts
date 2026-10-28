import type { ModelingExportDocumentInput } from "@/application/modeling/modeling-service";
import type { ObjectExportModalState } from "@/core/export/object-export-state";

export function buildDocumentExportModalInput(
  target: ObjectExportModalState,
  format: string,
  options: unknown,
): ModelingExportDocumentInput {
  return {
    baseRevisionId: target.baseRevisionId,
    target: target.target,
    targetLabel: target.label,
    format,
    options,
  };
}
