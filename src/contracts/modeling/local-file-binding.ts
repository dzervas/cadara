import type { DocumentId } from "@/contracts/shared/ids";

export interface LocalFileBindingMetadata {
  documentId: DocumentId;
  fileName: string;
  storedAt: string;
}
