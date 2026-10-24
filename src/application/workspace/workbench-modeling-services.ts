import type { DocumentId } from "@/contracts/shared/ids";
import type { ModelingService } from "@/domain/modeling/modeling-service";

/** Open tabs own services; selecting a tab must not rebuild its native history. */
export class WorkbenchModelingServices {
  private readonly services = new Map<DocumentId, ModelingService>();

  private readonly createService: (documentId: DocumentId) => ModelingService;
  private readonly releaseDocumentResources?: (
    documentId: DocumentId,
  ) => Promise<void>;

  constructor(
    createService: (documentId: DocumentId) => ModelingService,
    releaseDocumentResources?: (documentId: DocumentId) => Promise<void>,
  ) {
    this.createService = createService;
    this.releaseDocumentResources = releaseDocumentResources;
  }

  get(documentId: DocumentId): ModelingService {
    let service = this.services.get(documentId);
    if (!service) {
      service = this.createService(documentId);
      this.services.set(documentId, service);
    }
    return service;
  }

  async retainOpenDocuments(documentIds: readonly DocumentId[]): Promise<void> {
    const open = new Set(documentIds);
    await Promise.all(
      [...this.services].map(async ([documentId, service]) => {
        if (open.has(documentId)) return;
        this.services.delete(documentId);
        // Initialization may already be restoring in the shared worker. Drain it
        // before releasing native state, even if the tab closes during startup.
        const settled = service.waitForPersistence();
        service.dispose();
        try {
          await settled;
        } finally {
          // A reopened tab can already own this worker document again.
          if (!this.services.has(documentId)) {
            await this.releaseDocumentResources?.(documentId);
          }
        }
      }),
    );
  }

  /** Every open document's local changes requested so far are persisted. */
  async waitForLocalChanges(): Promise<void> {
    await Promise.all(
      [...this.services.values()].map((service) =>
        service.waitForLocalChanges(),
      ),
    );
  }

  dispose(): void {
    // Replacement/unmount is not explicit close: another host can use the same
    // worker document. Only retainOpenDocuments releases shared native state.
    for (const service of this.services.values()) service.dispose();
    this.services.clear();
  }
}
