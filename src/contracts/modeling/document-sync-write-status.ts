import type { DocumentId } from "@/contracts/shared/ids";

import type { LocalFileBindingMetadata } from "@/contracts/modeling/local-file-binding";

export type DocumentSyncWriteStatus =
  | { kind: "idle"; documentId: DocumentId; sequence: number }
  | {
      kind: "binding-restored";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata;
    }
  | {
      kind: "syncing";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata;
    }
  | {
      kind: "synced";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata;
    }
  | {
      kind: "persistent-binding-unavailable";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata;
      message: string;
    }
  | {
      kind: "permission-required";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata;
    }
  | {
      kind: "permission-denied";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata;
      message: string;
    }
  | {
      kind: "failed";
      documentId: DocumentId;
      sequence: number;
      metadata: LocalFileBindingMetadata | null;
      message: string;
    };
