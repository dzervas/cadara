import { expect, test, vi } from "vitest";
import type { DocumentId } from "@/contracts/shared/ids";
import { mergeDiscoveredWorkbenchProjectTabs } from "@/core/workspace/workbench-project-tabs";
import {
  reduceWorkbenchTabs,
  type WorkbenchTab,
} from "@/core/workspace/workbench-tabs";
import { WorkbenchPartReadiness } from "@/application/workspace/workbench-part-readiness";
import { WorkerBackedDocumentRepository } from "@/infrastructure/modeling/worker-backed-document-repository";
import { DocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-client";
import type { DocumentSyncWorkerLike } from "@/infrastructure/workers/document-sync-worker-client";
import { createDocumentSyncWorkerMessageHandler } from "@/infrastructure/workers/document-sync-worker-runtime";
import type { DocumentSyncWorkerResponse } from "@/infrastructure/workers/document-sync-worker-protocol";
import { isProjectSyncWorkerRequest } from "@/infrastructure/workers/project-sync-worker-protocol";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { Repo } from "@automerge/automerge-repo";
import * as Automerge from "@automerge/automerge";
import type { AutomergeRepositoryLike } from "./indexeddb-automerge-document-repository";
import { IndexedDbAutomergeDocumentRepository } from "./indexeddb-automerge-document-repository";
import { MemoryDocumentRepositoryUrlStore } from "./document-repository-url-store";
import { LocalProjectRepository } from "./local-project-repository";
import { createWorkbenchProjectBootstrap } from "./workbench-project-bootstrap";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";
import { createMemoryGeometryAssetStore } from "@/core/modeling/geometry-asset-store";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import type {
  ProjectManifest,
  ProjectResult,
  ProjectReadmeDocument,
} from "@/contracts/modeling/project-manifest";
import type { ProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import type { CollaborativeDocument } from "@/core/modeling/collaborative-document";
import { materializeCollaborativeDocument } from "@/core/modeling/collaborative-document";

function unwrap<T>(result: ProjectResult<T>) {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
}

function setup(
  urls = new MemoryDocumentRepositoryUrlStore(),
  repo = new Repo(),
) {
  const documents = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: urls,
    assetStore: createMemoryGeometryAssetStore(),
  });
  const ensurePartReady = async (
    documentId: Parameters<typeof documents.load>[0]["documentId"],
  ) => {
    const loaded = await documents.load({
      documentId,
      seedDocument: {
        ...(await createSeedAuthoredModelDocument()),
        documentId,
      },
    });
    if (!loaded.ok) throw new Error(loaded.status.diagnostic.message);
  };
  return {
    repo,
    urls,
    documents,
    ensurePartReady,
    projects: new LocalProjectRepository(
      documents,
      urls,
      urls,
      ensurePartReady,
    ),
  };
}

test("projects preserve part identity, ordered membership and names on repository reopen", async () => {
  const { repo, urls, documents, projects } = setup();
  try {
    const seed = await createSeedAuthoredModelDocument();
    expect(
      (
        await documents.initialize({
          documentId: seed.documentId,
          document: seed,
        })
      ).ok,
    ).toBe(true);
    const firstUrl = urls.get(seed.documentId)!;
    let project = unwrap(
      await projects.create("Enclosure", [
        { name: "Base", kind: "part", docId: seed.documentId },
      ]),
    );
    expect(project.entries[0].automergeDocumentId).toBe(
      (await repo.find(firstUrl)).documentId,
    );
    const second = { ...seed, documentId: "doc_lid" as const };
    project = unwrap(
      await projects.addPart(
        project.projectId,
        { name: "Lid", docId: second.documentId },
        second,
      ),
    );
    project = unwrap(
      await projects.renameEntry(project.projectId, seed.documentId, "Housing"),
    );
    const reopened = new LocalProjectRepository(documents, urls);
    expect(unwrap(await reopened.list())).toEqual([project]);
    expect(
      unwrap(await reopened.open(project.projectId)).entries.map((entry) => [
        entry.docId,
        entry.name,
      ]),
    ).toEqual([
      [seed.documentId, "Housing"],
      [second.documentId, "Lid"],
    ]);
    expect(urls.get(seed.documentId)).toBe(firstUrl);
    unwrap(
      await reopened.setParts(project.projectId, [
        { docId: second.documentId, name: "Lid" },
      ]),
    );
    expect(unwrap(await reopened.open(project.projectId)).entries).toHaveLength(
      1,
    );
    expect(urls.get(seed.documentId)).toBe(firstUrl);
  } finally {
    await repo.shutdown();
  }
});

