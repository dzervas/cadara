import type {
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  PerformanceSpan,
  PerformanceSpanAttributes,
  PerformanceSpanResult,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import type { DocumentSyncWriteStatus } from "@/contracts/modeling/document-sync-write-status";
import {
  classifyOkResult,
  measurePerformanceSpan,
  noopPerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import { isGeometryAssetDocumentRepository, isLocalFileSyncDocumentRepository } from "@/core/modeling/document-repository";
import { type DocumentRepository, type DocumentRepositoryLoadResult, type DocumentRepositoryMetadata, type DocumentRepositoryMutationResult, type DocumentRepositoryRestoreStatus, type GeometryAssetDocumentRepository, type LocalFileSyncDocumentRepository } from "@/contracts/modeling/document-repository";

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
    ...(repository.preload
      ? {
          preload(documentId: DocumentId) {
            return repository.preload!(documentId);
          },
        }
      : {}),
    load(input) {
      return measure(
        "load",
        input.documentId,
        () => repository.load(input),
        loadResultAttributes,
      );
    },
    initialize(input) {
      return measure(
        "initialize",
        input.documentId,
        () => repository.initialize(input),
        mutationResultAttributes,
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
    undoDurableHistory(documentId, actionSequence) {
      return measure(
        "undoDurableHistory",
        documentId,
        () => repository.undoDurableHistory(documentId, actionSequence),
        nullableMutationResultAttributes,
      );
    },
    redoDurableHistory(documentId, actionSequence) {
      return measure(
        "redoDurableHistory",
        documentId,
        () => repository.redoDurableHistory(documentId, actionSequence),
        nullableMutationResultAttributes,
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
    // cadara-8p7o: the worker writes a bound file after the repository write;
    // one span per write, from its syncing status to its outcome. One shared
    // subscription while anyone listens, so spans are not duplicated.
    const localFileWrites = new Map<
      DocumentId,
      { span: PerformanceSpan; startedAt: number }
    >();
    const localFileSyncListeners = new Set<
      (status: DocumentSyncWriteStatus) => void
    >();
    let unsubscribeLocalFileSync: (() => void) | null = null;
    const localFileWriteResults: Partial<
      Record<DocumentSyncWriteStatus["kind"], PerformanceSpanResult>
    > = {
      synced: "success",
      failed: "failure",
      "permission-denied": "failure",
      // The binding was removed, or a new write replaced an unanswered one.
      idle: "cancelled",
      syncing: "cancelled",
    };
    const endLocalFileWrite = (
      documentId: DocumentId,
      result: PerformanceSpanResult,
    ) => {
      const running = localFileWrites.get(documentId);
      if (!running) return;
      localFileWrites.delete(documentId);
      running.span.end({
        "cadara.duration_ms": Number(
          (performance.now() - running.startedAt).toFixed(2),
        ),
        "cadara.result": result,
      });
    };
    const traceLocalFileWrite = (status: DocumentSyncWriteStatus) => {
      const result = localFileWriteResults[status.kind];
      if (result) endLocalFileWrite(status.documentId, result);
      if (status.kind !== "syncing") return;
      localFileWrites.set(status.documentId, {
        startedAt: performance.now(),
        span: telemetry.startSpan({
          name: "Document repository localFileWrite",
          op: "cad.document.repository",
          attributes: {
            "cadara.seam": "document.repository",
            "cadara.operation": "localFileWrite",
            "cadara.storage_kind": "filesystem",
          },
        }),
      });
    };

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
        localFileSyncListeners.add(listener);
        unsubscribeLocalFileSync ??= repository.subscribeToLocalFileSyncStatus(
          (status) => {
            traceLocalFileWrite(status);
            for (const next of localFileSyncListeners) next(status);
          },
        );
        return () => {
          localFileSyncListeners.delete(listener);
          if (localFileSyncListeners.size > 0) return;
          // Nobody hears the outcome of a running write any more.
          for (const documentId of [...localFileWrites.keys()]) {
            endLocalFileWrite(documentId, "cancelled");
          }
          unsubscribeLocalFileSync?.();
          unsubscribeLocalFileSync = null;
        };
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
