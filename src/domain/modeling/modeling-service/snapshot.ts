import type { DocumentId } from "@/core/editor/schema";
import type {
  CommitSketchResponse,
  CreateFeatureResponse,
  DeleteDocumentTargetResponse,
  DeleteFeatureResponse,
  WorkspaceSnapshot,
  EvaluatePreviewResponse,
  GetDocumentSnapshotResponse,
  GetDocumentSnapshotRequest,
  AddDocumentVariableResponse,
  RenameBodyResponse,
  ResolvedReferenceRecord,
  ResolveReferenceResponse,
  ReorderDocumentHistoryResponse,
  ReorderFeatureResponse,
  SetFeatureCursorResponse,
  SetFeatureSuppressionResponse,
  UpdateDocumentVariableResponse,
  UpdateFeatureResponse,
} from "@/contracts/modeling/schema";
import type { DocumentExportResult } from "@/contracts/modeling/export";
import { requireDocumentExportResult } from "@/contracts/modeling/export.runtime-schema";
import {
  requireCommitSketchResponse,
  requireDeleteDocumentTargetResponse,
  requireDeleteFeatureResponse,
  requireEvaluatePreviewResponse,
  requireGetDocumentSnapshotResponse,
  requireRenameBodyResponse,
  requireReorderDocumentHistoryResponse,
  requireReorderFeatureResponse,
  requireResolveReferenceResponse,
  requireSetFeatureCursorResponse,
  requireSetFeatureSuppressionResponse,
  validateAddDocumentVariableResponse,
  validateCreateFeatureResponse,
  validateUpdateDocumentVariableResponse,
  validateUpdateFeatureResponse,
} from "@/contracts/modeling/runtime-schema";
import type { ContractValidationIssue } from "@/contracts/shared/validation";
import type {
  ModelingFeatureMutationResult,
  ModelingFeatureSuppressionResult,
  ModelingDeleteFeatureResult,
  ModelingDeleteTargetResult,
  ModelingRenameBodyResult,
  ModelingReorderFeatureResult,
  ModelingReorderDocumentHistoryResult,
  ModelingSetFeatureCursorResult,
  ModelingCommitSketchResult,
  ModelingDocumentVariableMutationResult,
  ModelingPreviewResult,
  ModelingResolvedReferenceResult,
  ModelingExportDocumentResult,
} from "./types";
import { CONTRACT_VERSION, SNAPSHOT_SCHEMA_VERSION } from "./helpers";
import { normalizeWorkspaceSnapshot } from "./normalization";

export function buildDocumentRequest(
  documentId: WorkspaceSnapshot["document"]["documentId"],
): GetDocumentSnapshotRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function assertKernelContractVersion(
  contractVersion: GetDocumentSnapshotResponse["snapshot"]["document"]["contractVersion"],
) {
  if (contractVersion !== CONTRACT_VERSION) {
    throw new Error(
      "Kernel contract version does not match the active modeling service.",
    );
  }
}

export function assertSnapshotSchemaVersion(
  schemaVersion: WorkspaceSnapshot["document"]["schemaVersion"],
) {
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      "Snapshot schema version does not match the active modeling service.",
    );
  }
}

export function assertKernelDocumentIdMatches(
  responseDocumentId: DocumentId,
  expectedDocumentId: DocumentId,
  operationLabel: string,
) {
  if (responseDocumentId !== expectedDocumentId) {
    throw new Error(
      `${operationLabel} response document ID does not match the active document.`,
    );
  }
}

export function validateSnapshotResponse(
  response: GetDocumentSnapshotResponse,
  expectedDocumentId: DocumentId,
): WorkspaceSnapshot {
  const parsed = requireGetDocumentSnapshotResponse(response);
  assertKernelContractVersion(parsed.snapshot.document.contractVersion);
  assertSnapshotSchemaVersion(parsed.snapshot.document.schemaVersion);
  assertKernelDocumentIdMatches(
    parsed.snapshot.document.documentId,
    expectedDocumentId,
    "Snapshot",
  );
  return normalizeWorkspaceSnapshot(parsed.snapshot);
}