test("readmes persist, discussions are lazy and unique, and named versions reopen every document at its recorded heads", async () => {
  const { repo, urls, documents, projects } = setup();
  try {
    const seed = await createSeedAuthoredModelDocument();
    let project = unwrap(await projects.create("Enclosure", []));
    project = unwrap(
      await projects.addPart(
        project.projectId,
        { docId: seed.documentId, name: "Base" },
        seed,
      ),
    );
    expect(project.entries.some((entry) => entry.kind === "discussion")).toBe(
      false,
    );
    project = unwrap(
      await projects.addReadme(
        project.projectId,
        "Build notes",
        "# Before printing",
      ),
    );
    project = unwrap(await projects.ensureDiscussion(project.projectId));
    expect(unwrap(await projects.ensureDiscussion(project.projectId))).toEqual(
      project,
    );
    for (const entry of project.entries) {
      expect(entry.automergeDocumentId).toBe(
        (await repo.find(urls.get(entry.docId)!)).documentId,
      );
    }
    const versioned = unwrap(
      await projects.recordVersion(
        project.projectId,
        "Printed",
        "2026-10-29T00:00:00Z",
      ),
    );
    const version = versioned.versions[0];
    expect(Object.keys(version.heads).sort()).toEqual(
      project.entries.map((entry) => entry.docId).sort(),
    );
    const part = await repo.find<CollaborativeDocument>(
      urls.get(seed.documentId)!,
    );
    const before = materializeCollaborativeDocument(part.doc());
    const changed = { ...before, name: "After printing" };
    expect(
      (
        await documents.mutate({
          documentId: seed.documentId,
          document: changed,
          expected: before,
        })
      ).ok,
    ).toBe(true);
    const readmeEntry = project.entries.find(
      (entry) => entry.kind === "readme",
    )!;
    const readme = await repo.find<ProjectReadmeDocument>(
      urls.get(readmeEntry.docId)!,
    );
    readme.change((draft) => {
      draft.markdown = "# After printing";
    });
    for (const entry of project.entries) {
      const handle = await repo.find(urls.get(entry.docId)!);
      const historic = Automerge.view(handle.doc(), version.heads[entry.docId]);
      expect(Automerge.getHeads(historic)).toEqual(version.heads[entry.docId]);
    }
    expect(
      materializeCollaborativeDocument(
        Automerge.view(part.doc(), version.heads[seed.documentId]),
      ).name,
    ).toBe(before.name);
    expect(
      Automerge.view(readme.doc(), version.heads[readmeEntry.docId]).markdown,
    ).toBe("# Before printing");
    expect(
      (await projects.recordVersion(project.projectId, "Printed")).ok,
    ).toBe(false);
  } finally {
    await repo.shutdown();
  }
});

test("unsupported assembly creation and corrupt stored manifests produce diagnostics", async () => {
  const { repo, urls, projects } = setup();
  try {
    expect(
      (
        await projects.create("Assembly", [
          { kind: "assembly", name: "Assembly", docId: "doc_assembly" },
        ])
      ).ok,
    ).toBe(false);
    const project = unwrap(
      await projects.create("Enclosure", [
        { kind: "part", name: "Base", docId: "doc_base" },
      ]),
    );
    const catalog = await repo.find<ProjectCatalog>(
      urls.get("doc_project_catalog")!,
    );
    const handle = await repo.find<ProjectManifest>(
      catalog.doc().projects[0].url as AutomergeUrl,
    );
    handle.change((draft) => {
      draft.name = "";
    });
    const opened = await projects.open(project.projectId);
    expect(opened.ok).toBe(false);
    if (!opened.ok)
      expect(opened.diagnostic.message).toContain("name must not be empty");
    expect((await projects.list()).ok).toBe(false);
  } finally {
    await repo.shutdown();
  }
});

