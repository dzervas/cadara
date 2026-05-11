import type {
  DocumentExportRequest,
  DocumentExportResult,
  DocumentExportSuccessResult,
} from "@/contracts/modeling/export";
import type {
  BodyId,
  DocumentId,
  DocumentVariableId,
  FeatureId,
  PrimitiveRef,
  RevisionId,
  SketchId,
} from "@/core/editor/schema";
import type {
  CommitSketchRequest,
  AddDocumentVariableRequest,
  CreateFeatureRequest,
  DeleteDocumentTargetRequest,
  DeleteFeatureRequest,
  DocumentFeatureCursor,
  WorkspaceSnapshot,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  ModelingDiagnostic,
  MutationRevisionState,
  PreviewFreshness,
  RebuildResult,
  RenameBodyRequest,
  ReorderDocumentHistoryRequest,
  ReorderDocumentHistoryResponse,
  ReorderFeatureRequest,
  ResolvedReferenceRecord,
  SetFeatureCursorRequest,
  SetFeatureSuppressionRequest,
  SnapshotMutationBasis,
  UpdateFeatureRequest,
  UpdateDocumentVariableRequest,
} from "@/contracts/modeling/schema";
import type { GeometryAssetBlobInput } from "@/contracts/modeling/geometry-assets";
import type { RenderExport } from "@/contracts/render/schema";
import type {
  SolveSketchRequest,
  ValidateSketchRequest,
  DeriveSketchRegionsRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
} from "@/contracts/solver/schema";
import type { SketchSolverAdapter as SketchSolverBoundary } from "@/contracts/solver/adapter";
import type { RequestId } from "@/contracts/shared/ids";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import type { LocalFileBindingMetadata } from "@/domain/modeling/local-file-binding-store";
import type { DocumentSyncWriteStatus } from "@/domain/modeling/document-sync-worker-protocol";
import type { LocalFileSystemFileHandle } from "@/lib/local-file-system-access";
import type { DocumentRepositoryMetadata } from "@/domain/modeling/document-repository";
import type { OperationHistoryStore } from "@/domain/modeling/modeling-history-persistence";
import type { DocumentRepository } from "@/domain/modeling/document-repository";
import type { AppResultAsync } from "@/contracts/errors";
import type { ExportProviderRegistry } from "@/domain/export/provider-registry";

