import typia from "typia";

import type {
  CadaraExportOptions,
  DocumentExportRequest,
  DocumentExportResult,
} from "@/contracts/modeling/export";
import { requireContract } from "@/contracts/shared/validation";

const cadaraExportOptionsValidator =
  typia.createValidateEquals<CadaraExportOptions>();
const documentExportRequestValidator =
  typia.createValidateEquals<DocumentExportRequest>();
const documentExportResultValidator =
  typia.createValidateEquals<DocumentExportResult>();

export function getDefaultCadaraExportOptions(): CadaraExportOptions {
  return { pretty: true };
}

export function requireCadaraExportOptions(
  value: unknown,
): CadaraExportOptions {
  return requireContract(
    cadaraExportOptionsValidator,
    value,
    "Cadara export options",
  );
}

export function requireDocumentExportRequest(
  value: unknown,
): DocumentExportRequest {
  return requireContract(
    documentExportRequestValidator,
    value,
    "Document export request",
  );
}

export function requireDocumentExportResult(
  value: unknown,
): DocumentExportResult {
  return requireContract(
    documentExportResultValidator,
    value,
    "Document export result",
  );
}