test("database-local catalogs stay independent when peer channels share part pointers", async () => {
  const sharedPartUrls = new MemoryDocumentRepositoryUrlStore();
  const first = setup(sharedPartUrls);
  const second = setup(sharedPartUrls);
  const firstProjects = new LocalProjectRepository(
    first.documents,
    sharedPartUrls,
    new MemoryDocumentRepositoryUrlStore(),
    first.ensurePartReady,
  );
  const secondProjects = new LocalProjectRepository(
    second.documents,
    sharedPartUrls,
    new MemoryDocumentRepositoryUrlStore(),
  );
  try {
    const firstProject = unwrap(
      await firstProjects.create("First database", [
        { name: "Part", kind: "part", docId: "doc_workspace" },
      ]),
    );
    expect(unwrap(await secondProjects.list())).toEqual([]);
    // The second database holds no copy of the shared part and has no peer
    // network: its project still lists the part by the shared URL's identity.
    const secondProject = unwrap(
      await secondProjects.create("Second database", [
        { name: "Part", kind: "part", docId: "doc_workspace" },
      ]),
    );
    expect(secondProject.entries[0].automergeDocumentId).toBe(
      firstProject.entries[0].automergeDocumentId,
    );
    expect(unwrap(await firstProjects.list())).toEqual([firstProject]);
    expect(unwrap(await secondProjects.list())).toEqual([secondProject]);
  } finally {
    await first.repo.shutdown();
    await second.repo.shutdown();
  }
});

test("rejected duplicate parts leave their URL mapping and historical views unchanged", async () => {
  const { repo, urls, documents, projects } = setup();
  try {
    const seed = await createSeedAuthoredModelDocument();
    const project = unwrap(await projects.create("Enclosure", []));
    unwrap(
      await projects.addPart(
        project.projectId,
        { name: "Base", docId: seed.documentId },
        seed,
      ),
    );
    const versioned = unwrap(
      await projects.recordVersion(project.projectId, "Original"),
    );
    const originalUrl = urls.get(seed.documentId)!;
    const part = await repo.find<CollaborativeDocument>(originalUrl);
    const originalHeads = Automerge.getHeads(part.doc());
    const original = materializeCollaborativeDocument(part.doc());
    expect(
      (
        await documents.mutate({
          documentId: seed.documentId,
          expected: original,
          document: { ...original, name: "Edited base" },
        })
      ).ok,
    ).toBe(true);
    const editedHeads = Automerge.getHeads(part.doc());
    const rejected = await projects.addPart(
      project.projectId,
      { name: "Duplicate", docId: seed.documentId },
      { ...seed, name: "Replacement" },
    );
    expect(rejected.ok).toBe(false);
    expect(urls.get(seed.documentId)).toBe(originalUrl);
    const current = await repo.find<CollaborativeDocument>(
      urls.get(seed.documentId)!,
    );
    expect(Automerge.getHeads(current.doc())).toEqual(editedHeads);
    expect(materializeCollaborativeDocument(current.doc()).name).toBe(
      "Edited base",
    );
    const historic = Automerge.view(
      current.doc(),
      versioned.versions[0].heads[seed.documentId],
    );
    expect(Automerge.getHeads(historic)).toEqual(originalHeads);
    expect(materializeCollaborativeDocument(historic)).toEqual(original);

    const other = unwrap(await projects.create("Other project", []));
    expect(
      (
        await projects.addPart(
          other.projectId,
          { name: "Existing", docId: seed.documentId },
          seed,
        )
      ).ok,
    ).toBe(false);
    expect(urls.get(seed.documentId)).toBe(originalUrl);
    expect(
      unwrap(
        await projects.addPart(other.projectId, {
          name: "Linked",
          docId: seed.documentId,
        }),
      ).entries[0].docId,
    ).toBe(seed.documentId);
    expect(
      (
        await projects.addPart(
          "missing-project",
          { name: "Orphan", docId: "doc_orphan" },
          { ...seed, documentId: "doc_orphan" },
        )
      ).ok,
    ).toBe(false);
    expect(urls.get("doc_orphan")).toBeNull();
    expect(
      (
        await projects.addPart(
          other.projectId,
          { name: "", docId: "doc_invalid" },
          { ...seed, documentId: "doc_invalid" },
        )
      ).ok,
    ).toBe(false);
    expect(urls.get("doc_invalid")).toBeNull();
  } finally {
    await repo.shutdown();
  }
});

