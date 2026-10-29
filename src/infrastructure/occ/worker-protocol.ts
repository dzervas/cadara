import type { OccNativeTopologyWorkerResult } from "@/contracts/modeling/kernel-worker-result";
import typia from "typia";
import { describeUnknownError } from "@/contracts/errors";

import type { AddDocumentVariableRequest, AddDocumentVariableResponse, CommitSketchRequest, CommitSketchResponse, CreateFeatureRequest, CreateFeatureResponse, DeleteDocumentTargetRequest, DeleteDocumentTargetResponse, DeleteFeatureRequest, DeleteFeatureResponse, EvaluatePreviewRequest, EvaluatePreviewResponse, FeatureBooleanOperation, GetDocumentSnapshotRequest, GetDocumentSnapshotResponse, ModelingDiagnostic, ModelingOperationResult, RenameBodyRequest, RenameBodyResponse, RenameDocumentRequest, RenameFeatureRequest, RenameSketchRequest, SetBodyAppearanceRequest, SetBodyAppearanceResponse, ReorderDocumentHistoryRequest, ReorderDocumentHistoryResponse, ReorderFeatureRequest, ReorderFeatureResponse, ResolveReferenceRequest, ResolveReferenceResponse, SetFeatureCursorRequest, SetFeatureCursorResponse, SetFeatureSuppressionRequest, SetFeatureSuppressionResponse, UpdateDocumentVariableRequest, UpdateDocumentVariableResponse, RemoveDocumentVariableRequest, RemoveDocumentVariableResponse, UpdateFeatureRequest, UpdateFeatureResponse } from "@/contracts/modeling/schema";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { MeasureTopologyRequest, MeasureTopologyResponse } from "@/contracts/modeling/topology-measure";
import type { AuthoredDocumentRestoreOptions } from "@/contracts/modeling/adapter";
import type { OccWorkerRestoreProgressMessage } from "@/infrastructure/occ/worker-restore-progress.runtime-schema";
import type { OccWorkerEngineDownloadProgressMessage } from "@/infrastructure/occ/worker-engine-download-progress.runtime-schema";
import type { BakedGeometryAssetReference, GeometryAssetBlobInput, GeometryAssetFormat } from "@/contracts/modeling/geometry-assets";
import type { BodyId, GeometryAssetId, RequestId, RevisionId } from "@/contracts/shared/ids";
import type { MeshExportAccuracy, MeshTriangle, StepWriterOptions } from "@/contracts/export/capabilities";
import type { SketchVectorExportModel } from "@/contracts/export/sketch-vector";
import type { DocumentExportDiagnostic } from "@/contracts/modeling/export";
import type { DurableRef } from "@/contracts/shared/references";
import type { NeutralCurveJoinRequest, NeutralCurveJoinResult, NeutralCurveQueryRequest, NeutralCurveQueryResult, NeutralCurveSelfIntersectionRequest } from "@/contracts/modeling/neutral-curve-query";
import type { DeriveSketchRegionsRequest, DeriveSketchRegionsResponse, ProjectSketchExternalReferencesRequest, ProjectSketchExternalReferencesResponse, QuerySketchEditIntersectionsRequest, QuerySketchEditIntersectionsResponse, QuerySketchSnapIntersectionsRequest, QuerySketchSnapIntersectionsResponse } from "@/contracts/solver/schema";
import type { OccNativeExactBrepPayload, OccNativeTopologyCapabilityProbeResult } from "@/contracts/modeling/kernel-payloads";
import type { OccNativeMeshExportPayload, OccNativeTopologyPayload } from "@/infrastructure/occ/native-topology-payload";
import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";

export interface OccWorkerAssetConfig {
  mainWasm?: string;
  worker?: string;
}

interface AuthoredDocumentWorkerOperationBase {
  document: AuthoredModelDocument;
  diagnostics?: readonly ModelingDiagnostic[];
  assets?: readonly GeometryAssetBlobInput[];
}

