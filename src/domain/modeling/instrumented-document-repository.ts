import type {
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import {
  classifyOkResult,
  measurePerformanceSpan,
  noopPerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import {
  isGeometryAssetDocumentRepository,
  isLocalFileSyncDocumentRepository,
  type DocumentRepository,
  type DocumentRepositoryLoadResult,
  type DocumentRepositoryMetadata,
  type DocumentRepositoryMutationResult,
  type DocumentRepositoryRestoreStatus,
  type GeometryAssetDocumentRepository,
  type LocalFileSyncDocumentRepository,
} from "@/domain/modeling/document-repository";

export function createInstrumentedDocumentRepository<
  T extends DocumentRepository | null,
>(
  repository: T,
  telemetry: PerformanceTelemetry = noopPerformanceTelemetry,
): T {
  if (!repository) {
    return repository;
  }

  const measure = <R>(
    operation: string,
    documentId: DocumentId | null,
    action: () => Promise<R>,
    resultAttributes?: (result: R) => PerformanceSpanAttributes,
  ) =>
    measurePerformanceSpan({
      telemetry,
      descriptor: {
        name: `Document repository ${operation}`,
        op: "cad.document.repository",
        attributes: {
          "cadara.seam": "document.repository",
          "cadara.operation": operation,
          ...metadataAttributes(
            documentId ? repository.getMetadata(documentId) : null,
          ),
        },
      },
      action,
      classifyResult: classifyOkResult,
      resultAttributes,
    });

  const wrapped: DocumentRepository = {
    load(input) {
      return measure(
        "load",
        input.documentId,
        () => repository.load(input),
        loadResultAttributes,
      );
    },
    mutate(input) {
      return measure(
        "mutate",
        input.documentId,
        () => repository.mutate(input),
        mutationResultAttributes,
      );
    },
    subscribe(documentId, listener) {
      return repository.subscribe(documentId, listener);
    },
    reset(documentId) {
      return measure(
        "reset",
        documentId,
        () => repository.reset(documentId),
        restoreStatusAttributes,
      );
    },
    getRestoreStatus(documentId) {
      return repository.getRestoreStatus(documentId);
    },
    getMetadata(documentId) {
      return repository.getMetadata(documentId);
    },
    getDurableHistoryAvailability(documentId) {
      return measure("getDurableHistoryAvailability", documentId, () =>
        repository.getDurableHistoryAvailability(documentId),
      );
    },
    undoDurableHistory(documentId) {
      return measure(
        "undoDurableHistory",
        documentId,
        () => repository.undoDurableHistory(documentId),
        nullableMutationResultAttributes,
      );
    },
    redoDurableHistory(documentId) {
      return measure(
        "redoDurableHistory",
        documentId,
        () => repository.redoDurableHistory(documentId),
        nullableMutationResultAttributes,
      );
    },
    getSketchDraftHistory(documentId, draftKey) {
      return measure("getSketchDraftHistory", documentId, () =>
        repository.getSketchDraftHistory(documentId, draftKey),
      );
    },
    saveSketchDraftHistory(documentId, draftKey, session) {
      return measure("saveSketchDraftHistory", documentId, () =>
        repository.saveSketchDraftHistory(documentId, draftKey, session),
      );
    },
    undoSketchDraftHistory(documentId, draftKey) {
      return measure("undoSketchDraftHistory", documentId, () =>
        repository.undoSketchDraftHistory(documentId, draftKey),
      );
    },
    redoSketchDraftHistory(documentId, draftKey) {
      return measure("redoSketchDraftHistory", documentId, () =>
        repository.redoSketchDraftHistory(documentId, draftKey),
      );
    },
    clearSketchDraftHistory(documentId, draftKey) {
      return measure("clearSketchDraftHistory", documentId, () =>
        repository.clearSketchDraftHistory(documentId, draftKey),
      );
    },
  };

  if (isGeometryAssetDocumentRepository(repository)) {
    Object.assign(wrapped, {
      getGeometryAssetBytes(hash: GeometryAssetHash) {
        return measure("getGeometryAssetBytes", null, () =>
          repository.getGeometryAssetBytes(hash),
        );
      },
      getGeometryAssetRecord(asset: GeometryAssetRecord) {
        return measure("getGeometryAssetRecord", null, () =>
          repository.getGeometryAssetRecord(asset),
        );
      },
    } satisfies Pick<
      GeometryAssetDocumentRepository,
      "getGeometryAssetBytes" | "getGeometryAssetRecord"
    >);
  }

  if (isLocalFileSyncDocumentRepository(repository)) {
    Object.assign(wrapped, {
      bindLocalFile(
        input: Parameters<LocalFileSyncDocumentRepository["bindLocalFile"]>[0],
      ) {
        return measure(
          "bindLocalFile",
          input.documentId,
          () => repository.bindLocalFile(input),
          (result) => ({
            "cadara.result": result.ok ? "success" : "failure",
          }),
        );
      },
      restoreLocalFileBinding(documentId: DocumentId) {
        return measure("restoreLocalFileBinding", documentId, () =>
          repository.restoreLocalFileBinding(documentId),
        );
      },
      getLocalFileSyncStatus(documentId: DocumentId) {
        return measure("getLocalFileSyncStatus", documentId, () =>
          repository.getLocalFileSyncStatus(documentId),
        );
      },
      subscribeToLocalFileSyncStatus(
        listener: Parameters<
          LocalFileSyncDocumentRepository["subscribeToLocalFileSyncStatus"]
        >[0],
      ) {
        return repository.subscribeToLocalFileSyncStatus(listener);
      },
    } satisfies Pick<
      LocalFileSyncDocumentRepository,
      | "bindLocalFile"
      | "restoreLocalFileBinding"
      | "getLocalFileSyncStatus"
      | "subscribeToLocalFileSyncStatus"
    >);
  }

  return wrapped as T;
}

function loadResultAttributes(
  result: DocumentRepositoryLoadResult,
): PerformanceSpanAttributes {
  return result.ok
    ? {
        ...metadataAttributes(result.metadata),
        "cadara.result": "success",
        "cadara.diagnostic_count": result.diagnostics?.length ?? 0,
        "cadara.asset_availability_count":
          result.assetAvailability?.length ??
          result.metadata.assetAvailability?.length ??
          0,
      }
    : restoreStatusAttributes(result.status);
}

function mutationResultAttributes(
  result: DocumentRepositoryMutationResult,
): PerformanceSpanAttributes {
  return result.ok
    ? {
        ...metadataAttributes(result.metadata),
        "cadara.result": "success",
        "cadara.diagnostic_count": result.diagnostics?.length ?? 0,
        "cadara.asset_availability_count":
          result.assetAvailability?.length ??
          result.metadata.assetAvailability?.length ??
          0,
      }
    : restoreStatusAttributes(result.status);
}

function nullableMutationResultAttributes(
  result: DocumentRepositoryMutationResult | null,
): PerformanceSpanAttributes {
  return result
    ? mutationResultAttributes(result)
    : { "cadara.result": "cancelled" };
}

function restoreStatusAttributes(
  status: DocumentRepositoryRestoreStatus,
): PerformanceSpanAttributes {
  return {
    "cadara.result": status.kind === "failed" ? "failure" : "success",
  };
}

function metadataAttributes(
  metadata: DocumentRepositoryMetadata | null,
): PerformanceSpanAttributes {
  return metadata
    ? {
        "cadara.repository_source": metadata.source,
        "cadara.repository_head_count": metadata.heads.length,
        "cadara.storage_kind": metadata.storageKey?.startsWith("file:")
          ? "filesystem"
          : "browser",
        "cadara.asset_availability_count":
          metadata.assetAvailability?.length ?? 0,
      }
    : {};
}