test("setParts on a mixed-document manifest preserves plain readme and discussion entries", async () => {
  const { repo, projects } = setup();
  try {
    let project = unwrap(
      await projects.create("Enclosure", [
        { name: "Base", kind: "part", docId: "doc_base" },
      ]),
    );
    project = unwrap(
      await projects.addReadme(project.projectId, "Build notes", "# Printing"),
    );
    project = unwrap(await projects.ensureDiscussion(project.projectId));
    const otherEntries = project.entries.filter(
      (entry) => entry.kind !== "part",
    );
    project = unwrap(
      await projects.setParts(project.projectId, [
        { name: "Lid", docId: "doc_lid" },
        { name: "Housing", docId: "doc_base" },
      ]),
    );
    expect(project.entries).toEqual([
      expect.objectContaining({ name: "Lid", kind: "part", docId: "doc_lid" }),
      expect.objectContaining({
        name: "Housing",
        kind: "part",
        docId: "doc_base",
      }),
      ...otherEntries,
    ]);
    project = unwrap(
      await projects.setParts(project.projectId, [
        { name: "Housing", docId: "doc_base" },
      ]),
    );
    expect(unwrap(await projects.open(project.projectId)).entries).toEqual([
      expect.objectContaining({
        name: "Housing",
        kind: "part",
        docId: "doc_base",
      }),
      ...otherEntries,
    ]);
  } finally {
    await repo.shutdown();
  }
});

test("a reload that finds the first project before its session was recorded opens the project's part and adds no stray part", async () => {
  const { repo, projects } = setup();
  const emptyStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  try {
    const created = createWorkbenchProjectBootstrap(emptyStorage, "", true);
    const project = unwrap(
      await projects.create(
        "My project",
        created.initialTabs.tabs.map((tab) => ({
          name: tab.title,
          kind: "part" as const,
          docId: tab.documentId,
        })),
      ),
    );
    const [firstPart] = created.initialTabs.tabs;

    // The session record was never written: the reload mounts a new placeholder.
    const reloaded = createWorkbenchProjectBootstrap(emptyStorage, "", true);
    expect(reloaded.firstPartPlaceholder).toBe(
      reloaded.initialTabs.activeDocumentId,
    );
    expect(reloaded.firstPartPlaceholder).not.toBe(firstPart!.documentId);
    const merged = mergeDiscoveredWorkbenchProjectTabs(
      project,
      reloaded.initialTabs,
      reloaded.firstPartPlaceholder,
    );

    expect(merged.tabs.map((tab) => tab.documentId)).toEqual([
      firstPart!.documentId,
    ]);
    expect(merged.activeDocumentId).toBe(firstPart!.documentId);
    const saved = unwrap(
      await projects.setParts(
        project.projectId,
        merged.tabs.map((tab) => ({ docId: tab.documentId, name: tab.title })),
      ),
    );
    expect(
      saved.entries.map((entry) => entry.docId),
      "no extra part",
    ).toEqual([firstPart!.documentId]);
  } finally {
    await repo.shutdown();
  }
});

