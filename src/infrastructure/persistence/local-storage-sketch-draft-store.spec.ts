import { expect, test } from "vitest";
import { makeSketchDraftRecoveryFixture } from "@/application/sketch-draft-recovery/recovery.fixtures";
import { createLocalStorageSketchDraftStore, sketchDraftStorageKey } from "./local-storage-sketch-draft-store";

test("round-trips only valid local recovery records; corrupted JSON, wrong document and invalid authored fields are removed", async () => {
  const { draft } = await makeSketchDraftRecoveryFixture();
  const values = new Map<string, string>();
  const store = createLocalStorageSketchDraftStore({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  });
  store.save(draft);
  expect(store.load(draft.documentId)).toEqual(draft);
  const recordKey = values.get(sketchDraftStorageKey(draft.documentId))!;
  expect(recordKey).toContain(encodeURIComponent(draft.sketchId));
  for (const invalid of ["{", JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, documentId: "other" }), JSON.stringify({ ...draft, definition: { points: "invalid" } })]) {
    values.set(sketchDraftStorageKey(draft.documentId), recordKey);
    values.set(recordKey, invalid);
    expect(store.load(draft.documentId)).toBeNull();
    expect(values.size).toBe(0);
  }
  store.save(draft); store.clear(draft.documentId);
  expect(store.load(draft.documentId)).toBeNull();
});
