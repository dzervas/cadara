import { useMemo, useSyncExternalStore } from "react";
import {
  createLoadingStatus,
  selectInitialLoadingPhase,
} from "@/contracts/modeling/loading-status";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { WorkbenchDocumentActionResult } from "@/workbench/document/document-file-actions";
import { browserOccLoadingStatus } from "@/infrastructure/occ/browser-kernel-runtime";

export function useInitialLoadingPhase(
  service: Pick<ModelingService, "initialLoadingStatus">,
) {
  const engine = useSyncExternalStore(
    browserOccLoadingStatus.subscribe,
    browserOccLoadingStatus.getSnapshot,
    browserOccLoadingStatus.getSnapshot,
  );
  const engineProgress = useSyncExternalStore(
    browserOccLoadingStatus.subscribe,
    browserOccLoadingStatus.getProgress,
    browserOccLoadingStatus.getProgress,
  );
  const document = useSyncExternalStore(
    service.initialLoadingStatus.subscribe,
    service.initialLoadingStatus.getSnapshot,
    service.initialLoadingStatus.getSnapshot,
  );
  const documentProgress = useSyncExternalStore(
    service.initialLoadingStatus.subscribe,
    service.initialLoadingStatus.getProgress,
    service.initialLoadingStatus.getProgress,
  );
  // A tab switch selects a different source immediately; old promises can only
  // settle their old source, never overwrite the active document's presentation.
  const opening = useMemo(() => {
    const status = createLoadingStatus("ready");
    let request = 0;
    return {
      owner: service,
      status,
      async openDocument(
        operation: () => Promise<WorkbenchDocumentActionResult>,
      ) {
        const current = ++request;
        status.set("opening-document");
        try {
          const result = await operation();
          if (current === request) {
            status.set(
              result.status === "user-error" ||
                result.status === "unexpected-error"
                ? "failed"
                : "ready",
            );
          }
          return result;
        } catch (error) {
          if (current === request) status.set("failed");
          throw error;
        }
      },
    };
  }, [service]);
  const file = useSyncExternalStore(
    opening.status.subscribe,
    opening.status.getSnapshot,
    opening.status.getSnapshot,
  );
  const phase =
    file === "ready" ? selectInitialLoadingPhase(engine, document) : file;
  return {
    phase,
    // Measured progress belongs to the phase it was reported in.
    progress:
      file !== "ready"
        ? null
        : phase === "preparing-engine"
          ? engineProgress
          : phase === document
            ? documentProgress
            : null,
    filePhase: file,
    openDocument: opening.openDocument,
  };
}
