import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { parseAutomergeDocumentUrlStorePayload } from "@/contracts/modeling/document-repository.runtime-schema";
import type { DocumentId } from "@/contracts/shared/ids";
import {
  createInitialWorkbenchTabsState,
  reduceWorkbenchTabs,
} from "@/core/workspace/workbench-tabs";
import {
  createDocumentRepositoryUrlStorageKey,
  createLocalStorageDocumentRepositoryUrlStore,
} from "@/infrastructure/persistence/document-repository-url-store";
import { createIndexedDbAutomergeDocumentRepository } from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { createLocalStorageWorkbenchTabsStore } from "@/infrastructure/persistence/local-storage-workbench-tabs-store";
import { openDocumentCopyAsTab } from "@/workbench/document/document-file-actions";

import { nativeDocumentUrls } from "./model-assets";

const examples = nativeDocumentUrls;
let opening = false;

/** Open a fresh browser-stored native document, then enter the workbench. */
export async function openExample(
  model: "bracket" | "wheel" | "enclosure",
): Promise<void> {
  if (opening) throw new Error("An example is already being opened.");
  opening = true;
  try {
    if (!Object.hasOwn(examples, model)) throw new Error("Unknown example.");
    const response = await fetch(examples[model]);
    if (!response.ok)
      throw new Error(`Could not load ${model} example (${response.status}).`);
    const file = new File([await response.blob()], `${model}.cadara`, {
      type: "application/json",
    });
    const storage = window.localStorage;
    const tabsStore = createLocalStorageWorkbenchTabsStore(storage);
    const loadTabs = () => {
      const result = tabsStore.load();
      if (!result.ok) throw new Error(result.message);
      return result.state;
    };
    // The upstream URL store falls back to {} on corruption. Refuse that fallback
    // here: importing a sample must never discard mappings for existing documents.
    const urlKey = createDocumentRepositoryUrlStorageKey();
    const checkUrls = () => {
      const raw = storage.getItem(urlKey);
      if (raw !== null) {
        const parsed = parseAutomergeDocumentUrlStorePayload(
          JSON.parse(raw),
          isValidAutomergeUrl,
        );
        if (!parsed.ok) throw new Error(parsed.message);
      }
    };
    loadTabs();
    checkUrls();
    const baseUrlStore = createLocalStorageDocumentRepositoryUrlStore(storage);
    const repository = createIndexedDbAutomergeDocumentRepository({
      urlStore: {
        get(id) {
          checkUrls();
          return baseUrlStore.get(id);
        },
        set(id, url) {
          checkUrls();
          baseUrlStore.set(id, url);
        },
        delete(id) {
          checkUrls();
          baseUrlStore.delete(id);
        },
      },
    });
    // Landing and editor share the origin and the existing document repository.
    // localStorage tabs + IndexedDB are not one atomic transaction; another open
    // workbench window can race tab writes. A failed tab save may leave an orphan
    // NEW document, but we never overwrite an existing document or reset tabs.
    // The preview meshes were exported by the CLI from these same native files.
    const result = await openDocumentCopyAsTab({
      file,
      repository,
      createDocumentId() {
        const id: DocumentId = `doc_${crypto.randomUUID()}`;
        if (
          baseUrlStore.get(id) ||
          loadTabs()?.tabs.some((tab) => tab.documentId === id)
        ) {
          throw new Error("New document ID collision.");
        }
        return id;
      },
      openTab(tab) {
        // Reload after the asynchronous durable initialize, retaining every tab.
        const state = loadTabs();
        tabsStore.save(
          state
            ? reduceWorkbenchTabs(state, { type: "open", tab, activate: true })
            : createInitialWorkbenchTabsState(tab),
        );
      },
    });
    if (result.status !== "success") {
      if (result.status === "unexpected-error") throw result.error;
      throw new Error(
        result.status === "cancelled"
          ? "Opening the example was cancelled."
          : result.message,
      );
    }
    window.location.assign("/app");
  } finally {
    opening = false;
  }
}
