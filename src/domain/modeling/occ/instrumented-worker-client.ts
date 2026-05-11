import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { GeometryAssetBlobInput } from "@/contracts/modeling/geometry-assets";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { BodyId, RevisionId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  ExportCapabilities,
  MeshExportAccuracy,
  StepWriterOptions,
} from "@/contracts/export/capabilities";
import type { DocumentExportDiagnostic } from "@/contracts/modeling/export";
import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import {
  classifyOkResult,
  measurePerformanceSpan,
  noopPerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import type { FeatureBooleanOperation } from "@/contracts/modeling/schema";
import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
  CreateFeatureRequest,
  DeleteDocumentTargetRequest,
  DeleteFeatureRequest,
  EvaluatePreviewRequest,
  GetDocumentSnapshotRequest,
  RenameBodyRequest,
  ReorderDocumentHistoryRequest,
  ReorderFeatureRequest,
  ResolveReferenceRequest,
  SetFeatureCursorRequest,
  SetFeatureSuppressionRequest,
  UpdateDocumentVariableRequest,
  UpdateFeatureRequest,
} from "@/contracts/modeling/schema";
import type { ProjectSketchExternalReferencesRequest } from "@/contracts/solver/schema";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import type { OccWorkerAssetConfig } from "@/domain/modeling/occ/worker-protocol";
import type { OccWorkerSnapshotClient } from "@/domain/modeling/occ/worker-client";

export function createInstrumentedOccWorkerClient(
  client: OccWorkerSnapshotClient | null,
  telemetry: PerformanceTelemetry = noopPerformanceTelemetry,
): OccWorkerSnapshotClient | null {
  return client ? new InstrumentedOccWorkerClient(client, telemetry) : null;
}

class InstrumentedOccWorkerClient implements OccWorkerSnapshotClient {
  private readonly inner: OccWorkerSnapshotClient;
  private readonly telemetry: PerformanceTelemetry;

  constructor(inner: OccWorkerSnapshotClient, telemetry: PerformanceTelemetry) {
    this.inner = inner;
    this.telemetry = telemetry;
  }

  warmup(assets?: OccWorkerAssetConfig) {
    return this.measure("warmup", () => this.inner.warmup(assets));
  }

  preload(assets?: OccWorkerAssetConfig) {
    return this.measure("warmup", () => this.inner.preload(assets));
  }

  restoreAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
  ) {
    return this.measure("restoreAuthoredModelDocument", () =>
      this.inner.restoreAuthoredModelDocument(document, diagnostics, assets),
    );
  }

  validateAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
  ) {
    return this.measure("validateAuthoredModelDocument", () =>
      this.inner.validateAuthoredModelDocument(document, diagnostics, assets),
    );
  }

  exportAuthoredModelDocument(documentId: AuthoredModelDocument["documentId"]) {
    return this.measure("exportAuthoredModelDocument", () =>
      this.inner.exportAuthoredModelDocument(documentId),
    );
  }

  getDocumentSnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.measure(
      "getDocumentSnapshot",
      () => this.inner.getDocumentSnapshot(request, lodTierId),
      snapshotResultAttributes,
    );
  }

  projectSketchExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ) {
    return this.measure(
      "projectSketchExternalReferences",
      () => this.inner.projectSketchExternalReferences(request),
      diagnosticResultAttributes,
    );
  }

  commitSketch(request: CommitSketchRequest) {
    return this.measure(
      "commitSketch",
      () => this.inner.commitSketch(request),
      diagnosticResultAttributes,
    );
  }

  createFeature(request: CreateFeatureRequest) {
    return this.measure(
      "createFeature",
      () => this.inner.createFeature(request),
      diagnosticResultAttributes,
    );
  }

  updateFeature(request: UpdateFeatureRequest) {
    return this.measure(
      "updateFeature",
      () => this.inner.updateFeature(request),
      diagnosticResultAttributes,
    );
  }

  setFeatureSuppression(request: SetFeatureSuppressionRequest) {
    return this.measure(
      "setFeatureSuppression",
      () => this.inner.setFeatureSuppression(request),
      diagnosticResultAttributes,
    );
  }

  deleteFeature(request: DeleteFeatureRequest) {
    return this.measure(
      "deleteFeature",
      () => this.inner.deleteFeature(request),
      diagnosticResultAttributes,
    );
  }

  deleteTarget(request: DeleteDocumentTargetRequest) {
    return this.measure(
      "deleteTarget",
      () => this.inner.deleteTarget(request),
      diagnosticResultAttributes,
    );
  }

  renameBody(request: RenameBodyRequest) {
    return this.measure(
      "renameBody",
      () => this.inner.renameBody(request),
      diagnosticResultAttributes,
    );
  }

  reorderFeature(request: ReorderFeatureRequest) {
    return this.measure(
      "reorderFeature",
      () => this.inner.reorderFeature(request),
      diagnosticResultAttributes,
    );
  }

  reorderDocumentHistory(request: ReorderDocumentHistoryRequest) {
    return this.measure(
      "reorderDocumentHistory",
      () => this.inner.reorderDocumentHistory(request),
      diagnosticResultAttributes,
    );
  }

  setFeatureCursor(request: SetFeatureCursorRequest) {
    return this.measure(
      "setFeatureCursor",
      () => this.inner.setFeatureCursor(request),
      diagnosticResultAttributes,
    );
  }

  addDocumentVariable(request: AddDocumentVariableRequest) {
    return this.measure(
      "addDocumentVariable",
      () => this.inner.addDocumentVariable(request),
      diagnosticResultAttributes,
    );
  }

  updateDocumentVariable(request: UpdateDocumentVariableRequest) {
    return this.measure(
      "updateDocumentVariable",
      () => this.inner.updateDocumentVariable(request),
      diagnosticResultAttributes,
    );
  }

  evaluatePreview(request: EvaluatePreviewRequest) {
    return this.measure(
      "evaluatePreview",
      () => this.inner.evaluatePreview(request),
      diagnosticResultAttributes,
    );
  }

  resolveReference(request: ResolveReferenceRequest) {
    return this.measure(
      "resolveReference",
      () => this.inner.resolveReference(request),
      diagnosticResultAttributes,
    );
  }

  probeNativeTopologyKernelCapabilities(assets?: OccWorkerAssetConfig) {
    return this.measure("probeNativeTopologyKernelCapabilities", () =>
      this.inner.probeNativeTopologyKernelCapabilities(assets),
    );
  }

  buildNativeTopologySnapshot(
    request: GetDocumentSnapshotRequest,
    lodTierId?: OccTessellationTierId,
  ) {
    return this.measure(
      "buildNativeTopologySnapshot",
      () => this.inner.buildNativeTopologySnapshot(request, lodTierId),
      nativeTopologyResultAttributes,
    );
  }

  executeNativeFeatureHistoryRebuild(
    document: AuthoredModelDocument,
    diagnostics?: readonly ModelingDiagnostic[],
    assets?: readonly GeometryAssetBlobInput[],
    lodTierId?: OccTessellationTierId,
  ) {
    return this.measure(
      "executeNativeFeatureHistoryRebuild",
      () =>
        this.inner.executeNativeFeatureHistoryRebuild(
          document,
          diagnostics,
          assets,
          lodTierId,
        ),
      nativeTopologyResultAttributes,
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
    return this.measure(
      "buildNativeBooleanFeatureTransactionPayload",
      () =>
        this.inner.buildNativeBooleanFeatureTransactionPayload(
          documentId,
          baseRevisionId,
          leftBodyId,
          rightBodyId,
          operation,
          lodTierId,
        ),
      nativeTopologyResultAttributes,
    );
  }

  buildNativeMeshExportPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    target: DurableRef,
    options: MeshExportAccuracy,
  ) {
    return this.measure(
      "buildNativeMeshExportPayload",
      () =>
        this.inner.buildNativeMeshExportPayload(
          documentId,
          baseRevisionId,
          target,
          options,
        ),
      nativeTopologyResultAttributes,
    );
  }

  buildNativeExactBrepPayload(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
    target: DurableRef,
  ) {
    return this.measure(
      "buildNativeExactBrepPayload",
      () =>
        this.inner.buildNativeExactBrepPayload(
          documentId,
          baseRevisionId,
          target,
        ),
      nativeTopologyResultAttributes,
    );
  }

  async getExportCapabilities(
    documentId: AuthoredModelDocument["documentId"],
    baseRevisionId: RevisionId,
  ): Promise<ExportCapabilities | DocumentExportDiagnostic> {
    const capabilities = await this.measure("getExportCapabilities", () =>
      this.inner.getExportCapabilities(documentId, baseRevisionId),
    );

    if ("code" in capabilities) {
      return capabilities;
    }

    return {
      ...capabilities,
      mesh: {
        ...capabilities.mesh,
        tessellate: (target, options) =>
          this.measure("tessellateExportMesh", () =>
            Promise.resolve(capabilities.mesh.tessellate(target, options)),
          ),
      },
      brep: {
        ...capabilities.brep,
        writeStep: (target, options: StepWriterOptions) =>
          this.measure("writeStepExport", () =>
            Promise.resolve(capabilities.brep.writeStep(target, options)),
          ),
      },
      sketchVector: {
        ...capabilities.sketchVector,
        resolveSketchVectorModel: (target) =>
          this.measure("resolveSketchVectorExportModel", () =>
            Promise.resolve(
              capabilities.sketchVector.resolveSketchVectorModel(target),
            ),
          ),
      },
    };
  }

  dispose() {
    this.inner.dispose?.();
  }

  private measure<T>(
    operation: string,
    action: () => Promise<T>,
    resultAttributes?: (result: T) => PerformanceSpanAttributes,
  ) {
    return measurePerformanceSpan({
      telemetry: this.telemetry,
      descriptor: {
        name: `OCC worker ${operation}`,
        op: "cad.occ.worker",
        attributes: {
          "cadara.seam": "occ.worker",
          "cadara.operation": operation,
        },
      },
      action,
      classifyResult: classifyOkResult,
      resultAttributes,
    });
  }
}

