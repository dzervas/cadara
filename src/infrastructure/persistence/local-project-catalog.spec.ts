// Logic lane: catalog reads share editor persistence and never open part documents.
import { expect, test } from "vitest";
import { Repo } from "@automerge/automerge-repo";
import type { AutomergeRepositoryLike } from "./indexeddb-automerge-document-repository";
import { IndexedDbAutomergeDocumentRepository } from "./indexeddb-automerge-document-repository";
import { LocalProjectRepository } from "./local-project-repository";
import { LocalProjectCatalog } from "./local-project-catalog";
import { MemoryDocumentRepositoryUrlStore } from "./document-repository-url-store";
import type { DocumentId } from "@/contracts/shared/ids";

test("the kernel-free catalog lists the same stored manifests as the editor without loading their parts", async () => {
  const repo = new Repo();
  const urls = new MemoryDocumentRepositoryUrlStore();
  const part = repo.create({ format: "part-document-not-read-by-the-catalog" });
  urls.set("doc_fixture" as DocumentId, part.url);
  const documents = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: urls,
  });
  const editor = new LocalProjectRepository(documents, urls);
  try {
    const created = await editor.create("Stored bracket", [
      { name: "Bracket", kind: "part", docId: "doc_fixture" as DocumentId },
    ]);
    if (!created.ok) throw new Error(created.diagnostic.message);
    const openedIds: string[] = [];
    const reader = new LocalProjectCatalog(
      {
        getAutomergeRepository: async () =>
          ({
            create: repo.create.bind(repo),
            find: async (id) => {
              openedIds.push(id);
              return repo.find(id);
            },
            delete: repo.delete.bind(repo),
          }) as AutomergeRepositoryLike,
      },
      urls,
    );
    const listed = await reader.list();
    expect(listed).toEqual({ ok: true, value: [created.value] });
    expect(openedIds).not.toContain(part.url);
    expect(await reader.open(created.value.projectId)).toEqual(
      await editor.open(created.value.projectId),
    );
  } finally {
    await repo.shutdown();
  }
});
