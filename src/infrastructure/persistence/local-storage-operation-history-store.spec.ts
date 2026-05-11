import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import { createEmptyOperationHistory } from "@/contracts/modeling/operation-history";
import { createLocalStorageOperationHistoryStore } from "@/infrastructure/persistence/local-storage-operation-history-store";

test("src/infrastructure/persistence/local-storage-operation-history-store.spec.ts", () => {
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

  const store = createLocalStorageOperationHistoryStore(storage);
  const empty = store.load();
  expectTrue(
    empty.ok && empty.payload === null,
    "Operation history stores should treat missing storage as an empty history payload.",
  );

  persisted.set("cad.modeling.operationHistory.v1", '{"broken"');
  const invalid = store.load();
  expectTrue(
    !invalid.ok && invalid.reasonCode === "invalid-json",
    "Operation history stores should return an explicit invalid-json failure for malformed persisted payloads.",
  );

  const payload = createEmptyOperationHistory("doc_workspace", ["head_1"]);
  store.save(payload);
  const loaded = store.load();
  expectTrue(
    loaded.ok &&
      loaded.payload?.documentId === "doc_workspace" &&
      loaded.payload.baseRepositoryHeads?.[0] === "head_1",
    "Operation history stores should round-trip valid persisted payloads through the storage adapter.",
  );

  store.clear();
  expectTrue(
    removed.includes("cad.modeling.operationHistory.v1"),
    "Operation history stores should remove the persisted key when the history is cleared.",
  );
});
