import type { ImportHistoryProbeCapabilities } from "@/contracts/import/capabilities";
import type { DocumentId } from "@/contracts/shared/ids";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createBrowserOccKernelAdapter } from "@/infrastructure/occ/browser-kernel-runtime";

let probeOrdinal = 0;

export function createBrowserOccImportHistoryProbe(): ImportHistoryProbeCapabilities {
  return createKernelHistoryProbeSession({
    createService() {
      probeOrdinal += 1;
      const documentId = `doc_occ_history_probe_${probeOrdinal}` as DocumentId;
      return createModelingService(createBrowserOccKernelAdapter(documentId), {
        currentDocumentId: documentId,
        documentRepository: null,
        operationHistoryStore: null,
      });
    },
  });
}
