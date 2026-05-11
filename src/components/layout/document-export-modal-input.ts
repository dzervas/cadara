import type { ModelingExportDocumentInput } from "@/domain/modeling/modeling-service";
import type { ObjectExportModalState } from "@/domain/export/object-export-state";

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