export type OccWorkerOperation =
  | {
      kind: "warmup";
      assets?: OccWorkerAssetConfig;
    }
  | {
      kind: "probeNativeTopologyKernelCapabilities";
      assets?: OccWorkerAssetConfig;
    }
  | ({
      kind: "restoreAuthoredModelDocument";
      // Progress returns as restoreProgress messages for this request, sent
      // only when reportProgress says the caller listens.
      options?: Omit<AuthoredDocumentRestoreOptions, "onProgress"> & {
        reportProgress?: boolean;
      };
    } & AuthoredDocumentWorkerOperationBase)
  | ({
      kind: "validateAuthoredModelDocument";
    } & AuthoredDocumentWorkerOperationBase)
  | {
      kind: "exportAuthoredModelDocument";
      documentId: AuthoredModelDocument["documentId"];
    }
  | {
      kind: "releaseDocument";
      documentId: AuthoredModelDocument["documentId"];
    }
  | {
      kind: "getDocumentSnapshot";
      request: GetDocumentSnapshotRequest;
      lodTierId?: OccTessellationTierId;
    }
  | {
      /**
       * Background LOD refinement (cadara-se2): runs between the serial
       * requests, one body or sketch per step, instead of as one request.
       */
      kind: "refineSnapshotLod";
      request: GetDocumentSnapshotRequest;
      lodTierId: OccTessellationTierId;
    }
  | {
      kind: "buildNativeTopologySnapshot";
      request: GetDocumentSnapshotRequest;
      lodTierId?: OccTessellationTierId;
    }
  | ({
      kind: "executeNativeFeatureHistoryRebuild";
      lodTierId?: OccTessellationTierId;
    } & AuthoredDocumentWorkerOperationBase)
  | {
      kind: "buildNativeBooleanFeatureTransactionPayload";
      documentId: AuthoredModelDocument["documentId"];
      baseRevisionId: RevisionId;
      leftBodyId: BodyId;
      rightBodyId: BodyId;
      operation: Exclude<FeatureBooleanOperation, "newBody">;
      lodTierId?: OccTessellationTierId;
    }
  | {
      kind: "projectSketchExternalReferences";
      request: ProjectSketchExternalReferencesRequest;
    }
  | {
      kind: "queryNeutralCurves";
      request: NeutralCurveQueryRequest;
    }
  | {
      kind: "queryNeutralCurveSelfIntersections";
      request: NeutralCurveSelfIntersectionRequest;
    }
  | {
      kind: "queryNeutralCurveJoin";
      request: NeutralCurveJoinRequest;
    }
  | {
      kind: "deriveSketchRegions";
      request: DeriveSketchRegionsRequest;
    }
  | {
      kind: "querySketchEditIntersections";
      request: QuerySketchEditIntersectionsRequest;
    }
  | {
      kind: "querySketchSnapIntersections";
      request: QuerySketchSnapIntersectionsRequest;
    }
  | {
      kind: "commitSketch";
      request: CommitSketchRequest;
    }
  | {
      kind: "createFeature";
      request: CreateFeatureRequest;
    }
  | {
      kind: "updateFeature";
      request: UpdateFeatureRequest;
    }
  | {
      kind: "setFeatureSuppression";
      request: SetFeatureSuppressionRequest;
    }
  | {
      kind: "deleteFeature";
      request: DeleteFeatureRequest;
    }
  | {
      kind: "deleteTarget";
      request: DeleteDocumentTargetRequest;
    }
  | {
      kind: "renameBody";
      request: RenameBodyRequest;
    }
  | {
      kind: "renameFeature";
      request: RenameFeatureRequest;
    }
  | {
      kind: "renameSketch";
      request: RenameSketchRequest;
    }
  | {
      kind: "renameDocument";
      request: RenameDocumentRequest;
    }
  | {
      kind: "setBodyAppearance";
      request: SetBodyAppearanceRequest;
    }
  | {
      kind: "reorderFeature";
      request: ReorderFeatureRequest;
    }
  | {
      kind: "reorderDocumentHistory";
      request: ReorderDocumentHistoryRequest;
    }
  | {
      kind: "setFeatureCursor";
      request: SetFeatureCursorRequest;
    }
  | {
      kind: "addDocumentVariable";
      request: AddDocumentVariableRequest;
    }
  | {
      kind: "updateDocumentVariable";
      request: UpdateDocumentVariableRequest;
    }
  | {
      kind: "removeDocumentVariable";
      request: RemoveDocumentVariableRequest;
    }
  | {
      kind: "evaluatePreview";
      request: EvaluatePreviewRequest;
    }
  | {
      kind: "resolveReference";
      request: ResolveReferenceRequest;
    }
  | {
      kind: "measureTopology";
      request: MeasureTopologyRequest;
    }
  | {
      kind: "tessellateExportMesh";
      documentId: AuthoredModelDocument["documentId"];
      baseRevisionId: RevisionId;
      target: DurableRef;
      options: MeshExportAccuracy;
    }
  | {
      kind: "buildNativeMeshExportPayload";
      documentId: AuthoredModelDocument["documentId"];
      baseRevisionId: RevisionId;
      target: DurableRef;
      options: MeshExportAccuracy;
    }
  | {
      kind: "buildNativeExactBrepPayload";
      documentId: AuthoredModelDocument["documentId"];
      baseRevisionId: RevisionId;
      target: DurableRef;
    }
  | {
      kind: "writeStepExport";
      documentId: AuthoredModelDocument["documentId"];
      baseRevisionId: RevisionId;
      target: DurableRef;
      options: StepWriterOptions;
    }
  | {
      kind: "resolveSketchVectorExportModel";
      documentId: AuthoredModelDocument["documentId"];
      baseRevisionId: RevisionId;
      target: DurableRef;
    };

/** A newer refinement of the same document, or its release, supersedes one. */
export type OccSnapshotLodRefinementOutcome = "completed" | "superseded";

