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
} from '@/contracts/modeling/schema'

/**
 * Public modeling-kernel boundary for durable document queries and feature
 * mutations. Implementers must treat request payloads as authoritative typed
 * contracts and must reject invalid feature definitions explicitly rather than
 * inferring omitted semantics from UI conventions.
 */
export interface ModelingKernelAdapter {
  /** Returns the authoritative typed snapshot for the requested document. */
  getDocumentSnapshot(request: GetDocumentSnapshotRequest): Promise<GetDocumentSnapshotResponse>
  /** Commits a durable sketch definition against an explicit base revision. */
  commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse>
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
  /** Moves the document feature cursor without deleting durable feature records. */
  setFeatureCursor(request: SetFeatureCursorRequest): Promise<SetFeatureCursorResponse>
  /** Adds a durable document variable record after validating its raw expression text. */
  addDocumentVariable(request: AddDocumentVariableRequest): Promise<AddDocumentVariableResponse>
  /** Updates a durable document variable record after validating its raw expression text. */
  updateDocumentVariable(request: UpdateDocumentVariableRequest): Promise<UpdateDocumentVariableResponse>
  /** Evaluates a transient preview for a typed feature definition. */
  evaluatePreview(request: EvaluatePreviewRequest): Promise<EvaluatePreviewResponse>
  /** Resolves one durable reference without silently remapping invalid targets. */
  resolveReference(request: ResolveReferenceRequest): Promise<ResolveReferenceResponse>
}
