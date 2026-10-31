import type { LoadingStatusSource } from "@/contracts/modeling/loading-status";
import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
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
import type * as schema from "@/contracts/modeling/schema";
import type {
  MeasureTopologyResponse,
  TopologyMeasureTarget,
} from "@/contracts/modeling/topology-measure";
import type { GeometryAssetBlobInput } from "@/contracts/modeling/geometry-assets";
import type { RenderExport } from "@/contracts/render/schema";
import type {
  SolveSketchRequest,
  ValidateSketchRequest,
  DeriveSketchRegionsRequest,
  QuerySketchEditIntersectionsRequest,
  QuerySketchSnapIntersectionsRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
} from "@/contracts/solver/schema";
import type { SketchSolverAdapter as SketchSolverBoundary } from "@/contracts/solver/adapter";
import type { RequestId } from "@/contracts/shared/ids";
import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import type { LocalFileBindingMetadata } from "@/contracts/modeling/local-file-binding";
import type { DocumentSyncWriteStatus } from "@/contracts/modeling/document-sync-write-status";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";
import type { DocumentRepositoryMetadata, DocumentRepositoryMutationResult } from "@/contracts/modeling/document-repository";
import type { AuthoredActionSketch } from "@/contracts/modeling/authored-actions";
import type { OperationHistoryStore } from "@/contracts/modeling/operation-history-store";
import type { DocumentRepository } from "@/contracts/modeling/document-repository";
import type { AppResultAsync } from "@/contracts/errors";
import type { ExportProviderRegistry } from "@/core/export/provider-registry";
import type { DurableRef } from "@/contracts/shared/references";
import type { OccNativeExactBrepPayload } from "@/contracts/modeling/kernel-payloads";
import type { OccNativeTopologyWorkerResult } from "@/contracts/modeling/kernel-worker-result";

