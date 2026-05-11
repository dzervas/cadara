import type {
  AuthoredModelDocument,
  AuthoredModelDocumentDiagnostic,
} from "@/contracts/modeling/authored-document";
import type {
  GeometryAssetAvailability,
  GeometryAssetBlobInput,
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type {
  DurableHistoryAvailability,
  PersistedSketchDraftSession,
} from "@/contracts/modeling/durable-history";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type { LocalFileBindingMetadata } from "@/domain/modeling/local-file-binding-store";
import type { DocumentSyncWriteStatus } from "@/domain/modeling/document-sync-worker-protocol";
import type { LocalFileSystemFileHandle } from "@/lib/local-file-system-access";

export type DocumentRepositoryChangeSource =
  | "local"
  | "peer"
  | "restore"
  | "seed"
  | "reset"
  | "undo"
  | "redo";

export interface DocumentRepositoryMetadata {
  documentId: DocumentId;
  heads: readonly string[];
  source: DocumentRepositoryChangeSource;
  storageKey?: string;
  assetAvailability?: readonly GeometryAssetAvailability[];
}

export type DocumentRepositoryRestoreStatus =
  | { kind: "pending"; documentId: DocumentId }
  | { kind: "seeded"; documentId: DocumentId }
  | { kind: "restored"; documentId: DocumentId }
  | { kind: "reset"; documentId: DocumentId }
  | {
      kind: "failed";
      documentId: DocumentId;
      diagnostic: AuthoredModelDocumentDiagnostic;
    };

export type DocumentRepositoryLoadResult =
  | {
      ok: true;
      document: AuthoredModelDocument;
      diagnostics?: ModelingDiagnostic[];
      assetAvailability?: readonly GeometryAssetAvailability[];
      status: DocumentRepositoryRestoreStatus;
      metadata: DocumentRepositoryMetadata;
    }
  | {
      ok: false;
      status: Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>;
    };

export type DocumentRepositoryMutationResult =
  | {
      ok: true;
      document: AuthoredModelDocument;
      diagnostics?: ModelingDiagnostic[];
      assetAvailability?: readonly GeometryAssetAvailability[];
      status: DocumentRepositoryRestoreStatus;
      metadata: DocumentRepositoryMetadata;
    }
  | {
      ok: false;
      status: Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>;
    };

export interface DocumentRepositoryChangeEvent {
  document: AuthoredModelDocument;
  diagnostics?: ModelingDiagnostic[];
  assetAvailability?: readonly GeometryAssetAvailability[];
  status: DocumentRepositoryRestoreStatus;
  metadata: DocumentRepositoryMetadata;
}

export interface DocumentRepository {
  load(input: {
    documentId: DocumentId;
    seedDocument: AuthoredModelDocument;
  }): Promise<DocumentRepositoryLoadResult>;
  mutate(input: {
    documentId: DocumentId;
    document: AuthoredModelDocument;
    assets?: readonly GeometryAssetBlobInput[];
  }): Promise<DocumentRepositoryMutationResult>;
  subscribe(
    documentId: DocumentId,
    listener: (event: DocumentRepositoryChangeEvent) => void,
  ): () => void;
  reset(documentId: DocumentId): Promise<DocumentRepositoryRestoreStatus>;
  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus;
  getMetadata(documentId: DocumentId): DocumentRepositoryMetadata;
  getDurableHistoryAvailability(
    documentId: DocumentId,
  ): Promise<DurableHistoryAvailability>;
  undoDurableHistory(
    documentId: DocumentId,
  ): Promise<DocumentRepositoryMutationResult | null>;
  redoDurableHistory(
    documentId: DocumentId,
  ): Promise<DocumentRepositoryMutationResult | null>;
  getSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
  ): Promise<{
    session: PersistedSketchDraftSession | null;
    availability: DurableHistoryAvailability;
  }>;
  saveSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
    session: PersistedSketchDraftSession,
  ): Promise<DurableHistoryAvailability>;
  undoSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
  ): Promise<{
    session: PersistedSketchDraftSession | null;
    availability: DurableHistoryAvailability;
  }>;
  redoSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
  ): Promise<{
    session: PersistedSketchDraftSession | null;
    availability: DurableHistoryAvailability;
  }>;
  clearSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
  ): Promise<void>;
}

export interface GeometryAssetDocumentRepository extends DocumentRepository {
  getGeometryAssetBytes(hash: GeometryAssetHash): Promise<Uint8Array | null>;
  getGeometryAssetRecord(
    asset: GeometryAssetRecord,
  ): Promise<Uint8Array | null>;
}

export function isGeometryAssetDocumentRepository(
  repository: DocumentRepository | null | undefined,
): repository is GeometryAssetDocumentRepository {
  return Boolean(repository && "getGeometryAssetBytes" in repository);
}

export type LocalFileBindingResult =
  | { ok: true; metadata: LocalFileBindingMetadata }
  | { ok: false; message: string };

export interface LocalFileSyncDocumentRepository extends DocumentRepository {
  bindLocalFile(input: {
    documentId: DocumentId;
    handle: LocalFileSystemFileHandle;
    metadata: LocalFileBindingMetadata;
  }): Promise<LocalFileBindingResult>;
  restoreLocalFileBinding(
    documentId: DocumentId,
  ): Promise<LocalFileBindingMetadata | null>;
  getLocalFileSyncStatus(
    documentId: DocumentId,
  ): Promise<DocumentSyncWriteStatus>;
  subscribeToLocalFileSyncStatus(
    listener: (status: DocumentSyncWriteStatus) => void,
  ): () => void;
}

export function isLocalFileSyncDocumentRepository(
  repository: DocumentRepository | null | undefined,
): repository is LocalFileSyncDocumentRepository {
  return Boolean(repository && "bindLocalFile" in repository);
}
