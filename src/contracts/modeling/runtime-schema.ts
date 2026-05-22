import typia from "typia";

import type {
  AddDocumentVariableResponse,
  BaseDocumentRequest,
  CommitSketchResponse,
  CreateFeatureResponse,
  DeleteDocumentTargetRequest,
  DeleteDocumentTargetResponse,
  DeleteFeatureResponse,
  DocumentVariableRecord,
  EvaluatePreviewResponse,
  FeatureDefinition,
  GetDocumentSnapshotResponse,
  KernelDocumentSnapshot,
  ModelingDiagnostic,
  MutationRevisionState,
  RebuildResult,
  RenameBodyResponse,
  ResolvedReferenceRecord,
  ResolveReferenceResponse,
  ReorderDocumentHistoryResponse,
  ReorderFeatureResponse,
  SetFeatureCursorResponse,
  SetFeatureSuppressionResponse,
  UpdateDocumentVariableResponse,
  UpdateFeatureResponse,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import {
  ContractValidationError,
  requireContract,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
import { validateFeatureDefinitionAuthoredValueInvariants } from "@/contracts/modeling/feature-authored-values";

const featureDefinitionValidator =
  typia.createValidateEquals<FeatureDefinition>();
const modelingDiagnosticValidator =
  typia.createValidateEquals<ModelingDiagnostic>();
const documentVariableRecordValidator =
  typia.createValidateEquals<DocumentVariableRecord>();
const mutationRevisionStateValidator =
  typia.createValidateEquals<MutationRevisionState>();
const rebuildResultValidator = typia.createValidateEquals<RebuildResult>();
const kernelDocumentSnapshotValidator =
  typia.createValidateEquals<KernelDocumentSnapshot>();
const workspaceSnapshotValidator =
  typia.createValidateEquals<WorkspaceSnapshot>();
const getDocumentSnapshotResponseValidator =
  typia.createValidateEquals<GetDocumentSnapshotResponse>();
const createFeatureResponseValidator =
  typia.createValidateEquals<CreateFeatureResponse>();
const updateFeatureResponseValidator =
  typia.createValidateEquals<UpdateFeatureResponse>();
const setFeatureSuppressionResponseValidator =
  typia.createValidateEquals<SetFeatureSuppressionResponse>();
const deleteFeatureResponseValidator =
  typia.createValidateEquals<DeleteFeatureResponse>();
const deleteDocumentTargetResponseValidator =
  typia.createValidateEquals<DeleteDocumentTargetResponse>();
const renameBodyResponseValidator =
  typia.createValidateEquals<RenameBodyResponse>();
const addDocumentVariableResponseValidator =
  typia.createValidateEquals<AddDocumentVariableResponse>();
const updateDocumentVariableResponseValidator =
  typia.createValidateEquals<UpdateDocumentVariableResponse>();
const reorderFeatureResponseValidator =
  typia.createValidateEquals<ReorderFeatureResponse>();
const reorderDocumentHistoryResponseValidator =
  typia.createValidateEquals<ReorderDocumentHistoryResponse>();
const setFeatureCursorResponseValidator =
  typia.createValidateEquals<SetFeatureCursorResponse>();
const commitSketchResponseValidator =
  typia.createValidateEquals<CommitSketchResponse>();
const evaluatePreviewResponseValidator =
  typia.createValidateEquals<EvaluatePreviewResponse>();
const resolvedReferenceRecordValidator =
  typia.createValidateEquals<ResolvedReferenceRecord>();
const resolveReferenceResponseValidator =
  typia.createValidateEquals<ResolveReferenceResponse>();
const deleteDocumentTargetRequestValidator =
  typia.createValidateEquals<DeleteDocumentTargetRequest>();

export function validateFeatureDefinition(
  value: unknown,
): ContractValidationResult<FeatureDefinition> {
  const structuralResult = validateContract(featureDefinitionValidator, value);
  if (!structuralResult.success) {
    return structuralResult;
  }

  const invariantIssues = validateFeatureDefinitionAuthoredValueInvariants(
    structuralResult.data,
  );
  return invariantIssues.length === 0
    ? structuralResult
    : {
        success: false,
        data: structuralResult.data,
        issues: invariantIssues,
      };
}

export function requireFeatureDefinition(value: unknown): FeatureDefinition {
  const result = validateFeatureDefinition(value);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? "Feature definition validation failed.",
    value,
    result.issues,
  );
}

export function validateModelingDiagnostic(
  value: unknown,
): ContractValidationResult<ModelingDiagnostic> {
  return validateContract(modelingDiagnosticValidator, value);
}

export function requireModelingDiagnostic(value: unknown): ModelingDiagnostic {
  return requireContract(
    modelingDiagnosticValidator,
    value,
    "Modeling diagnostic",
  );
}

export function validateDocumentVariableRecord(
  value: unknown,
): ContractValidationResult<DocumentVariableRecord> {
  return validateContract(documentVariableRecordValidator, value);
}

export function requireDocumentVariableRecord(
  value: unknown,
): DocumentVariableRecord {
  return requireContract(
    documentVariableRecordValidator,
    value,
    "Document variable record",
  );
}

export function validateMutationRevisionState(
  value: unknown,
): ContractValidationResult<MutationRevisionState> {
  return validateContract(mutationRevisionStateValidator, value);
}

export function validateRebuildResult(
  value: unknown,
): ContractValidationResult<RebuildResult> {
  return validateContract(rebuildResultValidator, value);
}

export function validateKernelDocumentSnapshot(
  value: unknown,
): ContractValidationResult<KernelDocumentSnapshot> {
  const structuralResult = validateContract(kernelDocumentSnapshotValidator, value);
  if (!structuralResult.success) {
    return structuralResult;
  }

  const invariantIssues = validateKernelDocumentSnapshotInvariants(
    structuralResult.data,
  );
  return invariantIssues.length === 0
    ? structuralResult
    : {
        success: false,
        data: structuralResult.data,
        issues: invariantIssues,
      };
}

export function requireKernelDocumentSnapshot(
  value: unknown,
): KernelDocumentSnapshot {
  return requireValidationResult(
    validateKernelDocumentSnapshot(value),
    value,
    "Kernel document snapshot",
  );
}

export function validateWorkspaceSnapshot(
  value: unknown,
): ContractValidationResult<WorkspaceSnapshot> {
  const structuralResult = validateContract(workspaceSnapshotValidator, value);
  if (!structuralResult.success) {
    return structuralResult;
  }

  const invariantIssues = prefixIssues(
    "document",
    validateKernelDocumentSnapshotInvariants(structuralResult.data.document),
  );
  return invariantIssues.length === 0
    ? structuralResult
    : {
        success: false,
        data: structuralResult.data,
        issues: invariantIssues,
      };
}

export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  return requireValidationResult(
    validateWorkspaceSnapshot(value),
    value,
    "Workspace snapshot",
  );
}

