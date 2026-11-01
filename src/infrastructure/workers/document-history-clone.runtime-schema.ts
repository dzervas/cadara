import typia from "typia";
import type { DocumentId, RequestId } from "@/contracts/shared/ids";

/**
 * Copies a part document with its whole Automerge change history under a new
 * document identity (Move to project). The copy has no file binding and no
 * browser-local undo stack: both are keyed by the document identity.
 */
export interface DocumentHistoryCloneRequest {
  kind: "cloneWithHistory";
  requestId: RequestId;
  documentId: DocumentId;
  targetDocumentId: DocumentId;
  /** The source's URL in the tabs' shared URL store (see the `load` request). */
  storageKey?: string | null;
}

export interface DocumentHistoryCloneResponse {
  kind: "clonedWithHistory";
  requestId: RequestId;
  /** The persisted copy's Automerge URL. */
  storageKey: string;
}

const documentHistoryCloneRequestValidator =
  typia.createValidateEquals<DocumentHistoryCloneRequest>();
const documentHistoryCloneResponseValidator =
  typia.createValidateEquals<DocumentHistoryCloneResponse>();

export function validateDocumentHistoryCloneRequest(value: unknown) {
  return documentHistoryCloneRequestValidator(value);
}

export function validateDocumentHistoryCloneResponse(value: unknown) {
  return documentHistoryCloneResponseValidator(value);
}
