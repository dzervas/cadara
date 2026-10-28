import type { RequestId, RevisionId } from "@/contracts/shared/ids";
import type { DocumentRepositoryMutationResult } from "@/contracts/modeling/document-repository";

/** A write receipt is retained by its effect request, not inferred from a global flush. */
export function createSketchPublicationReceipts() {
  const receipts = new Map<RequestId, DocumentRepositoryMutationResult>();
  const cursors = new Map<RevisionId, DocumentRepositoryMutationResult>();
  return {
    observeCursor(baseRevisionId: RevisionId, receipt: DocumentRepositoryMutationResult) { cursors.set(baseRevisionId, receipt); },
    takeCursor(baseRevisionId: RevisionId) { const receipt = cursors.get(baseRevisionId); cursors.delete(baseRevisionId); return receipt; },
    observe(requestId: RequestId, receipt: DocumentRepositoryMutationResult) {
      receipts.set(requestId, receipt);
    },
    take(requestId: RequestId) {
      const receipt = receipts.get(requestId);
      receipts.delete(requestId);
      return receipt;
    },
  };
}