export function validateGetDocumentSnapshotResponse(
  value: unknown,
): ContractValidationResult<GetDocumentSnapshotResponse> {
  const structuralResult = validateContract(
    getDocumentSnapshotResponseValidator,
    value,
  );
  if (!structuralResult.success) {
    return structuralResult;
  }

  const invariantIssues = prefixIssues(
    "snapshot.document",
    validateKernelDocumentSnapshotInvariants(
      structuralResult.data.snapshot.document,
    ),
  );
  return invariantIssues.length === 0
    ? structuralResult
    : {
        success: false,
        data: structuralResult.data,
        issues: invariantIssues,
      };
}

export function requireGetDocumentSnapshotResponse(
  value: unknown,
): GetDocumentSnapshotResponse {
  return requireValidationResult(
    validateGetDocumentSnapshotResponse(value),
    value,
    "Get document snapshot response",
  );
}

export function validateCreateFeatureResponse(
  value: unknown,
): ContractValidationResult<CreateFeatureResponse> {
  return validateContract(createFeatureResponseValidator, value);
}

export function requireCreateFeatureResponse(
  value: unknown,
): CreateFeatureResponse {
  return requireContract(
    createFeatureResponseValidator,
    value,
    "Create feature response",
  );
}

export function validateUpdateFeatureResponse(
  value: unknown,
): ContractValidationResult<UpdateFeatureResponse> {
  return validateContract(updateFeatureResponseValidator, value);
}

export function requireUpdateFeatureResponse(
  value: unknown,
): UpdateFeatureResponse {
  return requireContract(
    updateFeatureResponseValidator,
    value,
    "Update feature response",
  );
}

export function requireSetFeatureSuppressionResponse(
  value: unknown,
): SetFeatureSuppressionResponse {
  return requireContract(
    setFeatureSuppressionResponseValidator,
    value,
    "Set feature suppression response",
  );
}

export function requireDeleteFeatureResponse(
  value: unknown,
): DeleteFeatureResponse {
  return requireContract(
    deleteFeatureResponseValidator,
    value,
    "Delete feature response",
  );
}

export function requireDeleteDocumentTargetResponse(
  value: unknown,
): DeleteDocumentTargetResponse {
  return requireContract(
    deleteDocumentTargetResponseValidator,
    value,
    "Delete document target response",
  );
}

export function requireRenameBodyResponse(value: unknown): RenameBodyResponse {
  return requireContract(
    renameBodyResponseValidator,
    value,
    "Rename body response",
  );
}