test("a document opened during discovery joins the manifest and survives repository reopen", async () => {
  const { repo, urls, documents, projects } = setup();
  try {
    const seed = await createSeedAuthoredModelDocument();
    const project = unwrap(
      await projects.create("Enclosure", [
        { name: "Base", kind: "part", docId: seed.documentId },
      ]),
    );
    const first: WorkbenchTab = {
      title: "Base",
      documentId: seed.documentId,
      storageKind: "browser",
      storageDescriptor: null,
    };
    const pending = { tabs: [first], activeDocumentId: first.documentId };
    const second = {
      ...seed,
      documentId: "doc_opened" as const,
      name: "Opened part",
    };
    expect(
      (
        await documents.initialize({
          documentId: second.documentId,
          document: second,
        })
      ).ok,
    ).toBe(true);
    const opened = reduceWorkbenchTabs(pending, {
      type: "open",
      tab: { ...first, documentId: second.documentId, title: second.name },
      activate: true,
    });
    const merged = mergeDiscoveredWorkbenchProjectTabs(project, opened);
    unwrap(
      await projects.setParts(
        project.projectId,
        merged.tabs.map((tab) => ({ docId: tab.documentId, name: tab.title })),
      ),
    );
    const reopened = unwrap(
      await new LocalProjectRepository(documents, urls).open(project.projectId),
    );
    expect(reopened.entries).toEqual([
      expect.objectContaining({
        name: "Base",
        kind: "part",
        docId: seed.documentId,
      }),
      expect.objectContaining({
        name: second.name,
        kind: "part",
        docId: second.documentId,
      }),
    ]);
    expect(merged.activeDocumentId).toBe(second.documentId);
  } finally {
    await repo.shutdown();
  }
});

test("overlapping worker load and project creation share one initialized part", async () => {
  const { repo, urls, documents } = setup();
  const workerDocuments = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: new MemoryDocumentRepositoryUrlStore(),
    assetStore: createMemoryGeometryAssetStore(),
  });
  let releaseLoad!: () => void;
  const loading = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const load = workerDocuments.load.bind(workerDocuments);
  vi.spyOn(workerDocuments, "load").mockImplementation(async (input) => {
    await loading;
    return load(input);
  });
  const projectLoad = vi.spyOn(documents, "load");
  let listener:
    | ((event: MessageEvent<DocumentSyncWorkerResponse>) => void)
    | null = null;
  const handler = createDocumentSyncWorkerMessageHandler(
    { repository: workerDocuments },
    (message) => {
      listener?.({ data: message } as MessageEvent<DocumentSyncWorkerResponse>);
    },
  );
  const worker: DocumentSyncWorkerLike = {
    postMessage: (message) => {
      if (!isProjectSyncWorkerRequest(message)) void handler(message);
    },
    addEventListener: (_type, callback) => {
      listener = callback;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const client = new DocumentSyncWorkerClient({ worker });
  const workerRepository = new WorkerBackedDocumentRepository({
    client,
    urlStore: urls,
  });
  const readiness = new WorkbenchPartReadiness();
  const projects = new LocalProjectRepository(documents, urls, urls, (docId) =>
    readiness.ensure(docId),
  );
  try {
    const seed = {
      ...(await createSeedAuthoredModelDocument()),
      documentId: "doc_unsaved" as const,
    };
    const create = vi.spyOn(repo, "create");
    const workerLoad = workerRepository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    const creating = projects.create("New project", [
      { name: "Workspace", kind: "part", docId: seed.documentId },
    ]);
    const prepare = vi.fn(async () => {
      const loaded = await workerLoad;
      if (!loaded.ok) throw new Error(loaded.status.diagnostic.message);
    });
    readiness.register(prepare);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(urls.get(seed.documentId)).toBeNull();
    releaseLoad();
    const [opened, result] = await Promise.all([workerLoad, creating]);
    expect(opened.ok).toBe(true);
    expect(projectLoad).not.toHaveBeenCalled();
    const project = unwrap(result);
    const url = urls.get(seed.documentId)!;
    const handle = await repo.find<CollaborativeDocument>(url);
    expect(project.entries[0].automergeDocumentId).toBe(handle.documentId);
    expect(materializeCollaborativeDocument(handle.doc()).documentId).toBe(
      seed.documentId,
    );
    expect(
      create.mock.calls.filter(
        ([initial]) =>
          (initial as { format?: string })?.format ===
          "cadara-stable-authored-v3",
      ),
    ).toHaveLength(1);
    const reopened = await workerRepository.load({
      documentId: seed.documentId,
      seedDocument: seed,
    });
    expect(reopened.ok).toBe(true);
    expect(urls.get(seed.documentId)).toBe(url);
    expect(unwrap(await projects.open(project.projectId))).toEqual(project);
  } finally {
    releaseLoad();
    client.dispose();
    readiness.dispose();
    await repo.shutdown();
  }
});

