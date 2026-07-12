import typia from "typia";
import { describeUnknownError } from "@/contracts/errors";

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
} from "@/contracts/modeling/schema";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  BakedGeometryAssetReference,
  GeometryAssetBlobInput,
  GeometryAssetFormat,
} from "@/contracts/modeling/geometry-assets";
import type { BodyId, GeometryAssetId, RequestId, RevisionId } from "@/contracts/shared/ids";
import type {
  MeshExportAccuracy,
  MeshTriangle,
  StepWriterOptions,
} from "@/contracts/export/capabilities";
import type { SketchVectorExportModel } from "@/contracts/export/sketch-vector";
import type { DocumentExportDiagnostic } from "@/contracts/modeling/export";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
} from "@/contracts/solver/schema";
import type { PackedWorkspaceSnapshot } from "@/domain/modeling/occ/mesh-transport";
import type {
  OccNativeExactBrepPayload,
  OccNativeMeshExportPayload,
  OccNativeTopologyCapabilityProbeResult,
  OccNativeTopologyDiagnostic,
  OccNativeTopologyPayload,
} from "@/domain/modeling/occ/native-topology-payload";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";

export interface OccWorkerAssetConfig {
  mainWasm?: string;
  worker?: string;
}

interface AuthoredDocumentWorkerOperationBase {
  document: AuthoredModelDocument;
  diagnostics?: readonly ModelingDiagnostic[];
  assets?: readonly GeometryAssetBlobInput[];
}

export interface OccNativeTopologyUnavailableResult {
  kind: "nativeTopologyUnavailable";
  diagnostics: readonly OccNativeTopologyDiagnostic[];
  capability: OccNativeTopologyCapabilityProbeResult;
}

export type OccNativeTopologyWorkerResult<TPayload> =
  | {
      kind: "nativeTopologyPayload";
      payload: TPayload;
      diagnostics: readonly OccNativeTopologyDiagnostic[];
    }
  | OccNativeTopologyUnavailableResult;

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
    } & AuthoredDocumentWorkerOperationBase)
  | ({
      kind: "validateAuthoredModelDocument";
    } & AuthoredDocumentWorkerOperationBase)
  | {
      kind: "exportAuthoredModelDocument";
      documentId: AuthoredModelDocument["documentId"];
    }
  | {
      kind: "getDocumentSnapshot";
      request: GetDocumentSnapshotRequest;
      lodTierId?: OccTessellationTierId;
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
      kind: "evaluatePreview";
      request: EvaluatePreviewRequest;
    }
  | {
      kind: "resolveReference";
      request: ResolveReferenceRequest;
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

export type OccWorkerOperationResult =
  | void
  | AuthoredModelDocument
  | GetDocumentSnapshotResponse
  | ProjectSketchExternalReferencesResponse
  | CommitSketchResponse
  | CreateFeatureResponse
  | UpdateFeatureResponse
  | SetFeatureSuppressionResponse
  | DeleteFeatureResponse
  | DeleteDocumentTargetResponse
  | RenameBodyResponse
  | ReorderFeatureResponse
  | ReorderDocumentHistoryResponse
  | SetFeatureCursorResponse
  | AddDocumentVariableResponse
  | UpdateDocumentVariableResponse
  | EvaluatePreviewResponse
  | ResolveReferenceResponse
  | OccNativeTopologyCapabilityProbeResult
  | OccNativeTopologyWorkerResult<OccNativeTopologyPayload>
  | OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>
  | OccNativeTopologyWorkerResult<OccNativeMeshExportPayload>
  | MeshTriangle[]
  | SketchVectorExportModel
  | { payload: string }
  | { diagnostic: DocumentExportDiagnostic }
  | DocumentExportDiagnostic;

export type OccWorkerResponsePayload =
  | OccWorkerOperationResult
  | {
      contractVersion: GetDocumentSnapshotResponse["contractVersion"];
      snapshot:
        | GetDocumentSnapshotResponse["snapshot"]
        | PackedWorkspaceSnapshot;
    };

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
  | {
      kind: "invoked";
      requestId: RequestId;
      operation: OccWorkerOperation["kind"];
      payload?: OccWorkerResponsePayload;
    }
  | {
      kind: "resolveGeometryAsset";
      requestId: RequestId;
      reference: BakedGeometryAssetReference;
    }
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
  return occWorkerRequestEnvelopeValidator(value);
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
