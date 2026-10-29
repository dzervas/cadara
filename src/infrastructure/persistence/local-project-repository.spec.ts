import { expect, test } from "vitest";
import { mergeDiscoveredWorkbenchProjectTabs } from "@/core/workspace/workbench-project-tabs";
import {
  reduceWorkbenchTabs,
  type WorkbenchTab,
} from "@/core/workspace/workbench-tabs";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { Repo } from "@automerge/automerge-repo";
import * as Automerge from "@automerge/automerge";
import type { AutomergeRepositoryLike } from "./indexeddb-automerge-document-repository";
import { IndexedDbAutomergeDocumentRepository } from "./indexeddb-automerge-document-repository";
import { MemoryDocumentRepositoryUrlStore } from "./document-repository-url-store";
import { LocalProjectRepository } from "./local-project-repository";
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

function setup() {
  const repo = new Repo();
  const urls = new MemoryDocumentRepositoryUrlStore();
  const documents = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: urls,
    assetStore: createMemoryGeometryAssetStore(),
  });
  return {
    repo,
    urls,
    documents,
    projects: new LocalProjectRepository(documents, urls),
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
    const firstUrl = urls.get(seed.documentId);
    let project = unwrap(
      await projects.create("Enclosure", [
        { name: "Base", kind: "part", docId: seed.documentId },
      ]),
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
  const first = setup();
  const second = setup();
  const sharedPartUrls = new MemoryDocumentRepositoryUrlStore();
  const firstProjects = new LocalProjectRepository(
    first.documents,
    sharedPartUrls,
    new MemoryDocumentRepositoryUrlStore(),
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
    const secondProject = unwrap(
      await secondProjects.create("Second database", [
        { name: "Part", kind: "part", docId: "doc_workspace" },
      ]),
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
      { name: "Lid", kind: "part", docId: "doc_lid" },
      { name: "Housing", kind: "part", docId: "doc_base" },
      ...otherEntries,
    ]);
    project = unwrap(
      await projects.setParts(project.projectId, [
        { name: "Housing", docId: "doc_base" },
      ]),
    );
    expect(unwrap(await projects.open(project.projectId)).entries).toEqual([
      { name: "Housing", kind: "part", docId: "doc_base" },
      ...otherEntries,
    ]);
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
      { name: "Base", kind: "part", docId: seed.documentId },
      { name: second.name, kind: "part", docId: second.documentId },
    ]);
    expect(merged.activeDocumentId).toBe(second.documentId);
  } finally {
    await repo.shutdown();
  }
});