export interface ModelingService {
  readonly currentDocumentId: DocumentId;
  readonly sketchSolver: SketchSolverService | null;
  dispose(): void;
  subscribeToDocumentChanges(
    listener: (event: ModelingServiceDocumentChangeEvent) => void,
  ): () => void;
  waitForPersistence(): Promise<void>;
  getHistoryRestoreState(): Promise<ModelingHistoryRestoreState>;
  resetOperationHistory(): void;
  setViewportLodTier(tierId: OccTessellationTierId): boolean;
  getCurrentDocumentSnapshot(): Promise<WorkspaceSnapshot>;
  createNewDocument(): Promise<ModelingDocumentFileMutationResult>;
  importDocument(
    input: ModelingImportDocumentInput,
  ): Promise<ModelingDocumentFileMutationResult>;
  renameDocument(input: {
    name: string;
  }): Promise<ModelingDocumentFileMutationResult>;
  exportCurrentDocument(): Promise<DocumentExportSuccessResult>;
  bindLocalFile(input: {
    handle: LocalFileSystemFileHandle;
    metadata: LocalFileBindingMetadata;
  }): Promise<ModelingDocumentFileMutationResult>;
  restoreLocalFileBinding(): Promise<LocalFileBindingMetadata | null>;
  getLocalFileSyncStatus(): Promise<DocumentSyncWriteStatus | null>;
  subscribeToLocalFileSyncStatus(
    listener: (status: DocumentSyncWriteStatus) => void,
  ): () => void;
  commitSketch(
    input: ModelingCommitSketchInput,
  ): AppResultAsync<ModelingCommitSketchResult>;
  projectSketchExternalReferences(
    input: ModelingProjectSketchExternalReferencesInput,
  ): Promise<
    import("@/contracts/solver/schema").ProjectSketchExternalReferencesResponse
  >;
  addDocumentVariable(
    input: ModelingAddDocumentVariableInput,
  ): AppResultAsync<ModelingDocumentVariableMutationResult>;
  updateDocumentVariable(
    input: ModelingUpdateDocumentVariableInput,
  ): AppResultAsync<ModelingDocumentVariableMutationResult>;
  createFeature(
    input: ModelingCreateFeatureInput,
  ): AppResultAsync<ModelingFeatureMutationResult>;
  updateFeature(
    input: ModelingUpdateFeatureInput,
  ): AppResultAsync<ModelingFeatureMutationResult>;
  setFeatureSuppression(
    input: ModelingSetFeatureSuppressionInput,
  ): AppResultAsync<ModelingFeatureSuppressionResult>;
  deleteFeature(
    input: ModelingDeleteFeatureInput,
  ): AppResultAsync<ModelingDeleteFeatureResult>;
  deleteTarget(
    input: ModelingDeleteTargetInput,
  ): AppResultAsync<ModelingDeleteTargetResult>;
  renameBody(
    input: ModelingRenameBodyInput,
  ): AppResultAsync<ModelingRenameBodyResult>;
  reorderFeature(
    input: ModelingReorderFeatureInput,
  ): AppResultAsync<ModelingReorderFeatureResult>;
  reorderDocumentHistory(
    input: ModelingReorderDocumentHistoryInput,
  ): AppResultAsync<ModelingReorderDocumentHistoryResult>;
  setFeatureCursor(
    input: ModelingSetFeatureCursorInput,
  ): AppResultAsync<ModelingSetFeatureCursorResult>;
  evaluatePreview(
    input: ModelingEvaluatePreviewInput,
  ): Promise<ModelingPreviewResult>;
  exportDocument(
    input: ModelingExportDocumentInput,
  ): Promise<ModelingExportDocumentResult>;
  resolveReference(
    target: PrimitiveRef,
  ): Promise<ModelingResolvedReferenceResult>;
}

export interface ModelingServiceOptions {
  currentDocumentId: WorkspaceSnapshot["document"]["documentId"];
  sketchSolver?: SketchSolverBoundary;
  operationHistoryStore?: OperationHistoryStore | null;
  documentRepository?: DocumentRepository | null;
  documentRepositoryPersistence?: "blocking" | "background";
  exportProviders?: ExportProviderRegistry;
}

export interface ModelingServiceDocumentChangeEvent {
  documentId: DocumentId;
  metadata: DocumentRepositoryMetadata;
}

export interface ModelingHistoryRestoreDiagnostic {
  reasonCode: string;
  message: string;
  entryIndex: number | null;
}

export type ModelingHistoryRestoreState =
  | { kind: "pending"; entriesReplayed: number; diagnostics: [] }
  | { kind: "empty"; entriesReplayed: 0; diagnostics: [] }
  | { kind: "restored"; entriesReplayed: number; diagnostics: [] }
  | {
      kind: "failed";
      entriesReplayed: number;
      diagnostics: ModelingHistoryRestoreDiagnostic[];
    };

/**
 * Explicit sketch-solver service facade exposed to editor/runtime code.
 * This keeps Phase 3 solver behavior separate from the broader kernel service.
 */
