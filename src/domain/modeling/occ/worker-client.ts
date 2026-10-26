import type {
  MeasureTopologyRequest,
  MeasureTopologyResponse,
} from "@/contracts/modeling/topology-measure";
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
  ModelingOperationResult,
  RenameBodyRequest,
  RenameBodyResponse,
  RenameDocumentRequest,
  RenameFeatureRequest,
  RenameSketchRequest,
  SetBodyAppearanceRequest,
  SetBodyAppearanceResponse,
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
  RemoveDocumentVariableRequest,
  RemoveDocumentVariableResponse,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
} from "@/contracts/modeling/schema";
import type {
  AuthoredDocumentRestoreOptions,
  GeometryAssetResolver,
} from "@/contracts/modeling/adapter";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { GeometryAssetBlobInput } from "@/contracts/modeling/geometry-assets";
import type { BodyId, RequestId, RevisionId } from "@/contracts/shared/ids";
import type {
  NeutralCurveJoinRequest,
  NeutralCurveJoinResult,
  NeutralCurveQueryRequest,
  NeutralCurveQueryResult,
  NeutralCurveSelfIntersectionRequest,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  DeriveSketchRegionsRequest,
  DeriveSketchRegionsResponse,
  QuerySketchEditIntersectionsRequest,
  QuerySketchEditIntersectionsResponse,
  QuerySketchSnapIntersectionsRequest,
  QuerySketchSnapIntersectionsResponse,
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
} from "@/contracts/solver/schema";
import {
  createRenderMeshUnpackCache,
  unpackWorkspaceSnapshotRenderMeshes,
} from "@/domain/modeling/occ/mesh-transport";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import { validateOccWorkerRestoreProgressMessage } from "@/domain/modeling/occ/worker-restore-progress.runtime-schema";
import {
  validateOccWorkerEngineDownloadProgressMessage,
  type OccWorkerEngineDownloadProgressMessage,
} from "@/domain/modeling/occ/worker-engine-download-progress.runtime-schema";
import type {
  OccSnapshotLodRefinementOutcome,
  OccWorkerAssetConfig,
  OccWorkerOperation,
  OccWorkerRequest,
  OccWorkerResponse,
} from "@/domain/modeling/occ/worker-protocol";
import type {
  ExportCapabilities,
  MeshExportAccuracy,
  MeshTriangle,
  StepWriterOptions,
} from "@/contracts/export/capabilities";
import type { SketchVectorExportModel } from "@/contracts/export/sketch-vector";
import type { DocumentExportDiagnostic } from "@/contracts/modeling/export";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  OccNativeExactBrepPayload,
  OccNativeMeshExportPayload,
  OccNativeTopologyCapabilityProbeResult,
  OccNativeTopologyPayload,
} from "@/domain/modeling/occ/native-topology-payload";
import type { OccNativeTopologyWorkerResult } from "@/domain/modeling/occ/worker-protocol";

export interface OccWorkerLike {
  postMessage(message: OccWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<OccWorkerResponse>) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<OccWorkerResponse>) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  terminate?(): void;
}

