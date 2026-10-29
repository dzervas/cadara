import { expect, test } from "vitest";
import { createWorkbenchProjectSessionStore } from "./workbench-project-session-store";

test("the synchronous project session retains the active part identity before manifest loading", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const store = createWorkbenchProjectSessionStore(storage, "active-project");
  expect(store.load()).toBeNull();
  const session = {
    schemaVersion: 1 as const,
    projectId: "enclosure",
    activeDocumentId: "doc_lid" as const,
  };
  store.save(session);
  expect(
    createWorkbenchProjectSessionStore(storage, "active-project").load(),
  ).toEqual(session);
  storage.setItem(
    "active-project",
    JSON.stringify({ ...session, schemaVersion: 2 }),
  );
  expect(() => store.load()).toThrow("Invalid stored project session");
  storage.setItem(
    "active-project",
    JSON.stringify({ ...session, unexpected: true }),
  );
  expect(() => store.load()).toThrow("Invalid stored project session");
});