export interface SketchSolverService {
  solveSketch(
    input: Omit<SolveSketchRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["solveSketch"]>;
  validateSketch(
    input: Omit<ValidateSketchRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["validateSketch"]>;
  deriveSketchRegions(
    input: Omit<DeriveSketchRegionsRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["deriveSketchRegions"]>;
  projectExternalReferences(
    input: Omit<ProjectSketchExternalReferencesRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["projectExternalReferences"]>;
  resolveSketchReference(
    input: Omit<ResolveSketchReferenceRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["resolveSketchReference"]>;
  createCommitCorrelation(
    requestId: RequestId,
  ): ModelingCommitSketchCorrelation;
}

export interface ModelingFeatureMutationResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  featureId: FeatureId;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingFeatureSuppressionResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  featureId: FeatureId;
  suppressed: boolean;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingDeleteFeatureResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  deletedFeatureId: FeatureId;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingDeleteTargetResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  deletedTarget: PrimitiveRef;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingRenameBodyResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  bodyId: BodyId;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingReorderFeatureResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  featureId: FeatureId;
  beforeFeatureId: FeatureId | null;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingReorderDocumentHistoryResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  item: ReorderDocumentHistoryResponse["item"];
  beforeItem: ReorderDocumentHistoryResponse["beforeItem"];
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingSetFeatureCursorResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  cursor: DocumentFeatureCursor;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingCommitSketchResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  sketchId: SketchId;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingDocumentVariableMutationResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  variableId: DocumentVariableId;
  revisionState: MutationRevisionState;
  rebuildResult: RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: ModelingDiagnostic[];
}

type ModelingMutationBasisInput = Pick<
  SnapshotMutationBasis,
  "baseRepositoryHeads"
>;

export type ModelingCreateFeatureInput = Omit<
  CreateFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingAddDocumentVariableInput = Omit<
  AddDocumentVariableRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingUpdateFeatureInput = Omit<
  UpdateFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingSetFeatureSuppressionInput = Omit<
  SetFeatureSuppressionRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingUpdateDocumentVariableInput = Omit<
  UpdateDocumentVariableRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingDeleteFeatureInput = Omit<
  DeleteFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingDeleteTargetInput = Omit<
  DeleteDocumentTargetRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingRenameBodyInput = Omit<
  RenameBodyRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingReorderFeatureInput = Omit<
  ReorderFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingReorderDocumentHistoryInput = Omit<
  ReorderDocumentHistoryRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput>;
export type ModelingSetFeatureCursorInput = Omit<
  SetFeatureCursorRequest,
  "contractVersion" | "documentId"
> & {
  persistHistory?: boolean;
} & Partial<ModelingMutationBasisInput>;
export type ModelingExportDocumentInput = Omit<
  DocumentExportRequest,
  "contractVersion" | "documentId"
>;
export type ModelingExportDocumentResult = DocumentExportResult;

export interface ModelingImportDocumentInput {
  document: unknown;
  assets?: readonly GeometryAssetBlobInput[];
}

export type ModelingDocumentFileMutationResult =
  | { ok: true; revisionId: RevisionId; diagnostics: ModelingDiagnostic[] }
  | { ok: false; diagnostics: ModelingDiagnostic[] };

export interface ModelingCommitSketchCorrelation {
  requestId: RequestId;
  projectionRequestId: RequestId;
  validationRequestId: RequestId;
  solveRequestId: RequestId;
  regionRequestId: RequestId;
}

export interface ModelingCommitSketchInput
  extends
    Omit<CommitSketchRequest, "contractVersion" | "documentId">,
    Partial<ModelingMutationBasisInput> {
  solverCorrelation: ModelingCommitSketchCorrelation | null;
}
export type ModelingEvaluatePreviewInput = Omit<
  EvaluatePreviewRequest,
  "contractVersion" | "documentId"
>;
export type ModelingProjectSketchExternalReferencesInput = Omit<
  ProjectSketchExternalReferencesRequest,
  "contractVersion" | "documentId"
>;

export interface ModelingPreviewResult {
  revisionId: WorkspaceSnapshot["document"]["revisionId"];
  previewId: EvaluatePreviewResponse["previewId"];
  renderables: RenderExport["records"];
  freshness: PreviewFreshness;
  stale: boolean;
  diagnostics: ModelingDiagnostic[];
}

export interface ModelingResolvedReferenceResult {
  resolution: ResolvedReferenceRecord;
  diagnostics: ModelingDiagnostic[];
}