type PendingRequest = {
  operation: OccWorkerOperation["kind"];
  onProgress?: AuthoredDocumentRestoreOptions["onProgress"];
  resolve: (value?: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

export interface OccWorkerClientOptions {
  worker: OccWorkerLike;
  createWorker?: () => OccWorkerLike;
  onFatalError?: (error: Error) => void;
  onEngineDownloadProgress?: (
    progress: Omit<OccWorkerEngineDownloadProgressMessage, "kind">,
  ) => void;
  assetResolver?: GeometryAssetResolver;
  requestTimeoutMs?: number | null;
}

export interface OccWorkerSnapshotClient {
  warmup(assets?: OccWorkerAssetConfig): Promise<void>;
  preload(assets?: OccWorkerAssetConfig): Promise<void>;
  restoreAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
    options?: AuthoredDocumentRestoreOptions,
  ): Promise<void>;
  validateAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
  ): Promise<void>;
  exportAuthoredModelDocument(
    documentId: AuthoredModelDocument["documentId"],
  ): Promise<AuthoredModelDocument>;
  releaseDocument(documentId: AuthoredModelDocument["documentId"]): Promise<void>;
  getDocumentSnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ): Promise<GetDocumentSnapshotResponse>;
  /** Background LOD refinement; requests sent meanwhile run between its steps. */
  refineSnapshotLod(
    request: GetDocumentSnapshotRequest,
    lodTierId: OccTessellationTierId,
  ): Promise<OccSnapshotLodRefinementOutcome>;
  projectSketchExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse>;
  queryNeutralCurves(
    request: NeutralCurveQueryRequest,
  ): Promise<NeutralCurveQueryResult>;
  queryNeutralCurveSelfIntersections(
    request: NeutralCurveSelfIntersectionRequest,
  ): Promise<NeutralCurveQueryResult>;
  queryNeutralCurveJoin(
    request: NeutralCurveJoinRequest,
  ): Promise<NeutralCurveJoinResult>;
  commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse>;
  createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse>;
  updateFeature(request: UpdateFeatureRequest): Promise<UpdateFeatureResponse>;
  setFeatureSuppression(
    request: SetFeatureSuppressionRequest,
  ): Promise<SetFeatureSuppressionResponse>;
  deleteFeature(request: DeleteFeatureRequest): Promise<DeleteFeatureResponse>;
  deleteTarget(
    request: DeleteDocumentTargetRequest,
  ): Promise<DeleteDocumentTargetResponse>;
  renameBody(request: RenameBodyRequest): Promise<RenameBodyResponse>;
  renameFeature(request: RenameFeatureRequest): Promise<UpdateFeatureResponse>;
  renameSketch(request: RenameSketchRequest): Promise<CommitSketchResponse>;
  renameDocument(
    request: RenameDocumentRequest,
  ): Promise<ModelingOperationResult>;
  setBodyAppearance(
    request: SetBodyAppearanceRequest,
  ): Promise<SetBodyAppearanceResponse>;
  reorderFeature(
    request: ReorderFeatureRequest,
  ): Promise<ReorderFeatureResponse>;
  reorderDocumentHistory(
    request: ReorderDocumentHistoryRequest,
  ): Promise<ReorderDocumentHistoryResponse>;
  setFeatureCursor(
    request: SetFeatureCursorRequest,
  ): Promise<SetFeatureCursorResponse>;
  addDocumentVariable(
    request: AddDocumentVariableRequest,
  ): Promise<AddDocumentVariableResponse>;
  updateDocumentVariable(
    request: UpdateDocumentVariableRequest,
  ): Promise<UpdateDocumentVariableResponse>;
  removeDocumentVariable(
    request: RemoveDocumentVariableRequest,
  ): Promise<RemoveDocumentVariableResponse>;
  evaluatePreview(
    request: EvaluatePreviewRequest,
  ): Promise<EvaluatePreviewResponse>;
  resolveReference(
    request: ResolveReferenceRequest,
  ): Promise<ResolveReferenceResponse>;
  measureTopology(
    request: MeasureTopologyRequest,
  ): Promise<MeasureTopologyResponse>;
  probeNativeTopologyKernelCapabilities(
    assets?: OccWorkerAssetConfig,
  ): Promise<OccNativeTopologyCapabilityProbeResult>;
  buildNativeTopologySnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>;
  executeNativeFeatureHistoryRebuild(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
    lodTierId?: OccTessellationTierId,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>;
  buildNativeBooleanFeatureTransactionPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    leftBodyId: BodyId,
    rightBodyId: BodyId,
    operation: Exclude<FeatureBooleanOperation, "newBody">,
    lodTierId?: OccTessellationTierId,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>;
  buildNativeMeshExportPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    target: DurableRef,
    options: MeshExportAccuracy,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeMeshExportPayload>>;
  buildNativeExactBrepPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    target: DurableRef,
  ): Promise<OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>>;
  getExportCapabilities(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
  ): Promise<ExportCapabilities | DocumentExportDiagnostic>;
  dispose?(): void;
}

export class OccWorkerClient implements OccWorkerSnapshotClient {
  private worker: OccWorkerLike;
  private readonly createWorker: (() => OccWorkerLike) | undefined;
  private readonly onFatalError: ((error: Error) => void) | undefined;
  private readonly onEngineDownloadProgress: OccWorkerClientOptions["onEngineDownloadProgress"];
  private documentsInvalidated = false;
  private readonly restoredDocuments = new Set<string>();
  private readonly assetResolver: GeometryAssetResolver | undefined;
  private readonly requestTimeoutMs: number | null;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly renderMeshes = createRenderMeshUnpackCache();
  private requestSequence = 0;
  private terminalError: Error | null = null;
  private disposed = false;

