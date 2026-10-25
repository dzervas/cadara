import type { LocalSaveStatusSource } from "@/application/workspace/local-save-guard";

/** `navigator.storage`; a fake in tests. */
export type StorageDurabilityManager = Pick<
  StorageManager,
  "estimate" | "persist" | "persisted"
>;

/** Why the documents in browser storage may be lost. */
export type StorageDurabilityWarning = "not-persisted" | "low-space";

/**
 * Below this much free browser storage (quota minus usage) a new document
 * or edit may fail to save, so the user is told to export.
 */
export const LOW_STORAGE_REMAINING_BYTES = 250 * 1024 * 1024;

const SHOWN_WARNINGS_STORAGE_KEY = "cadara.storageDurabilityWarnings.v1";

/**
 * Asks the browser to keep CADara's storage (documents, the
 * offline app) when it runs low on space, and returns the warning to show:
 * `not-persisted` when the browser declines, `low-space` when it agreed but
 * little room is left. Each warning is returned once per browser profile
 * (remembered in `shownWarnings`, i.e. localStorage), never every session.
 */
export async function checkStorageDurability(
  storage: StorageDurabilityManager,
  shownWarnings: Pick<Storage, "getItem" | "setItem">,
): Promise<StorageDurabilityWarning | null> {
  const persisted = (await storage.persisted()) || (await storage.persist());
  const { quota, usage } = await storage.estimate();
  const warning: StorageDurabilityWarning | null = !persisted
    ? "not-persisted"
    : quota !== undefined &&
        usage !== undefined &&
        quota - usage < LOW_STORAGE_REMAINING_BYTES
      ? "low-space"
      : null;
  if (!warning) return null;

  const shown = (shownWarnings.getItem(SHOWN_WARNINGS_STORAGE_KEY) ?? "")
    .split(",")
    .filter(Boolean);
  if (shown.includes(warning)) return null;
  shownWarnings.setItem(
    SHOWN_WARNINGS_STORAGE_KEY,
    [...shown, warning].join(","),
  );
  return warning;
}

/**
 * Calls `onSaved` once, when a local save first completes without failure
 * (saving turns false with no failure). Returns the disposer.
 */
export function watchFirstSuccessfulLocalSave(
  source: LocalSaveStatusSource,
  onSaved: () => void,
): () => void {
  let wasSaving = source.getLocalSaveStatus().saving;
  const unsubscribe = source.subscribeToLocalSaveStatus(() => {
    const { saving, failure } = source.getLocalSaveStatus();
    const saved = wasSaving && !saving && failure === null;
    wasSaving = saving;
    if (!saved) return;
    unsubscribe();
    onSaved();
  });
  return unsubscribe;
}