function diagnosticResultAttributes(
  result: unknown,
): PerformanceSpanAttributes {
  const diagnostics =
    typeof result === "object" && result !== null && "diagnostics" in result
      ? (result as { diagnostics?: readonly unknown[] }).diagnostics
      : undefined;

  return {
    "cadara.diagnostic_count": diagnostics?.length ?? 0,
  };
}

function snapshotResultAttributes(result: unknown): PerformanceSpanAttributes {
  const snapshot =
    typeof result === "object" && result !== null && "snapshot" in result
      ? (
          result as {
            snapshot?: {
              document?: {
                features?: readonly unknown[];
                sketches?: readonly unknown[];
                bodies?: readonly unknown[];
                render?: { records?: readonly unknown[] };
                diagnostics?: readonly unknown[];
              };
            };
          }
        ).snapshot
      : null;

  return snapshot?.document
    ? {
        "cadara.feature_count": snapshot.document.features?.length ?? 0,
        "cadara.sketch_count": snapshot.document.sketches?.length ?? 0,
        "cadara.body_count": snapshot.document.bodies?.length ?? 0,
        "cadara.render_record_count":
          snapshot.document.render?.records?.length ?? 0,
        "cadara.diagnostic_count": snapshot.document.diagnostics?.length ?? 0,
      }
    : {};
}

function nativeTopologyResultAttributes(
  result: unknown,
): PerformanceSpanAttributes {
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok?: unknown }).ok === false
  ) {
    return { "cadara.result": "failure" as const };
  }

  return {};
}