export function formatValidationIssues(
  issues: readonly ContractValidationIssue[],
) {
  if (issues.length === 0) {
    return "no issue details reported";
  }

  return issues
    .slice(0, 3)
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseResponseWithFallback<TPrimary, TFallback>(input: {
  operation: string;
  response: unknown;
  primarySchemaName: string;
  validatePrimary: (value: unknown) =>
    | { success: true; data: TPrimary }
    | { success: false; issues: readonly ContractValidationIssue[] };
  fallbackSchemaName: string;
  validateFallback: (value: unknown) =>
    | { success: true; data: TFallback }
    | { success: false; issues: readonly ContractValidationIssue[] };
}): TPrimary | TFallback {
  const primary = input.validatePrimary(input.response);
  if (primary.success) {
    return primary.data;
  }

  const fallback = input.validateFallback(input.response);
  if (fallback.success) {
    return fallback.data;
  }

  throw new Error(
    `${input.operation} response failed runtime validation for both ${input.primarySchemaName} and ${input.fallbackSchemaName}. ` +
      `${input.primarySchemaName}: ${formatValidationIssues(primary.issues)}. ` +
      `${input.fallbackSchemaName}: ${formatValidationIssues(fallback.issues)}.`,
  );
}

export function mapFeatureMutationResponse(
  response: CreateFeatureResponse | UpdateFeatureResponse,
  expectedDocumentId: DocumentId,
): ModelingFeatureMutationResult {
  const normalized = parseResponseWithFallback({
    operation: "Feature mutation",
    response,
    primarySchemaName: "CreateFeatureResponse",
    validatePrimary: validateCreateFeatureResponse,
    fallbackSchemaName: "UpdateFeatureResponse",
    validateFallback: validateUpdateFeatureResponse,
  });
  assertKernelContractVersion(normalized.contractVersion);
  assertKernelDocumentIdMatches(
    normalized.documentId,
    expectedDocumentId,
    "Feature mutation",
  );
  return {
    revisionId: normalized.revisionId,
    featureId: normalized.featureId,
    revisionState: normalized.revisionState,
    rebuildResult: normalized.rebuildResult,
    changedTargets: normalized.changedTargets,
    diagnostics: normalized.diagnostics,
  };
}

export function mapFeatureSuppressionResponse(
  response: SetFeatureSuppressionResponse,
  expectedDocumentId: DocumentId,
): ModelingFeatureSuppressionResult {
  const parsed = requireSetFeatureSuppressionResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Feature suppression",
  );
  return {
    revisionId: parsed.revisionId,
    featureId: parsed.featureId,
    suppressed: parsed.suppressed,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapDeleteFeatureResponse(
  response: DeleteFeatureResponse,
  expectedDocumentId: DocumentId,
): ModelingDeleteFeatureResult {
  const parsed = requireDeleteFeatureResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Delete feature",
  );
  return {
    revisionId: parsed.revisionId,
    deletedFeatureId: parsed.deletedFeatureId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapDeleteTargetResponse(
  response: DeleteDocumentTargetResponse,
  expectedDocumentId: DocumentId,
): ModelingDeleteTargetResult {
  const parsed = requireDeleteDocumentTargetResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Delete target",
  );
  return {
    revisionId: parsed.revisionId,
    deletedTarget: parsed.deletedTarget,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapRenameBodyResponse(
  response: RenameBodyResponse,
  expectedDocumentId: DocumentId,
): ModelingRenameBodyResult {
  const parsed = requireRenameBodyResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Rename body",
  );
  return {
    revisionId: parsed.revisionId,
    bodyId: parsed.bodyId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapDocumentVariableResponse(
  response: AddDocumentVariableResponse | UpdateDocumentVariableResponse,
  expectedDocumentId: DocumentId,
): ModelingDocumentVariableMutationResult {
  const normalized = parseResponseWithFallback({
    operation: "Document variable mutation",
    response,
    primarySchemaName: "AddDocumentVariableResponse",
    validatePrimary: validateAddDocumentVariableResponse,
    fallbackSchemaName: "UpdateDocumentVariableResponse",
    validateFallback: validateUpdateDocumentVariableResponse,
  });
  assertKernelContractVersion(normalized.contractVersion);
  assertKernelDocumentIdMatches(
    normalized.documentId,
    expectedDocumentId,
    "Document variable mutation",
  );
  return {
    revisionId: normalized.revisionId,
    variableId: normalized.variableId,
    revisionState: normalized.revisionState,
    rebuildResult: normalized.rebuildResult,
    changedTargets: normalized.changedTargets,
    diagnostics: normalized.diagnostics,
  };
}

export function mapCommitSketchResponse(
  response: CommitSketchResponse,
  expectedDocumentId: DocumentId,
): ModelingCommitSketchResult {
  const parsed = requireCommitSketchResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Commit sketch",
  );
  return {
    revisionId: parsed.revisionId,
    sketchId: parsed.sketchId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapPreviewResponse(
  response: EvaluatePreviewResponse,
  expectedDocumentId: DocumentId,
): ModelingPreviewResult {
  const parsed = requireEvaluatePreviewResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Preview",
  );
  return {
    revisionId: parsed.revisionId,
    previewId: parsed.previewId,
    renderables: parsed.render.records,
    freshness: parsed.freshness,
    stale: parsed.freshness.kind === "stale",
    diagnostics: parsed.diagnostics,
  };
}

export function mapExportDocumentResponse(
  response: DocumentExportResult,
): ModelingExportDocumentResult {
  return requireDocumentExportResult(response);
}

export function mapReorderFeatureResponse(
  response: ReorderFeatureResponse,
  expectedDocumentId: DocumentId,
): ModelingReorderFeatureResult {
  const parsed = requireReorderFeatureResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Reorder feature",
  );
  return {
    revisionId: parsed.revisionId,
    featureId: parsed.featureId,
    beforeFeatureId: parsed.beforeFeatureId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapReorderDocumentHistoryResponse(
  response: ReorderDocumentHistoryResponse,
  expectedDocumentId: DocumentId,
): ModelingReorderDocumentHistoryResult {
  const parsed = requireReorderDocumentHistoryResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Reorder document history",
  );
  return {
    revisionId: parsed.revisionId,
    item: parsed.item,
    beforeItem: parsed.beforeItem,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapSetFeatureCursorResponse(
  response: SetFeatureCursorResponse,
  expectedDocumentId: DocumentId,
): ModelingSetFeatureCursorResult {
  const parsed = requireSetFeatureCursorResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.documentId,
    expectedDocumentId,
    "Set feature cursor",
  );
  return {
    revisionId: parsed.revisionId,
    cursor: parsed.cursor,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  };
}

export function mapResolvedReferenceResponse(
  response: ResolveReferenceResponse,
  expectedDocumentId: DocumentId,
): ModelingResolvedReferenceResult {
  const parsed = requireResolveReferenceResponse(response);
  assertKernelContractVersion(parsed.contractVersion);
  assertKernelDocumentIdMatches(
    parsed.resolution.ownerDocumentId,
    expectedDocumentId,
    "Resolve reference",
  );
  return {
    resolution: parsed.resolution,
    diagnostics: parsed.diagnostics,
  };
}

export function normalizeResolution(value: unknown): ResolvedReferenceRecord {
  return requireResolveReferenceResponse({
    contractVersion: CONTRACT_VERSION,
    resolution: value,
    diagnostics: [],
  }).resolution;
}