export interface ModelingService {
  readonly initialLoadingStatus: LoadingStatusSource;
  readonly currentDocumentId: DocumentId;
  readonly sketchSolver: SketchSolverService | null;
  /** The kernel's neutral curve queries, for callers that build their own region solver (import verification). */
  readonly neutralCurveQueries: NeutralCurveQueryCapability;
  dispose(): void;
  subscribeToDocumentChanges(
    listener: (event: ModelingServiceDocumentChangeEvent) => void,
  ): () => void;
  waitForPersistence(): Promise<void>;
  /**
   * Settles after every local mutation requested so far has run (New,
   * Import, edits), without their repository writes; never rejects.
   */
  waitForLocalMutations(): Promise<void>;
  /** Settles after every local mutation requested so far and its repository writes. */
  waitForLocalChanges(): Promise<void>;
  /** The current local save state; the same object until it changes. */
  getLocalSaveStatus(): LocalSaveStatus;
  subscribeToLocalSaveStatus(listener: () => void): () => void;
  /**
   * Counts a repository write made outside this service (durable undo/redo)
   * as saving until `work` settles, either way.
   */
  trackLocalSave(work: Promise<unknown>): void;
  getHistoryRestoreState(): Promise<ModelingHistoryRestoreState>;
  resetOperationHistory(): void;
  /** Records the viewport's tier; true when a background refinement is due. */
  setViewportLodTier(tierId: OccTessellationTierId): boolean;
  /**
   * Refines snapshots to the latest requested viewport tier without holding
   * up authored mutations (cadara-se2). True when the snapshot tier changed.
   */
  refineViewportLod(): Promise<boolean>;
  getCurrentDocumentSnapshot(): Promise<schema.WorkspaceSnapshot>;
  buildNativeExactBrepPayload(input: {
    baseRevisionId: RevisionId;
    target: DurableRef;
  }): Promise<OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>>;
  createNewDocument(input?: {
    name?: string;
    /** Exact replacement transaction, never inferred from a global drain tail. */
    observe?: (transaction: DocumentRepositoryMutationResult) => void;
  }): Promise<ModelingDocumentFileMutationResult>;
  importDocument(
    input: ModelingImportDocumentInput,
  ): Promise<ModelingDocumentFileMutationResult>;
  renameDocument(input: {
    name: string;
    observe?: (transaction: DocumentRepositoryMutationResult) => void;
  }): Promise<ModelingDocumentFileMutationResult>;
  exportCurrentDocument(input?: {
    observe: (transaction: DocumentRepositoryMutationResult) => void;
  }): Promise<DocumentExportSuccessResult>;
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
  removeDocumentVariable(
    input: ModelingRemoveDocumentVariableInput,
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
  /** Relabels a feature without re-running it (cadara-kv69). */
  renameFeature(
    input: ModelingRenameFeatureInput,
  ): AppResultAsync<ModelingFeatureMutationResult>;
  /** Relabels a sketch without solving it or re-running a feature (cadara-kv69). */
  renameSketch(
    input: ModelingRenameSketchInput,
  ): AppResultAsync<ModelingCommitSketchResult>;
  setBodyAppearance(
    input: ModelingSetBodyAppearanceInput,
  ): AppResultAsync<ModelingSetBodyAppearanceResult>;
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
  /**
   * Exact measures of live body topology, for the measured targets only
   * (cadara-h026.5); null when the kernel cannot measure topology.
   */
  measureTopology(
    targets: readonly TopologyMeasureTarget[],
  ): Promise<MeasureTopologyResponse | null>;
}

export interface ModelingServiceOptions {
  currentDocumentId: schema.WorkspaceSnapshot["document"]["documentId"];
  sketchSolver?: SketchSolverBoundary;
  operationHistoryStore?: OperationHistoryStore | null;
  documentRepository?: DocumentRepository | null;
  documentRepositoryPersistence?: "blocking" | "background";
  exportProviders?: ExportProviderRegistry;
  /** Permission to write this document; a refused change never reaches the kernel. */
  documentWriteGate?: DocumentWriteGate | null;
}

/**
 * Who may write the document (for example a synced project's role).
 * `authorize` announces a refusal to the user; `allows` only asks.
 */
export interface DocumentWriteGate {
  authorize(kind: "part"): boolean;
  allows(kind: "part"): boolean;
  /** The diagnostic a refused write reports. */
  readonly refusal: { reasonCode: string; message: string };
}

/**
 * Whether this session's accepted edits are stored yet (cadara-8p7o): the
 * page-leave guard, its notification and the logo save animation read it.
 */
export interface LocalSaveStatus {
  /**
   * A local document change is running or its write is queued: from the
   * mutation request through the kernel evaluation and the repository write,
   * plus a bound local file being written. Snapshot/LOD refinement is not.
   */
  saving: boolean;
  /** The newest unresolved save failure; an unchanged one keeps its identity. */
  failure: LocalSaveFailure | null;
}

export interface LocalSaveFailure {
  documentId: DocumentId;
  /**
   * `repository`: an accepted change exists in memory only and leaving loses
   * it. `local-file`: browser storage holds it but the bound file is stale.
   */
  target: "repository" | "local-file";
  reasonCode: string;
  message: string;
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
  /** See `SketchSolverAdapter.supersedesRegionDerivation`. */
  readonly supersedesRegionDerivation: boolean;
  solveSketch(
    input: Omit<SolveSketchRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["solveSketch"]>;
  validateSketch(
    input: Omit<ValidateSketchRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["validateSketch"]>;
  deriveSketchRegions(
    input: Omit<DeriveSketchRegionsRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["deriveSketchRegions"]>;
  /** T10g-1: the exact edit intersections of one accepted pair. */
  querySketchEditIntersections(
    input: Omit<QuerySketchEditIntersectionsRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["querySketchEditIntersections"]>;
  /** T13i: the spline intersection snap candidates of one accepted pair. */
  querySketchSnapIntersections(
    input: Omit<QuerySketchSnapIntersectionsRequest, "contractVersion">,
  ): ReturnType<SketchSolverBoundary["querySketchSnapIntersections"]>;
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
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  featureId: FeatureId;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingFeatureSuppressionResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  featureId: FeatureId;
  suppressed: boolean;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingDeleteFeatureResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  deletedFeatureId: FeatureId;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingDeleteTargetResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  deletedTarget: PrimitiveRef;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingRenameBodyResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  bodyId: BodyId;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingSetBodyAppearanceResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  bodyId: BodyId;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingReorderFeatureResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  featureId: FeatureId;
  beforeFeatureId: FeatureId | null;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingReorderDocumentHistoryResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  item: schema.ReorderDocumentHistoryResponse["item"];
  beforeItem: schema.ReorderDocumentHistoryResponse["beforeItem"];
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingSetFeatureCursorResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  cursor: schema.DocumentFeatureCursor;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingCommitSketchResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  sketchId: SketchId;
  /** True when the live shared publication applied but its persistence flush failed. */
  durabilityPending?: boolean;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingDocumentVariableMutationResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  variableId: DocumentVariableId;
  revisionState: schema.MutationRevisionState;
  rebuildResult: schema.RebuildResult;
  changedTargets: PrimitiveRef[];
  diagnostics: schema.ModelingDiagnostic[];
}

type ModelingMutationBasisInput = Pick<
  schema.SnapshotMutationBasis,
  "baseRepositoryHeads"
>;

export type ModelingCreateFeatureInput = Omit<
  schema.CreateFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingAddDocumentVariableInput = Omit<
  schema.AddDocumentVariableRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingUpdateFeatureInput = Omit<
  schema.UpdateFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingSetFeatureSuppressionInput = Omit<
  schema.SetFeatureSuppressionRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingUpdateDocumentVariableInput = Omit<
  schema.UpdateDocumentVariableRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingRemoveDocumentVariableInput = Omit<
  schema.RemoveDocumentVariableRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingDeleteFeatureInput = Omit<
  schema.DeleteFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingDeleteTargetInput = Omit<
  schema.DeleteDocumentTargetRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingRenameBodyInput = Omit<
  schema.RenameBodyRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingRenameFeatureInput = Omit<
  schema.RenameFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingRenameSketchInput = Omit<
  schema.RenameSketchRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingSetBodyAppearanceInput = Omit<
  schema.SetBodyAppearanceRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingReorderFeatureInput = Omit<
  schema.ReorderFeatureRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingReorderDocumentHistoryInput = Omit<
  schema.ReorderDocumentHistoryRequest,
  "contractVersion" | "documentId"
> &
  Partial<ModelingMutationBasisInput> & {
    observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
  };
export type ModelingSetFeatureCursorInput = Omit<
  schema.SetFeatureCursorRequest,
  "contractVersion" | "documentId"
> & {
  persistHistory?: boolean;
  observePersistence?: (transaction: DocumentRepositoryMutationResult) => void;
} & Partial<ModelingMutationBasisInput>;
export type ModelingExportDocumentInput = Omit<
  DocumentExportRequest,
  "contractVersion" | "documentId"
>;
export type ModelingExportDocumentResult = DocumentExportResult;

export interface ModelingImportDocumentInput {
  document: unknown;
  observe?: (transaction: DocumentRepositoryMutationResult) => void;
  assets?: readonly GeometryAssetBlobInput[];
}

export type ModelingDocumentFileMutationResult =
  | {
      ok: true;
      revisionId: RevisionId;
      diagnostics: schema.ModelingDiagnostic[];
    }
  | { ok: false; diagnostics: schema.ModelingDiagnostic[] };

export interface ModelingCommitSketchCorrelation {
  requestId: RequestId;
  projectionRequestId: RequestId;
  validationRequestId: RequestId;
  solveRequestId: RequestId;
  regionRequestId: RequestId;
}

export interface ModelingCommitSketchInput
  extends
    Omit<schema.CommitSketchRequest, "contractVersion" | "documentId">,
    Partial<ModelingMutationBasisInput> {
  solverCorrelation: ModelingCommitSketchCorrelation | null;
  /** Observe the exact Publish Sketch repository write, never a global persistence tail. */
  observePublication?: (transaction: DocumentRepositoryMutationResult) => void;
  publicationBase?: {
    actionContextId: SketchId;
    expectedSketch: AuthoredActionSketch | null;
  };
}
export type ModelingEvaluatePreviewInput = Omit<
  schema.EvaluatePreviewRequest,
  "contractVersion" | "documentId"
>;
export type ModelingProjectSketchExternalReferencesInput = Omit<
  ProjectSketchExternalReferencesRequest,
  "contractVersion" | "documentId"
>;

export interface ModelingPreviewResult {
  revisionId: schema.WorkspaceSnapshot["document"]["revisionId"];
  previewId: schema.EvaluatePreviewResponse["previewId"];
  renderables: RenderExport["records"];
  freshness: schema.PreviewFreshness;
  stale: boolean;
  diagnostics: schema.ModelingDiagnostic[];
}

export interface ModelingResolvedReferenceResult {
  resolution: schema.ResolvedReferenceRecord;
  diagnostics: schema.ModelingDiagnostic[];
}
