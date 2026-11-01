import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { createBrowserAutomergeRepo } from "@/infrastructure/persistence/browser-automerge-repo";
import { LocalProjectCatalog } from "@/infrastructure/persistence/local-project-catalog";
import { resolveLocalProjectStorage } from "@/infrastructure/persistence/document-repository-url-store";

export function createDashboardLocalProjects(storage: Storage, search: string) {
  const { databaseName, partUrls, catalogUrls } = resolveLocalProjectStorage(
    storage,
    search,
  );
  const repo = createBrowserAutomergeRepo(
    new IndexedDBStorageAdapter(databaseName, "documents"),
  );
  return new LocalProjectCatalog(
    { getAutomergeRepository: () => repo },
    partUrls,
    catalogUrls,
  );
}
