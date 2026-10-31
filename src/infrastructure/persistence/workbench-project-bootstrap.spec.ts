import { expect, test } from "vitest";
import { PendingLocalWrites } from "@/application/workspace/local-save-guard";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";
import { createWorkbenchProjectBootstrap } from "./workbench-project-bootstrap";
import { createLocalStorageWorkbenchTabsStore } from "./local-storage-workbench-tabs-store";

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

function seedStoredSession(
  storage: ReturnType<typeof createRecordingStorage>,
  activeDocumentId = "doc_lid",
) {
  // Discover the session key the persistent bootstrap reads, then store a session there.
  createWorkbenchProjectBootstrap(storage.storage, search, true);
  const key = storage.reads.find((read) => read.startsWith(sessionKey));
  if (!key) throw new Error("The persistent bootstrap did not read a session.");
  storage.values.set(
    key,
    JSON.stringify({
      schemaVersion: 1,
      projectId: "enclosure",
      activeDocumentId,
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
  expect(bootstrap.firstPartPlaceholder, "a session part is real").toBeNull();
  expect(storage.writes).toEqual([]);
});

function firstTabOf(
  bootstrap: ReturnType<typeof createWorkbenchProjectBootstrap>,
) {
  expect(bootstrap.initialTabs.tabs).toHaveLength(1);
  expect(bootstrap.initialTabs.activeDocumentId).toBe(
    bootstrap.initialTabs.tabs[0]!.documentId,
  );
  return bootstrap.initialTabs.tabs[0]!;
}

test("a fresh persistent browser gives its first part a generated identity, unique per browser", () => {
  const first = firstTabOf(
    createWorkbenchProjectBootstrap(
      createRecordingStorage().storage,
      search,
      true,
    ),
  );
  const second = firstTabOf(
    createWorkbenchProjectBootstrap(
      createRecordingStorage().storage,
      search,
      true,
    ),
  );

  expect(first.documentId).toMatch(/^doc_\w+$/);
  expect(first.documentId, "never the legacy fixed id").not.toBe(
    OCC_KERNEL_DOCUMENT_ID,
  );
  expect(second.documentId, "another browser's first part").not.toBe(
    first.documentId,
  );
  expect(first.title).toBe("Workspace");
  expect(
    createWorkbenchProjectBootstrap(
      createRecordingStorage().storage,
      search,
      true,
    ).firstPartPlaceholder,
    "without a session the mounted first part is a placeholder",
  ).toMatch(/^doc_/);
});

test.each([
  [
    "a stored part",
    `cad.documentRepository.automergeUrls.v1:projects-under-test`,
    JSON.stringify({
      [OCC_KERNEL_DOCUMENT_ID]: "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu",
    }),
  ],
  [
    "a pre-repository operation history",
    `cad.modeling.operationHistory.${OCC_KERNEL_DOCUMENT_ID}.v1`,
    "{}",
  ],
])(
  "a browser with legacy first-part state (%s) keeps the fixed identity",
  (_, key, value) => {
    const storage = createRecordingStorage();
    storage.values.set(key, value);

    const first = firstTabOf(
      createWorkbenchProjectBootstrap(storage.storage, search, true),
    );

    expect(first.documentId).toBe(OCC_KERNEL_DOCUMENT_ID);
    expect(storage.writes, "keeping it migrates nothing").toEqual([]);
  },
);

test("local peer channels share the fixed first-part identity across their databases", () => {
  const channel = (database: string) =>
    `?cadLocalPeerSync=1&cadLocalPeerSyncChannel=bench&cadRepositoryDbName=${database}`;
  const storage = createRecordingStorage();

  expect(
    firstTabOf(
      createWorkbenchProjectBootstrap(storage.storage, channel("a"), true),
    ).documentId,
  ).toBe(OCC_KERNEL_DOCUMENT_ID);
  expect(
    firstTabOf(
      createWorkbenchProjectBootstrap(storage.storage, channel("b"), true),
    ).documentId,
  ).toBe(OCC_KERNEL_DOCUMENT_ID);
});

test("a legacy project session keeps its fixed-identity part and its cached tabs", () => {
  const storage = createRecordingStorage();
  seedStoredSession(storage, OCC_KERNEL_DOCUMENT_ID);
  const tabs = {
    tabs: [
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        title: "Base",
        storageKind: "browser" as const,
        storageDescriptor: null,
      },
      {
        documentId: "doc_lid" as const,
        title: "Lid",
        storageKind: "browser" as const,
        storageDescriptor: null,
      },
    ],
    activeDocumentId: OCC_KERNEL_DOCUMENT_ID,
  };
  createLocalStorageWorkbenchTabsStore(
    storage.storage,
    "cad.workbench.tabs.project.v1:enclosure",
  ).save(tabs);
  storage.writes.length = 0;

  const bootstrap = createWorkbenchProjectBootstrap(
    storage.storage,
    search,
    true,
  );

  expect(bootstrap.session?.activeDocumentId).toBe(OCC_KERNEL_DOCUMENT_ID);
  expect(bootstrap.initialTabs).toEqual(tabs);
  expect(storage.writes).toEqual([]);
});
