import type { DocumentId } from "@/contracts/shared/ids";

type EnsurePartReady = (docId: DocumentId) => Promise<void>;

/** Project discovery can start before the shell registers its document owner. */
export class WorkbenchPartReadiness {
  private owner: EnsurePartReady | null = null;
  private disposed = false;
  private readonly waiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>();

  register(owner: EnsurePartReady) {
    this.owner = owner;
    for (const waiter of this.waiters) waiter.resolve();
    this.waiters.clear();
    return () => {
      if (this.owner === owner) this.owner = null;
    };
  }

  async ensure(docId: DocumentId): Promise<void> {
    while (!this.owner && !this.disposed) {
      await new Promise<void>((resolve, reject) => {
        this.waiters.add({ resolve, reject });
      });
    }
    if (this.disposed)
      throw new Error("Workbench closed before its part document was ready.");
    await this.owner!(docId);
  }

  dispose() {
    this.disposed = true;
    this.owner = null;
    for (const waiter of this.waiters)
      waiter.reject(
        new Error("Workbench closed before its part document was ready."),
      );
    this.waiters.clear();
  }
}
