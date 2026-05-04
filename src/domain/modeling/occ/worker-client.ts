import type {
  AddDocumentVariableRequest,
  AddDocumentVariableResponse,
  CommitSketchRequest,
  CommitSketchResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
  DeleteDocumentTargetRequest,
  DeleteDocumentTargetResponse,
  DeleteFeatureRequest,
  DeleteFeatureResponse,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  FeatureBooleanOperation,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  ModelingDiagnostic,
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
  SetFeatureSuppressionRequest,
  SetFeatureSuppressionResponse,
  UpdateDocumentVariableRequest,
  UpdateDocumentVariableResponse,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
} from '@/contracts/modeling/schema'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import type { BodyId, RequestId, RevisionId } from '@/contracts/shared/ids'
import type {
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
} from '@/contracts/solver/schema'
import { unpackWorkspaceSnapshotRenderMeshes } from '@/domain/modeling/occ/mesh-transport'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'
import type {
  OccWorkerAssetConfig,
  OccWorkerOperation,
  OccWorkerRequest,
  OccWorkerResponse,
} from '@/domain/modeling/occ/worker-protocol'
import type { ExportCapabilities, MeshExportAccuracy, MeshTriangle, StepWriterOptions } from '@/contracts/export/capabilities'
import type { SketchVectorExportModel } from '@/contracts/export/sketch-vector'
import type { DocumentExportDiagnostic } from '@/contracts/modeling/export'
import type { DurableRef } from '@/contracts/shared/references'
import type {
  OccNativeExactBrepPayload,
  OccNativeMeshExportPayload,
  OccNativeTopologyCapabilityProbeResult,
  OccNativeTopologyPayload,
} from '@/domain/modeling/occ/native-topology-payload'
import type {
  OccNativeTopologyWorkerResult,
} from '@/domain/modeling/occ/worker-protocol'

export interface OccWorkerLike {
  postMessage(message: OccWorkerRequest, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<OccWorkerResponse>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<OccWorkerResponse>) => void): void
  terminate?(): void
}

type PendingRequest = {
  operation: OccWorkerOperation['kind']
  resolve: (value?: unknown) => void
  reject: (error: Error) => void
}

export interface OccWorkerClientOptions {
  worker: OccWorkerLike
}

