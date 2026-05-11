import type { AppError, AppResultAsync } from "@/contracts/errors";
import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import {
  measurePerformanceSpan,
  noopPerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import type {
  ModelingAddDocumentVariableInput,
  ModelingCommitSketchInput,
  ModelingCreateFeatureInput,
  ModelingDeleteFeatureInput,
  ModelingDeleteTargetInput,
  ModelingDocumentVariableMutationResult,
  ModelingExportDocumentInput,
  ModelingFeatureMutationResult,
  ModelingImportDocumentInput,
  ModelingRenameBodyInput,
  ModelingReorderDocumentHistoryInput,
  ModelingReorderFeatureInput,
  ModelingService,
  ModelingSetFeatureCursorInput,
  ModelingUpdateDocumentVariableInput,
  ModelingUpdateFeatureInput,
} from "@/domain/modeling/modeling-service/types";
import type {
  ModelingFeatureSuppressionResult,
  ModelingSetFeatureSuppressionInput,
} from "@/domain/modeling/modeling-service/types";

export function createInstrumentedModelingService(
  service: ModelingService,
  telemetry: PerformanceTelemetry = noopPerformanceTelemetry,
): ModelingService {
  return new InstrumentedModelingService(service, telemetry);
}

class InstrumentedModelingService implements ModelingService {
  private readonly inner: ModelingService;
  private readonly telemetry: PerformanceTelemetry;

  constructor(inner: ModelingService, telemetry: PerformanceTelemetry) {
    this.inner = inner;
    this.telemetry = telemetry;
  }

  get currentDocumentId() {
    return this.inner.currentDocumentId;
  }

  get sketchSolver() {
    return this.inner.sketchSolver;
  }

  dispose() {
    this.inner.dispose();
  }

  subscribeToDocumentChanges(
    listener: Parameters<ModelingService["subscribeToDocumentChanges"]>[0],
  ) {
    return this.inner.subscribeToDocumentChanges(listener);
  }

  waitForPersistence() {
    return this.measure("waitForPersistence", () =>
      this.inner.waitForPersistence(),
    );
  }

  getHistoryRestoreState() {
    return this.measure(
      "getHistoryRestoreState",
      () => this.inner.getHistoryRestoreState(),
      (result) => ({
        "cadara.result": result.kind === "failed" ? "failure" : "success",
        "cadara.diagnostic_count": result.diagnostics.length,
      }),
    );
  }

  resetOperationHistory() {
    return this.inner.resetOperationHistory();
  }

  setViewportLodTier(
    tierId: Parameters<ModelingService["setViewportLodTier"]>[0],
  ) {
    return this.inner.setViewportLodTier(tierId);
  }

  getCurrentDocumentSnapshot() {
    return this.measure(
      "getCurrentDocumentSnapshot",
      () => this.inner.getCurrentDocumentSnapshot(),
      snapshotAttributes,
    );
  }

  createNewDocument() {
    return this.measure(
      "createNewDocument",
      () => this.inner.createNewDocument(),
      okDiagnosticAttributes,
    );
  }

  importDocument(input: ModelingImportDocumentInput) {
    return this.measure(
      "importDocument",
      () => this.inner.importDocument(input),
      okDiagnosticAttributes,
    );
  }

  renameDocument(input: Parameters<ModelingService["renameDocument"]>[0]) {
    return this.measure(
      "renameDocument",
      () => this.inner.renameDocument(input),
      okDiagnosticAttributes,
    );
  }

  exportCurrentDocument() {
    return this.measure(
      "exportCurrentDocument",
      () => this.inner.exportCurrentDocument(),
      okDiagnosticAttributes,
    );
  }

  bindLocalFile(input: Parameters<ModelingService["bindLocalFile"]>[0]) {
    return this.measure(
      "bindLocalFile",
      () => this.inner.bindLocalFile(input),
      okDiagnosticAttributes,
    );
  }

  restoreLocalFileBinding() {
    return this.measure("restoreLocalFileBinding", () =>
      this.inner.restoreLocalFileBinding(),
    );
  }

  getLocalFileSyncStatus() {
    return this.measure("getLocalFileSyncStatus", () =>
      this.inner.getLocalFileSyncStatus(),
    );
  }

  subscribeToLocalFileSyncStatus(
    listener: Parameters<ModelingService["subscribeToLocalFileSyncStatus"]>[0],
  ) {
    return this.inner.subscribeToLocalFileSyncStatus(listener);
  }

  commitSketch(input: ModelingCommitSketchInput) {
    return this.measureAppResult(
      "commitSketch",
      () => this.inner.commitSketch(input),
      mutationAttributes,
    );
  }

  projectSketchExternalReferences(
    input: Parameters<ModelingService["projectSketchExternalReferences"]>[0],
  ) {
    return this.measure(
      "projectSketchExternalReferences",
      () => this.inner.projectSketchExternalReferences(input),
      diagnosticAttributes,
    );
  }

  addDocumentVariable(input: ModelingAddDocumentVariableInput) {
    return this.measureAppResult(
      "addDocumentVariable",
      () => this.inner.addDocumentVariable(input),
      mutationAttributes,
    );
  }

  updateDocumentVariable(input: ModelingUpdateDocumentVariableInput) {
    return this.measureAppResult(
      "updateDocumentVariable",
      () => this.inner.updateDocumentVariable(input),
      mutationAttributes,
    );
  }

  createFeature(input: ModelingCreateFeatureInput) {
    return this.measureAppResult(
      "createFeature",
      () => this.inner.createFeature(input),
      mutationAttributes,
    );
  }

  updateFeature(input: ModelingUpdateFeatureInput) {
    return this.measureAppResult(
      "updateFeature",
      () => this.inner.updateFeature(input),
      mutationAttributes,
    );
  }

  setFeatureSuppression(input: ModelingSetFeatureSuppressionInput) {
    return this.measureAppResult(
      "setFeatureSuppression",
      () => this.inner.setFeatureSuppression(input),
      mutationAttributes,
    );
  }

  deleteFeature(input: ModelingDeleteFeatureInput) {
    return this.measureAppResult(
      "deleteFeature",
      () => this.inner.deleteFeature(input),
      mutationAttributes,
    );
  }

  deleteTarget(input: ModelingDeleteTargetInput) {
    return this.measureAppResult(
      "deleteTarget",
      () => this.inner.deleteTarget(input),
      mutationAttributes,
    );
  }

  renameBody(input: ModelingRenameBodyInput) {
    return this.measureAppResult(
      "renameBody",
      () => this.inner.renameBody(input),
      mutationAttributes,
    );
  }

  reorderFeature(input: ModelingReorderFeatureInput) {
    return this.measureAppResult(
      "reorderFeature",
      () => this.inner.reorderFeature(input),
      mutationAttributes,
    );
  }

  reorderDocumentHistory(input: ModelingReorderDocumentHistoryInput) {
    return this.measureAppResult(
      "reorderDocumentHistory",
      () => this.inner.reorderDocumentHistory(input),
      mutationAttributes,
    );
  }

  setFeatureCursor(input: ModelingSetFeatureCursorInput) {
    return this.measureAppResult(
      "setFeatureCursor",
      () => this.inner.setFeatureCursor(input),
      mutationAttributes,
    );
  }

  evaluatePreview(input: Parameters<ModelingService["evaluatePreview"]>[0]) {
    return this.measure(
      "evaluatePreview",
      () => this.inner.evaluatePreview(input),
      diagnosticAttributes,
    );
  }

  exportDocument(input: ModelingExportDocumentInput) {
    return this.measure(
      "exportDocument",
      () => this.inner.exportDocument(input),
      okDiagnosticAttributes,
    );
  }

  resolveReference(target: Parameters<ModelingService["resolveReference"]>[0]) {
    return this.measure(
      "resolveReference",
      () => this.inner.resolveReference(target),
      diagnosticAttributes,
    );
  }

  private measure<T>(
    operation: string,
    action: () => Promise<T>,
    resultAttributes?: (result: T) => PerformanceSpanAttributes,
  ) {
    return measurePerformanceSpan({
      telemetry: this.telemetry,
      descriptor: {
        name: `Modeling service ${operation}`,
        op: "cad.modeling.service",
        attributes: {
          "cadara.seam": "modeling.service",
          "cadara.operation": operation,
        },
      },
      action,
      classifyResult(result) {
        return isFailedOkResult(result) ? "failure" : "success";
      },
      resultAttributes,
    });
  }

  private measureAppResult<T>(
    operation: string,
    action: () => AppResultAsync<T>,
    resultAttributes?: (result: T) => PerformanceSpanAttributes,
  ): AppResultAsync<T> {
    const startedAt = getPerformanceNow();
    const span = this.telemetry.startSpan({
      name: `Modeling service ${operation}`,
      op: "cad.modeling.service",
      attributes: {
        "cadara.seam": "modeling.service",
        "cadara.operation": operation,
      },
    });

    return action()
      .map((value) => {
        span.end({
          ...resultAttributes?.(value),
          "cadara.duration_ms": roundDuration(getPerformanceNow() - startedAt),
          "cadara.result": "success",
        });
        return value;
      })
      .mapErr((error: AppError) => {
        span.end({
          "cadara.duration_ms": roundDuration(getPerformanceNow() - startedAt),
          "cadara.result": resultForAppError(error),
          "cadara.diagnostic_count": Number(
            error.code === "modeling/diagnostic",
          ),
        });
        return error;
      });
  }
}

function snapshotAttributes(
  result: Awaited<ReturnType<ModelingService["getCurrentDocumentSnapshot"]>>,
): PerformanceSpanAttributes {
  return {
    "cadara.feature_count": result.document.features.length,
    "cadara.sketch_count": result.document.sketches.length,
    "cadara.body_count": result.document.bodies.length,
    "cadara.render_record_count": result.document.render.records.length,
    "cadara.diagnostic_count": result.document.diagnostics.length,
    "cadara.repository_head_count": result.provenance?.repositoryHeads.length,
    "cadara.repository_source": result.provenance?.repositorySource ?? null,
  };
}

function mutationAttributes(
  result:
    | ModelingFeatureMutationResult
    | ModelingFeatureSuppressionResult
    | ModelingDocumentVariableMutationResult
    | { diagnostics: readonly unknown[] },
): PerformanceSpanAttributes {
  return {
    "cadara.diagnostic_count": result.diagnostics.length,
  };
}

function diagnosticAttributes(result: {
  diagnostics?: readonly unknown[];
}): PerformanceSpanAttributes {
  return {
    "cadara.diagnostic_count": result.diagnostics?.length ?? 0,
  };
}

function okDiagnosticAttributes(result: {
  ok?: boolean;
  diagnostics?: readonly unknown[];
}): PerformanceSpanAttributes {
  return {
    "cadara.result": result.ok === false ? "failure" : "success",
    "cadara.diagnostic_count": result.diagnostics?.length ?? 0,
  };
}

function isFailedOkResult(result: unknown) {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok?: unknown }).ok === false
  );
}

function resultForAppError(error: AppError) {
  if (error.code === "modeling/revision-rejected") {
    return "rejected";
  }

  if (error.code === "modeling/diagnostic") {
    return "rejected";
  }

  return "failure";
}

function getPerformanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundDuration(durationMs: number) {
  return Number(durationMs.toFixed(2));
}