  constructor(options: OccWorkerClientOptions) {
    this.worker = options.worker;
    this.createWorker = options.createWorker;
    this.onFatalError = options.onFatalError;
    this.onEngineDownloadProgress = options.onEngineDownloadProgress;
    this.assetResolver = options.assetResolver;
    this.requestTimeoutMs = options.requestTimeoutMs ?? null;
    this.attachListeners();
  }

  private attachListeners() {
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleTransportError);
    this.worker.addEventListener("messageerror", this.handleTransportError);
  }

  warmup(assets?: OccWorkerAssetConfig) {
    return this.invokeVoid({ kind: "warmup", assets });
  }

  preload(assets?: OccWorkerAssetConfig) {
    return this.warmup(assets);
  }

  restoreAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
    options: AuthoredDocumentRestoreOptions = {},
  ) {
    // A function cannot cross postMessage; progress returns by request id.
    const { onProgress, ...transportOptions } = options;
    return this.invoke<void>(
      {
        kind: "restoreAuthoredModelDocument",
        document,
        diagnostics,
        assets,
        options: onProgress
          ? { ...transportOptions, reportProgress: true }
          : transportOptions,
      },
      onProgress,
    );
  }

  validateAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
  ) {
    return this.invokeVoid({
      kind: "validateAuthoredModelDocument",
      document,
      diagnostics,
      assets,
    });
  }

  exportAuthoredModelDocument(documentId: AuthoredModelDocument["documentId"]) {
    return this.invoke<AuthoredModelDocument>({
      kind: "exportAuthoredModelDocument",
      documentId,
    });
  }

  releaseDocument(documentId: AuthoredModelDocument["documentId"]) {
    return this.invokeVoid({ kind: "releaseDocument", documentId });
  }

  getDocumentSnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<GetDocumentSnapshotResponse>({
      kind: "getDocumentSnapshot",
      request,
      lodTierId,
    });
  }

  refineSnapshotLod(
    request: GetDocumentSnapshotRequest,
    lodTierId: OccTessellationTierId,
  ) {
    return this.invoke<OccSnapshotLodRefinementOutcome>({
      kind: "refineSnapshotLod",
      request,
      lodTierId,
    });
  }

  projectSketchExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ) {
    return this.invoke<ProjectSketchExternalReferencesResponse>({
      kind: "projectSketchExternalReferences",
      request,
    });
  }

  queryNeutralCurves(request: NeutralCurveQueryRequest) {
    return this.invoke<NeutralCurveQueryResult>({
      kind: "queryNeutralCurves",
      request,
    });
  }

  queryNeutralCurveSelfIntersections(
    request: NeutralCurveSelfIntersectionRequest,
  ) {
    return this.invoke<NeutralCurveQueryResult>({
      kind: "queryNeutralCurveSelfIntersections",
      request,
    });
  }

  queryNeutralCurveJoin(request: NeutralCurveJoinRequest) {
    return this.invoke<NeutralCurveJoinResult>({
      kind: "queryNeutralCurveJoin",
      request,
    });
  }

  /**
   * Posts to whichever worker this client wraps; only the dedicated
   * sketch-derivation worker answers it (the OCC kernel worker rejects it).
   */
  deriveSketchRegions(request: DeriveSketchRegionsRequest) {
    return this.invoke<DeriveSketchRegionsResponse>({
      kind: "deriveSketchRegions",
      request,
    });
  }

  /** T10g-1: answered only by the dedicated sketch-derivation worker. */
  querySketchEditIntersections(request: QuerySketchEditIntersectionsRequest) {
    return this.invoke<QuerySketchEditIntersectionsResponse>({
      kind: "querySketchEditIntersections",
      request,
    });
  }

  /** T13i: answered only by the dedicated sketch-derivation worker. */
  querySketchSnapIntersections(request: QuerySketchSnapIntersectionsRequest) {
    return this.invoke<QuerySketchSnapIntersectionsResponse>({
      kind: "querySketchSnapIntersections",
      request,
    });
  }

  commitSketch(request: CommitSketchRequest) {
    return this.invoke<CommitSketchResponse>({ kind: "commitSketch", request });
  }

  createFeature(request: CreateFeatureRequest) {
    return this.invoke<CreateFeatureResponse>({
      kind: "createFeature",
      request,
    });
  }

  updateFeature(request: UpdateFeatureRequest) {
    return this.invoke<UpdateFeatureResponse>({
      kind: "updateFeature",
      request,
    });
  }

  setFeatureSuppression(request: SetFeatureSuppressionRequest) {
    return this.invoke<SetFeatureSuppressionResponse>({
      kind: "setFeatureSuppression",
      request,
    });
  }

  deleteFeature(request: DeleteFeatureRequest) {
    return this.invoke<DeleteFeatureResponse>({
      kind: "deleteFeature",
      request,
    });
  }

  deleteTarget(request: DeleteDocumentTargetRequest) {
    return this.invoke<DeleteDocumentTargetResponse>({
      kind: "deleteTarget",
      request,
    });
  }

  renameBody(request: RenameBodyRequest) {
    return this.invoke<RenameBodyResponse>({ kind: "renameBody", request });
  }

  renameFeature(request: RenameFeatureRequest) {
    return this.invoke<UpdateFeatureResponse>({
      kind: "renameFeature",
      request,
    });
  }

  renameSketch(request: RenameSketchRequest) {
    return this.invoke<CommitSketchResponse>({ kind: "renameSketch", request });
  }

  renameDocument(request: RenameDocumentRequest) {
    return this.invoke<ModelingOperationResult>({
      kind: "renameDocument",
      request,
    });
  }

  setBodyAppearance(request: SetBodyAppearanceRequest) {
    return this.invoke<SetBodyAppearanceResponse>({
      kind: "setBodyAppearance",
      request,
    });
  }

  reorderFeature(request: ReorderFeatureRequest) {
    return this.invoke<ReorderFeatureResponse>({
      kind: "reorderFeature",
      request,
    });
  }

  reorderDocumentHistory(request: ReorderDocumentHistoryRequest) {
    return this.invoke<ReorderDocumentHistoryResponse>({
      kind: "reorderDocumentHistory",
      request,
    });
  }

  setFeatureCursor(request: SetFeatureCursorRequest) {
    return this.invoke<SetFeatureCursorResponse>({
      kind: "setFeatureCursor",
      request,
    });
  }

  addDocumentVariable(request: AddDocumentVariableRequest) {
    return this.invoke<AddDocumentVariableResponse>({
      kind: "addDocumentVariable",
      request,
    });
  }

  updateDocumentVariable(request: UpdateDocumentVariableRequest) {
    return this.invoke<UpdateDocumentVariableResponse>({
      kind: "updateDocumentVariable",
      request,
    });
  }

  removeDocumentVariable(request: RemoveDocumentVariableRequest) {
    return this.invoke<RemoveDocumentVariableResponse>({
      kind: "removeDocumentVariable",
      request,
    });
  }

  evaluatePreview(request: EvaluatePreviewRequest) {
    return this.invoke<EvaluatePreviewResponse>({
      kind: "evaluatePreview",
      request,
    });
  }

  resolveReference(request: ResolveReferenceRequest) {
    return this.invoke<ResolveReferenceResponse>({
      kind: "resolveReference",
      request,
    });
  }

  measureTopology(request: MeasureTopologyRequest) {
    return this.invoke<MeasureTopologyResponse>({
      kind: "measureTopology",
      request,
    });
  }

  probeNativeTopologyKernelCapabilities(assets?: OccWorkerAssetConfig) {
    return this.invoke<OccNativeTopologyCapabilityProbeResult>({
      kind: "probeNativeTopologyKernelCapabilities",
      assets,
    });
  }

  buildNativeTopologySnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>(
      {
        kind: "buildNativeTopologySnapshot",
        request,
        lodTierId,
      },
    );
  }

  executeNativeFeatureHistoryRebuild(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>(
      {
        kind: "executeNativeFeatureHistoryRebuild",
        document,
        diagnostics,
        assets,
        lodTierId,
      },
    );
  }

  buildNativeBooleanFeatureTransactionPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    leftBodyId: BodyId,
    rightBodyId: BodyId,
    operation: Exclude<FeatureBooleanOperation, "newBody">,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.invoke<OccNativeTopologyWorkerResult<OccNativeTopologyPayload>>(
      {
        kind: "buildNativeBooleanFeatureTransactionPayload",
        documentId,
        baseRevisionId,
        leftBodyId,
        rightBodyId,
        operation,
        lodTierId,
      },
    );
  }

  buildNativeMeshExportPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    target: DurableRef,
    options: MeshExportAccuracy,
  ) {
    return this.invoke<
      OccNativeTopologyWorkerResult<OccNativeMeshExportPayload>
    >({
      kind: "buildNativeMeshExportPayload",
      documentId,
      baseRevisionId,
      target,
      options,
    });
  }

  buildNativeExactBrepPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    target: DurableRef,
  ) {
    return this.invoke<
      OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>
    >({
      kind: "buildNativeExactBrepPayload",
      documentId,
      baseRevisionId,
      target,
    });
  }

  getExportCapabilities(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
  ) {
    return Promise.resolve({
      mesh: {
        tessellate: (target: DurableRef, options: MeshExportAccuracy) =>
          this.invoke<MeshTriangle[] | DocumentExportDiagnostic>({
            kind: "tessellateExportMesh",
            documentId,
            baseRevisionId,
            target,
            options,
          }),
      },
      brep: {
        writeStep: (target: DurableRef, options: StepWriterOptions) =>
          this.invoke<
            { payload: string } | { diagnostic: DocumentExportDiagnostic }
          >({
            kind: "writeStepExport",
            documentId,
            baseRevisionId,
            target,
            options,
          }),
      },
      sketchVector: {
        resolveSketchVectorModel: (target: DurableRef) =>
          this.invoke<
            SketchVectorExportModel | { diagnostic: DocumentExportDiagnostic }
          >({
            kind: "resolveSketchVectorExportModel",
            documentId,
            baseRevisionId,
            target,
          }),
      },
    } satisfies ExportCapabilities);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.detachListeners();
    this.rejectAllPending(new Error("OCC worker client disposed."));
    this.worker.terminate?.();
  }

  private invokeVoid(operation: OccWorkerOperation) {
    return this.invoke<void>(operation);
  }

  private invoke<T>(
    operation: OccWorkerOperation,
    onProgress?: PendingRequest["onProgress"],
  ): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("OCC worker client disposed."));
    }
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }

    const documentId = "document" in operation ? operation.document.documentId
      : "documentId" in operation ? operation.documentId
      : "request" in operation && "documentId" in operation.request
        ? operation.request.documentId : null;
    if (this.documentsInvalidated && documentId &&
        !this.restoredDocuments.has(documentId) &&
        operation.kind !== "restoreAuthoredModelDocument" &&
        operation.kind !== "validateAuthoredModelDocument" &&
        operation.kind !== "releaseDocument") {
      return Promise.reject(new Error(
        "OCC worker document state was lost. Reopen the document before continuing.",
      ));
    }
    const worker = this.worker;
    const requestId = this.createRequestId(operation.kind);

    return new Promise<T>((resolve, reject) => {
      const timeout =
        this.requestTimeoutMs === null
          ? null
          : setTimeout(() => {
              this.rejectPending(
                requestId,
                new Error(
                  `OCC worker request timed out after ${this.requestTimeoutMs}ms.`,
                ),
              );
            }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        operation: operation.kind,
        onProgress,
        resolve: (value) => {
          if (operation.kind === "restoreAuthoredModelDocument") {
            this.restoredDocuments.add(operation.document.documentId);
          } else if (operation.kind === "releaseDocument") {
            this.restoredDocuments.delete(operation.documentId);
          }
          resolve(this.normalizePayload(operation.kind, value) as T);
        },
        reject,
        timeout,
      });
      try {
        worker.postMessage({ kind: "invoke", requestId, operation });
      } catch (error) {
        this.enterTerminalState(
          new Error(`OCC worker postMessage failed: ${describeTransportError(error)}`),
        );
      }
    });
  }

  private normalizePayload(
    operation: OccWorkerOperation["kind"],
    payload: unknown,
  ) {
    if (operation === "getDocumentSnapshot" && payload) {
      return {
        ...(payload as GetDocumentSnapshotResponse),
        snapshot: unpackWorkspaceSnapshotRenderMeshes(
          (payload as GetDocumentSnapshotResponse).snapshot,
          this.renderMeshes,
        ),
      } satisfies GetDocumentSnapshotResponse;
    }

    return payload;
  }

  private readonly handleMessage = (event: MessageEvent<OccWorkerResponse>) => {
    if (this.disposed || this.terminalError) {
      return;
    }

    const message = event.data;
    if (message.kind === "fatal") {
      this.enterTerminalState(new Error(
        `OpenCascade stopped (out of memory or runtime abort): ${message.error.message}. Reopen the document to continue. The failed operation was not retried.`,
      ), this.pending.size > 0);
      return;
    }

    if (message.kind === "resolveGeometryAsset") {
      const worker = this.worker;
      void this.answerGeometryAssetRequest(message.requestId, message.reference).catch(
        (error: unknown) => {
          if (worker !== this.worker) return;
          this.enterTerminalState(
            new Error(
              `OCC worker geometry asset resolution failed: ${describeTransportError(error)}`,
            ),
          );
        },
      );
      return;
    }

    if (message.kind === "engineDownloadProgress") {
      const validated = validateOccWorkerEngineDownloadProgressMessage(message);
      if (!validated.success) {
        this.enterTerminalState(new Error(
          `Invalid OCC worker engine download progress: ${validated.errors[0]?.path}.`,
        ));
        return;
      }
      this.onEngineDownloadProgress?.(validated.data);
      return;
    }

    const pending = this.pending.get(message.requestId);

    if (!pending) {
      return;
    }

    if (message.kind === "restoreProgress") {
      const validated = validateOccWorkerRestoreProgressMessage(message);
      if (validated.success && pending.operation === "restoreAuthoredModelDocument") {
        pending.onProgress?.(validated.data.progress);
        return;
      }
      this.pending.delete(message.requestId);
      this.clearPendingTimeout(pending);
      pending.reject(new Error(
        `Invalid OCC worker restore progress for ${pending.operation}: ${
          validated.success ? "not a restore request" : validated.errors[0]?.path
        }.`,
      ));
      return;
    }

    this.pending.delete(message.requestId);
    this.clearPendingTimeout(pending);

    if (message.kind === "failure") {
      pending.reject(new Error(message.error.message));
      return;
    }

    if (message.kind !== "invoked" || message.operation !== pending.operation) {
      pending.reject(
        new Error(`Unexpected OCC worker response ${message.kind}.`),
      );
      return;
    }

    pending.resolve(message.payload);
  };

  private async answerGeometryAssetRequest(
    requestId: RequestId,
    reference: Parameters<GeometryAssetResolver["resolveGeometryAsset"]>[0],
  ) {
    const worker = this.worker;
    const resolved =
      (await this.assetResolver?.resolveGeometryAsset(reference)) ?? null;
    if (this.disposed || this.terminalError || worker !== this.worker) {
      return;
    }

    try {
      worker.postMessage(
        {
          kind: "resolveGeometryAssetResult",
          requestId,
          assetId: reference.assetId,
          asset: resolved,
        },
        resolved ? [resolved.bytes.buffer as ArrayBuffer] : [],
      );
    } catch (error) {
      this.enterTerminalState(
        new Error(`OCC worker postMessage failed: ${describeTransportError(error)}`),
      );
    }
  }

  private readonly handleTransportError = (event: Event) => {
    this.enterTerminalState(
      new Error(
        event.type === "messageerror"
          ? "OCC worker message deserialization failed."
          : "OCC worker transport failed.",
      ),
    );
  };

  private enterTerminalState(error: Error, replaceAbortedWorker = false) {
    if (this.disposed || this.terminalError) {
      return;
    }

    this.terminalError = error;
    this.detachListeners();
    this.rejectAllPending(error);
    this.worker.terminate?.();
    this.documentsInvalidated = true;
    this.restoredDocuments.clear();
    // Only request-triggered runtime aborts may replace the worker. Transport or
    // unsolicited startup failures stay terminal so broken module loads cannot loop.
    // Never replay a failed request or warmup.
    if (replaceAbortedWorker && this.createWorker) {
      try {
        this.worker = this.createWorker();
        this.terminalError = null;
        this.attachListeners();
      } catch (replacementError) {
        this.terminalError = new Error(
          `${error.message} OCC worker replacement failed: ${describeTransportError(replacementError)}`,
        );
      }
    }
    this.onFatalError?.(this.terminalError ?? error);
  }

  private detachListeners() {
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleTransportError);
    this.worker.removeEventListener("messageerror", this.handleTransportError);
  }

  private rejectAllPending(error: Error) {
    for (const requestId of [...this.pending.keys()]) {
      this.rejectPending(requestId, error);
    }
  }

  private rejectPending(requestId: RequestId, error: Error) {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }

    this.pending.delete(requestId);
    this.clearPendingTimeout(pending);
    pending.reject(error);
  }

  private clearPendingTimeout(pending: PendingRequest) {
    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
    }
  }

  private createRequestId(prefix: string) {
    this.requestSequence += 1;
    return `request_occ_${prefix}_${this.requestSequence}` as RequestId;
  }
}

function describeTransportError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