test("missing part identities are diagnosed after the document owner settles without a URL", async () => {
  const { repo, urls, documents } = setup();
  try {
    const owner = vi.fn(async () => {});
    const projects = new LocalProjectRepository(documents, urls, urls, owner);
    const result = await projects.create("Missing part", [
      { kind: "part", name: "Missing", docId: "doc_missing" },
    ]);
    expect(owner).toHaveBeenCalledWith("doc_missing");
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        message: expect.stringContaining("no stored Automerge URL"),
      },
    });
    expect(urls.get("doc_missing")).toBeNull();
  } finally {
    await repo.shutdown();
  }
});

async function seedLegacyManifest(
  repo: Repo,
  urls: MemoryDocumentRepositoryUrlStore,
) {
  const part = repo.create({ content: "part" });
  const readme = repo.create({ content: "readme" });
  urls.set("doc_part", part.url);
  urls.set("doc_notes", readme.url);
  const manifest = repo.create({
    format: "cadara-project" as const,
    schemaVersion: 1 as const,
    projectId: "legacy-project",
    name: "Legacy",
    versions: [],
    entries: [
      { name: "Part", kind: "part" as const, docId: "doc_part" as const },
      { name: "Notes", kind: "readme" as const, docId: "doc_notes" as const },
    ],
  });
  const catalog = repo.create<ProjectCatalog>({
    format: "cadara-project-catalog",
    schemaVersion: 1,
    projects: [{ projectId: "legacy-project", url: manifest.url }],
  });
  urls.set("doc_project_catalog", catalog.url);
  return { manifest, part, readme };
}

test("opening a legacy manifest persists identities resolved once through the local URL store", async () => {
  const { repo, urls, documents, projects } = setup();
  try {
    const { manifest, part, readme } = await seedLegacyManifest(repo, urls);
    const opened = unwrap(await projects.open("legacy-project"));
    expect(opened.entries.map((entry) => entry.automergeDocumentId)).toEqual([
      part.documentId,
      readme.documentId,
    ]);
    expect(manifest.doc().entries).toEqual(opened.entries);
    urls.delete("doc_part");
    urls.delete("doc_notes");
    expect(
      unwrap(
        await new LocalProjectRepository(documents, urls).open(
          "legacy-project",
        ),
      ),
    ).toEqual(opened);
  } finally {
    await repo.shutdown();
  }
});

test.each(["missing URL", "unavailable document"])(
  "unresolvable legacy entries return a diagnostic without a partial migration: %s",
  async (failure) => {
    const { repo, urls, projects } = setup();
    try {
      const { manifest, readme } = await seedLegacyManifest(repo, urls);
      if (failure === "missing URL") urls.delete("doc_notes");
      else {
        const find = repo.find.bind(repo);
        vi.spyOn(repo, "find").mockImplementation((id) => {
          if (id === readme.url)
            return Promise.reject(new Error("Stored document unavailable"));
          return find(id);
        });
      }
      const result = await projects.open("legacy-project");
      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          reasonCode: "project-persistence-failed",
          message: expect.any(String),
        },
      });
      expect(
        manifest
          .doc()
          .entries.every((entry) => !("automergeDocumentId" in entry)),
      ).toBe(true);
    } finally {
      await repo.shutdown();
    }
  },
);

