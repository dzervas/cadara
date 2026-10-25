// Logic lane (src/application, docs/testing.md). Seam: the persistent-storage
// request and its once-per-profile warning, against a fake
// StorageManager and a fake localStorage; and the first-successful-save
// trigger against a fake save-status source.
import { describe, expect, it } from "vitest";

import {
  checkStorageDurability,
  LOW_STORAGE_REMAINING_BYTES,
  watchFirstSuccessfulLocalSave,
  type StorageDurabilityManager,
} from "@/application/workspace/storage-durability";
import type { LocalSaveStatusSource } from "@/application/workspace/local-save-guard";
import type { LocalSaveStatus } from "@/application/modeling/modeling-service";

function fakeStorageManager(state: {
  persisted: boolean;
  grantsPersist: boolean;
  quota?: number;
  usage?: number;
}) {
  const calls: string[] = [];
  const storage: StorageDurabilityManager = {
    async persisted() {
      calls.push("persisted");
      return state.persisted;
    },
    async persist() {
      calls.push("persist");
      state.persisted = state.grantsPersist;
      return state.grantsPersist;
    },
    async estimate() {
      calls.push("estimate");
      return { quota: state.quota, usage: state.usage };
    },
  };
  return { storage, calls };
}

function fakeLocalStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const ROOMY = { quota: 10 * 1024 ** 3, usage: 1024 ** 2 };

describe("checkStorageDurability", () => {
  it("requests persistence and shows nothing when the browser grants it and space is ample", async () => {
    const { storage, calls } = fakeStorageManager({
      persisted: false,
      grantsPersist: true,
      ...ROOMY,
    });
    expect(await checkStorageDurability(storage, fakeLocalStorage())).toBe(
      null,
    );
    expect(calls).toEqual(["persisted", "persist", "estimate"]);
  });

  it("does not ask again when storage is already persistent", async () => {
    const { storage, calls } = fakeStorageManager({
      persisted: true,
      grantsPersist: true,
      ...ROOMY,
    });
    expect(await checkStorageDurability(storage, fakeLocalStorage())).toBe(
      null,
    );
    expect(calls).not.toContain("persist");
  });

  it("warns once when the browser denies persistence; later sessions are not nagged", async () => {
    const shownWarnings = fakeLocalStorage();
    const denied = () =>
      fakeStorageManager({ persisted: false, grantsPersist: false, ...ROOMY })
        .storage;
    expect(await checkStorageDurability(denied(), shownWarnings)).toBe(
      "not-persisted",
    );
    expect(await checkStorageDurability(denied(), shownWarnings)).toBe(null);
  });

  it("warns once when little space is left, even though persistence was granted", async () => {
    const shownWarnings = fakeLocalStorage();
    const lowSpace = () =>
      fakeStorageManager({
        persisted: true,
        grantsPersist: true,
        quota: LOW_STORAGE_REMAINING_BYTES * 3,
        usage: LOW_STORAGE_REMAINING_BYTES * 2 + 1,
      }).storage;
    expect(await checkStorageDurability(lowSpace(), shownWarnings)).toBe(
      "low-space",
    );
    expect(await checkStorageDurability(lowSpace(), shownWarnings)).toBe(null);
  });

  it("remembers each warning separately", async () => {
    const shownWarnings = fakeLocalStorage();
    await checkStorageDurability(
      fakeStorageManager({ persisted: false, grantsPersist: false, ...ROOMY })
        .storage,
      shownWarnings,
    );
    expect(
      await checkStorageDurability(
        fakeStorageManager({
          persisted: true,
          grantsPersist: true,
          quota: LOW_STORAGE_REMAINING_BYTES,
          usage: 1,
        }).storage,
        shownWarnings,
      ),
    ).toBe("low-space");
  });
});

describe("watchFirstSuccessfulLocalSave", () => {
  function fakeSource() {
    let status: LocalSaveStatus = { saving: false, failure: null };
    const listeners = new Set<() => void>();
    const source: LocalSaveStatusSource = {
      getLocalSaveStatus: () => status,
      subscribeToLocalSaveStatus(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return {
      source,
      listeners,
      set(next: LocalSaveStatus) {
        status = next;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it("fires once, when a save completes without failure, then stops listening", () => {
    const { source, listeners, set } = fakeSource();
    let saved = 0;
    watchFirstSuccessfulLocalSave(source, () => saved++);

    set({ saving: true, failure: null });
    expect(saved).toBe(0);
    set({ saving: false, failure: null });
    expect(saved).toBe(1);
    expect(listeners.size).toBe(0);
  });

  it("ignores a save that failed", () => {
    const { source, set } = fakeSource();
    let saved = 0;
    watchFirstSuccessfulLocalSave(source, () => saved++);

    set({ saving: true, failure: null });
    set({
      saving: false,
      failure: { message: "Quota exceeded." } as LocalSaveStatus["failure"],
    });
    expect(saved).toBe(0);
    set({ saving: true, failure: null });
    set({ saving: false, failure: null });
    expect(saved).toBe(1);
  });
});