export type OccWorkerOperationResult =
  | void
  | OccSnapshotLodRefinementOutcome
  | AuthoredModelDocument
  | GetDocumentSnapshotResponse
  | ProjectSketchExternalReferencesResponse
  | NeutralCurveQueryResult
  | NeutralCurveJoinResult
  | DeriveSketchRegionsResponse
  | QuerySketchEditIntersectionsResponse
  | QuerySketchSnapIntersectionsResponse
  | CommitSketchResponse
  | CreateFeatureResponse
  | UpdateFeatureResponse
  | SetFeatureSuppressionResponse
  | DeleteFeatureResponse
  | DeleteDocumentTargetResponse
  | RenameBodyResponse
  | ModelingOperationResult
  | SetBodyAppearanceResponse
  | ReorderFeatureResponse
  | ReorderDocumentHistoryResponse
  | SetFeatureCursorResponse
  | AddDocumentVariableResponse
  | UpdateDocumentVariableResponse
  | RemoveDocumentVariableResponse
  | EvaluatePreviewResponse
  | ResolveReferenceResponse
  | MeasureTopologyResponse
  | OccNativeTopologyCapabilityProbeResult
  | OccNativeTopologyWorkerResult<OccNativeTopologyPayload>
  | OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>
  | OccNativeTopologyWorkerResult<OccNativeMeshExportPayload>
  | MeshTriangle[]
  | SketchVectorExportModel
  | { payload: string }
  | { diagnostic: DocumentExportDiagnostic }
  | DocumentExportDiagnostic;

export type OccWorkerRequest =
  | {
      kind: "invoke";
      requestId: RequestId;
      operation: OccWorkerOperation;
    }
  | {
      kind: "cancel";
      requestId: RequestId;
      cancelsRequestId: RequestId;
    }
  | {
      kind: "resolveGeometryAssetResult";
      requestId: RequestId;
      assetId: GeometryAssetId;
      asset: { bytes: Uint8Array; format: GeometryAssetFormat } | null;
    };

export type OccWorkerResponse =
  | { kind: "fatal"; error: { message: string } }
  | {
      kind: "invoked";
      requestId: RequestId;
      operation: OccWorkerOperation["kind"];
      payload?: OccWorkerOperationResult;
    }
  | {
      kind: "resolveGeometryAsset";
      requestId: RequestId;
      reference: BakedGeometryAssetReference;
    }
  | OccWorkerRestoreProgressMessage
  | OccWorkerEngineDownloadProgressMessage
  | OccWorkerFailureMessage;

export interface OccWorkerFailureMessage {
  kind: "failure";
  requestId: RequestId;
  error: {
    message: string;
    code:
      | "occ-worker-initialization-failed"
      | "occ-worker-request-failed"
      | "occ-worker-request-cancelled";
  };
}

const occWorkerRequestEnvelopeValidator =
  typia.createValidateEquals<OccWorkerRequest>();

export function validateOccWorkerRequestEnvelope(value: unknown) {
  const validated = occWorkerRequestEnvelopeValidator(value);
  if (validated.success || typeof value !== "object" || value === null) {
    return validated;
  }

  const envelope = value as Record<string, unknown>;
  const operation =
    envelope.kind === "invoke" &&
    typeof envelope.operation === "object" &&
    envelope.operation !== null
      ? (envelope.operation as Record<string, unknown>)
      : null;
  const request =
    operation?.kind === "evaluatePreview" &&
    typeof operation.request === "object" &&
    operation.request !== null
      ? (operation.request as Record<string, unknown>)
      : null;
  if (
    !request ||
    !(request.replacesFeatureId === null ||
      typeof request.replacesFeatureId === "string")
  ) {
    return validated;
  }

  // Typia's exact validator can lag newly-added nested request fields during
  // incremental worker transforms. Validate the legacy projection, while the
  // explicit check above owns the new field until the generated validator catches up.
  const projected = structuredClone(envelope);
  const projectedOperation = projected.operation as Record<string, unknown>;
  const projectedRequest = projectedOperation.request as Record<string, unknown>;
  delete projectedRequest.replacesFeatureId;
  const projectedValidation = occWorkerRequestEnvelopeValidator(projected);
  return projectedValidation.success
    ? { ...projectedValidation, data: value as OccWorkerRequest }
    : validated;
}

export function normalizeOccWorkerFailure(
  requestId: RequestId,
  error: unknown,
  code: OccWorkerFailureMessage["error"]["code"] = "occ-worker-request-failed",
): OccWorkerFailureMessage {
  return {
    kind: "failure",
    requestId,
    error: {
      code,
      message: describeUnknownError(error, "OCC worker request failed."),
    },
  };
}

/** Emscripten aborts poison the entire WASM instance, not just one request. */
export function isOccRuntimeAbort(error: unknown): boolean {
  const message = describeUnknownError(error, "");
  return error instanceof WebAssembly.RuntimeError ||
    /\babort(?:ed)?\b|out[ -]of[ -]memory|\boom\b|cannot enlarge memory|memory access out of bounds|array buffer allocation failed|memory allocation failed|maximum memory size exceeded/i.test(message);
}
