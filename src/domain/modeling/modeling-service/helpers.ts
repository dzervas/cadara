import type {
  DocumentExportDiagnostic,
  DocumentExportRequest,
} from "@/contracts/modeling/export";
import type {
  DocumentId,
  PrimitiveRef,
  RevisionId,
  SketchId,
} from "@/core/editor/schema";
import { getPrimitiveRefLabel as formatPrimitiveRefLabel } from "@/core/editor/schema";
import type {
  CommitSketchRequest,
  AddDocumentVariableRequest,
  CreateFeatureRequest,
  DeleteDocumentTargetRequest,
  DeleteFeatureRequest,
  WorkspaceSnapshot,
  EvaluatePreviewRequest,
  KernelDocumentSnapshot,
  ModelingDiagnostic,
  ModelingOperationResult,
  MutationRevisionState,
  RenameBodyRequest,
  ResolvedReferenceRecord,
  ResolveReferenceRequest,
  ReorderDocumentHistoryRequest,
  ReorderFeatureRequest,
  SetFeatureCursorRequest,
  SetFeatureSuppressionRequest,
  UpdateFeatureRequest,
  UpdateDocumentVariableRequest,
} from "@/contracts/modeling/schema";
import { documentExportRequestSchema } from "@/contracts/modeling/export.runtime-schema";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import type { DurableRef } from "@/contracts/shared/references";
import type { RequestId } from "@/contracts/shared/ids";
import {
  appErrorFromModelingResult,
  normalizeUnknownError,
  ok,
  err,
  ResultAsync,
  type AppErrorContextEntry,
  type AppResult,
  type AppResultAsync,
} from "@/contracts/errors";
import type {
  ModelingCreateFeatureInput,
  ModelingUpdateFeatureInput,
  ModelingDeleteFeatureInput,
  ModelingDeleteTargetInput,
  ModelingRenameBodyInput,
  ModelingAddDocumentVariableInput,
  ModelingUpdateDocumentVariableInput,
  ModelingReorderFeatureInput,
  ModelingReorderDocumentHistoryInput,
  ModelingSetFeatureCursorInput,
  ModelingSetFeatureSuppressionInput,
  ModelingEvaluatePreviewInput,
  ModelingExportDocumentInput,
  ModelingCommitSketchInput,
  ModelingHistoryRestoreState,
} from "./types";
import type { DocumentRepositoryRestoreStatus } from "@/domain/modeling/document-repository";
import {
  isRecord,
  assertDocumentId,
  assertDocumentVariableId,
  assertRevisionId,
  assertDurableRef,
} from "./validation";
import { normalizeFeatureDefinition } from "./normalization";

export const CONTRACT_VERSION = "modeling-contract/v1alpha1" as const;
export const SNAPSHOT_SCHEMA_VERSION = "document-snapshot/v1alpha1" as const;

export function withContractVersion<
  TRequest extends { contractVersion: typeof CONTRACT_VERSION },
>(input: Omit<TRequest, "contractVersion">): TRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    ...input,
  } as TRequest;
}

export function sameStringSet(
  left: readonly string[],
  right: readonly string[],
) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export function collectSketchDependencyIds(
  value: unknown,
  dependencyIds: Set<SketchId>,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSketchDependencyIds(item, dependencyIds);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.sketchId === "string") {
    dependencyIds.add(value.sketchId as SketchId);
  }

  for (const child of Object.values(value)) {
    collectSketchDependencyIds(child, dependencyIds);
  }
}

export function collectMissingFeatureSketchDependencyIds(
  document: AuthoredModelDocument,
) {
  const documentSketchIds = new Set(
    document.sketches.map((sketch) => sketch.sketchId),
  );
  const dependencyIds = new Set<SketchId>();

  for (const feature of document.features) {
    collectSketchDependencyIds(feature.definition, dependencyIds);
  }

  return new Set(
    [...dependencyIds].filter((sketchId) => !documentSketchIds.has(sketchId)),
  );
}

export function assertMutationBase(input: {
  baseRevisionId: RevisionId;
  baseRepositoryHeads?: readonly string[];
}) {
  assertRevisionId(input.baseRevisionId);
  if (
    input.baseRepositoryHeads !== undefined &&
    !Array.isArray(input.baseRepositoryHeads)
  ) {
    throw new Error("Invalid repository heads mutation basis.");
  }
}

export function stripRepositoryMutationBasis<
  T extends { baseRepositoryHeads?: readonly string[] },
>(input: T): Omit<T, "baseRepositoryHeads"> {
  const requestInput = { ...input };
  delete requestInput.baseRepositoryHeads;
  return requestInput;
}

