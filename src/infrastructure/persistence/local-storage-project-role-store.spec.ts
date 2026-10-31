import { expect, test } from "vitest";
import { createLocalStorageProjectRoleStore } from "./local-storage-project-role-store";

// Logic lane, persistence adapter: the remembered sync-token role a synced
// project's write gate starts from before the next token arrives.

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

const link = { orgId: "org_a", projectId: "project_a" };

test("a role is remembered per project and user; with no user known yet, the last user's role applies", () => {
  const storage = memoryStorage();
  const store = createLocalStorageProjectRoleStore(storage);
  expect(store.load(link, "user_a")).toBeNull();
  store.save(link, "user_a", "viewer");
  expect(store.load(link, "user_a")).toBe("viewer");
  expect(store.load(link, null)).toBe("viewer");
  expect(store.load(link, "user_b")).toBeNull();
  expect(store.load({ ...link, projectId: "project_b" }, "user_a")).toBeNull();
  // A reload reads the same browser storage.
  expect(createLocalStorageProjectRoleStore(storage).load(link, "user_a")).toBe(
    "viewer",
  );
});

test("a damaged or unknown entry remembers no role", () => {
  const storage = memoryStorage();
  const store = createLocalStorageProjectRoleStore(storage);
  store.save(link, "user_a", "editor");
  const [key] = [...storage.values.keys()];
  storage.setItem(key!, "{not json");
  expect(store.load(link, "user_a")).toBeNull();
  storage.setItem(key!, JSON.stringify({ userId: "user_a", role: "owner" }));
  expect(store.load(link, "user_a")).toBeNull();
});