test("setParts retains known identities and persists newly added unsaved parts", async () => {
  const { repo, urls, projects } = setup();
  try {
    const project = unwrap(
      await projects.create("Parts", [
        { name: "Original", kind: "part", docId: "doc_original" },
      ]),
    );
    const original = project.entries[0];
    urls.delete(original.docId);
    const edited = unwrap(
      await projects.setParts(project.projectId, [
        { name: "Renamed", docId: original.docId },
        { name: "New", docId: "doc_added" },
      ]),
    );
    expect(edited.entries[0]).toEqual({ ...original, name: "Renamed" });
    const added = await repo.find(urls.get("doc_added")!);
    expect(edited.entries[1].automergeDocumentId).toBe(added.documentId);
    expect(unwrap(await projects.open(project.projectId))).toEqual(edited);
  } finally {
    await repo.shutdown();
  }
});

test("migration refuses writes when entries change during identity resolution", async () => {
  const { repo, urls, projects } = setup();
  try {
    const { manifest, readme } = await seedLegacyManifest(repo, urls);
    const find = repo.find.bind(repo);
    vi.spyOn(repo, "find").mockImplementation((id) => {
      if (id === readme.url) {
        const entries = JSON.parse(
          JSON.stringify(manifest.doc().entries),
        ).reverse();
        manifest.change((draft) => {
          draft.entries = entries;
        });
      }
      return find(id);
    });
    expect(await projects.open("legacy-project")).toMatchObject({
      ok: false,
      diagnostic: { message: expect.stringContaining("entries changed") },
    });
    expect(manifest.doc().entries.map((entry) => entry.docId)).toEqual([
      "doc_notes",
      "doc_part",
    ]);
    expect(
      manifest
        .doc()
        .entries.every((entry) => !("automergeDocumentId" in entry)),
    ).toBe(true);
  } finally {
    await repo.shutdown();
  }
});

test("an uploaded project records its service link, and a synced manifest joins another catalog with its part identities", async () => {
  const owner = setup();
  try {
    const seed = await createSeedAuthoredModelDocument();
    let project = unwrap(await owner.projects.create("Bracket", []));
    project = unwrap(
      await owner.projects.addPart(
        project.projectId,
        { docId: seed.documentId, name: "Base" },
        seed,
      ),
    );
    const manifestDocumentId = unwrap(
      await owner.projects.manifestDocumentId(project.projectId),
    );
    const link = { orgId: "org", projectId: "remote" };
    expect(
      unwrap(await owner.projects.linkService(project.projectId, link)).service,
    ).toEqual(link);

    // A collaborator's browser: its own catalog and URL store, with the
    // manifest delivered into the shared Repo by sync.
    const guestUrls = new MemoryDocumentRepositoryUrlStore();
    const guest = new LocalProjectRepository(
      owner.documents,
      guestUrls,
      new MemoryDocumentRepositoryUrlStore(),
    );
    const adopted = unwrap(await guest.adoptManifest(manifestDocumentId));
    expect(adopted.projectId).toBe(project.projectId);
    expect(adopted.service).toEqual(link);
    expect(guestUrls.get(seed.documentId)).toBe(
      owner.urls.get(seed.documentId),
    );
    expect(
      unwrap(await guest.list()).map((listed) => listed.projectId),
    ).toEqual([project.projectId]);
    expect(unwrap(await guest.adoptManifest(manifestDocumentId))).toEqual(
      adopted,
    );
    expect(unwrap(await guest.list())).toHaveLength(1);
  } finally {
    await owner.repo.shutdown();
  }
});

/**
 * Two browsers' first projects, each made of the part its workbench
 * bootstrap opened first; sync delivers both into one Repo.
 */
