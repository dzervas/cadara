import type { RequestId } from "@/contracts/shared/ids";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";

/** A write receipt is retained by its effect request, not inferred from a global flush. */
export function createSketchPublicationReceipts() {
  const receipts = new Map<RequestId, DocumentRepositoryMutationResult>();
  return {
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
