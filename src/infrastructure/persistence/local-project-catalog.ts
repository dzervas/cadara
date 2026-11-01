import type { DocumentId } from "@/contracts/shared/ids";
import type { ProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import { validateProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import type {
  ProjectManifest,
  ProjectEntry,
  ProjectResult,
} from "@/contracts/modeling/project-manifest";
import {
  parseProjectManifest,
  validateLegacyProjectManifest,
} from "@/contracts/modeling/project-manifest.runtime-schema";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import type {
  AutomergeHandleLike,
  AutomergeRepositoryLike,
} from "./indexeddb-automerge-document-repository";
import type { DocumentRepositoryUrlStore } from "./document-repository-url-store";

export const CATALOG_ID = "doc_project_catalog" as DocumentId;

/** Catalog and manifests only: reading projects never materializes part geometry. */
interface ProjectDocuments {
  getAutomergeRepository(): Promise<AutomergeRepositoryLike>;
}
export class LocalProjectCatalog<
  TDocuments extends ProjectDocuments = ProjectDocuments,
> {
  private queue: Promise<unknown> = Promise.resolve();
  protected readonly documents: TDocuments;
  protected readonly urls: DocumentRepositoryUrlStore;
  protected readonly catalogUrls: DocumentRepositoryUrlStore;
  protected readonly ensurePartReady?: (docId: DocumentId) => Promise<void>;
  constructor(
    documents: TDocuments,
    urls: DocumentRepositoryUrlStore,
    catalogUrls = urls,
    ensurePartReady?: (docId: DocumentId) => Promise<void>,
  ) {
    this.documents = documents;
    this.urls = urls;
    this.catalogUrls = catalogUrls;
    this.ensurePartReady = ensurePartReady;
  }
  protected run<T>(operation: () => Promise<T>): Promise<ProjectResult<T>> {
    const next = this.queue.then(async (): Promise<ProjectResult<T>> => {
      try {
        return { ok: true, value: await operation() };
      } catch (error) {
        return {
          ok: false,
          diagnostic: {
            reasonCode: "project-persistence-failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });
    this.queue = next;
    return next;
  }

  protected async catalog() {
    const repo = await this.documents.getAutomergeRepository();
    const url = this.catalogUrls.get(CATALOG_ID);
    const handle = url
      ? await repo.find<ProjectCatalog>(url)
      : repo.create<ProjectCatalog>({
          format: "cadara-project-catalog",
          schemaVersion: 1,
          projects: [],
        });
    await handle.whenReady();
    const parsed = validateProjectCatalog(handle.doc());
    if (
      !parsed.success ||
      parsed.data.projects.some(
        (project) =>
          !project.projectId.trim() || !isValidAutomergeUrl(project.url),
      )
    )
      throw new Error("Invalid local project catalog.");
    if (!url) {
      await repo.flush?.([handle.documentId]);
      this.catalogUrls.set(CATALOG_ID, handle.url);
    }
    return handle;
  }

  protected checked(handle: AutomergeHandleLike<ProjectManifest>) {
    const result = parseProjectManifest(handle.doc());
    if (!result.ok) throw new Error(result.diagnostic.message);
    return JSON.parse(JSON.stringify(result.value)) as ProjectManifest;
  }

  /**
   * The Automerge identity is part of the stored URL. A local peer's
   * document (URL shared, data only in the peer's storage and the sync
   * worker) is not loadable here, so it is never loaded for its identity.
   */
  protected storedDocumentId(docId: DocumentId) {
    const url = this.urls.get(docId);
    if (!url) throw new Error(`Document ${docId} has no stored Automerge URL.`);
    return parseAutomergeUrl(url).documentId;
  }

  protected async partEntry(entry: {
    name: string;
    docId: DocumentId;
  }): Promise<ProjectEntry> {
    if (!entry.name.trim() || !entry.docId.trim())
      throw new Error("Project entries require names and document identities.");
    // The workbench's document owner initializes unsaved tabs; a second repository must not seed them.
    if (!this.urls.get(entry.docId)) await this.ensurePartReady?.(entry.docId);
    return {
      ...entry,
      kind: "part",
      automergeDocumentId: this.storedDocumentId(entry.docId),
    };
  }

  /**
   * The manifest with legacy entries' missing identities (from before
   * manifests recorded them) filled from their stored URLs, and the indices
   * of the filled entries.
   */
  protected migration(
    value: unknown,
  ): ProjectResult<{ manifest: ProjectManifest; filled: number[] }> {
    const failed = (message: string) => ({
      ok: false as const,
      diagnostic: { reasonCode: "invalid-project-manifest", message },
    });
    const legacy = validateLegacyProjectManifest(value);
    if (!legacy.success) return failed("Invalid project manifest.");
    const next = JSON.parse(JSON.stringify(legacy.data)) as ProjectManifest;
    const filled: number[] = [];
    for (const [index, entry] of next.entries.entries()) {
      if (entry.automergeDocumentId !== undefined) continue;
      const url = this.urls.get(entry.docId);
      if (!url)
        return failed(`Document ${entry.docId} has no stored Automerge URL.`);
      entry.automergeDocumentId = parseAutomergeUrl(url).documentId;
      filled.push(index);
    }
    const parsed = parseProjectManifest(next);
    return parsed.ok
      ? { ok: true, value: { manifest: parsed.value, filled } }
      : parsed;
  }

  protected async migrate(handle: AutomergeHandleLike<ProjectManifest>) {
    const migration = this.migration(handle.doc());
    if (!migration.ok) throw new Error(migration.diagnostic.message);
    const { manifest, filled } = migration.value;
    if (!filled.length) return;
    handle.change((draft) => {
      for (const index of filled)
        draft.entries[index].automergeDocumentId =
          manifest.entries[index].automergeDocumentId;
    });
    await (
      await this.documents.getAutomergeRepository()
    ).flush?.([handle.documentId]);
  }

  protected async handle(projectId: string) {
    const catalog = await this.catalog();
    const entry = catalog
      .doc()
      .projects.find((project) => project.projectId === projectId);
    if (!entry) throw new Error("Project not found in this browser.");
    const handle = await (
      await this.documents.getAutomergeRepository()
    ).find<ProjectManifest>(entry.url as AutomergeUrl);
    await handle.whenReady();
    await this.migrate(handle);
    if (this.checked(handle).projectId !== projectId)
      throw new Error("Project identity does not match its catalog entry.");
    return handle;
  }

  list() {
    return this.run(async () => {
      const catalog = await this.catalog();
      const projects: ProjectManifest[] = [];
      for (const entry of catalog.doc().projects)
        projects.push(this.checked(await this.handle(entry.projectId)));
      return projects;
    });
  }

  create(
    name: string,
    entries: Omit<ProjectEntry, "automergeDocumentId">[],
    forkedFrom?: ProjectManifest["forkedFrom"],
  ) {
    return this.run(async () => {
      if (entries.some((entry) => entry.kind === "assembly"))
        throw new Error("Assembly documents are not implemented.");
      const manifest: ProjectManifest = {
        format: "cadara-project",
        schemaVersion: 1,
        projectId: crypto.randomUUID(),
        name,
        entries: await Promise.all(
          entries.map(async (entry) =>
            entry.kind === "part"
              ? this.partEntry(entry)
              : {
                  ...entry,
                  automergeDocumentId: this.storedDocumentId(entry.docId),
                },
          ),
        ),
        versions: [],
        ...(forkedFrom ? { forkedFrom } : {}),
      };
      const parsed = parseProjectManifest(manifest);
      if (!parsed.ok) throw new Error(parsed.diagnostic.message);
      const repo = await this.documents.getAutomergeRepository();
      const catalog = await this.catalog();
      const handle = repo.create(manifest);
      await handle.whenReady();
      await repo.flush?.([handle.documentId]);
      catalog.change((draft) => {
        draft.projects.push({ projectId: manifest.projectId, url: handle.url });
      });
      await repo.flush?.([catalog.documentId]);
      return this.checked(handle);
    });
  }

  open(projectId: string) {
    return this.run(async () => this.checked(await this.handle(projectId)));
  }
}