async function twoBrowsersFirstProjects(firstPartId: () => DocumentId) {
  const owner = setup();
  const guest = setup(new MemoryDocumentRepositoryUrlStore(), owner.repo);
  const create = async (browser: typeof owner) => {
    const docId = firstPartId();
    const project = unwrap(
      await browser.projects.create("My project", [
        { name: "Workspace", kind: "part", docId },
      ]),
    );
    return { docId, project, url: browser.urls.get(docId) };
  };
  const owned = await create(owner);
  const guestOwn = await create(guest);
  return {
    owner,
    guest,
    owned,
    guestOwn,
    manifestDocumentId: unwrap(
      await owner.projects.manifestDocumentId(owned.project.projectId),
    ),
  };
}

const freshBrowserFirstPartId = () =>
  createWorkbenchProjectBootstrap(
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    "",
    true,
  ).initialTabs.activeDocumentId;

test("another browser opens a fresh browser's first project beside its own first project", async () => {
  const { owner, guest, owned, guestOwn, manifestDocumentId } =
    await twoBrowsersFirstProjects(freshBrowserFirstPartId);
  try {
    const adopted = unwrap(
      await guest.projects.adoptManifest(manifestDocumentId),
    );

    expect(adopted.projectId).toBe(owned.project.projectId);
    expect(
      guest.urls.get(owned.docId),
      "the owner's part opens from the synced document",
    ).toBe(owned.url);
    expect(
      guest.urls.get(guestOwn.docId),
      "the guest's own first part is untouched",
    ).toBe(guestOwn.url);
    expect(
      unwrap(await guest.projects.list()).map((listed) => listed.projectId),
    ).toEqual([guestOwn.project.projectId, owned.project.projectId]);
  } finally {
    await owner.repo.shutdown();
  }
});

test("two legacy browsers' first parts collide and the refusal names the legacy identity", async () => {
  const { owner, guest, owned, guestOwn, manifestDocumentId } =
    await twoBrowsersFirstProjects(() => OCC_KERNEL_DOCUMENT_ID);
  try {
    const refused = await guest.projects.adoptManifest(manifestDocumentId);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.diagnostic.message).toBe(
      "Workspace uses the legacy first-part identity, and this browser already holds a different document under it. Open the project from a new browser profile.",
    );
    expect(
      guest.urls.get(owned.docId),
      "the guest keeps its own document",
    ).toBe(guestOwn.url);
    expect(
      unwrap(await guest.projects.list()).map((listed) => listed.projectId),
    ).toEqual([guestOwn.project.projectId]);
  } finally {
    await owner.repo.shutdown();
  }
});

test("a stale tab list applies only its own change: a collaborator's part and order survive", async () => {
  const { repo, projects } = setup();
  try {
    const project = unwrap(
      await projects.create("Parts", [
        { name: "Base", kind: "part", docId: "doc_base" },
        { name: "Lid", kind: "part", docId: "doc_lid" },
      ]),
    );
    const local = [
      { name: "Base", docId: "doc_base" as DocumentId },
      { name: "Lid", docId: "doc_lid" as DocumentId },
    ];
    // A collaborator adds a part; this browser's tabs do not show it yet.
    unwrap(
      await projects.setParts(project.projectId, [
        ...local,
        { name: "Hinge", docId: "doc_hinge" as DocumentId },
      ]),
    );
    const renamed = unwrap(
      await projects.setParts(
        project.projectId,
        [local[1]!, { ...local[0]!, name: "Body" }],
        local,
      ),
    );
    expect(
      renamed.entries.map((entry) => `${entry.docId}:${entry.name}`),
    ).toEqual(["doc_base:Body", "doc_lid:Lid", "doc_hinge:Hinge"]);
    const removed = unwrap(
      await projects.setParts(
        project.projectId,
        [{ ...local[0]!, name: "Body" }],
        [local[1]!, { ...local[0]!, name: "Body" }],
      ),
    );
    expect(removed.entries.map((entry) => entry.docId)).toEqual([
      "doc_base",
      "doc_hinge",
    ]);
  } finally {
    await repo.shutdown();
  }
});
