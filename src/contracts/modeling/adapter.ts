import type {
  DocumentExportRequest,
  DocumentExportResult,
} from '@/contracts/modeling/export'
import type {
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
} from '@/contracts/solver/schema'
import type {
  CommitSketchRequest,
  CommitSketchResponse,
  AddDocumentVariableRequest,
  AddDocumentVariableResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
  DeleteFeatureRequest,
  DeleteFeatureResponse,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  RenameBodyRequest,
  RenameBodyResponse,
  ReorderDocumentHistoryRequest,
  ReorderDocumentHistoryResponse,
  ReorderFeatureRequest,
  ReorderFeatureResponse,
  ResolveReferenceRequest,
  ResolveReferenceResponse,
  SetFeatureCursorRequest,
  SetFeatureCursorResponse,
  UpdateDocumentVariableRequest,
  UpdateDocumentVariableResponse,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import type { AuthoredModelDocument as AuthoredDocument } from '@/contracts/modeling/authored-document'
import type { GeometryAssetHash } from '@/contracts/modeling/geometry-assets'
import type { StepImportReviewFileInput, StepImportReviewResult } from '@/contracts/modeling/step-import'

export interface GeometryAssetResolver {
  getGeometryAssetBytes(hash: GeometryAssetHash): Promise<Uint8Array | null>
}

/**
 * Public modeling-kernel boundary for durable document queries and feature
 * mutations. Implementers must treat request payloads as authoritative typed
 * contracts and must reject invalid feature definitions explicitly rather than
 * inferring omitted semantics from UI conventions.
 */
export interface ModelingKernelAdapter {
  /** Updates the requested viewport snapshot tessellation tier when supported. */
  setSnapshotLodTier?(tierId: 'startup' | 'normal' | 'fine'): boolean
  /** Rehydrates kernel runtime state from a repository-authored document when supported. */
  restoreAuthoredModelDocument?(
    document: AuthoredDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assetResolver?: GeometryAssetResolver,
  ): Promise<void>
  /** Rebuilds an authored document for validation without requiring a viewport snapshot. */
  validateAuthoredModelDocument?(
    document: AuthoredDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assetResolver?: GeometryAssetResolver,
  ): Promise<void>
  /** Exports the complete authored document state, including history after the active cursor. */
  exportAuthoredModelDocument?(documentId: AuthoredDocument['documentId']): Promise<AuthoredDocument>
  /** Prepares a STEP import review without mutating authored document history. */
  prepareStepImportReview?(files: readonly StepImportReviewFileInput[]): Promise<StepImportReviewResult>
  /** Returns the authoritative typed snapshot for the requested document. */
  getDocumentSnapshot(request: GetDocumentSnapshotRequest): Promise<GetDocumentSnapshotResponse>
  /** Commits a durable sketch definition against an explicit base revision. */
  commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse>
  /** Projects active-sketch external references against the requested document revision. */
  projectSketchExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse>
  /** Creates a new durable feature or rejects the submitted definition explicitly. */
  createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse>
  /** Updates an existing durable feature or rejects the submitted definition explicitly. */
  updateFeature(request: UpdateFeatureRequest): Promise<UpdateFeatureResponse>
  /** Deletes an existing durable feature from the document. */
  deleteFeature(request: DeleteFeatureRequest): Promise<DeleteFeatureResponse>
  /** Renames an existing durable body without changing its topology. */
  renameBody(request: RenameBodyRequest): Promise<RenameBodyResponse>
  /** Reorders an existing durable feature within the document feature list. */
  reorderFeature(request: ReorderFeatureRequest): Promise<ReorderFeatureResponse>
  /** Reorders an existing durable sketch or feature within authored document history. */
  reorderDocumentHistory(request: ReorderDocumentHistoryRequest): Promise<ReorderDocumentHistoryResponse>
  /** Moves the document feature cursor without deleting durable feature records. */
  setFeatureCursor(request: SetFeatureCursorRequest): Promise<SetFeatureCursorResponse>
  /** Adds a durable document variable record after validating its raw expression text. */
  addDocumentVariable(request: AddDocumentVariableRequest): Promise<AddDocumentVariableResponse>
  /** Updates a durable document variable record after validating its raw expression text. */
  updateDocumentVariable(request: UpdateDocumentVariableRequest): Promise<UpdateDocumentVariableResponse>
  /** Evaluates a transient preview for a typed feature definition. */
  evaluatePreview(request: EvaluatePreviewRequest): Promise<EvaluatePreviewResponse>
  /** Exports the requested document target as a download-ready payload. */
  exportDocument(request: DocumentExportRequest): Promise<DocumentExportResult>
  /** Resolves one durable reference without silently remapping invalid targets. */
  resolveReference(request: ResolveReferenceRequest): Promise<ResolveReferenceResponse>
}