export function validateAddDocumentVariableResponse(
  value: unknown,
): ContractValidationResult<AddDocumentVariableResponse> {
  return validateContract(addDocumentVariableResponseValidator, value);
}

export function requireAddDocumentVariableResponse(
  value: unknown,
): AddDocumentVariableResponse {
  return requireContract(
    addDocumentVariableResponseValidator,
    value,
    "Add document variable response",
  );
}

export function validateUpdateDocumentVariableResponse(
  value: unknown,
): ContractValidationResult<UpdateDocumentVariableResponse> {
  return validateContract(updateDocumentVariableResponseValidator, value);
}

export function requireUpdateDocumentVariableResponse(
  value: unknown,
): UpdateDocumentVariableResponse {
  return requireContract(
    updateDocumentVariableResponseValidator,
    value,
    "Update document variable response",
  );
}

export function requireReorderFeatureResponse(
  value: unknown,
): ReorderFeatureResponse {
  return requireContract(
    reorderFeatureResponseValidator,
    value,
    "Reorder feature response",
  );
}

export function requireReorderDocumentHistoryResponse(
  value: unknown,
): ReorderDocumentHistoryResponse {
  return requireContract(
    reorderDocumentHistoryResponseValidator,
    value,
    "Reorder document history response",
  );
}

export function requireSetFeatureCursorResponse(
  value: unknown,
): SetFeatureCursorResponse {
  return requireContract(
    setFeatureCursorResponseValidator,
    value,
    "Set feature cursor response",
  );
}

export function requireCommitSketchResponse(
  value: unknown,
): CommitSketchResponse {
  return requireContract(
    commitSketchResponseValidator,
    value,
    "Commit sketch response",
  );
}

export function requireEvaluatePreviewResponse(
  value: unknown,
): EvaluatePreviewResponse {
  return requireContract(
    evaluatePreviewResponseValidator,
    value,
    "Evaluate preview response",
  );
}

export function requireResolvedReferenceRecord(
  value: unknown,
): ResolvedReferenceRecord {
  return requireContract(
    resolvedReferenceRecordValidator,
    value,
    "Resolved reference record",
  );
}

export function requireResolveReferenceResponse(
  value: unknown,
): ResolveReferenceResponse {
  return requireContract(
    resolveReferenceResponseValidator,
    value,
    "Resolve reference response",
  );
}

export function validateDeleteDocumentTargetRequest(
  value: unknown,
): ContractValidationResult<DeleteDocumentTargetRequest> {
  return validateContract(deleteDocumentTargetRequestValidator, value);
}

export function validateModelingDocumentRequestEnvelope(
  value: unknown,
): ContractValidationResult<BaseDocumentRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      success: false,
      data: value,
      issues: [
        {
          path: "",
          expected: "BaseDocumentRequest",
          value,
          message: "Modeling document request envelope must be an object.",
        },
      ],
    };
  }

  const candidate = value as Partial<BaseDocumentRequest>;
  if (candidate.contractVersion !== "modeling-contract/v1alpha1") {
    return {
      success: false,
      data: value,
      issues: [
        {
          path: "contractVersion",
          expected: "modeling-contract/v1alpha1",
          value: candidate.contractVersion,
          message:
            "Unsupported contract version; expected contractVersion modeling-contract/v1alpha1.",
        },
      ],
    };
  }

  if (
    typeof candidate.documentId !== "string" ||
    !candidate.documentId.startsWith("doc_")
  ) {
    return {
      success: false,
      data: value,
      issues: [
        {
          path: "documentId",
          expected: "DocumentId",
          value: candidate.documentId,
          message: 'Document ids must be prefixed with "doc_".',
        },
      ],
    };
  }

  return {
    success: true,
    data: {
      contractVersion: candidate.contractVersion,
      documentId: candidate.documentId,
    },
  };
}

export function requireDeleteDocumentTargetRequest(
  value: unknown,
): DeleteDocumentTargetRequest {
  return requireContract(
    deleteDocumentTargetRequestValidator,
    value,
    "Delete document target request",
  );
}

function validateKernelDocumentSnapshotInvariants(
  snapshot: KernelDocumentSnapshot,
): ContractValidationIssue[] {
  return snapshot.features.flatMap((feature, index) =>
    prefixIssues(
      `features.${index}.definition`,
      validateFeatureDefinitionAuthoredValueInvariants(feature.definition),
    ),
  );
}

function prefixIssues(
  prefix: string,
  issues: readonly ContractValidationIssue[],
): ContractValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path ? `${prefix}.${issue.path}` : prefix,
  }));
}

function requireValidationResult<T>(
  result: ContractValidationResult<T>,
  value: unknown,
  label: string,
): T {
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? `${label} validation failed.`,
    value,
    result.issues,
  );
}