export interface OccWorkerSnapshotClient {
  warmup(assets?: OccWorkerAssetConfig): Promise<void>
  preload(assets?: OccWorkerAssetConfig): Promise<void>
  restoreAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
  ): Promise<void>
  validateAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
  ): Promise<void>
  exportAuthoredModelDocument(documentId: AuthoredModelDocument['documentId']): Promise<AuthoredModelDocument>
  getDocumentSnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ): Promise<GetDocumentSnapshotResponse>
  projectSketchExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse>
  commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse>
  createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse>
  updateFeature(request: UpdateFeatureRequest): Promise<UpdateFeatureResponse>
  setFeatureSuppression(request: SetFeatureSuppressionRequest): Promise<SetFeatureSuppressionResponse>
  deleteFeature(request: DeleteFeatureRequest): Promise<DeleteFeatureResponse>
  deleteTarget(request: DeleteDocumentTargetRequest): Promise<DeleteDocumentTargetResponse>
  renameBody(request: RenameBodyRequest): Promise<RenameBodyResponse>
  reorderFeature(request: ReorderFeatureRequest): Promise<ReorderFeatureResponse>
  reorderDocumentHistory(request: ReorderDocumentHistoryRequest): Promise<ReorderDocumentHistoryResponse>
  setFeatureCursor(request: SetFeatureCursorRequest): Promise<SetFeatureCursorResponse>
  addDocumentVariable(request: AddDocumentVariableRequest): Promise<AddDocumentVariableResponse>
  updateDocumentVariable(request: UpdateDocumentVariableRequest): Promise<UpdateDocumentVariableResponse>
  evaluatePreview(request: EvaluatePreviewRequest): Promise<EvaluatePreviewResponse>
  resolveReference(request: ResolveReferenceRequest): Promise<ResolveReferenceResponse>
  probeNativeTopologyKernelCapabilities(assets?: OccWorkerAssetConfig): Promise<OccNativeTopologyCapabilityProbeResult>
  buildNativeTopologySnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>
  executeNativeFeatureHistoryRebuild(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
    lodTierId?: OccTessellationTierId,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>
  buildNativeBooleanFeatureTransactionPayload(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
    leftBodyId: BodyId,
    rightBodyId: BodyId,
    operation: Exclude<FeatureBooleanOperation, 'newBody'>,
    lodTierId?: OccTessellationTierId,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>
  buildNativeMeshExportPayload(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
    target: DurableRef,
    options: MeshExportAccuracy,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeMeshExportPayload>>
  buildNativeExactBrepPayload(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
    target: DurableRef,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>>
  getExportCapabilities(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
  ): Promise<ExportCapabilities | DocumentExportDiagnostic>
  dispose?(): void
}

export class OccWorkerClient implements OccWorkerSnapshotClient {
  private readonly worker: OccWorkerLike
  private readonly pending = new Map<RequestId, PendingRequest>()
  private requestSequence = 0

  constructor(options: OccWorkerClientOptions) {
    this.worker = options.worker
    this.worker.addEventListener('message', this.handleMessage)
  }

  warmup(assets?: OccWorkerAssetConfig) {
    return this.invokeVoid({ kind: 'warmup', assets })
  }

  preload(assets?: OccWorkerAssetConfig) {
    return this.warmup(assets)
  }

  restoreAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
  ) {
    return this.invokeVoid({
      kind: 'restoreAuthoredModelDocument',
      document,
      diagnostics,
      assets,
    })
  }

  validateAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
  ) {
    return this.invokeVoid({
      kind: 'validateAuthoredModelDocument',
      document,
      diagnostics,
      assets,
    })
  }

  exportAuthoredModelDocument(documentId: AuthoredModelDocument['documentId']) {
    return this.invoke<AuthoredModelDocument>({
      kind: 'exportAuthoredModelDocument',
      documentId,
    })
  }

  getDocumentSnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<GetDocumentSnapshotResponse>({
      kind: 'getDocumentSnapshot',
      request,
      lodTierId,
    })
  }

  projectSketchExternalReferences(request: ProjectSketchExternalReferencesRequest) {
    return this.invoke<ProjectSketchExternalReferencesResponse>({
      kind: 'projectSketchExternalReferences',
      request,
    })
  }

  commitSketch(request: CommitSketchRequest) {
    return this.invoke<CommitSketchResponse>({ kind: 'commitSketch', request })
  }

  createFeature(request: CreateFeatureRequest) {
    return this.invoke<CreateFeatureResponse>({ kind: 'createFeature', request })
  }

  updateFeature(request: UpdateFeatureRequest) {
    return this.invoke<UpdateFeatureResponse>({ kind: 'updateFeature', request })
  }

  setFeatureSuppression(request: SetFeatureSuppressionRequest) {
    return this.invoke<SetFeatureSuppressionResponse>({ kind: 'setFeatureSuppression', request })
  }

  deleteFeature(request: DeleteFeatureRequest) {
    return this.invoke<DeleteFeatureResponse>({ kind: 'deleteFeature', request })
  }

  deleteTarget(request: DeleteDocumentTargetRequest) {
    return this.invoke<DeleteDocumentTargetResponse>({ kind: 'deleteTarget', request })
  }

  renameBody(request: RenameBodyRequest) {
    return this.invoke<RenameBodyResponse>({ kind: 'renameBody', request })
  }

  reorderFeature(request: ReorderFeatureRequest) {
    return this.invoke<ReorderFeatureResponse>({ kind: 'reorderFeature', request })
  }

  reorderDocumentHistory(request: ReorderDocumentHistoryRequest) {
    return this.invoke<ReorderDocumentHistoryResponse>({ kind: 'reorderDocumentHistory', request })
  }

  setFeatureCursor(request: SetFeatureCursorRequest) {
    return this.invoke<SetFeatureCursorResponse>({ kind: 'setFeatureCursor', request })
  }

  addDocumentVariable(request: AddDocumentVariableRequest) {
    return this.invoke<AddDocumentVariableResponse>({ kind: 'addDocumentVariable', request })
  }

  updateDocumentVariable(request: UpdateDocumentVariableRequest) {
    return this.invoke<UpdateDocumentVariableResponse>({ kind: 'updateDocumentVariable', request })
  }

  evaluatePreview(request: EvaluatePreviewRequest) {
    return this.invoke<EvaluatePreviewResponse>({ kind: 'evaluatePreview', request })
  }

  resolveReference(request: ResolveReferenceRequest) {
    return this.invoke<ResolveReferenceResponse>({ kind: 'resolveReference', request })
  }

  probeNativeTopologyKernelCapabilities(assets?: OccWorkerAssetConfig) {
    return this.invoke<OccNativeTopologyCapabilityProbeResult>({
      kind: 'probeNativeTopologyKernelCapabilities',
      assets,
    })
  }

  buildNativeTopologySnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>({
      kind: 'buildNativeTopologySnapshot',
      request,
      lodTierId,
    })
  }

  executeNativeFeatureHistoryRebuild(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>({
      kind: 'executeNativeFeatureHistoryRebuild',
      document,
      diagnostics,
      assets,
      lodTierId,
    })
  }

  buildNativeBooleanFeatureTransactionPayload(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
    leftBodyId: BodyId,
    rightBodyId: BodyId,
    operation: Exclude<FeatureBooleanOperation, 'newBody'>,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>({
      kind: 'buildNativeBooleanFeatureTransactionPayload',
      documentId,
      baseRevisionId,
      leftBodyId,
      rightBodyId,
      operation,
      lodTierId,
    })
  }

  buildNativeMeshExportPayload(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
    target: DurableRef,
    options: MeshExportAccuracy,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeMeshExportPayload>>({
      kind: 'buildNativeMeshExportPayload',
      documentId,
      baseRevisionId,
      target,
      options,
    })
  }

  buildNativeExactBrepPayload(
    documentId: AuthoredModelDocument['documentId'],
    baseRevisionId: RevisionId,
    target: DurableRef,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>>({
      kind: 'buildNativeExactBrepPayload',
      documentId,
      baseRevisionId,
      target,
    })
  }

  getExportCapabilities(documentId: AuthoredModelDocument['documentId'], baseRevisionId: RevisionId) {
    return Promise.resolve({
      mesh: {
        tessellate: (target: DurableRef, options: MeshExportAccuracy) =>
          this.invoke<MeshTriangle[] | DocumentExportDiagnostic>({
            kind: 'tessellateExportMesh',
            documentId,
            baseRevisionId,
            target,
            options,
          }),
      },
      brep: {
        writeStep: (target: DurableRef, options: StepWriterOptions) =>
          this.invoke<{ payload: string } | { diagnostic: DocumentExportDiagnostic }>({
            kind: 'writeStepExport',
            documentId,
            baseRevisionId,
            target,
            options,
          }),
      },
      sketchVector: {
        resolveSketchVectorModel: (target: DurableRef) =>
          this.invoke<SketchVectorExportModel | { diagnostic: DocumentExportDiagnostic }>({
            kind: 'resolveSketchVectorExportModel',
            documentId,
            baseRevisionId,
            target,
          }),
      },
    } satisfies ExportCapabilities)
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage)
    for (const requestId of this.pending.keys()) {
      this.rejectPending(requestId, new Error('OCC worker client disposed.'))
    }
    this.worker.terminate?.()
  }

  private invokeVoid(operation: OccWorkerOperation) {
    return this.invoke<void>(operation)
  }

  private invoke<T>(operation: OccWorkerOperation): Promise<T> {
    const requestId = this.createRequestId(operation.kind)

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        operation: operation.kind,
        resolve: (value) => resolve(this.normalizePayload(operation.kind, value) as T),
        reject,
      })
      this.worker.postMessage({ kind: 'invoke', requestId, operation })
    })
  }

  private normalizePayload(operation: OccWorkerOperation['kind'], payload: unknown) {
    if (operation === 'getDocumentSnapshot' && payload) {
      return {
        ...(payload as GetDocumentSnapshotResponse),
        snapshot: unpackWorkspaceSnapshotRenderMeshes(
          (payload as GetDocumentSnapshotResponse).snapshot,
        ),
      } satisfies GetDocumentSnapshotResponse
    }

    return payload
  }

  private readonly handleMessage = (event: MessageEvent<OccWorkerResponse>) => {
    const message = event.data
    const pending = this.pending.get(message.requestId)

    if (!pending) {
      return
    }

    this.pending.delete(message.requestId)

    if (message.kind === 'failure') {
      pending.reject(new Error(message.error.message))
      return
    }

    if (message.kind !== 'invoked' || message.operation !== pending.operation) {
      pending.reject(new Error(`Unexpected OCC worker response ${message.kind}.`))
      return
    }

    pending.resolve(message.payload)
  }

  private rejectPending(requestId: RequestId, error: Error) {
    const pending = this.pending.get(requestId)
    if (!pending) {
      return
    }

    this.pending.delete(requestId)
    pending.reject(error)
  }

  private createRequestId(prefix: string) {
    this.requestSequence += 1
    return `occ_${prefix}_${this.requestSequence}` as RequestId
  }
}
