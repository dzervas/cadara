import type { DocumentId } from "@/contracts/shared/ids";
import type {
  LocalSaveFailure,
  LocalSaveStatus,
  ModelingService,
} from "@/domain/modeling/modeling-service";

/** Open tabs own services; selecting a tab must not rebuild its native history. */
export class WorkbenchModelingServices {
  private readonly services = new Map<DocumentId, ModelingService>();
  private readonly localSaveSubscriptions = new Map<DocumentId, () => void>();
  private readonly localSaveStatusListeners = new Set<() => void>();
  /** Every open tab's status combined (cadara-8p7o). */
  private localSaveStatus: LocalSaveStatus = { saving: false, failure: null };
  private localSaveFailures: readonly LocalSaveFailure[] = [];
  /** Tabs closed while saving whose writes have not settled yet. */
  private closingTabsSaving = 0;
  /** Failures of closed tabs' last writes: reported, not shown. */
  private readonly closedTabFailures: LocalSaveFailure[] = [];

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
      this.localSaveSubscriptions.set(
        documentId,
        service.subscribeToLocalSaveStatus(() => this.updateLocalSaveStatus()),
      );
      this.updateLocalSaveStatus();
    }
    return service;
  }

  async retainOpenDocuments(documentIds: readonly DocumentId[]): Promise<void> {
    const open = new Set(documentIds);
    await Promise.all(
      [...this.services].map(async ([documentId, service]) => {
        if (open.has(documentId)) return;
        this.services.delete(documentId);
        this.localSaveSubscriptions.get(documentId)?.();
        this.localSaveSubscriptions.delete(documentId);
        // A closed tab's queued write still matters: leaving before it is
        // stored loses the tab's last edit.
        const { saving, failure: failureAtClose } = service.getLocalSaveStatus();
        if (saving) this.closingTabsSaving += 1;
        this.updateLocalSaveStatus();
        // Initialization may already be restoring in the shared worker. Drain it
        // before releasing native state, even if the tab closes during startup.
        const settled = service.waitForPersistence();
        service.dispose();
        try {
          await settled;
        } finally {
          if (saving) this.closingTabsSaving -= 1;
          const failure = service.getLocalSaveStatus().failure;
          // A failure seen while the tab was open was already reported.
          if (failure && failure !== failureAtClose) {
            this.closedTabFailures.push(failure);
          }
          this.updateLocalSaveStatus();
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

  /**
   * Saving while any open tab saves; the failure of the first open tab that
   * has an in-memory-only change, else the first stale bound file.
   */
  getLocalSaveStatus(): LocalSaveStatus {
    return this.localSaveStatus;
  }

  /**
   * Every open tab's failure, plus those of closed tabs' last writes; the
   * same array until one changes.
   */
  getLocalSaveFailures(): readonly LocalSaveFailure[] {
    return this.localSaveFailures;
  }

  subscribeToLocalSaveStatus(listener: () => void): () => void {
    this.localSaveStatusListeners.add(listener);
    return () => {
      this.localSaveStatusListeners.delete(listener);
    };
  }

  private updateLocalSaveStatus() {
    const statuses = [...this.services.values()].map((service) =>
      service.getLocalSaveStatus(),
    );
    const saving =
      this.closingTabsSaving > 0 || statuses.some((status) => status.saving);
    const failures = statuses.flatMap((status) =>
      status.failure ? [status.failure] : [],
    );
    const failure =
      failures.find((entry) => entry.target === "repository") ??
      failures[0] ??
      null;
    const allFailures = [...failures, ...this.closedTabFailures];
    const sameStatus =
      saving === this.localSaveStatus.saving &&
      failure === this.localSaveStatus.failure;
    const sameFailures =
      allFailures.length === this.localSaveFailures.length &&
      allFailures.every((entry, index) => entry === this.localSaveFailures[index]);
    if (sameStatus && sameFailures) return;
    if (!sameStatus) this.localSaveStatus = { saving, failure };
    if (!sameFailures) this.localSaveFailures = allFailures;
    for (const listener of this.localSaveStatusListeners) listener();
  }

  dispose(): void {
    // Replacement/unmount is not explicit close: another host can use the same
    // worker document. Only retainOpenDocuments releases shared native state.
    for (const unsubscribe of this.localSaveSubscriptions.values()) unsubscribe();
    this.localSaveSubscriptions.clear();
    for (const service of this.services.values()) service.dispose();
    this.services.clear();
    this.updateLocalSaveStatus();
  }
}
