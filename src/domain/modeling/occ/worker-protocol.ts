import { z } from "zod";

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
import type { GeometryAssetBlobInput } from "@/contracts/modeling/geometry-assets";
import type { BodyId, RequestId, RevisionId } from "@/contracts/shared/ids";
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

const requestIdSchema = z.string().min(1);

export const occWorkerAssetConfigSchema = z.object({
  mainWasm: z.string().min(1).optional(),
  worker: z.string().min(1).optional(),
});

export type OccWorkerAssetConfig = z.infer<typeof occWorkerAssetConfigSchema>;

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
    };

export type OccWorkerResponse =
  | {
      kind: "invoked";
      requestId: RequestId;
      operation: OccWorkerOperation["kind"];
      payload?: OccWorkerResponsePayload;
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

export const occWorkerRequestEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("invoke"),
    requestId: requestIdSchema,
    operation: z
      .object({
        kind: z.string().min(1),
      })
      .passthrough(),
  }),
  z.object({
    kind: z.literal("cancel"),
    requestId: requestIdSchema,
    cancelsRequestId: requestIdSchema,
  }),
]);

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
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "OCC worker request failed.",
    },
  };
}
