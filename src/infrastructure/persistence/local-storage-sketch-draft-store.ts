import type { SketchDraftRecoveryStore } from "@/contracts/sketch/draft-recovery";
import { validatePersistedSketchDraft } from "@/contracts/sketch/draft-recovery.runtime-schema";
import type { StorageLike } from "@/contracts/modeling/operation-history-store";

export const sketchDraftStorageKey = (documentId: string) => `cad.sketchDraftRecovery.${documentId}.v1`;

/** The document slot indexes its one open draft, keyed by document + sketch +
 * published revision. Deliberately outside the Automerge/shared document. */
export function createLocalStorageSketchDraftStore(storage: StorageLike): SketchDraftRecoveryStore {
  const recordKey = (documentId: string) => {
    const index = sketchDraftStorageKey(documentId);
    const key = storage.getItem(index);
    return key?.startsWith(`${index}:`) ? key : null;
  };
  const clear = (documentId: string) => {
    const key = recordKey(documentId);
    if (key) storage.removeItem(key);
    storage.removeItem(sketchDraftStorageKey(documentId));
  };
  return {
    load(documentId) {
      const key = recordKey(documentId);
      const serialized = key ? storage.getItem(key) : null;
      if (serialized === null) return null;
      let value: unknown;
      try { value = JSON.parse(serialized); }
      catch {
        // A corrupt recovery record is unusable, not a document-load failure.
        clear(documentId);
        return null;
      }
      const result = validatePersistedSketchDraft(value);
      if (!result.success || result.data.documentId !== documentId) {
        clear(documentId);
        return null;
      }
      return result.data;
    },
    save(draft) {
      const index = sketchDraftStorageKey(draft.documentId);
      const previous = recordKey(draft.documentId);
      const key = `${index}:${encodeURIComponent(draft.sketchId)}:${encodeURIComponent(draft.publishedRevision ?? "unpublished")}`;
      storage.setItem(key, JSON.stringify(draft));
      storage.setItem(index, key);
      if (previous && previous !== key) storage.removeItem(previous);
    },
    clear,
  };
}
