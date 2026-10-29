import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from "@/contracts/modeling/authored-document";
import type { GeometryAssetAvailability, GeometryAssetBlobInput, GeometryAssetHash, GeometryAssetRecord } from "@/contracts/modeling/geometry-assets";
import type { DurableHistoryAvailability } from "@/contracts/modeling/durable-history";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type { LocalFileBindingMetadata } from "@/contracts/modeling/local-file-binding";
import type { DocumentSyncWriteStatus } from "@/contracts/modeling/document-sync-write-status";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";

export type DocumentRepositoryChangeSource =
  | "local"
  | "peer"
  | "restore"
  | "seed"
  | "reset"
  | "undo"
  | "redo";

export interface DocumentRepositoryMetadata {
  actorId: string;
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

export interface DocumentRepositoryAppliedLiveState {
  document: AuthoredModelDocument;
  diagnostics?: ModelingDiagnostic[];
  assetAvailability?: readonly GeometryAssetAvailability[];
  metadata: DocumentRepositoryMetadata;
}

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
      appliedLive?: DocumentRepositoryAppliedLiveState;
    };

/** A durability failure may carry transaction-specific `appliedLive` evidence.
 * A failure reason by itself never proves that the attempted mutation was applied.
 * Its matching action ledger is retained; further writes fail closed until load retries persistence.
 */
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
      appliedLive?: DocumentRepositoryAppliedLiveState;
    };

export interface DocumentRepositoryChangeEvent {
  document: AuthoredModelDocument;
  diagnostics?: ModelingDiagnostic[];
  assetAvailability?: readonly GeometryAssetAvailability[];
  status: DocumentRepositoryRestoreStatus;
  metadata: DocumentRepositoryMetadata;
}

export interface DocumentRepository {
  /** Starts reading the stored copy of the document and resolves without
   * waiting for that read, so the load that follows overlaps it with
   * preparing its seed document. That load reports any failure of the read. */
  preload?(documentId: DocumentId): Promise<void>;
  /** The open that loaded the document has shown it. A load answered
   * before the stored copy was read in full (a materialized-document cache)
   * reads it now; until then, any later request for the document reads it
   * first, so it waits for that read instead. */
  settleLoad?(documentId: DocumentId): void;
  /** Also explicitly retries unresolved durability in the current editing session. */
  load(input: {
    documentId: DocumentId;
    seedDocument: AuthoredModelDocument;
  }): Promise<DocumentRepositoryLoadResult>;
  initialize(input: {
    documentId: DocumentId;
    document: AuthoredModelDocument;
    assets?: readonly GeometryAssetBlobInput[];
  }): Promise<DocumentRepositoryMutationResult>;
  mutate(input: {
    documentId: DocumentId;
    document: AuthoredModelDocument;
    expected: AuthoredModelDocument;
    label?: string;
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
    actionSequence?: number,
  ): Promise<DocumentRepositoryMutationResult | null>;
  redoDurableHistory(
    documentId: DocumentId,
    actionSequence?: number,
  ): Promise<DocumentRepositoryMutationResult | null>;
}

export interface GeometryAssetDocumentRepository extends DocumentRepository {
  getGeometryAssetBytes(hash: GeometryAssetHash): Promise<Uint8Array | null>;
  getGeometryAssetRecord(
    asset: GeometryAssetRecord,
  ): Promise<Uint8Array | null>;
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
