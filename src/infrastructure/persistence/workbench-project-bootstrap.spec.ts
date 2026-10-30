import { expect, test } from "vitest";
import { PendingLocalWrites } from "@/application/workspace/local-save-guard";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";
import { createWorkbenchProjectBootstrap } from "./workbench-project-bootstrap";

const search = "?cadRepositoryDbName=projects-under-test";
const sessionKey = "cad.workbench.activeProject.v1:";

function createRecordingStorage() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    values,
    reads,
    writes,
    storage: {
      getItem: (key: string) => {
        reads.push(key);
        return values.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        writes.push(key);
        values.set(key, value);
      },
      removeItem: (key: string) => {
        writes.push(key);
        values.delete(key);
      },
    },
  };
}

function seedStoredSession(storage: ReturnType<typeof createRecordingStorage>) {
  // Discover the session key the persistent bootstrap reads, then store a session there.
  createWorkbenchProjectBootstrap(storage.storage, search, true);
  const key = storage.reads.find((read) => read.startsWith(sessionKey));
  if (!key) throw new Error("The persistent bootstrap did not read a session.");
  storage.values.set(
    key,
    JSON.stringify({
      schemaVersion: 1,
      projectId: "enclosure",
      activeDocumentId: "doc_lid",
    }),
  );
  storage.reads.length = 0;
  storage.writes.length = 0;
}

test("without a document repository the workbench has no durable project and project loading is complete", () => {
  const storage = createRecordingStorage();
  seedStoredSession(storage);

  const bootstrap = createWorkbenchProjectBootstrap(
    storage.storage,
    search,
    false,
  );

  expect(
    bootstrap.openInitialProject(new PendingLocalWrites()),
    "no project discovery or creation runs without a repository",
  ).toBeNull();
  expect(bootstrap.sessionStore, "no session writes").toBeNull();
  expect(bootstrap.session).toBeNull();
  expect(bootstrap.initialFailure).toBeNull();
  expect(bootstrap.initialTabs, "the in-memory workspace tab").toEqual({
    tabs: [
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        title: "Workspace",
        storageKind: "browser",
        storageDescriptor: null,
      },
    ],
    activeDocumentId: OCC_KERNEL_DOCUMENT_ID,
  });
  expect(() => bootstrap.getRepository()).toThrow(
    "Project persistence is disabled.",
  );
  expect(
    storage.reads,
    "a stored project session is ignored without a repository",
  ).toEqual([]);
  expect(storage.writes).toEqual([]);
});

test("with a document repository the workbench restores the stored project session before discovery", () => {
  const storage = createRecordingStorage();
  seedStoredSession(storage);

  const bootstrap = createWorkbenchProjectBootstrap(
    storage.storage,
    search,
    true,
  );

  expect(bootstrap.sessionStore).not.toBeNull();
  expect(bootstrap.session).toEqual({
    schemaVersion: 1,
    projectId: "enclosure",
    activeDocumentId: "doc_lid",
  });
  expect(bootstrap.initialTabs.activeDocumentId).toBe("doc_lid");
  expect(storage.writes).toEqual([]);
});