export function normalizeCreateFeatureInput(
  input: ModelingCreateFeatureInput,
  documentId: DocumentId,
): CreateFeatureRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    definition: normalizeFeatureDefinition(input.definition),
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeCommitSketchInput(
  input: ModelingCommitSketchInput,
  documentId: DocumentId,
): CommitSketchRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeUpdateFeatureInput(
  input: ModelingUpdateFeatureInput,
  documentId: DocumentId,
): UpdateFeatureRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    definition: normalizeFeatureDefinition(input.definition),
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeSetFeatureSuppressionInput(
  input: ModelingSetFeatureSuppressionInput,
  documentId: DocumentId,
): SetFeatureSuppressionRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeDeleteFeatureInput(
  input: ModelingDeleteFeatureInput,
  documentId: DocumentId,
): DeleteFeatureRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeDeleteTargetInput(
  input: ModelingDeleteTargetInput,
  documentId: DocumentId,
): DeleteDocumentTargetRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    target: assertDurableRef(input.target),
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeRenameBodyInput(
  input: ModelingRenameBodyInput,
  documentId: DocumentId,
): RenameBodyRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeAddDocumentVariableInput(
  input: ModelingAddDocumentVariableInput,
  documentId: DocumentId,
): AddDocumentVariableRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    variableId:
      input.variableId === undefined
        ? undefined
        : assertDocumentVariableId(input.variableId),
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeUpdateDocumentVariableInput(
  input: ModelingUpdateDocumentVariableInput,
  documentId: DocumentId,
): UpdateDocumentVariableRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    variableId: assertDocumentVariableId(input.variableId),
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeReorderFeatureInput(
  input: ModelingReorderFeatureInput,
  documentId: DocumentId,
): ReorderFeatureRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeReorderDocumentHistoryInput(
  input: ModelingReorderDocumentHistoryInput,
  documentId: DocumentId,
): ReorderDocumentHistoryRequest {
  assertMutationBase(input);
  const requestInput = stripRepositoryMutationBasis(input);

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeSetFeatureCursorInput(
  input: ModelingSetFeatureCursorInput,
  documentId: DocumentId,
): SetFeatureCursorRequest {
  assertMutationBase(input);

  return {
    contractVersion: CONTRACT_VERSION,
    documentId,
    baseRevisionId: input.baseRevisionId,
    cursor: input.cursor,
  };
}

export function normalizePreviewInput(
  input: ModelingEvaluatePreviewInput,
  documentId: DocumentId,
): EvaluatePreviewRequest {
  assertMutationBase(input);

  return {
    ...input,
    definition: normalizeFeatureDefinition(input.definition),
    contractVersion: CONTRACT_VERSION,
    documentId,
  };
}

export function normalizeResolveReferenceInput(
  target: PrimitiveRef,
  documentId: DocumentId,
): ResolveReferenceRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId,
    target: assertDurableRef(target),
  };
}

export function normalizeExportDocumentInput(
  input: ModelingExportDocumentInput,
  documentId: DocumentId,
): DocumentExportRequest {
  assertMutationBase(input);

  return documentExportRequestSchema.parse({
    ...input,
    target: assertDurableRef(input.target),
    contractVersion: CONTRACT_VERSION,
    documentId,
  });
}

export function createExportDiagnostic(
  code: string,
  message: string,
  target: DurableRef | null,
): DocumentExportDiagnostic {
  return {
    code,
    severity: "error",
    message,
    target,
  };
}

export function createExportFilename(targetLabel: string, extension: string) {
  const slug =
    targetLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document";

  return `${slug}.${extension}`;
}

export function stringifyCadaraDocument(
  document: KernelDocumentSnapshot,
  pretty: boolean,
) {
  return JSON.stringify(stableJsonValue(document), null, pretty ? 2 : 0);
}

export function normalizeCurrentDocumentId(
  value: WorkspaceSnapshot["document"]["documentId"],
): DocumentId {
  return assertDocumentId(value);
}

export function getResolutionLabel(resolution: ResolvedReferenceRecord) {
  return resolution.label || formatPrimitiveRefLabel(resolution.target);
}

export function createRestoreFailure(
  reasonCode: string,
  message: string,
  entryIndex: number | null,
  entriesReplayed: number,
): ModelingHistoryRestoreState {
  return {
    kind: "failed",
    entriesReplayed,
    diagnostics: [
      {
        reasonCode,
        message,
        entryIndex,
      },
    ],
  };
}

export function createRepositoryRestoreFailure(
  status: Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>,
  entriesReplayed = 0,
): ModelingHistoryRestoreState {
  return createRestoreFailure(
    status.diagnostic.reasonCode,
    status.diagnostic.message,
    null,
    entriesReplayed,
  );
}

export function createDocumentRepositoryDiagnostic(
  status: Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>,
): ModelingDiagnostic {
  return {
    code: status.diagnostic.reasonCode,
    severity: "error",
    message: status.diagnostic.message,
    target: null,
    detail: null,
  };
}

export function isAcceptedMutation(response: ModelingOperationResult) {
  return response.revisionState.kind === "accepted";
}

export type ModelingMutationBoundaryResult = {
  revisionState: MutationRevisionState;
  diagnostics: ModelingDiagnostic[];
};

export function modelingMutationResultToAppResult<
  T extends ModelingMutationBoundaryResult,
>(
  result: T,
  input: {
    operation: string;
    fallbackMessage: string;
    requestId?: RequestId;
    context?: readonly AppErrorContextEntry[];
  },
): AppResult<T> {
  if (result.revisionState.kind === "accepted") {
    return ok(result);
  }

  return err(
    appErrorFromModelingResult({
      operation: input.operation,
      fallbackMessage: input.fallbackMessage,
      diagnostics: result.diagnostics,
      revisionState: result.revisionState,
      requestId: input.requestId,
      context: input.context,
    }),
  );
}

export function runModelingMutationBoundary<
  T extends ModelingMutationBoundaryResult,
>(input: {
  operation: string;
  fallbackMessage: string;
  requestId?: RequestId;
  context?: readonly AppErrorContextEntry[];
  action: () => Promise<T>;
}): AppResultAsync<T> {
  return ResultAsync.fromPromise(input.action(), (error) =>
    normalizeUnknownError(error, {
      code: "app/operation-failed",
      fallbackMessage: input.fallbackMessage,
      requestId: input.requestId,
      context: [
        { key: "operation", value: input.operation },
        ...(input.context ?? []),
      ],
    }),
  ).andThen((result) => modelingMutationResultToAppResult(result, input));
}
