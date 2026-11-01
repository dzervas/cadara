import type { DocumentId } from "@/contracts/shared/ids";
import type { DocumentRepositoryChangeSource } from "@/contracts/modeling/document-repository";

export function localDocumentOfferOptOutKey(documentId: DocumentId) {
  return `cadara-local-document-offer-hidden:${documentId}`;
}

interface LocalDocumentOfferPreferences {
  isSuppressed(documentId: DocumentId): boolean;
  suppress(documentId: DocumentId): void;
}

/** One offer per document per editor session; explicit opt-outs survive it. */
export class LocalDocumentOffers {
  private readonly offered = new Set<DocumentId>();
  private readonly dismissed = new Set<DocumentId>();
  private readonly listeners = new Set<() => void>();

  private readonly preferences: LocalDocumentOfferPreferences;

  constructor(preferences: LocalDocumentOfferPreferences) {
    this.preferences = preferences;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isOffered(documentId: DocumentId) {
    return (
      this.offered.has(documentId) &&
      !this.dismissed.has(documentId) &&
      !this.preferences.isSuppressed(documentId)
    );
  }

  offer(documentId: DocumentId) {
    if (
      this.dismissed.has(documentId) ||
      this.preferences.isSuppressed(documentId) ||
      this.offered.has(documentId)
    )
      return;
    this.offered.add(documentId);
    this.notify();
  }

  recordChange(documentId: DocumentId, source: DocumentRepositoryChangeSource) {
    if (source === "local" || source === "undo" || source === "redo")
      this.offer(documentId);
  }

  dismiss(documentId: DocumentId) {
    this.dismissed.add(documentId);
    this.notify();
  }

  dontAsk(documentId: DocumentId) {
    this.preferences.suppress(documentId);
    this.dismiss(documentId);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
