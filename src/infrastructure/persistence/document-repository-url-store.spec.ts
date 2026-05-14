import { test, expect } from "vitest";

import {
  createDocumentRepositoryUrlStorageKey,
  MemoryDocumentRepositoryUrlStore,
  createLocalStorageDocumentRepositoryUrlStore,
  getDocumentRepositoryStorageNamespace,
} from "@/infrastructure/persistence/document-repository-url-store";

test("src/infrastructure/persistence/document-repository-url-store.spec.ts", () => {
  const validUrl = "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu" as never;
  const memoryStore = new MemoryDocumentRepositoryUrlStore();
  memoryStore.set("doc_workspace", validUrl);
  expect(
    memoryStore.get("doc_workspace"),
    "Memory URL stores should return persisted Automerge URLs.",
  ).toBe(validUrl);
  memoryStore.delete("doc_workspace");
  expect(
    memoryStore.get("doc_workspace"),
    "Memory URL stores should drop deleted URLs.",
  ).toBe(null);

  const persisted = new Map<string, string>();
  const removed: string[] = [];
  const storage = {
    getItem(key: string) {
      return persisted.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      persisted.set(key, value);
    },
    removeItem(key: string) {
      removed.push(key);
      persisted.delete(key);
    },
  };

  persisted.set(
    "cad.documentRepository.automergeUrls.v1",
    '{"doc_bad":"not-an-automerge-url"}',
  );
  const urlStore = createLocalStorageDocumentRepositoryUrlStore(storage);
  expect(
    urlStore.get("doc_bad"),
    "Local-storage URL stores should ignore invalid persisted payloads instead of surfacing malformed URLs.",
  ).toBe(null);

  urlStore.set("doc_workspace", validUrl);
  expect(
    persisted
      .get("cad.documentRepository.automergeUrls.v1")
      ?.includes(validUrl),
    "Local-storage URL stores should persist valid Automerge URLs through the storage adapter.",
  ).toBeTruthy();
  expect(
    urlStore.get("doc_workspace"),
    "Local-storage URL stores should read back the persisted Automerge URL for the document id.",
  ).toBe(validUrl);

  urlStore.delete("doc_workspace");
  expect(
    removed.includes("cad.documentRepository.automergeUrls.v1"),
    "Local-storage URL stores should clear the storage key once the final repository URL is removed.",
  ).toBeTruthy();

  const customKey = createDocumentRepositoryUrlStorageKey("cad-e2e-alt-db");
  const customUrlStore = createLocalStorageDocumentRepositoryUrlStore(
    storage,
    customKey,
  );
  customUrlStore.set("doc_workspace", validUrl);
  expect(
    persisted.get(customKey)?.includes(validUrl) &&
      persisted.get("cad.documentRepository.automergeUrls.v1") === undefined,
    "Local-storage URL stores should isolate persisted Automerge URLs by repository backend namespace.",
  ).toBeTruthy();
  expect(
    getDocumentRepositoryStorageNamespace(
      "?cadRepositoryDbName=cad-e2e-alt-db",
    ) === "cad-e2e-alt-db" &&
      getDocumentRepositoryStorageNamespace("") === "cad-authored-documents",
    "Repository storage namespaces should derive from the backend search params and fall back to the default database name.",
  ).toBeTruthy();
});
